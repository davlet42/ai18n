import type { I18nAgentConfig } from '../config.js';
import { parseExports, selectNamespaces } from '../commands/export.js';
import {
  detectLayout,
  flattenTree,
  listNamespaces,
  readLocaleTree,
  type Leaf,
} from '../locale-files.js';
import { validateAndroidMarkup, validateAnnotationMaskMarkers } from '../android-markup.js';
import { validateCldrPluralPair } from './cldr-plural.js';
import { validateFormatArgSet } from './placeholder-set.js';

export type AndroidCheckKind = 'plural' | 'placeholder' | 'markup' | 'mask';

export interface AndroidCheckIssue {
  lang: string;
  namespace: string;
  key: string;
  kind: AndroidCheckKind;
  message: string;
}

export interface AndroidCheckOptions {
  namespaces?: string[];
}

export function runAndroidStructuralCheck(
  config: I18nAgentConfig,
  options: AndroidCheckOptions = {},
): AndroidCheckIssue[] {
  const layout = detectLayout(config.localesDir, config.source);
  const allNamespaces = listNamespaces(layout, config.source);
  const exports = parseExports(config.exportsRaw, config.root);
  const androidExport = exports.find((entry) => entry.platform === 'android');
  const filter = options.namespaces ?? androidExport?.android?.namespaces;
  const { selected: namespaces, unknown } = selectNamespaces(allNamespaces, filter);

  const issues: AndroidCheckIssue[] = [];
  for (const ns of unknown) {
    issues.push({
      lang: '*',
      namespace: ns,
      key: '*',
      kind: 'plural',
      message: `unknown android namespace filter "${ns}"`,
    });
  }

  const sourceFlatByNs = new Map<string, Map<string, Leaf>>();
  for (const ns of namespaces) {
    const tree = readLocaleTree(layout, config.source, ns);
    if (!tree) {
      continue;
    }
    sourceFlatByNs.set(ns, flattenTree(tree));
  }

  for (const lang of config.targets) {
    for (const ns of namespaces) {
      const sourceFlat = sourceFlatByNs.get(ns);
      if (!sourceFlat) {
        continue;
      }
      const targetTree = readLocaleTree(layout, lang, ns);
      const targetFlat = targetTree ? flattenTree(targetTree) : new Map<string, Leaf>();

      for (const [key, sourceValue] of sourceFlat) {
        if (typeof sourceValue !== 'string' || sourceValue === '') {
          continue;
        }
        const targetValue = targetFlat.get(key);
        if (typeof targetValue !== 'string' || targetValue === '') {
          continue;
        }

        for (const message of validateCldrPluralPair(sourceValue, targetValue, lang)) {
          issues.push({ lang, namespace: ns, key, kind: 'plural', message });
        }
        for (const message of validateFormatArgSet(sourceValue, targetValue)) {
          issues.push({ lang, namespace: ns, key, kind: 'placeholder', message });
        }
        for (const message of validateAndroidMarkup(sourceValue, targetValue)) {
          issues.push({ lang, namespace: ns, key, kind: 'markup', message });
        }
        for (const message of validateAnnotationMaskMarkers(targetValue)) {
          issues.push({ lang, namespace: ns, key, kind: 'mask', message });
        }
      }
    }
  }

  return issues;
}

export function runMaskMarkerCheck(config: I18nAgentConfig): AndroidCheckIssue[] {
  const layout = detectLayout(config.localesDir, config.source);
  const namespaces = listNamespaces(layout, config.source);
  const issues: AndroidCheckIssue[] = [];
  const langs = [config.source, ...config.targets];

  for (const lang of langs) {
    for (const ns of namespaces) {
      const tree = readLocaleTree(layout, lang, ns);
      if (!tree) {
        continue;
      }
      for (const [key, value] of flattenTree(tree)) {
        if (typeof value !== 'string') {
          continue;
        }
        for (const message of validateAnnotationMaskMarkers(value)) {
          issues.push({ lang, namespace: ns, key, kind: 'mask', message });
        }
      }
    }
  }

  return issues;
}

export function formatAndroidCheckIssues(issues: AndroidCheckIssue[]): string[] {
  return issues.map((issue) => {
    const ns = issue.namespace ? `${issue.namespace}:` : '';
    return `[${issue.lang}] ${ns}${issue.key} (${issue.kind}): ${issue.message}`;
  });
}
