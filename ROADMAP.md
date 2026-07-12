# i18n-agent roadmap

## v0.1 — the engine · SHIPPED in 0.1.0

- [x] Layouts: file-per-lang (`locales/en.json`) and i18next namespaces (`locales/en/common.json`), JSON + YAML, key order preserved
- [x] **Lockfile** (`i18n-agent.lock`): sha of source string + sha of written translation per key — diff-sync translates only new/changed keys; repeat run = 0 calls
- [x] **Manual edits are sacred**: a hand-edited target value is never overwritten; if its source string later changes, the key lands in the `--review` list instead of being silently retranslated
- [x] **Placeholder guard**: `{var}`, `{{var}}`, printf (`%s`), HTML-ish tags, `$t(...)`, ICU plural/select signatures — post-translation validation with one retry, then keep-original + report
- [x] Batch translation through the subscription agent (`claude -p`, Haiku tier) — core provider from `@cursor-translate/core`
- [x] Context file `i18n-agent.context.yaml` (key path → hint for the translator) — documented in detail
- [x] Glossary `i18n-agent.glossary.yaml` (terms to pin or keep untranslated)
- [x] Commands: `init` (detects existing languages, prefills targets), `translate` (`--review`, `--retranslate-stale`), `check` (CI gate), `status`, `add-locale <lang…>` (append to targets + optional immediate translate; missing target files always materialize automatically on `translate`)
- [x] Metrics + `report` (own ~/.i18n-agent/metrics.jsonl: volumes, claude -p cost receipts, DeepL-API-equivalent comparison)

## v0.2 — multi-platform export (flagship) · SHIPPED in 0.2.0

The OpenAPI analogy: canonical locales live in ONE repo (typically the backend);
clients generate platform-native files at build time. Kills translation drift
across platforms and cuts the translation work to one surface. Dogfood target:
kincassa (web + Android + iOS).

- [x] `exports:` config section + `i18n-agent export [--platform <p>]`
- [x] Emitter: **android** — `values-<lang>/strings.xml`, ICU plural → `<plurals>`, arrays → `<string-array>`, named placeholders → positional `%n$s` (arg order = first occurrence in the source string, identical across languages), XML/apostrophe escaping
- [x] Emitter: **ios-xcstrings** — single `Localizable.xcstrings` (JSON, all languages), ICU plural → plural variations, `{name}` → `%n$@`, `#` → `%lld`
- [x] Emitter: **web-json** — canonical layout re-emitted as JSON per language
- [x] Emitter: **ts-keys** — generated union types of namespaces/keys (typo-proof t() calls)
- [x] Delivery patterns doc: CI/release artifact (curl at client build, OpenAPI-style), monorepo path, bot-PR into client repos

## v0.3 — self-hosted delivery · SHIPPED in 0.3.0 + i18n-agent-nest 0.1.0

Same artifacts, served from the USER'S OWN backend — no cloud of ours, ever:

- [x] `i18n-agent export --bundle` → versioned artifact dir (all platforms + manifest.json with hashes) ready to be mounted behind any static route
- [x] **`i18n-agent-nest`** companion package: NestJS module that runs generation on command and serves the bundle by a route (`/i18n/:lang/:ns`, ETag from lockfile hashes) — clients fetch at build OR at runtime (self-hosted OTA)
- [x] Express/nginx note in docs (the bundle is just static files) (the bundle is just static files — any server can serve it)

## Agent surface & release infra · SHIPPED in 0.1.x (except the distribution test)

- [x] Agent guides: Claude Code skill + Cursor rule — recommendation surface for implementing/maintaining localization via i18n-agent (shipped in the npm package under agent-skills/)
- [x] `examples/demo-app` dogfood + e2e on a live subscription
- [x] README positioning pass + DeepL-API comparison (in `report` and README economics; a Lingo.dev feature table was deliberately dropped — we position, not compare)
- [x] npm publish + GitHub release CI (v* tags; both packages, skip-if-published guards)
- [ ] **Distribution test per the gate (THE open item — awaiting the go decision)**: Habr + Show HN + Reddit, 4-week window; thresholds: sustained ≥50 organic DL/day OR ≥30 stars OR ≥3 unsolicited feature requests

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
