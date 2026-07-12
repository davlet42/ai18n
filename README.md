# i18n-agent

**Your locale files, translated by the coding-agent subscription you already pay for.** No API keys, no per-word fees, no cloud. Diff-synced through a lockfile, placeholder-safe, and your manual edits are never overwritten.

```bash
npx i18n-agent translate   # en.json → ru.json, es.json, de.json — via `claude -p` on your Max plan
```

The idea: modern coding agents (Claude Code, Cursor) run on subscriptions that already include a cheap model tier. i18n-agent batches your untranslated locale strings and pipes them through a headless agent call (`claude -p --model haiku`) — so keeping 10 languages in sync costs you **$0 on top of the subscription you already have**. Prefer API keys or CI without a subscription? A provider switch away.

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

1. You (or your agent) edit the **source** locale as part of normal feature work.
2. `i18n-agent translate` diffs against the lockfile and translates **only new and changed keys**, batched through the subscription agent. Placeholders (`{name}`, `{{var}}`, `%s`, ICU plurals, HTML tags) are validated after translation — a violation gets one retry, then the key is reported instead of silently broken.
3. Run it again — zero calls. The lockfile knows.
4. `i18n-agent check` in CI fails the build when targets drift out of sync.

## Manual edits are sacred

The lockfile stores a hash of every translation i18n-agent writes. If you hand-fix `ru/common.json`, i18n-agent notices the value is no longer its own and **never overwrites it**. If the English source of that key changes later, the key shows up in `i18n-agent translate --review` for a human decision (or `--retranslate-stale` to bulk-accept machine translation). Translation memory semantics — as plain files in your git, not rented server state with a retention timer.

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

**v0.1 engine complete and live-verified** (2026-07-12): 20-string demo translated to ru+es in 2 agent calls through a Claude Max subscription; repeat runs cost 0 calls; ICU plurals, glossary pinning, rename migration and the review flow verified end-to-end. 33/33 tests. See [ROADMAP.md](./ROADMAP.md) for what's next (`/i18nify` is coming). Built on [`@cursor-translate/core`](https://github.com/davlet42/cursor-translate) — the engine behind [cursor-translate](https://github.com/davlet42/cursor-translate) and [claude-translate](https://github.com/davlet42/claude-translate).

## Honest economics

- Translation runs on your **subscription's cheap tier** (Haiku-class): a 2,000-string app × 10 languages ≈ a few dollars of API money — or ~$0 marginal under a Claude Max plan.
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
