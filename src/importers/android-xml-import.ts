import type { Leaf, LocaleTree } from '../locale-files.js';

// Android strings.xml → canonical locale tree (the import direction, for a
// project migrating its existing per-platform translations into one canonical
// set). A tolerant regex parser for the constrained resource format —
// <string>, <plurals>, <string-array>; CDATA is out of scope (documented).
// translatable="false" entries are skipped: brand constants stay app-side.
// Reversals of the exporter transforms where reversible: XML entities and
// android escapes are unescaped; positional int placeholders inside plural
// bodies become ICU `#`; other printf placeholders are kept verbatim.

export interface AndroidImportResult {
  tree: { [key: string]: LocaleTree | Leaf };
  skipped: string[];
}

const STRING_RE = /<string\b([^>]*)>([\s\S]*?)<\/string>/g;
const PLURALS_RE = /<plurals\b([^>]*)>([\s\S]*?)<\/plurals>/g;
const ARRAY_RE = /<string-array\b([^>]*)>([\s\S]*?)<\/string-array>/g;
const ITEM_QTY_RE = /<item\s+quantity="([^"]+)"\s*>([\s\S]*?)<\/item>/g;
const PLAIN_ITEM_RE = /<item\s*>([\s\S]*?)<\/item>/g;

function attr(attrs: string, name: string): string | null {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
  return match ? match[1] : null;
}

function unescapeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function unescapeBackslashes(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] === '\\' && i + 1 < value.length) {
      const next = value[i + 1];
      out += next === 'n' ? '\n' : next === 't' ? '\t' : next;
      i += 1;
    } else {
      out += value[i];
    }
  }
  return out;
}

function unescapeAndroid(value: string): string {
  let v = unescapeBackslashes(unescapeEntities(value.trim()));
  // whole-string double quoting is android's whitespace-preserving form
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    v = v.slice(1, -1);
  }
  return v;
}

function toIcuPluralBody(value: string): string {
  return value.replace(/%(\d+\$)?d/g, '#');
}

export function parseAndroidStringsXml(xml: string): AndroidImportResult {
  const tree: { [key: string]: LocaleTree | Leaf } = {};
  const skipped: string[] = [];
  const take = (attrs: string): string | null => {
    const name = attr(attrs, 'name');
    if (name === null) {
      return null;
    }
    if (attr(attrs, 'translatable') === 'false') {
      skipped.push(name);
      return null;
    }
    return name;
  };

  for (const m of xml.matchAll(STRING_RE)) {
    const name = take(m[1]);
    if (name !== null) {
      tree[name] = unescapeAndroid(m[2]);
    }
  }
  for (const m of xml.matchAll(PLURALS_RE)) {
    const name = take(m[1]);
    if (name === null) {
      continue;
    }
    const parts: string[] = [];
    for (const item of m[2].matchAll(ITEM_QTY_RE)) {
      parts.push(`${item[1]} {${toIcuPluralBody(unescapeAndroid(item[2]))}}`);
    }
    if (parts.length > 0) {
      tree[name] = `{count, plural, ${parts.join(' ')}}`;
    }
  }
  for (const m of xml.matchAll(ARRAY_RE)) {
    const name = take(m[1]);
    if (name !== null) {
      tree[name] = [...m[2].matchAll(PLAIN_ITEM_RE)].map((i) => unescapeAndroid(i[1]));
    }
  }
  return { tree, skipped };
}

// values → source lang; values-ru → ru; values-zh-rCN → zh-CN; qualifier
// directories that are not language variants (values-night, values-v21, …)
// return null and are skipped by the importer.
export function androidLangFromValuesDir(dirName: string, sourceLang: string): string | null {
  if (dirName === 'values') {
    return sourceLang;
  }
  const match = /^values-([a-z]{2,3})(?:-r([A-Z]{2}))?$/.exec(dirName);
  if (!match) {
    return null;
  }
  return match[2] ? `${match[1]}-${match[2]}` : match[1];
}
