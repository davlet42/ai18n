import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import YAML from 'yaml';

// i18n-agent.config.yaml — the only required file. Looked up from cwd upwards so
// the CLI works from any subdirectory of the project.

export interface I18nAgentConfig {
  source: string;
  targets: string[];
  localesDir: string; // absolute
  model?: string;
  contextPath: string; // absolute; may not exist
  glossaryPath: string; // absolute; may not exist
  configPath: string; // absolute
  root: string; // directory containing the config
}

export const CONFIG_NAMES = ['i18n-agent.config.yaml', 'i18n-agent.config.yml'];

export function findConfigPath(cwd: string): string | null {
  let dir = resolve(cwd);
  for (;;) {
    for (const name of CONFIG_NAMES) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

export function loadConfig(cwd: string): I18nAgentConfig {
  const configPath = findConfigPath(cwd);
  if (!configPath) {
    throw new Error('i18n-agent.config.yaml not found — run `i18n-agent init` in your project root first.');
  }
  const root = dirname(configPath);
  const raw = YAML.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown> | null;
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Config is not a YAML object: ${configPath}`);
  }

  const source = typeof raw.source === 'string' ? raw.source : '';
  if (!source) {
    throw new Error(`Config must define "source" (source language code): ${configPath}`);
  }
  const targets = Array.isArray(raw.targets)
    ? raw.targets.filter((t): t is string => typeof t === 'string' && t.length > 0)
    : [];

  const translator =
    raw.translator && typeof raw.translator === 'object'
      ? (raw.translator as Record<string, unknown>)
      : {};

  return {
    source,
    targets,
    localesDir: resolve(root, typeof raw.locales === 'string' ? raw.locales : 'locales'),
    model: typeof translator.model === 'string' ? translator.model : undefined,
    contextPath: resolve(root, typeof raw.context === 'string' ? raw.context : 'i18n-agent.context.yaml'),
    glossaryPath: resolve(
      root,
      typeof raw.glossary === 'string' ? raw.glossary : 'i18n-agent.glossary.yaml',
    ),
    configPath,
    root,
  };
}
