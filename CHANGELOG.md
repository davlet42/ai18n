# Changelog

## Unreleased (v0.1 engine — week 1 complete)

- **Engine**: locale IO (flat + i18next namespaces, JSON/YAML, key order preserved), lockfile with per-language source shas and ownership (`i18n-agent`/`human`), sync planner with the full key lifecycle: translate / keep / retranslate / adopt / review / rename-migrate / prune.
- **Manual edits are sacred**: hand edits are never overwritten; editing a value resolves its review; `--accept-stale` accepts current values against a changed source; `--retranslate-stale` machine-translates them.
- **Rename detection**: a removed key whose source text matches a new untranslated key migrates its translation together with ownership — no retranslation, no lost polish.
- **Placeholder guard**: signature validation for `{var}`/`{{var}}`/printf/`$t()`/HTML tags/ICU plural-select (categories + inner tokens + `#`), corrective per-item retry, then keep-source + report.
- **Batch translator** through the subscription agent (`claude -p`, Haiku tier) via `@cursor-translate/core`; failed keys are omitted from targets (runtime falls back, next run retries) — never shipped as fake translations.
- **CLI**: `init` (layout/language detection, documented context+glossary templates, never clobbers existing files), `translate` (`--dry-run`/`--review`/`--accept-stale`/`--retranslate-stale`/`--lang`), `check` (CI gate), `status`, `add-locale --translate`.
- **Live e2e passed** (2026-07-12): 20 strings → ru+es in 2 agent calls through the subscription; repeat run = 0 calls; glossary term untranslated; ICU plurals translated inside, structure intact; review flow verified end-to-end. 30/30 tests.
- Project scaffolded: design locked 2026-07-12 (namespaces in v1, manual edits sacred, separate context file, name `i18n-agent`). See ROADMAP.md.
