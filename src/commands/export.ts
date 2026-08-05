import { resolve } from 'node:path';
import { loadConfig } from '../config.js';
import {
  detectLayout,
  listNamespaces,
  readLocaleTree,
  type LocaleTree,
} from '../locale-files.js';
import { emitAndroidXml, writeAndroidResources, type AndroidEmitOptions } from '../exporters/android.js';
import { emitXcstrings, writeXcstrings } from '../exporters/xcstrings.js';
import { emitTsKeys, writeTsKeys, writeWebJson } from '../exporters/simple.js';

export const EXPORT_PLATFORMS = ['android', 'ios-xcstrings', 'web-json', 'ts-keys'] as const;
export type ExportPlatform = (typeof EXPORT_PLATFORMS)[number];

/** Android-only knobs on an `exports:` entry (ignored for other platforms). */
export interface AndroidExportOptions extends AndroidEmitOptions {
  /**
   * Emit only these locale namespaces. Omit / empty = all namespaces
   * (legacy behaviour). Typical pilot: `[android]` so server `auth`/`email`
   * keys do not land in `values-<lang>/strings.xml`.
   */
  namespaces?: string[];
}

export interface ExportEntry {
  platform: ExportPlatform;
  out: string;
  android?: AndroidExportOptions;
}

export function parseAndroidExportOptions(item: Record<string, unknown>): AndroidExportOptions {
  const out: AndroidExportOptions = {};
  if (Array.isArray(item.namespaces)) {
    const ns = item.namespaces.filter((n): n is string => typeof n === 'string' && n.length > 0);
    if (ns.length > 0) out.namespaces = ns;
  } else if (typeof item.namespace === 'string' && item.namespace.length > 0) {
    // singular alias for a one-namespace filter
    out.namespaces = [item.namespace];
  }
  if (typeof item.prefixNamespace === 'boolean') {
    out.prefixNamespace = item.prefixNamespace;
  }
  return out;
}

/** Restrict the namespace list; warns (via return) about unknown filter names. */
export function selectNamespaces(
  all: string[],
  filter: string[] | undefined,
): { selected: string[]; unknown: string[] } {
  if (!filter || filter.length === 0) {
    return { selected: all, unknown: [] };
  }
  const have = new Set(all);
  const unknown = filter.filter((n) => !have.has(n));
  const want = new Set(filter);
  return { selected: all.filter((n) => want.has(n)), unknown };
}

// `exports:` section of i18n-agent.config.yaml:
//   exports:
//     - platform: android
//       out: ../android-app/app/src/main/res
//       namespaces: [android]   # optional filter
//       prefixNamespace: false  # optional; default true
export function parseExports(raw: unknown, root: string): ExportEntry[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: ExportEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const platform = rec.platform;
    const dest = rec.out;
    if (
      typeof platform === 'string' &&
      (EXPORT_PLATFORMS as readonly string[]).includes(platform) &&
      typeof dest === 'string'
    ) {
      const entry: ExportEntry = { platform: platform as ExportPlatform, out: resolve(root, dest) };
      if (platform === 'android') {
        const android = parseAndroidExportOptions(rec);
        if (android.namespaces || android.prefixNamespace !== undefined) {
          entry.android = android;
        }
      }
      out.push(entry);
    }
  }
  return out;
}

/** First android export entry's options — also drives `export --bundle` android XML. */
export function androidOptionsFromConfig(exportsRaw: unknown, root: string): AndroidExportOptions {
  const entry = parseExports(exportsRaw, root).find((e) => e.platform === 'android');
  return entry?.android ?? {};
}

