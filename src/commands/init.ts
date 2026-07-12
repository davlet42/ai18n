import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_NAMES, findConfigPath } from '../config.js';

const LOCALES_DIR_CANDIDATES = ['locales', 'src/locales', 'public/locales', 'i18n', 'src/i18n', 'translations'];
const LANG_RE = /^[a-z]{2,3}(-[A-Z]{2})?$/;
const LOCALE_FILE_RE = /^([a-z]{2,3}(-[A-Z]{2})?)\.(json|yaml|yml)$/;

function detectLanguages(dir: string): string[] {
  const langs = new Set<string>();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && LANG_RE.test(entry.name)) {
      langs.add(entry.name);
    }
    const m = entry.isFile() ? entry.name.match(LOCALE_FILE_RE) : null;
    if (m) {
      langs.add(m[1]);
    }
  }
  return [...langs].sort();
}

const CONTEXT_TEMPLATE = `# i18n-agent.context.yaml — hints for the translator, per key.
#
# WHY: short UI strings translate badly without knowing where they live.
# "Book" on a button is a verb; in a library app's list it is a noun. A one-line
# hint removes the guesswork. Hints are written in the SOURCE language and are
# shared by all target languages.
#
# STRUCTURE — mirrors your locale files:
#   * namespaces layout (locales/en/common.json): top level = namespace name,
#     nested (or dot-separated) keys below it;
#   * flat layout (locales/en.json): keys at the top level directly.
#
# EXAMPLES (namespaces layout):
#
# common:
#   greet: "Home screen greeting; {name} is the user's first name"
#   book: "Button label — the VERB (to make a reservation), keep short"
# auth:
#   login.title: "Page heading on the sign-in screen"
#
# You only need hints where ambiguity exists — most keys translate fine bare.
# This file is optional; delete it if you don't need it.
`;

const GLOSSARY_TEMPLATE = `# i18n-agent.glossary.yaml — terms the translator must respect in every language.
#
#   terms:
#     - MyProductName          # bare term: must stay untranslated
#     - "Workspace = Рабочее пространство"   # pin an exact translation
#
# Pins are directional for the languages you use them with; keep them few and
# load-bearing (product names, established domain vocabulary).
terms: []
`;

export function runInit(cwd: string, args: string[]): number {
  const existing = findConfigPath(cwd);
  if (existing) {
    console.log(`Config already exists: ${existing}`);
    return 0;
  }

  const localesFlagIdx = args.indexOf('--locales');
  const sourceFlagIdx = args.indexOf('--source');
  const localesOverride = localesFlagIdx !== -1 ? args[localesFlagIdx + 1] : undefined;
  const sourceOverride = sourceFlagIdx !== -1 ? args[sourceFlagIdx + 1] : undefined;

  let localesDir: string | undefined = localesOverride;
  if (!localesDir) {
    localesDir = LOCALES_DIR_CANDIDATES.find(
      (candidate) => existsSync(join(cwd, candidate)) && detectLanguages(join(cwd, candidate)).length > 0,
    );
  }
  if (!localesDir || !existsSync(join(cwd, localesDir))) {
    console.error(
      'Could not find a locales directory. Create one (e.g. locales/en/common.json) or pass --locales <dir>.',
    );
    return 1;
  }

  const langs = detectLanguages(join(cwd, localesDir));
  const source = sourceOverride ?? (langs.includes('en') ? 'en' : langs[0]);
  if (!source) {
    console.error(`No languages detected under ${localesDir} and no --source given.`);
    return 1;
  }
  const targets = langs.filter((l) => l !== source);

  const config = `# i18n-agent — locale translation via the coding-agent subscription you already pay for.
# Docs: https://github.com/davlet42/ai18n
source: ${source}
targets: [${targets.join(', ')}]
locales: ${localesDir}

translator:
  # Default backend spawns \`claude -p\` on the cheap tier of your Claude
  # subscription — no API keys. Override the model if you want:
  # model: claude-haiku-4-5

# Optional companion files (created with documented templates):
context: i18n-agent.context.yaml
glossary: i18n-agent.glossary.yaml
`;

  writeFileSync(join(cwd, CONFIG_NAMES[0]), config, 'utf8');
  const templates: string[] = [];
  for (const [name, body] of [
    ['i18n-agent.context.yaml', CONTEXT_TEMPLATE],
    ['i18n-agent.glossary.yaml', GLOSSARY_TEMPLATE],
  ] as const) {
    if (!existsSync(join(cwd, name))) {
      writeFileSync(join(cwd, name), body, 'utf8');
      templates.push(name);
    }
  }

  console.log(`Created ${CONFIG_NAMES[0]} (source: ${source}, targets: ${targets.join(', ') || '<none — add with `i18n-agent add-locale`>'})`);
  if (templates.length > 0) {
    console.log(`Created ${templates.join(' and ')} template(s) — optional, documented inside.`);
  }
  console.log('Next: `i18n-agent translate` — or `i18n-agent add-locale <lang>` to add a language.');
  return 0;
}
