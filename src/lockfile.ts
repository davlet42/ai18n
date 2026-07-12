import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

// ai18n.lock — the translation memory, as a plain committed file.
// For every string key we track the sha of the SOURCE text and, per target
// language, the sha of the value ai18n last wrote plus who owns it:
//   by: "ai18n"  — machine translation; retranslated when the source changes
//   by: "human"  — the value on disk stopped matching what ai18n wrote (or the
//                  key predates ai18n). Sacred: never overwritten. If its
//                  source changes later, the key goes to the --review list.
// Key ids are `${namespace}:${flatKey}` (flat layout uses an empty namespace).

export interface LockTarget {
  sha: string;
  by: 'ai18n' | 'human';
}

export interface LockEntry {
  source: string;
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
    sorted.keys[id] = { source: entry.source, targets };
  }
  writeFileSync(path, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
}

function entryFor(lock: Lockfile, id: string, sourceText: string): LockEntry {
  const existing = lock.keys[id];
  if (existing) {
    existing.source = sha256(sourceText);
    return existing;
  }
  const fresh: LockEntry = { source: sha256(sourceText), targets: {} };
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
  entryFor(lock, id, sourceText).targets[lang] = { sha: sha256(translatedText), by: 'ai18n' };
}

// Adopt a value we did not write (pre-existing translation or a hand edit).
export function recordHumanValue(
  lock: Lockfile,
  id: string,
  lang: string,
  sourceText: string,
  targetText: string,
): void {
  entryFor(lock, id, sourceText).targets[lang] = { sha: sha256(targetText), by: 'human' };
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
