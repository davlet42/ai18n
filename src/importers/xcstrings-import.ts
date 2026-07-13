import type { Leaf, LocaleTree } from '../locale-files.js';

// iOS String Catalog (.xcstrings) → canonical locale trees per language.
// Dot-separated keys (auth.signIn.title) become nesting — the engine treats
// dots as path separators, so a literal-dot key cannot survive anyway and
// nesting is the faithful canonical shape. Plural variations become ICU
// plural; %lld inside plural bodies becomes ICU `#`; other Apple printf
// specifiers (%@, %1$@) are kept verbatim (the placeholder guard knows them).

export interface XcstringsImportResult {
  sourceLang: string;
  byLang: Map<string, { [key: string]: LocaleTree | Leaf }>;
  warnings: string[];
}

interface StringUnit {
  value?: unknown;
}

interface Localization {
  stringUnit?: StringUnit;
  variations?: { plural?: Record<string, { stringUnit?: StringUnit }> };
}

interface CatalogEntry {
  localizations?: Record<string, Localization>;
}

interface Catalog {
  sourceLanguage?: unknown;
  strings?: Record<string, CatalogEntry>;
}

function toIcuPluralBody(value: string): string {
  return value.replace(/%(\d+\$)?(?:ll)?d/g, '#');
}

function localizedValue(loc: Localization): string | null {
  if (typeof loc.stringUnit?.value === 'string') {
    return loc.stringUnit.value;
  }
  const plural = loc.variations?.plural;
  if (plural && typeof plural === 'object') {
    const parts: string[] = [];
    for (const [category, variation] of Object.entries(plural)) {
      if (typeof variation?.stringUnit?.value === 'string') {
        parts.push(`${category} {${toIcuPluralBody(variation.stringUnit.value)}}`);
      }
    }
    if (parts.length > 0) {
      return `{count, plural, ${parts.join(' ')}}`;
    }
  }
  return null;
}

function setNested(
  root: { [key: string]: LocaleTree | Leaf },
  path: string[],
  value: string,
): boolean {
  let node: { [key: string]: LocaleTree | Leaf } = root;
  for (let i = 0; i < path.length - 1; i += 1) {
    const segment = path[i];
    const existing = node[segment];
    if (existing === undefined) {
      const child: { [key: string]: LocaleTree | Leaf } = {};
      node[segment] = child;
      node = child;
    } else if (existing !== null && typeof existing === 'object' && !Array.isArray(existing)) {
      node = existing as { [key: string]: LocaleTree | Leaf };
    } else {
      return false; // a leaf already sits where a container is needed
    }
  }
  const last = path[path.length - 1];
  if (node[last] !== undefined && typeof node[last] === 'object') {
    return false; // a container already sits where a leaf is needed
  }
  node[last] = value;
  return true;
}

export function parseXcstrings(raw: string, path: string): XcstringsImportResult {
  let catalog: Catalog;
  try {
    catalog = JSON.parse(raw) as Catalog;
  } catch (error) {
    throw new Error(`Not a valid .xcstrings JSON: ${path} — ${(error as Error).message}`);
  }
  const sourceLang = typeof catalog.sourceLanguage === 'string' ? catalog.sourceLanguage : 'en';
  const strings = catalog.strings ?? {};
  const byLang = new Map<string, { [key: string]: LocaleTree | Leaf }>();
  const warnings: string[] = [];
  const treeFor = (lang: string): { [key: string]: LocaleTree | Leaf } => {
    let tree = byLang.get(lang);
    if (!tree) {
      tree = {};
      byLang.set(lang, tree);
    }
    return tree;
  };

  for (const [key, entry] of Object.entries(strings)) {
    const segments = key.split('.');
    const localizations = entry.localizations ?? {};
    // Xcode semantics: a source string without an explicit localization is
    // its own value — meaningful for sentence-keys, degenerate for semantic
    // keys, so we warn either way.
    if (!localizations[sourceLang]) {
      if (!setNested(treeFor(sourceLang), segments, key)) {
        warnings.push(`${key} — conflicts with an existing entry; skipped for ${sourceLang}`);
      } else {
        warnings.push(`${key} — no ${sourceLang} localization; the key itself was used as the source value`);
      }
    }
    for (const [lang, loc] of Object.entries(localizations)) {
      const value = localizedValue(loc);
      if (value === null) {
        continue;
      }
      if (!setNested(treeFor(lang), segments, value)) {
        warnings.push(`${key} — conflicts with an existing entry; skipped for ${lang}`);
      }
    }
  }
  return { sourceLang, byLang, warnings };
}
