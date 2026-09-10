import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { loadGlossaryTerms } from './context-glossary.js';

export function glossarySha256(terms: string[]): string {
  return createHash('sha256').update(terms.join('\n'), 'utf8').digest('hex');
}

export function readGlossarySha(glossaryPath: string): string {
  return glossarySha256(loadGlossaryTerms(glossaryPath));
}

export function parseGlossarySearchTerms(terms: string[]): string[] {
  const out: string[] = [];
  for (const term of terms) {
    const eq = /^(.+?)\s*=/.exec(term);
    const needle = (eq ? eq[1] : term).trim();
    if (needle) {
      out.push(needle);
    }
  }
  return out;
}

export function sourceMatchesGlossary(sourceText: string, terms: string[]): boolean {
  const needles = parseGlossarySearchTerms(terms);
  return needles.some((needle) => sourceText.includes(needle));
}

export function readGlossaryFileSha(glossaryPath: string): string {
  try {
    return createHash('sha256').update(readFileSync(glossaryPath, 'utf8'), 'utf8').digest('hex');
  } catch {
    return '';
  }
}
