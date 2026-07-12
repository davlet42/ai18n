# ai18n roadmap

## v0.1 — the engine (week 1)

- [x] Layouts: file-per-lang (`locales/en.json`) and i18next namespaces (`locales/en/common.json`), JSON + YAML, key order preserved
- [x] **Lockfile** (`ai18n.lock`): sha of source string + sha of written translation per key — diff-sync translates only new/changed keys; repeat run = 0 calls
- [x] **Manual edits are sacred**: a hand-edited target value is never overwritten; if its source string later changes, the key lands in the `--review` list instead of being silently retranslated
- [x] **Placeholder guard**: `{var}`, `{{var}}`, printf (`%s`), HTML-ish tags, `$t(...)`, ICU plural/select signatures — post-translation validation with one retry, then keep-original + report
- [x] Batch translation through the subscription agent (`claude -p`, Haiku tier) — core provider from `@cursor-translate/core`
- [x] Context file `ai18n.context.yaml` (key path → hint for the translator) — documented in detail
- [x] Glossary `ai18n.glossary.yaml` (terms to pin or keep untranslated)
- [x] Commands: `init` (detects existing languages, prefills targets), `translate` (`--review`, `--retranslate-stale`), `check` (CI gate), `status`, `add-locale <lang…>` (append to targets + optional immediate translate; missing target files always materialize automatically on `translate`)
- [x] Metrics + `report` (own ~/.ai18n/metrics.jsonl: volumes, claude -p cost receipts, DeepL-API-equivalent comparison)

## v0.2 — agent surface + distribution (week 2)

- [ ] Claude Code skill `/translate-locales` + Cursor rule (locales stay in sync while an agent builds features)
- [ ] `examples/demo-app` dogfood + e2e on a live subscription
- [ ] README positioning pass + comparison with DeepL API / Lingo.dev flows
- [ ] npm publish + GitHub release CI (v* tags)
- [ ] Distribution test per the gate: Habr + Show HN + Reddit, 4-week window; thresholds: sustained ≥50 organic DL/day OR ≥30 stars OR ≥3 unsolicited feature requests

## v2 — ideas (gated on v0.1 traction)

- [ ] **`/i18nify` — the killer skill**: agent-driven i18n-фикация of a legacy project with hardcoded strings — wrap strings in `t()`, generate keys and the source locale, wire the i18n library. Extraction tools do half of this badly; agents can do all of it. Potentially the strongest wedge of the family.
- [ ] More formats: gettext PO, CSV, ARB (Flutter), Android XML / iOS strings
- [ ] Upstream integrations: consume i18next-parser / FormatJS extractor output
- [ ] More providers: cursor-cli and OpenAI-compatible endpoints via core exports, Ollama for fully local
- [ ] MCP tool for cloud agents (no hooks there — same pattern as *-translate)
- [ ] Pseudo-localization mode (layout/QA testing without real translation)
- [ ] PR mode: comment a diff of locale changes instead of writing files (CI bots)

## Non-goals (deliberate)

- **No cloud, no TMS, no metered token resale** — see the family thesis: the translation memory is a local file in your git, not rented server state with a retention timer. Decision log: vault, Ideas Backlog idea #5 (Lingo.dev pricing recon, 2026-07-12).
- **No code extraction in v1** — the source locale is authored (by you or your coding agent); `/i18nify` may revisit this properly in v2.
- No web UI, no review dashboard — `--review` list + git diff is the review UI.