export async function runExport(cwd: string, args: string[]): Promise<number> {
  const config = loadConfig(cwd);

  if (args.includes('--bundle')) {
    const { buildBundle } = await import('../bundle.js');
    const outIdx = args.indexOf('--out');
    const { outDir, manifest, warnings } = buildBundle(
      config,
      outIdx !== -1 ? args[outIdx + 1] : undefined,
    );
    console.log(
      `Bundle → ${outDir}\n  etag: ${manifest.etag} · ${Object.keys(manifest.files).length} files · languages: ${manifest.languages.join(', ')}`,
    );
    if (warnings.length > 0) {
      console.log(`\nWarnings (${warnings.length}):`);
      for (const w of warnings) console.log(`  ${w}`);
    }
    return 0;
  }
  const entries = parseExports(config.exportsRaw, config.root).filter((e) => {
    const onlyIdx = args.indexOf('--platform');
    return onlyIdx === -1 || args[onlyIdx + 1] === e.platform;
  });
  if (entries.length === 0) {
    console.log('No exports configured — add an `exports:` section to i18n-agent.config.yaml, e.g.:');
    console.log('  exports:\n    - platform: android\n      out: ../android-app/app/src/main/res');
    return 0;
  }

  const layout = detectLayout(config.localesDir, config.source);
  const languages = [config.source, ...config.targets];
  const namespaces = listNamespaces(layout, config.source);

  // ns → lang → tree
  const treeByNsLang = new Map<string, Map<string, LocaleTree>>();
  for (const ns of namespaces) {
    const perLang = new Map<string, LocaleTree>();
    for (const lang of languages) {
      const tree = readLocaleTree(layout, lang, ns);
      if (tree) perLang.set(lang, tree);
    }
    treeByNsLang.set(ns, perLang);
  }

  const allWarnings: string[] = [];
  let files = 0;

  for (const entry of entries) {
    switch (entry.platform) {
      case 'android': {
        const { selected, unknown } = selectNamespaces(namespaces, entry.android?.namespaces);
        for (const name of unknown) {
          allWarnings.push(`[android] namespaces filter: unknown namespace "${name}"`);
        }
        const emitOpts: AndroidEmitOptions = {
          prefixNamespace: entry.android?.prefixNamespace,
        };
        for (const lang of languages) {
          const nsInput = selected
            .map((ns) => ({
              namespace: ns,
              tree: treeByNsLang.get(ns)?.get(lang),
              sourceTree: treeByNsLang.get(ns)?.get(config.source),
            }))
            .filter((x): x is { namespace: string; tree: LocaleTree; sourceTree: LocaleTree } => !!x.tree && !!x.sourceTree);
          if (nsInput.length === 0) continue;
          const { xml, warnings } = emitAndroidXml(nsInput, emitOpts);
          allWarnings.push(...warnings.map((w) => `[android/${lang}] ${w}`));
          writeAndroidResources(entry.out, lang, lang === config.source, xml);
          files += 1;
        }
        break;
      }
      case 'ios-xcstrings': {
        const { json, warnings } = emitXcstrings({
          sourceLang: config.source,
          languages,
          namespaces: namespaces.map((ns) => ({
            namespace: ns,
            treeByLang: treeByNsLang.get(ns) ?? new Map(),
          })),
        });
        allWarnings.push(...warnings.map((w) => `[ios-xcstrings] ${w}`));
        writeXcstrings(entry.out, json);
        files += 1;
        break;
      }
      case 'web-json': {
        for (const lang of languages) {
          const trees = namespaces
            .map((ns) => ({ namespace: ns, tree: treeByNsLang.get(ns)?.get(lang) }))
            .filter((x): x is { namespace: string; tree: LocaleTree } => !!x.tree);
          files += writeWebJson(entry.out, lang, layout.kind, trees).length;
        }
        break;
      }
      case 'ts-keys': {
        const trees = namespaces
          .map((ns) => ({ namespace: ns, tree: treeByNsLang.get(ns)?.get(config.source) }))
          .filter((x): x is { namespace: string; tree: LocaleTree } => !!x.tree);
        writeTsKeys(entry.out, emitTsKeys(trees));
        files += 1;
        break;
      }
    }
    console.log(`[${entry.platform}] → ${entry.out}`);
  }

  console.log(`Exported ${files} file(s) for ${languages.length} language(s).`);
  if (allWarnings.length > 0) {
    console.log(`\nWarnings (${allWarnings.length}):`);
    for (const w of allWarnings) console.log(`  ${w}`);
  }
  return 0;
}
