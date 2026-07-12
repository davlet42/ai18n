import { readFileSync, writeFileSync } from 'node:fs';
import YAML from 'yaml';
import { findConfigPath } from '../config.js';
import { runTranslate } from './translate.js';

const LANG_RE = /^[a-z]{2,3}(-[A-Z]{2})?$/;

// Appends languages to `targets` in i18n-agent.config.yaml (comments preserved via
// the YAML document API). Target files materialize on the next `translate` —
// there is nothing else to create by hand.
export async function runAddLocale(cwd: string, args: string[]): Promise<number> {
  const translateAfter = args.includes('--translate');
  const langs = args.filter((a) => !a.startsWith('--'));
  if (langs.length === 0) {
    console.error('Usage: i18n-agent add-locale <lang> [<lang>…] [--translate]');
    return 1;
  }
  const bad = langs.filter((l) => !LANG_RE.test(l));
  if (bad.length > 0) {
    console.error(`Not a language code: ${bad.join(', ')} (expected e.g. "de" or "pt-BR")`);
    return 1;
  }

  const configPath = findConfigPath(cwd);
  if (!configPath) {
    console.error('i18n-agent.config.yaml not found — run `i18n-agent init` first.');
    return 1;
  }

  const doc = YAML.parseDocument(readFileSync(configPath, 'utf8'));
  const current = (doc.get('targets') as YAML.YAMLSeq | undefined)?.toJSON() as string[] | undefined;
  const existing = new Set(Array.isArray(current) ? current : []);
  const added: string[] = [];
  for (const lang of langs) {
    if (!existing.has(lang)) {
      existing.add(lang);
      added.push(lang);
    }
  }
  if (added.length === 0) {
    console.log('All of those languages are already in targets.');
    return 0;
  }
  doc.set('targets', [...existing]);
  writeFileSync(configPath, doc.toString(), 'utf8');
  console.log(`Added to targets: ${added.join(', ')} (${configPath})`);

  if (translateAfter) {
    const flags: string[] = [];
    for (const lang of added) {
      flags.push('--lang', lang);
    }
    return runTranslate(cwd, flags);
  }
  console.log('Files will materialize on the next `i18n-agent translate`.');
  return 0;
}
