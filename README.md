# i18n-agent

**Your locale files, translated by the coding-agent subscription you already pay for.** No API keys, no per-word fees, no cloud. Diff-synced through a lockfile, placeholder-safe, and your manual edits are never overwritten.

```bash
npx i18n-agent translate   # en.json → ru.json, es.json, de.json — via `claude -p` on your subscription
```

The idea: modern coding agents run on subscriptions that already include a cheap model tier. i18n-agent batches your untranslated locale strings and pipes them through a headless agent call (`claude -p --model haiku`) — so keeping 10 languages in sync costs you **$0 on top of the subscription you already have**. Prefer API keys or CI without a subscription? A provider switch away.

## Quick start

```bash
npm install -g i18n-agent            # or npx i18n-agent …
cd your-app
i18n-agent init                      # detects locales/, writes config + documented templates
i18n-agent add-locale ru es --translate
i18n-agent check                     # CI gate: exit 1 on drift
i18n-agent report --days 7           # volumes, real cost receipts, DeepL-API equivalent
```

## How it works

```
my-app/
├── locales/
│   ├── en/              # source of truth — authored by you (or your coding agent)
│   │   ├── common.json
│   │   └── auth.json
│   ├── ru/              # targets — generated, but hand-editable
│   └── es/
├── i18n-agent.config.yaml    # source, targets, provider
├── i18n-agent.context.yaml   # optional: hints for the translator per key
├── i18n-agent.glossary.yaml  # optional: terms to pin or keep untranslated
└── i18n-agent.lock           # what's translated, what changed, what a human touched
```

Locale files may be JSON, YAML, or **TypeScript modules** (`export default { … } as const;` — the layout typed web codebases use for compile-checked keys). The format is auto-detected from the source locale and mirrored to targets.

1. You (or your agent) edit the **source** locale as part of normal feature work.
2. `i18n-agent translate` diffs against the lockfile and translates **only new and changed keys**, batched through the subscription agent. Placeholders (`{name}`, `{{var}}`, `%s`, ICU plurals, HTML tags) are validated after translation — a violation gets one retry, then the key is reported instead of silently broken.
3. Run it again — zero calls. The lockfile knows.
4. `i18n-agent check` in CI fails the build when targets drift out of sync.

## Manual edits are sacred

The lockfile stores a hash of every translation i18n-agent writes. If you hand-fix `ru/common.json`, i18n-agent notices the value is no longer its own and **never overwrites it**. If the English source of that key changes later, the key shows up in `i18n-agent translate --review` for a human decision (or `--retranslate-stale` to bulk-accept machine translation). Translation memory semantics — as plain files in your git, not rented server state with a retention timer.

## Multi-platform export: one source, native locales everywhere

Your product has web, Android and iOS? Keep ONE canonical set of locales (typically next to the backend) and generate platform-native files at build time — the OpenAPI model applied to translations. No drift between platforms, translation work done once.

```yaml
# i18n-agent.config.yaml
exports:
  - platform: android        # values-<lang>/strings.xml, ICU plural → <plurals>, arrays → <string-array>
    out: ../android-app/app/src/main/res
  - platform: ios-xcstrings  # single Localizable.xcstrings (String Catalog), plural variations
    out: ../ios-app/Resources
  - platform: web-json       # canonical layout re-emitted as JSON
    out: ../web-app/public/locales
  - platform: ts-keys        # generated key unions — typo-proof t() calls
    out: ../web-app/src/i18n
```

`i18n-agent export` after `translate`. Named placeholders become positional per platform (`{name}` → `%1$s` / `%1$@`) with the argument order taken from the **source** string — every language numbers the same argument identically, even when a translation reorders the sentence.

Delivery is yours to choose: publish the export dir as a CI/release artifact and fetch it in client builds (OpenAPI-style), keep clients in a monorepo, or let a bot PR the generated files.

## Self-hosted delivery: your backend serves the translations

```bash
i18n-agent export --bundle          # → i18n-bundle/: all platforms + manifest.json (per-file sha256, content-derived etag)
```

