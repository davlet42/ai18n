import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { flattenTree, type LocaleTree } from '../locale-files.js';
import { collectArgOrder, findIcuMessage, hasSecondIcuMessage, toPositional } from './transform.js';

// iOS emitter: a single Localizable.xcstrings (Xcode String Catalog, JSON).
// Keys keep their dotted form (`common.search.placeholder`, namespaces
// prefixed: `auth.login.button`). ICU plural → plural variations;
// {name} → positional %n$@ (order from the source string), # → %lld.

interface StringUnit {
  stringUnit: { state: 'translated'; value: string };
}

interface Variations {
  variations: { plural: Record<string, StringUnit> };
}

type Localization = StringUnit | Variations;

function positionalize(value: string, sourceValue: string, hash: boolean): string {
  const order = collectArgOrder(sourceValue, hash);
  return toPositional(value, order, (i, token) => (token === '#' ? '%lld' : `%${i}$@`));
}

const XCSTRINGS_PLURALS = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);

export function emitXcstrings(options: {
  sourceLang: string;
  languages: string[]; // includes source
  namespaces: { namespace: string; treeByLang: Map<string, LocaleTree> }[];
}): { json: string; warnings: string[] } {
  const warnings: string[] = [];
  const strings: Record<string, { localizations: Record<string, Localization> }> = {};

  for (const { namespace, treeByLang } of options.namespaces) {
    const sourceTree = treeByLang.get(options.sourceLang);
    if (!sourceTree) continue;
    const sourceFlat = flattenTree(sourceTree);

    for (const [key, sourceValue] of sourceFlat) {
      if (typeof sourceValue !== 'string' || sourceValue === '') continue;
      const fullKey = namespace ? `${namespace}.${key}` : key;

      if (hasSecondIcuMessage(sourceValue)) {
        warnings.push(`${namespace}:${key} — multiple ICU blocks; exported verbatim`);
      }
      const srcIcu = hasSecondIcuMessage(sourceValue) ? null : findIcuMessage(sourceValue);

      const localizations: Record<string, Localization> = {};
      for (const lang of options.languages) {
        const tree = treeByLang.get(lang);
        if (!tree) continue;
        const value = flattenTree(tree).get(key);
        if (typeof value !== 'string' || value === '') continue;

        const icu = srcIcu ? findIcuMessage(value) : null;
        if (srcIcu && icu && srcIcu.keyword === 'plural') {
          const plural: Record<string, StringUnit> = {};
          for (const category of icu.categories) {
            if (!XCSTRINGS_PLURALS.has(category.name)) {
              warnings.push(`${namespace}:${key} — plural category "${category.name}" skipped for xcstrings`);
              continue;
            }
            const srcBody = srcIcu.categories.find((c) => c.name === category.name)?.body ?? category.body;
            const full = `${icu.before}${category.body}${icu.after}`;
            const srcFull = `${srcIcu.before}${srcBody}${srcIcu.after}`;
            plural[category.name] = {
              stringUnit: { state: 'translated', value: positionalize(full, srcFull, true) },
            };
          }
          localizations[lang] = { variations: { plural } };
        } else {
          localizations[lang] = {
            stringUnit: { state: 'translated', value: positionalize(value, sourceValue, false) },
          };
        }
      }
      strings[fullKey] = { localizations };
    }
  }

  const catalog = { sourceLanguage: options.sourceLang, strings, version: '1.0' };
  return { json: `${JSON.stringify(catalog, null, 2)}\n`, warnings };
}

export function writeXcstrings(outPath: string, json: string): string {
  const path = outPath.endsWith('.xcstrings') ? outPath : join(outPath, 'Localizable.xcstrings');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, json, 'utf8');
  return path;
}
