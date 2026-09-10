import type { Leaf } from './locale-files.js';
import { loadGlossaryTerms } from './context-glossary.js';
import { readGlossaryFileSha, sourceMatchesGlossary } from './glossary-match.js';
import { keyId, type Lockfile } from './lockfile.js';

export const GLOSSARY_INVALIDATED_SOURCE = 'glossary-invalidated';

export function applyGlossaryInvalidation(
  lock: Lockfile,
  glossaryPath: string,
  sourceFlat: Map<string, Map<string, Leaf>>,
  options: { force?: boolean } = {},
): string {
  const currentSha = readGlossaryFileSha(glossaryPath);
  const glossaryChanged = Boolean(lock.glossarySha && lock.glossarySha !== currentSha);
  if (!options.force && !glossaryChanged) {
    return currentSha;
  }

  const terms = loadGlossaryTerms(glossaryPath);
  if (terms.length === 0) {
    return currentSha;
  }

  for (const [namespace, source] of sourceFlat) {
    for (const [key, value] of source) {
      if (typeof value !== 'string' || !sourceMatchesGlossary(value, terms)) {
        continue;
      }
      const id = keyId(namespace, key);
      const entry = lock.keys[id];
      if (!entry) {
        continue;
      }
      for (const target of Object.values(entry.targets)) {
        if (options.force || target.by === 'machine') {
          target.source = GLOSSARY_INVALIDATED_SOURCE;
        }
      }
    }
  }

  return currentSha;
}