Mount the bundle behind any static route — or, on NestJS, use the companion package [`i18n-agent-nest`](./packages/nest):

```ts
I18nAgentModule.forRoot({ bundleDir: 'i18n-bundle' })
// GET /i18n/manifest.json · /i18n/web/ru/common.json · /i18n/android/… · ETag/304 out of the box
```

Web clients fetch locales at runtime, mobile CI fetches native files at build time — from YOUR server. No third-party cloud, no retention timers: the "translation service" is static files in your deploy. Not on Nest? `express.static` or nginx serve the same bundle; the module only adds correct ETags and the manifest route.

## Recommended: let your coding agent drive it

i18n-agent ships optional **agent guides** — install one and your coding agent handles localization correctly whenever *you* ask it to ("add localization to this app", "add German", "translate the new strings"). This is a recommendation surface, not background automation: the agent learns the workflow — author the source locale, run `i18n-agent`, never hand-write target files.

Claude Code (project-level skill):

```bash
mkdir -p .claude/skills && cp -r "$(npm root -g)/i18n-agent/agent-skills/claude-code/i18n-agent" .claude/skills/
```

Cursor (project rule):

```bash
mkdir -p .cursor/rules && cp "$(npm root -g)/i18n-agent/agent-skills/cursor/i18n-agent.mdc" .cursor/rules/
```

The guides encode the ownership rules (source is yours, targets are machine-owned, hand edits are sacred and reviewed) so an agent never fights the lockfile.

## Status

**v0.1 engine complete and live-verified** (2026-07-12): 20-string demo translated to ru+es in 2 agent calls through the subscription; repeat runs cost 0 calls; ICU plurals, glossary pinning, rename migration and the review flow verified end-to-end. 33/33 tests. See [ROADMAP.md](./ROADMAP.md) for what's next (`/i18nify` is coming). Built on [`@cursor-translate/core`](https://github.com/davlet42/cursor-translate) — the engine behind [cursor-translate](https://github.com/davlet42/cursor-translate) and [claude-translate](https://github.com/davlet42/claude-translate).

## Migrating an existing app: import your native translations

Already shipping with per-platform locales? Pull them into the canonical set once — keeping every human translation:

```bash
i18n-agent import --platform android --in app/src/main/res
i18n-agent import --platform ios-xcstrings --in Localizable.xcstrings
```

- **Android**: `values*/strings.xml` land in one namespace (default `android`); `<plurals>` become ICU plural, `<string-array>` arrays; `translatable="false"` brand constants are skipped; non-language qualifier dirs (`values-night`, `values-v21`) are ignored.
- **iOS**: dot keys become nesting and the top-level segment becomes the namespace (`auth.signIn.title` → `auth.json`); plural variations become ICU plural; Apple specifiers (`%@`, `%lld`) are understood by the placeholder guard.
- Then run `i18n-agent translate`: every pre-existing translation is **adopted as human-owned** — sacred, never overwritten; only genuinely missing keys hit the translator.

## Honest economics

- Translation runs on your **subscription's cheap tier** (Haiku-class): a 2,000-string app × 10 languages ≈ a few dollars of API money — or ~$0 marginal on the subscription you already have.
- i18n-agent stores nothing server-side because there is no server. The "translation memory" is `i18n-agent.lock` + your locale files, in your repo, forever.
- What i18n-agent does **not** do: no TMS dashboard, no review workflow UI (use `--review` + git diff), no code extraction (your source locale is authored — by you or your coding agent; see `/i18nify` on the roadmap).

Every run logs volumes and real `claude -p` cost receipts — pull your own numbers:

```
$ i18n-agent report --days 7
i18n-agent report — last 7 day(s), project "demo-app"
  runs: 2 · strings translated: 2 (failed: 0) · agent calls: 2
  volume: 24 source chars → 34 translated chars
  spend: $0.0040 (claude -p receipts; ~$0 marginal on a subscription)
  DeepL API equivalent for the same volume: ~$0.00 (@ $25/M chars)
```

## License

MIT
