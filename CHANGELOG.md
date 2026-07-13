# Changelog

## 0.3.2 (2026-07-13)

**BundleReader hardening** — feedback from the first self-hosted production deployment (0.3.1 was skipped: the `v0.3.1` release train shipped `i18n-agent-nest@0.1.1`):

- The hot path no longer touches the filesystem: file contents are cached in memory per manifest etag (a bundle is the project's locale artifacts, so the cache is bounded by the manifest), and the manifest mtime stat is throttled — new `BundleReaderOptions.statIntervalMs` (default 1000, 0 = stat every call). In-place regeneration is still picked up within the interval.
- Manifest lookups use `Object.hasOwn` — prototype-inherited property names (`constructor`, `__proto__`, …) can no longer match as paths (was not exploitable thanks to the path prefix-check, pure hygiene).
- Mid-regeneration race: content whose hash mismatches the manifest entry is served but never cached, so a half-swapped bundle cannot pin stale pairs until the next etag change.
- New exported types: `BundleReaderOptions`, `BundleFile`.
- CI: auto-publish covers both packages (`i18n-agent`, `i18n-agent-nest`) with skip-if-published guards — either can release independently without red runs.
- nest: depends on the published `i18n-agent@^0.3.0` (registry) instead of the local file link.

## 0.3.0 (2026-07-12)

**Self-hosted delivery** — the same artifacts, served by YOUR backend (no third-party cloud):

- `i18n-agent export --bundle [--out <dir>]` → one versioned directory: all platform exports + `manifest.json` with per-file sha256 and a content-derived bundle etag (identical content ⇒ identical etag)
- `BundleReader` (framework-free, exported): serves only manifest-listed paths (traversal-proof), per-file ETags, auto-reload on in-place regeneration
- Companion package **`i18n-agent-nest`** (0.1.0): `I18nAgentModule.forRoot({ bundleDir })` — manifest route + bundle files with ETag/304 on your NestJS server; web fetches at runtime, mobile CI at build time
- Config: `bundle.out`

## 0.2.0 (2026-07-12)

**Multi-platform export** — one canonical source in git, native locales for every platform at build time (the OpenAPI model applied to translations):

- `exports:` config section + `i18n-agent export [--platform <p>]`
- **android**: `values-<lang>/strings.xml`, ICU plural → `<plurals>` (incl. `few/many`), arrays → `<string-array>`, XML/apostrophe escaping, named → positional `%n$s`
- **ios-xcstrings**: single `Localizable.xcstrings` String Catalog with plural variations, `{name}` → `%n$@`, `#` → `%lld`
- **web-json** re-emit + **ts-keys** generated key unions (typo-proof `t()`)
- Argument numbering is derived from the SOURCE string, so all languages agree even when translations reorder words
- Roadmap: v0.3 self-hosted delivery recorded — `export --bundle` + `i18n-agent-nest` companion (your own backend serves the artifacts; no third-party cloud)

## 0.1.1 (2026-07-12)

- Docs: removed subscription-tier mentions — works on any plan; npm README refreshed.
- First release through GitHub Actions auto-publish (NPM_TOKEN wired).

## 0.1.0 (2026-07-12)

- **Engine**: locale IO (flat + i18next namespaces, JSON/YAML, key order preserved), lockfile with per-language source shas and ownership (`i18n-agent`/`human`), sync planner with the full key lifecycle: translate / keep / retranslate / adopt / review / rename-migrate / prune.
- **Manual edits are sacred**: hand edits are never overwritten; editing a value resolves its review; `--accept-stale` accepts current values against a changed source; `--retranslate-stale` machine-translates them.
- **Rename detection**: a removed key whose source text matches a new untranslated key migrates its translation together with ownership — no retranslation, no lost polish.
- **Placeholder guard**: signature validation for `{var}`/`{{var}}`/printf/`$t()`/HTML tags/ICU plural-select (categories + inner tokens + `#`), corrective per-item retry, then keep-source + report.
- **Batch translator** through the subscription agent (`claude -p`, Haiku tier) via `@cursor-translate/core`; failed keys are omitted from targets (runtime falls back, next run retries) — never shipped as fake translations.
- **CLI**: `init` (layout/language detection, documented context+glossary templates, never clobbers existing files), `translate` (`--dry-run`/`--review`/`--accept-stale`/`--retranslate-stale`/`--lang`), `check` (CI gate), `status`, `add-locale --translate`.
- **Live e2e passed** (2026-07-12): 20 strings → ru+es in 2 agent calls through the subscription; repeat run = 0 calls; glossary term untranslated; ICU plurals translated inside, structure intact; review flow verified end-to-end. 30/30 tests.
- Project scaffolded: design locked 2026-07-12 (namespaces in v1, manual edits sacred, separate context file, name `i18n-agent`). See ROADMAP.md.
