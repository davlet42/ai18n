import { existsSync, readFileSync } from 'node:fs';
import YAML from 'yaml';
import { flattenTree, FLAT_NS, type LocaleTree } from './locale-files.js';
import { keyId } from './lockfile.js';

// ai18n.context.yaml — translator hints per key. Namespaced layouts nest under
// the namespace name; flat layouts put keys at the top level:
//
//   # namespaces:                      # flat:
//   auth:                              # greet: "Home screen greeting"
//     login.button: "Keep short"
//
// Values are free-form English hints ("button on the payment screen",
// "{name} is the user's first name"). Missing file → no hints, never an error.

export function loadContextMap(path: string, layoutKind: 'flat' | 'namespaces'): Map<string, string> {
  const out = new Map<string, string>();
  if (!existsSync(path)) {
    return out;
  }
  const doc = YAML.parse(readFileSync(path, 'utf8')) as unknown;
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return out;
  }

  if (layoutKind === 'flat') {
    for (const [key, hint] of flattenTree(doc as LocaleTree)) {
      if (typeof hint === 'string' && hint.trim() !== '') {
        out.set(keyId(FLAT_NS, key), hint);
      }
    }
    return out;
  }

  for (const [namespace, sub] of Object.entries(doc as Record<string, unknown>)) {
    if (!sub || typeof sub !== 'object' || Array.isArray(sub)) {
      continue;
    }
    for (const [key, hint] of flattenTree(sub as LocaleTree)) {
      if (typeof hint === 'string' && hint.trim() !== '') {
        out.set(keyId(namespace, key), hint);
      }
    }
  }
  return out;
}

// ai18n.glossary.yaml — terms the translator must respect:
//   terms:
//     - Poieton              # bare term: keep untranslated
//     - "Wallet = Кошелёк"   # pin an exact translation
// A plain YAML list (without the `terms:` wrapper) is accepted too.
export function loadGlossaryTerms(path: string): string[] {
  if (!existsSync(path)) {
    return [];
  }
  const doc = YAML.parse(readFileSync(path, 'utf8')) as unknown;
  const list = Array.isArray(doc)
    ? doc
    : doc && typeof doc === 'object' && Array.isArray((doc as { terms?: unknown }).terms)
      ? (doc as { terms: unknown[] }).terms
      : [];
  return list.filter((t): t is string => typeof t === 'string' && t.trim() !== '');
}
