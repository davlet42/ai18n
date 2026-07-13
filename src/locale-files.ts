import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import YAML from 'yaml';
import { parseTsLocaleModule, serializeTsLocaleModule } from './ts-module-locale.js';

// Locale tree IO. Two layouts:
//   flat        locales/en.json            (one file per language)
//   namespaces  locales/en/common.json     (i18next-style, one dir per language)
// Three formats: JSON, YAML, and TS modules (`export default {…} as const;` —
// see ts-module-locale.ts). Key order is preserved (insertion order on parse,
// kept on write). Targets always mirror the SOURCE structure — nesting and
// order come from the source tree, only string leaves get translated values.

export type Leaf = string | number | boolean | null;
export type LocaleTree = { [key: string]: LocaleTree | Leaf } | Leaf[];

export type LocaleExt = 'json' | 'yaml' | 'yml' | 'ts';

export interface LocaleLayout {
  kind: 'flat' | 'namespaces';
  dir: string; // locales root
  ext: LocaleExt;
}

// 'ts' is last so mixed directories keep resolving to JSON/YAML.
const EXTS: LocaleExt[] = ['json', 'yaml', 'yml', 'ts'];

// Declaration files (i18n-keys.d.ts and friends) are codegen output, not locales.
function isLocaleFile(fileName: string, ext: LocaleExt): boolean {
  return fileName.endsWith(`.${ext}`) && !(ext === 'ts' && fileName.endsWith('.d.ts'));
}

export function detectLayout(localesDir: string, sourceLang: string): LocaleLayout {
  const langDir = join(localesDir, sourceLang);
  if (existsSync(langDir)) {
    const files = readdirSync(langDir).filter((f) => EXTS.some((e) => isLocaleFile(f, e)));
    if (files.length > 0) {
      const ext = EXTS.find((e) => isLocaleFile(files[0], e))!;
      return { kind: 'namespaces', dir: localesDir, ext };
    }
  }
  for (const ext of EXTS) {
    if (existsSync(join(localesDir, `${sourceLang}.${ext}`))) {
      return { kind: 'flat', dir: localesDir, ext };
    }
  }
  throw new Error(
    `No source locale found for "${sourceLang}" under ${localesDir} — expected ${sourceLang}.json/.yaml/.ts or ${sourceLang}/<namespace>.json`,
  );
}

// Flat layout is modeled as a single unnamed namespace.
export const FLAT_NS = '';

export function listNamespaces(layout: LocaleLayout, lang: string): string[] {
  if (layout.kind === 'flat') {
    return [FLAT_NS];
  }
  const dir = join(layout.dir, lang);
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((f) => isLocaleFile(f, layout.ext))
    .map((f) => f.slice(0, -(layout.ext.length + 1)))
    .sort();
}

export function localeFilePath(layout: LocaleLayout, lang: string, namespace: string): string {
  return layout.kind === 'flat'
    ? join(layout.dir, `${lang}.${layout.ext}`)
    : join(layout.dir, lang, `${namespace}.${layout.ext}`);
}

export function readLocaleTree(layout: LocaleLayout, lang: string, namespace: string): LocaleTree | null {
  const path = localeFilePath(layout, lang, namespace);
  if (!existsSync(path)) {
    return null;
  }
  const raw = readFileSync(path, 'utf8');
  const parsed =
    layout.ext === 'ts'
      ? parseTsLocaleModule(raw, path)
      : layout.ext === 'json'
        ? JSON.parse(raw)
        : YAML.parse(raw);
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error(`Locale file is not an object: ${path}`);
  }
  return parsed as LocaleTree;
}

export function writeLocaleTree(
  layout: LocaleLayout,
  lang: string,
  namespace: string,
  tree: LocaleTree,
): string {
  const path = localeFilePath(layout, lang, namespace);
  mkdirSync(dirname(path), { recursive: true });
  const body =
    layout.ext === 'ts'
      ? serializeTsLocaleModule(tree)
      : layout.ext === 'json'
        ? `${JSON.stringify(tree, null, 2)}\n`
        : YAML.stringify(tree);
  writeFileSync(path, body, 'utf8');
  return path;
}

// --- flatten / rebuild ------------------------------------------------------

function isLeaf(v: unknown): v is Leaf {
  return v === null || ['string', 'number', 'boolean'].includes(typeof v);
}

// Nested keys join with '.'; arrays use numeric segments (i18next-compatible).
// Limitation (documented): keys containing a literal '.' are not supported in v1.
export function flattenTree(tree: LocaleTree, prefix = ''): Map<string, Leaf> {
  const out = new Map<string, Leaf>();
  const entries: [string, unknown][] = Array.isArray(tree)
    ? tree.map((v, i) => [String(i), v] as [string, unknown])
    : Object.entries(tree);
  for (const [k, v] of entries) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (isLeaf(v)) {
      out.set(key, v);
    } else if (v && typeof v === 'object') {
      for (const [ck, cv] of flattenTree(v as LocaleTree, key)) {
        out.set(ck, cv);
      }
    }
  }
  return out;
}

// Rebuild a target tree that mirrors the source's structure and key order.
// String leaves take their value from `values`; a string leaf WITHOUT a value
// is OMITTED — a failed translation must not ship the source text as a fake
// translation (runtime falls back via the i18n library, and the next run
// retries the key). Non-string leaves are copied verbatim by the caller
// through `values`. Containers left empty by omission are dropped.
export function buildTargetTree(source: LocaleTree, values: Map<string, Leaf>, prefix = ''): LocaleTree {
  if (Array.isArray(source)) {
    // Arrays keep positions: a missing translation would shift indices, so
    // array slots fall back to the source text instead of omission.
    return source.map((v, i) => {
      const key = prefix ? `${prefix}.${i}` : String(i);
      if (isLeaf(v)) {
        return (typeof v === 'string' ? (values.get(key) ?? v) : v) as Leaf;
      }
      return buildTargetTree(v as LocaleTree, values, key) as unknown as Leaf;
    }) as LocaleTree;
  }
  const out: { [key: string]: LocaleTree | Leaf } = {};
  for (const [k, v] of Object.entries(source)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (isLeaf(v)) {
      if (typeof v === 'string') {
        const value = values.get(key);
        if (value !== undefined) {
          out[k] = value;
        }
      } else {
        out[k] = v;
      }
    } else {
      const child = buildTargetTree(v as LocaleTree, values, key);
      const empty =
        (Array.isArray(child) && child.length === 0) ||
        (!Array.isArray(child) && Object.keys(child).length === 0);
      if (!empty || (Array.isArray(v) ? v.length === 0 : Object.keys(v).length === 0)) {
        out[k] = child;
      }
    }
  }
  return out;
}
