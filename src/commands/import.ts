import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { loadConfig } from '../config.js';
import {
  detectLayout,
  flattenTree,
  localeFilePath,
  writeLocaleTree,
  FLAT_NS,
  type Leaf,
  type LocaleExt,
  type LocaleLayout,
  type LocaleTree,
} from '../locale-files.js';
import { parseAndroidStringsXml, androidLangFromValuesDir } from '../importers/android-xml-import.js';
import { parseXcstrings } from '../importers/xcstrings-import.js';

export const IMPORT_PLATFORMS = ['android', 'ios-xcstrings'] as const;
export type ImportPlatform = (typeof IMPORT_PLATFORMS)[number];

// Import native platform locales into the canonical locales/ set.
//
// Default (migration): pull every language found under --in; refuse to
// overwrite existing locale files without --force.
//
// --source-only (recurring sync): write only the config source language,
// always replace that namespace file, leave target locales untouched. Used
// when a client (e.g. Android) keeps English in-repo and the canonical set
// on the backend is refreshed on request before `translate`.

interface PendingWrite {
  lang: string;
  namespace: string;
  tree: LocaleTree;
}

function flagValue(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : undefined;
}

function resolveLayout(localesDir: string, sourceLang: string, format?: string): LocaleLayout {
  try {
    return detectLayout(localesDir, sourceLang);
  } catch {
    const ext: LocaleExt =
      format === 'yaml' || format === 'ts' || format === 'json' ? format : 'json';
    return { kind: 'namespaces', dir: localesDir, ext };
  }
}

function collectAndroid(inPath: string, sourceLang: string, namespace: string): {
  writes: PendingWrite[];
  skipped: string[];
} {
  const writes: PendingWrite[] = [];
  const skipped: string[] = [];
  for (const dirName of readdirSync(inPath)) {
    const lang = androidLangFromValuesDir(dirName, sourceLang);
    if (lang === null) {
      continue;
    }
    const file = join(inPath, dirName, 'strings.xml');
    if (!existsSync(file)) {
      continue;
    }
    const parsed = parseAndroidStringsXml(readFileSync(file, 'utf8'));
    skipped.push(...parsed.skipped.map((name) => `${dirName}/${name}`));
    if (Object.keys(parsed.tree).length > 0) {
      writes.push({ lang, namespace, tree: parsed.tree });
    }
  }
  return { writes, skipped };
}

// Resolve --in for Android: res/, values/, or a strings.xml file. With
// sourceOnly, only the source-language values/ (or the given file) is read —
// target values-<lang>/ dirs are ignored even when present next to it.
function collectAndroidInput(
  inPath: string,
  sourceLang: string,
  namespace: string,
  sourceOnly: boolean,
): { writes: PendingWrite[]; skipped: string[]; error?: string } {
  const st = statSync(inPath);
  if (st.isFile()) {
    if (basename(inPath) !== 'strings.xml') {
      return {
        writes: [],
        skipped: [],
        error: `--in file must be strings.xml (got ${basename(inPath)})`,
      };
    }
    const parsed = parseAndroidStringsXml(readFileSync(inPath, 'utf8'));
    const parent = basename(dirname(inPath));
    const lang = androidLangFromValuesDir(parent, sourceLang);
    if (lang === null) {
      return {
        writes: [],
        skipped: [],
        error: `parent directory "${parent}" is not a language values/ dir`,
      };
    }
    if (sourceOnly && lang !== sourceLang) {
      return {
        writes: [],
        skipped: [],
        error: `--source-only expects the source language (${sourceLang}), got values dir for "${lang}"`,
      };
    }
    return {
      writes:
        Object.keys(parsed.tree).length > 0
          ? [{ lang: sourceOnly ? sourceLang : lang, namespace, tree: parsed.tree }]
          : [],
      skipped: parsed.skipped.map((name) => `${parent}/${name}`),
    };
  }

  if (!st.isDirectory()) {
    return { writes: [], skipped: [], error: `--in must be a directory or strings.xml file` };
  }

  // values/ (or values-xx/) passed directly
  const asLang = androidLangFromValuesDir(basename(inPath), sourceLang);
  if (asLang !== null) {
    const file = join(inPath, 'strings.xml');
    if (!existsSync(file)) {
      return { writes: [], skipped: [], error: `No strings.xml under ${inPath}` };
    }
    if (sourceOnly && asLang !== sourceLang) {
      return {
        writes: [],
        skipped: [],
        error: `--source-only expects values/ (source ${sourceLang}), got "${basename(inPath)}"`,
      };
    }
    const parsed = parseAndroidStringsXml(readFileSync(file, 'utf8'));
    return {
      writes:
        Object.keys(parsed.tree).length > 0
          ? [{ lang: sourceOnly ? sourceLang : asLang, namespace, tree: parsed.tree }]
          : [],
      skipped: parsed.skipped.map((name) => `${basename(inPath)}/${name}`),
    };
  }

  // res/ directory
  const collected = collectAndroid(inPath, sourceLang, namespace);
  if (sourceOnly) {
    return {
      writes: collected.writes.filter((w) => w.lang === sourceLang),
      skipped: collected.skipped.filter((s) => s.startsWith('values/')),
    };
  }
  return collected;
}

