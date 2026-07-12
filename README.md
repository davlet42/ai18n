# ai18n

**Your locale files, translated by the coding-agent subscription you already pay for.** No API keys, no per-word fees, no cloud. Diff-synced through a lockfile, placeholder-safe, and your manual edits are never overwritten.

```bash
npx ai18n translate   # en.json → ru.json, es.json, de.json — via `claude -p` on your Max plan
```

The idea: modern coding agents (Claude Code, Cursor) run on subscriptions that already include a cheap model tier. ai18n batches your untranslated locale strings and pipes them through a headless agent call (`claude -p --model haiku`) — so keeping 10 languages in sync costs you **$0 on top of the subscription you already have**. Prefer API keys or CI without a subscription? A provider switch away.

## How it works

```
my-app/
├── locales/
│   ├── en/              # source of truth — authored by you (or your coding agent)
│   │   ├── common.json
│   │   └── auth.json
│   ├── ru/              # targets — generated, but hand-editable
│   └── es/
├── ai18n.config.yaml    # source, targets, provider
├── ai18n.context.yaml   # optional: hints for the translator per key
├── ai18n.glossary.yaml  # optional: terms to pin or keep untranslated
└── ai18n.lock           # what's translated, what changed, what a human touched
```

1. You (or your agent) edit the **source** locale as part of normal feature work.
2. `ai18n translate` diffs against the lockfile and translates **only new and changed keys**, batched through the subscription agent. Placeholders (`{name}`, `{{var}}`, `%s`, ICU plurals, HTML tags) are validated after translation — a violation gets one retry, then the key is reported instead of silently broken.
3. Run it again — zero calls. The lockfile knows.
4. `ai18n check` in CI fails the build when targets drift out of sync.

## Manual edits are sacred

The lockfile stores a hash of every translation ai18n writes. If you hand-fix `ru/common.json`, ai18n notices the value is no longer its own and **never overwrites it**. If the English source of that key changes later, the key shows up in `ai18n translate --review` for a human decision (or `--retranslate-stale` to bulk-accept machine translation). Translation memory semantics — as plain files in your git, not rented server state with a retention timer.

## Recommended: let your coding agent drive it

ai18n ships optional **agent guides** — install one and your coding agent handles localization correctly whenever *you* ask it to ("add localization to this app", "add German", "translate the new strings"). This is a recommendation surface, not background automation: the agent learns the workflow — author the source locale, run `ai18n`, never hand-write target files.

Claude Code (project-level skill):

```bash
mkdir -p .claude/skills && cp -r "$(npm root -g)/ai18n/agent-skills/claude-code/ai18n" .claude/skills/
```

Cursor (project rule):

```bash
mkdir -p .cursor/rules && cp "$(npm root -g)/ai18n/agent-skills/cursor/ai18n.mdc" .cursor/rules/
```

The guides encode the ownership rules (source is yours, targets are machine-owned, hand edits are sacred and reviewed) so an agent never fights the lockfile.

## Status

Under active development — v0.1 engine in progress. See [ROADMAP.md](./ROADMAP.md). Built on [`@cursor-translate/core`](https://github.com/davlet42/cursor-translate) — the engine behind [cursor-translate](https://github.com/davlet42/cursor-translate) and [claude-translate](https://github.com/davlet42/claude-translate).

## Honest economics

- Translation runs on your **subscription's cheap tier** (Haiku-class): a 2,000-string app × 10 languages ≈ a few dollars of API money — or ~$0 marginal under a Claude Max plan.
- ai18n stores nothing server-side because there is no server. The "translation memory" is `ai18n.lock` + your locale files, in your repo, forever.
- What ai18n does **not** do: no TMS dashboard, no review workflow UI (use `--review` + git diff), no code extraction (your source locale is authored — by you or your coding agent; see `/i18nify` on the roadmap).

## License

MIT
