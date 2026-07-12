import { resolve } from 'node:path';
import { loadConfig } from '../config.js';
import {
  detectLayout,
  listNamespaces,
  readLocaleTree,
  type LocaleTree,
} from '../locale-files.js';
import { emitAndroidXml, writeAndroidResources } from '../exporters/android.js';
import { emitXcstrings, writeXcstrings } from '../exporters/xcstrings.js';
import { emitTsKeys, writeTsKeys, writeWebJson } from '../exporters/simple.js';

export const EXPORT_PLATFORMS = ['android', 'ios-xcstrings', 'web-json', 'ts-keys'] as const;
export type ExportPlatform = (typeof EXPORT_PLATFORMS)[number];

export interface ExportEntry {
  platform: ExportPlatform;
  out: string;
}

// `exports:` section of i18n-agent.config.yaml:
//   exports:
//     - platform: android
//       out: ../android-app/app/src/main/res
export function parseExports(raw: unknown, root: string): ExportEntry[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: ExportEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const platform = (item as { platform?: unknown }).platform;
    const dest = (item as { out?: unknown }).out;
    if (
      typeof platform === 'string' &&
      (EXPORT_PLATFORMS as readonly string[]).includes(platform) &&
      typeof dest === 'string'
    ) {
      out.push({ platform: platform as ExportPlatform, out: resolve(root, dest) });
    }
  }
  return out;
}

export async function runExport(cwd: string, args: string[]): Promise<number> {
  const config = loadConfig(cwd);
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
        for (const lang of languages) {
          const nsInput = namespaces
            .map((ns) => ({
              namespace: ns,
              tree: treeByNsLang.get(ns)?.get(lang),
              sourceTree: treeByNsLang.get(ns)?.get(config.source),
            }))
            .filter((x): x is { namespace: string; tree: LocaleTree; sourceTree: LocaleTree } => !!x.tree && !!x.sourceTree);
          if (nsInput.length === 0) continue;
          const { xml, warnings } = emitAndroidXml(nsInput);
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
