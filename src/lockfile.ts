import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

// i18n-agent.lock — the translation memory, as a plain committed file.
// For every string key we track the sha of the SOURCE text and, per target
// language, the sha of the value i18n-agent last wrote plus who owns it:
//   by: "i18n-agent"  — machine translation; retranslated when the source changes
//   by: "human"  — the value on disk stopped matching what i18n-agent wrote (or the
//                  key predates i18n-agent). Sacred: never overwritten. If its
//                  source changes later, the key goes to the --review list.
// Key ids are `${namespace}:${flatKey}` (flat layout uses an empty namespace).

export interface LockTarget {
  sha: string;
  by: 'machine' | 'human';
  // sha of the SOURCE text this translation was made against — per language,
  // so one language's retranslation can never erase another's review state.
  source: string;
}

export interface LockEntry {
  targets: { [lang: string]: LockTarget };
}

export interface Lockfile {
  version: 1;
  keys: { [id: string]: LockEntry };
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function keyId(namespace: string, flatKey: string): string {
  return `${namespace}:${flatKey}`;
}

export function readLockfile(path: string): Lockfile {
  if (!existsSync(path)) {
    return { version: 1, keys: {} };
  }
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Lockfile;
  if (parsed.version !== 1 || typeof parsed.keys !== 'object') {
    throw new Error(`Unsupported lockfile format: ${path}`);
  }
  return parsed;
}

// Keys are written sorted so lockfile diffs stay minimal and reviewable in git.
export function writeLockfile(path: string, lock: Lockfile): void {
  const sorted: Lockfile = { version: 1, keys: {} };
  for (const id of Object.keys(lock.keys).sort()) {
    const entry = lock.keys[id];
    const targets: LockEntry['targets'] = {};
    for (const lang of Object.keys(entry.targets).sort()) {
      targets[lang] = entry.targets[lang];
    }
    sorted.keys[id] = { targets };
  }
  writeFileSync(path, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
}

function entryFor(lock: Lockfile, id: string): LockEntry {
  const existing = lock.keys[id];
  if (existing) {
    return existing;
  }
  const fresh: LockEntry = { targets: {} };
  lock.keys[id] = fresh;
  return fresh;
}

export function recordTranslation(
  lock: Lockfile,
  id: string,
  lang: string,
  sourceText: string,
  translatedText: string,
): void {
  entryFor(lock, id).targets[lang] = {
    sha: sha256(translatedText),
    by: 'machine',
    source: sha256(sourceText),
  };
}

// Adopt a value we did not write (pre-existing translation or a hand edit).
export function recordHumanValue(
  lock: Lockfile,
  id: string,
  lang: string,
  sourceText: string,
  targetText: string,
): void {
  entryFor(lock, id).targets[lang] = {
    sha: sha256(targetText),
    by: 'human',
    source: sha256(sourceText),
  };
}

export function pruneKey(lock: Lockfile, id: string, lang?: string): void {
  const entry = lock.keys[id];
  if (!entry) {
    return;
  }
  if (lang === undefined) {
    delete lock.keys[id];
    return;
  }
  delete entry.targets[lang];
}
