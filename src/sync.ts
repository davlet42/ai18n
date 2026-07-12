import { join } from 'node:path';
import type { Ai18nConfig } from './config.js';
import { loadContextMap, loadGlossaryTerms } from './context-glossary.js';
import {
  detectLayout,
  flattenTree,
  listNamespaces,
  readLocaleTree,
  writeLocaleTree,
  buildTargetTree,
  type Leaf,
  type LocaleLayout,
  type LocaleTree,
} from './locale-files.js';
import {
  keyId,
  pruneKey,
  readLockfile,
  recordHumanValue,
  recordTranslation,
  writeLockfile,
  type Lockfile,
} from './lockfile.js';
import { countPlan, planNamespace, type NamespacePlan, type PlanCounts } from './planner.js';
import {
  claudeCliTransport,
  translateBatch,
  type BatchItem,
  type BatchTransport,
} from './translate-batch.js';

// The orchestrator behind `translate`, `check` and `status`: read everything,
// plan every (namespace × target language) pair, optionally execute the plan
// (translate, write target files mirroring the source, update the lockfile).

export interface ReviewItem {
  namespace: string;
  lang: string;
  key: string;
  sourceText: string;
  currentValue: string;
}

export interface SyncState {
  layout: LocaleLayout;
  lock: Lockfile;
  lockPath: string;
  namespaces: string[];
  sourceTrees: Map<string, LocaleTree>; // ns → tree
  sourceFlat: Map<string, Map<string, Leaf>>; // ns → flat entries
  plans: NamespacePlan[]; // per ns × lang
  counts: PlanCounts;
  countsByLang: Map<string, PlanCounts>;
  reviews: ReviewItem[];
}

export function computeSync(config: Ai18nConfig): SyncState {
  const layout = detectLayout(config.localesDir, config.source);
  const lockPath = join(config.root, 'ai18n.lock');
  const lock = readLockfile(lockPath);
  const namespaces = listNamespaces(layout, config.source);

  const sourceTrees = new Map<string, LocaleTree>();
  const sourceFlat = new Map<string, Map<string, Leaf>>();
  for (const ns of namespaces) {
    const tree = readLocaleTree(layout, config.source, ns);
    if (!tree) {
      continue;
    }
    sourceTrees.set(ns, tree);
    sourceFlat.set(ns, flattenTree(tree));
  }

  const plans: NamespacePlan[] = [];
  const reviews: ReviewItem[] = [];
  const countsByLang = new Map<string, PlanCounts>();

  for (const lang of config.targets) {
    const langPlans: NamespacePlan[] = [];
    for (const ns of namespaces) {
      const source = sourceFlat.get(ns);
      if (!source) {
        continue;
      }
      const targetTree = readLocaleTree(layout, lang, ns);
      const target = targetTree ? flattenTree(targetTree) : new Map<string, Leaf>();
      const plan = planNamespace({ namespace: ns, lang, source, target, lock });
      langPlans.push(plan);
      for (const action of plan.actions) {
        if (action.type === 'review') {
          reviews.push({
            namespace: ns,
            lang,
            key: action.key,
            sourceText: action.sourceText,
            currentValue: action.currentValue,
          });
        }
      }
    }
    plans.push(...langPlans);
    countsByLang.set(lang, countPlan(langPlans));
  }

  return {
    layout,
    lock,
    lockPath,
    namespaces,
    sourceTrees,
    sourceFlat,
    plans,
    counts: countPlan(plans),
    countsByLang,
    reviews,
  };
}

export interface ApplySyncOptions {
  transport?: BatchTransport; // tests inject; default = subscription agent
  retranslateStale?: boolean; // also machine-translate `review` keys
  langs?: string[]; // subset of config.targets
}

export interface ApplySyncResult {
  writtenFiles: string[];
  translated: number;
  migrated: number;
  pruned: number;
  failed: { id: string; lang: string; reason: string }[];
  reviews: ReviewItem[];
  calls: number;
}

