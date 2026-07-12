import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import type { I18nAgentConfig } from './config.js';
import {
  detectLayout,
  listNamespaces,
  readLocaleTree,
  type LocaleTree,
} from './locale-files.js';
import { emitAndroidXml } from './exporters/android.js';
import { emitXcstrings } from './exporters/xcstrings.js';
import { emitTsKeys } from './exporters/simple.js';

// Self-hosted delivery, part 1: `i18n-agent export --bundle` produces ONE
// versioned directory that any server can mount behind a static route:
//
//   <out>/manifest.json                     etag, languages, per-file sha256
//   <out>/web/<lang>/<ns>.json              (or web/<lang>.json for flat)
//   <out>/android/res/values-*/strings.xml
//   <out>/ios/Localizable.xcstrings
//   <out>/ts/i18n-keys.d.ts
//
// The etag is a hash over the sorted per-file hashes — identical content
// yields an identical etag regardless of generation time, so clients can
// cache aggressively. BundleReader (part 2) serves ONLY manifest-listed
// paths, which makes path traversal structurally impossible.

export interface BundleManifestFile {
  sha256: string;
  bytes: number;
}

export interface BundleManifest {
  etag: string;
  generatedAt: string;
  sourceLang: string;
  languages: string[];
  layout: 'flat' | 'namespaces';
  namespaces: string[];
  files: Record<string, BundleManifestFile>;
}

export const BUNDLE_MANIFEST = 'manifest.json';

function sha256(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex');
}

export interface BuildBundleResult {
  outDir: string;
  manifest: BundleManifest;
  warnings: string[];
}

export function buildBundle(config: I18nAgentConfig, outOverride?: string): BuildBundleResult {
  const outDir = resolve(config.root, outOverride ?? config.bundleOut ?? 'i18n-bundle');
  const layout = detectLayout(config.localesDir, config.source);
  const languages = [config.source, ...config.targets];
  const namespaces = listNamespaces(layout, config.source);
  const warnings: string[] = [];

  // ns → lang → tree
  const trees = new Map<string, Map<string, LocaleTree>>();
  for (const ns of namespaces) {
    const perLang = new Map<string, LocaleTree>();
    for (const lang of languages) {
      const tree = readLocaleTree(layout, lang, ns);
      if (tree) perLang.set(lang, tree);
    }
    trees.set(ns, perLang);
  }

  rmSync(outDir, { recursive: true, force: true });
  const files: Record<string, BundleManifestFile> = {};
  const put = (rel: string, content: string): void => {
    const path = join(outDir, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf8');
    files[rel] = { sha256: sha256(content), bytes: Buffer.byteLength(content) };
  };

  // web-json
  for (const lang of languages) {
    for (const ns of namespaces) {
      const tree = trees.get(ns)?.get(lang);
      if (!tree) continue;
      const rel = layout.kind === 'flat' ? `web/${lang}.json` : `web/${lang}/${ns}.json`;
      put(rel, `${JSON.stringify(tree, null, 2)}\n`);
    }
  }

  // android
  for (const lang of languages) {
    const nsInput = namespaces
      .map((ns) => ({
        namespace: ns,
        tree: trees.get(ns)?.get(lang),
        sourceTree: trees.get(ns)?.get(config.source),
      }))
      .filter((x): x is { namespace: string; tree: LocaleTree; sourceTree: LocaleTree } => !!x.tree && !!x.sourceTree);
    if (nsInput.length === 0) continue;
    const { xml, warnings: w } = emitAndroidXml(nsInput);
    warnings.push(...w.map((m) => `[android/${lang}] ${m}`));
    put(`android/res/${lang === config.source ? 'values' : `values-${lang}`}/strings.xml`, xml);
  }

  // ios
  const { json, warnings: iosWarnings } = emitXcstrings({
    sourceLang: config.source,
    languages,
    namespaces: namespaces.map((ns) => ({ namespace: ns, treeByLang: trees.get(ns) ?? new Map() })),
  });
  warnings.push(...iosWarnings.map((m) => `[ios-xcstrings] ${m}`));
  put('ios/Localizable.xcstrings', json);

  // ts-keys
  const sourceTrees = namespaces
    .map((ns) => ({ namespace: ns, tree: trees.get(ns)?.get(config.source) }))
    .filter((x): x is { namespace: string; tree: LocaleTree } => !!x.tree);
  put('ts/i18n-keys.d.ts', emitTsKeys(sourceTrees));

  const etag = sha256(
    Object.keys(files)
      .sort()
      .map((rel) => `${rel}:${files[rel].sha256}`)
      .join('\n'),
  ).slice(0, 32);

  const manifest: BundleManifest = {
    etag,
    generatedAt: new Date().toISOString(),
    sourceLang: config.source,
    languages,
    layout: layout.kind,
    namespaces,
    files,
  };
  writeFileSync(join(outDir, BUNDLE_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return { outDir, manifest, warnings };
}

// Framework-free reader used by server companions (i18n-agent-nest et al.).
// Serves ONLY paths listed in the manifest; reloads the manifest when its
// mtime changes (a redeploy/regeneration swaps the bundle in place).
export class BundleReader {
  private manifestCache: BundleManifest | null = null;
  private manifestMtimeMs = 0;

  constructor(private readonly bundleDir: string) {}

  manifest(): BundleManifest | null {
    const path = join(this.bundleDir, BUNDLE_MANIFEST);
    if (!existsSync(path)) {
      return null;
    }
    const mtimeMs = statSync(path).mtimeMs;
    if (!this.manifestCache || mtimeMs !== this.manifestMtimeMs) {
      try {
        this.manifestCache = JSON.parse(readFileSync(path, 'utf8')) as BundleManifest;
        this.manifestMtimeMs = mtimeMs;
      } catch {
        return null;
      }
    }
    return this.manifestCache;
  }

  etag(): string | null {
    return this.manifest()?.etag ?? null;
  }

  // rel must be a manifest-listed path — anything else (including traversal
  // attempts) returns null.
  read(rel: string): { content: Buffer; sha256: string; etag: string } | null {
    const manifest = this.manifest();
    if (!manifest) {
      return null;
    }
    const entry = manifest.files[rel];
    if (!entry) {
      return null;
    }
    const path = resolve(this.bundleDir, rel);
    if (!path.startsWith(resolve(this.bundleDir) + sep)) {
      return null; // belt and braces on top of the manifest allowlist
    }
    try {
      return { content: readFileSync(path), sha256: entry.sha256, etag: `"${entry.sha256}"` };
    } catch {
      return null;
    }
  }

  webPath(lang: string, namespace?: string): string {
    const manifest = this.manifest();
    return manifest?.layout === 'flat' ? `web/${lang}.json` : `web/${lang}/${namespace}.json`;
  }
}
