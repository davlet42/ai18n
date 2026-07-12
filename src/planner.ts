import type { Leaf } from './locale-files.js';
import { keyId, sha256, type Lockfile } from './lockfile.js';

// The sync brain. Pure: takes the flattened source, a flattened target and the
// lockfile — returns what to do with every key of one (namespace, targetLang)
// pair. Executing the plan (translation, file/lock writes) happens elsewhere.
//
// Ownership rules (design decision 2026-07-12 — "manual edits are sacred"):
//   * a target value that does not match what ai18n last wrote belongs to a
//     human and is never overwritten;
//   * a human-owned key whose SOURCE text changed is surfaced for review
//     instead of being silently retranslated;
//   * keys that exist in the target but not in the source are pruned;
//   * non-string leaves mirror the source verbatim.

export type KeyAction =
  | { type: 'translate'; key: string; sourceText: string }
  | { type: 'retranslate'; key: string; sourceText: string }
  | { type: 'keep'; key: string; value: Leaf }
  | { type: 'adopt'; key: string; value: string } // pre-existing/hand value → keep + record as human
  | { type: 'review'; key: string; sourceText: string; currentValue: string }
  | { type: 'copy'; key: string; value: Leaf } // non-string leaf mirrored from source
  | { type: 'prune'; key: string };

export interface NamespacePlan {
  namespace: string;
  lang: string;
  actions: KeyAction[];
}

export interface PlanCounts {
  translate: number;
  retranslate: number;
  keep: number;
  adopt: number;
  review: number;
  copy: number;
  prune: number;
}

export function planNamespace(options: {
  namespace: string;
  lang: string;
  source: Map<string, Leaf>;
  target: Map<string, Leaf>;
  lock: Lockfile;
}): NamespacePlan {
  const { namespace, lang, source, target, lock } = options;
  const actions: KeyAction[] = [];

  for (const [key, sourceValue] of source) {
    if (typeof sourceValue !== 'string') {
      actions.push({ type: 'copy', key, value: sourceValue });
      continue;
    }
    if (sourceValue === '') {
      actions.push({ type: 'copy', key, value: '' });
      continue;
    }

    const id = keyId(namespace, key);
    const entry = lock.keys[id];
    const locked = entry?.targets[lang];
    const targetValue = target.get(key);
    const sourceChanged = entry ? entry.source !== sha256(sourceValue) : false;

    if (targetValue === undefined || typeof targetValue !== 'string' || targetValue === '') {
      actions.push({ type: 'translate', key, sourceText: sourceValue });
      continue;
    }

    if (!locked) {
      // Value predates ai18n (first run over an existing project) — adopt it
      // as human-owned so it is protected from now on.
      actions.push({ type: 'adopt', key, value: targetValue });
      continue;
    }

    const humanEdited = locked.by === 'human' || locked.sha !== sha256(targetValue);

    if (humanEdited) {
      if (sourceChanged) {
        actions.push({ type: 'review', key, sourceText: sourceValue, currentValue: targetValue });
      } else {
        actions.push({ type: 'adopt', key, value: targetValue });
      }
      continue;
    }

    if (sourceChanged) {
      actions.push({ type: 'retranslate', key, sourceText: sourceValue });
    } else {
      actions.push({ type: 'keep', key, value: targetValue });
    }
  }

  for (const key of target.keys()) {
    if (!source.has(key)) {
      actions.push({ type: 'prune', key });
    }
  }

  return { namespace, lang, actions };
}

export function countPlan(plans: NamespacePlan[]): PlanCounts {
  const counts: PlanCounts = {
    translate: 0,
    retranslate: 0,
    keep: 0,
    adopt: 0,
    review: 0,
    copy: 0,
    prune: 0,
  };
  for (const plan of plans) {
    for (const action of plan.actions) {
      counts[action.type] += 1;
    }
  }
  return counts;
}
