---
name: ai18n
description: Use when the user asks to add localization/i18n to a project, translate locale files, add a target language, keep locales in sync, or review stale translations. Guides the correct ai18n workflow — edit only the source locale, machine-translate targets through the user's subscription, never hand-write target files.
---

# ai18n — localization through the user's own subscription

ai18n translates locale files via a headless agent call on the subscription the
user already pays for (no API keys, no per-word fees). Your job is to drive it
correctly: **you author the source locale; ai18n owns the targets.**

## Setting up localization in a project that has none

1. Wire an i18n library appropriate to the stack (i18next / next-intl /
   vue-i18n / react-intl). While implementing, move user-facing strings into
   the SOURCE locale as keys — `locales/en/common.json` (namespaces) or
   `locales/en.json` (flat). Never hardcode UI strings.
2. `npx ai18n init` — detects the layout, writes `ai18n.config.yaml` plus
   documented `ai18n.context.yaml` / `ai18n.glossary.yaml` templates.
3. `npx ai18n add-locale <lang> … --translate` — target files materialize
   fully translated; nothing is created by hand.
4. Add `npx ai18n check` to CI — it exits 1 when locales drift.
5. Commit `ai18n.lock` together with the locale files (it is the translation
   memory; never edit it manually).

## Working in a project that already has ai18n (config file present)

- After adding or changing keys in the source locale: `npx ai18n translate`.
- Before committing: `npx ai18n check`.
- Adding a language: `npx ai18n add-locale <lang> --translate`.
- A string that needs disambiguation ("Book" — verb or noun?) gets a one-line
  hint in `ai18n.context.yaml` — then retranslate.

## Hard rules

- **Edit ONLY the source locale.** Do not write translations into target files
  yourself: a hand-written value is recorded as human-owned and the machine
  will never update it again. Reserve hand edits for deliberate human polish
  the user asked for.
- **Never break placeholders**: `{var}`, `{{var}}`, printf, `$t(...)`, HTML
  tags, ICU plural/select structures stay byte-identical in source edits.
- **Review semantics**: `check` reporting "awaiting review" means a human
  edited a translation and its source changed later. Surface the list
  (`npx ai18n translate --review`) to the user and let THEM decide: edit the
  value (resolves the review), `--accept-stale` (value still correct), or
  `--retranslate-stale` (machine redo). Do not decide for them.
- Renamed keys are migrated automatically (translation + ownership follow the
  key) — rename freely in the source, then `translate`.
- `npx ai18n report` shows volumes and real cost receipts when the user asks
  what localization costs.