function collectXcstrings(
  inPath: string,
  singleNamespace: string | undefined,
): { writes: PendingWrite[]; warnings: string[]; sourceLang: string } {
  const parsed = parseXcstrings(readFileSync(inPath, 'utf8'), inPath);
  const writes: PendingWrite[] = [];
  for (const [lang, tree] of parsed.byLang) {
    if (singleNamespace !== undefined) {
      writes.push({ lang, namespace: singleNamespace, tree });
      continue;
    }
    // default: the top-level key segment becomes the namespace (auth.signIn.title
    // → auth.json); dot-less keys land in `common`.
    const scalars: { [key: string]: LocaleTree | Leaf } = {};
    for (const [top, child] of Object.entries(tree)) {
      if (child !== null && typeof child === 'object' && !Array.isArray(child)) {
        writes.push({ lang, namespace: top, tree: child });
      } else {
        scalars[top] = child;
      }
    }
    if (Object.keys(scalars).length > 0) {
      writes.push({ lang, namespace: 'common', tree: scalars });
    }
  }
  return { writes, warnings: parsed.warnings, sourceLang: parsed.sourceLang };
}

export function runImport(cwd: string, args: string[]): number {
  const platform = flagValue(args, '--platform');
  const inRaw = flagValue(args, '--in');
  const sourceOnly = args.includes('--source-only');
  if (!platform || !(IMPORT_PLATFORMS as readonly string[]).includes(platform) || !inRaw) {
    console.error(
      `Usage: i18n-agent import --platform <${IMPORT_PLATFORMS.join('|')}> --in <path> [--ns <name>] [--format json|yaml|ts] [--source-only] [--force]`,
    );
    return 1;
  }
  const config = loadConfig(cwd);
  const inPath = resolve(cwd, inRaw);
  if (!existsSync(inPath)) {
    console.error(`No such path: ${inPath}`);
    return 1;
  }
  const layout = resolveLayout(config.localesDir, config.source, flagValue(args, '--format'));
  const ns = flagValue(args, '--ns');
  const warnings: string[] = [];
  let writes: PendingWrite[];
  let importSourceLang = config.source;

  if (platform === 'android') {
    const collected = collectAndroidInput(inPath, config.source, ns ?? 'android', sourceOnly);
    if (collected.error) {
      console.error(collected.error);
      return 1;
    }
    writes = collected.writes;
    warnings.push(...collected.skipped.map((name) => `skipped translatable="false": ${name}`));
  } else {
    if (!statSync(inPath).isFile()) {
      console.error(`--in must be an .xcstrings file (got a directory): ${inPath}`);
      return 1;
    }
    const collected = collectXcstrings(inPath, ns);
    writes = collected.writes;
    warnings.push(...collected.warnings);
    importSourceLang = collected.sourceLang;
    if (sourceOnly) {
      writes = writes.filter((w) => w.lang === config.source);
    }
  }

  if (writes.length === 0) {
    console.error(
      sourceOnly
        ? `Nothing to import — no source-language (${config.source}) content found under the given path.`
        : 'Nothing to import — no locale content found under the given path.',
    );
    return 1;
  }
  if (importSourceLang !== config.source) {
    warnings.push(
      `catalog source language is "${importSourceLang}" but the config source is "${config.source}" — files were written per catalog language codes`,
    );
  }
  // Flat layout has a single unnamed namespace — everything merges into it.
  if (layout.kind === 'flat') {
    const byLang = new Map<string, { [key: string]: LocaleTree | Leaf }>();
    for (const w of writes) {
      const tree = byLang.get(w.lang) ?? {};
      Object.assign(tree, w.tree);
      byLang.set(w.lang, tree);
    }
    writes = [...byLang.entries()].map(([lang, tree]) => ({ lang, namespace: FLAT_NS, tree }));
  }

  // --source-only always replaces the source namespace file(s). Full migration
  // still requires --force when targets already exist.
  const force = sourceOnly || args.includes('--force');
  const existing = writes
    .map((w) => localeFilePath(layout, w.lang, w.namespace))
    .filter((p) => existsSync(p));
  if (existing.length > 0 && !force) {
    console.error(
      `Refusing to overwrite existing locale files (use --force to replace them, or --source-only to refresh the source language only):\n  ${existing.join('\n  ')}`,
    );
    return 1;
  }

  let keys = 0;
  const langs = new Set<string>();
  for (const w of writes) {
    const path = writeLocaleTree(layout, w.lang, w.namespace, w.tree);
    langs.add(w.lang);
    if (w.lang === config.source) {
      keys += flattenTree(w.tree).size;
    }
    console.log(`→ ${path}`);
  }

  const newTargets = [...langs].filter((l) => l !== config.source && !config.targets.includes(l));
  if (sourceOnly) {
    console.log(
      `Synced ${keys} source key(s) (${config.source}) from ${platform} — target locales were not touched.`,
    );
    console.log('Next: run `i18n-agent translate` to fill new/changed keys in target languages.');
  } else {
    console.log(
      `Imported ${keys} source key(s) across ${langs.size} language(s) from ${platform}.`,
    );
    console.log(
      'Next: run `i18n-agent translate` — pre-existing translations are adopted as human-owned and never overwritten.',
    );
  }
  if (newTargets.length > 0) {
    console.log(`Add the imported languages to your config targets: i18n-agent add-locale ${newTargets.join(' ')}`);
  }
  if (warnings.length > 0) {
    console.log(`\nWarnings (${warnings.length}):`);
    for (const w of warnings) {
      console.log(`  ${w}`);
    }
  }
  return 0;
}