export async function applySync(
  config: Ai18nConfig,
  state: SyncState,
  options: ApplySyncOptions = {},
): Promise<ApplySyncResult> {
  const transport = options.transport ?? claudeCliTransport({ model: config.model });
  const contextMap = loadContextMap(config.contextPath, state.layout.kind);
  const glossaryTerms = loadGlossaryTerms(config.glossaryPath);
  const langs = options.langs ?? config.targets;

  const result: ApplySyncResult = {
    writtenFiles: [],
    translated: 0,
    migrated: 0,
    pruned: 0,
    failed: [],
    reviews: options.retranslateStale ? [] : state.reviews.filter((r) => langs.includes(r.lang)),
    calls: 0,
  };

  for (const lang of langs) {
    const langPlans = state.plans.filter((p) => p.lang === lang);

    // 1) collect what needs machine translation for this language
    const items: BatchItem[] = [];
    for (const plan of langPlans) {
      for (const action of plan.actions) {
        const wants =
          action.type === 'translate' ||
          action.type === 'retranslate' ||
          (options.retranslateStale && action.type === 'review');
        if (!wants) {
          continue;
        }
        const id = keyId(plan.namespace, action.key);
        items.push({ id, text: (action as { sourceText: string }).sourceText, context: contextMap.get(id) });
      }
    }

    const batch = await translateBatch(items, {
      sourceLang: config.source,
      targetLang: lang,
      glossaryTerms,
      transport,
      model: config.model,
    });
    result.calls += batch.calls;
    for (const failure of batch.failed) {
      result.failed.push({ id: failure.id, lang, reason: failure.reason });
    }

    // 2) rebuild every namespace tree for this language and update the lock
    for (const plan of langPlans) {
      const ns = plan.namespace;
      const sourceTree = state.sourceTrees.get(ns);
      const sourceFlat = state.sourceFlat.get(ns);
      if (!sourceTree || !sourceFlat) {
        continue;
      }

      const values = new Map<string, Leaf>();
      for (const action of plan.actions) {
        const id = keyId(ns, action.key);
        switch (action.type) {
          case 'keep':
          case 'copy':
            values.set(action.key, action.value);
            break;
          case 'adopt': {
            values.set(action.key, action.value);
            recordHumanValue(state.lock, id, lang, sourceFlat.get(action.key) as string, action.value);
            break;
          }
          case 'rename': {
            values.set(action.key, action.value);
            const sourceText = sourceFlat.get(action.key) as string;
            if (action.by === 'human') {
              recordHumanValue(state.lock, id, lang, sourceText, action.value);
            } else {
              recordTranslation(state.lock, id, lang, sourceText, action.value);
            }
            result.migrated += 1;
            break;
          }
          case 'translate':
          case 'retranslate': {
            const translated = batch.translations.get(id);
            if (translated !== undefined) {
              values.set(action.key, translated);
              recordTranslation(state.lock, id, lang, action.sourceText, translated);
              result.translated += 1;
            }
            // failed or quota: no value → the key is omitted from the target
            // file (runtime falls back via the i18n library) and, with no
            // lock entry, the next run retries it.
            break;
          }
          case 'review': {
            if (options.retranslateStale) {
              const translated = batch.translations.get(id);
              if (translated !== undefined) {
                values.set(action.key, translated);
                recordTranslation(state.lock, id, lang, action.sourceText, translated);
                result.translated += 1;
              } else {
                values.set(action.key, action.currentValue);
                result.failed.push({ id, lang, reason: 'retranslate_stale_failed' });
              }
            } else {
              values.set(action.key, action.currentValue);
            }
            break;
          }
          case 'prune':
            pruneKey(state.lock, id, lang);
            result.pruned += 1;
            break;
        }
      }

      const path = writeLocaleTree(state.layout, lang, ns, buildTargetTree(sourceTree, values));
      result.writtenFiles.push(path);
    }
  }

  // 3) lock hygiene: entries whose key vanished from the source in every
  // namespace lose their reason to exist.
  for (const id of Object.keys(state.lock.keys)) {
    const sep = id.indexOf(':');
    const ns = id.slice(0, sep);
    const key = id.slice(sep + 1);
    const source = state.sourceFlat.get(ns);
    if (!source || !source.has(key)) {
      pruneKey(state.lock, id);
    }
  }

  writeLockfile(state.lockPath, state.lock);
  return result;
}
