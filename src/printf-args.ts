// Platform-agnostic printf placeholder extraction and parity checks.
// Covers Android/Java (%1$s, %s), Apple xcstrings (%@, %1$@, %lld), and named %(user)s.
// Used by translate guard (all platforms), structural check, and format-arg validators.

const ICU_HEAD_RE = /^([\w.]+)\s*,\s*(plural|selectordinal|select)\s*,([\s\S]*)$/;
const PRINTF_RE = /^%(\d+\$)?(?:ll)?[sdif@]/;
const NAMED_PRINTF_RE = /^%\(([^)]+)\)[sdif]/;

function findBalanced(text: string, start: number, open: string, close: string): number {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === open) {
      depth += 1;
    } else if (text[i] === close) {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

function parseIcuCategories(body: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  let i = 0;
  while (i < body.length) {
    while (i < body.length && /\s/.test(body[i])) {
      i += 1;
    }
    let name = '';
    while (i < body.length && body[i] !== '{' && !/\s/.test(body[i])) {
      name += body[i];
      i += 1;
    }
    while (i < body.length && /\s/.test(body[i])) {
      i += 1;
    }
    if (i >= body.length || body[i] !== '{' || name === '') {
      break;
    }
    const end = findBalanced(body, i, '{', '}');
    if (end === -1) {
      break;
    }
    out.push({ name, body: body.slice(i + 1, end) });
    i = end + 1;
  }
  return out;
}

function scanPrintfArgs(text: string, insideIcuCategory: boolean): string[] {
  const tokens: string[] = [];
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (ch === '{' && text[i + 1] === '{') {
      const end = text.indexOf('}}', i + 2);
      if (end !== -1) {
        i = end + 2;
        continue;
      }
    }

    if (ch === '{') {
      const end = findBalanced(text, i, '{', '}');
      if (end !== -1) {
        const inner = text.slice(i + 1, end);
        const icu = inner.match(ICU_HEAD_RE);
        if (icu && !insideIcuCategory) {
          for (const category of parseIcuCategories(icu[3])) {
            tokens.push(...scanPrintfArgs(category.body, true));
          }
        }
        i = end + 1;
        continue;
      }
    }

    if (ch === '%') {
      if (text[i + 1] === '%') {
        i += 2;
        continue;
      }
      const named = text.slice(i).match(NAMED_PRINTF_RE);
      if (named) {
        tokens.push(named[0]);
        i += named[0].length;
        continue;
      }
      const positional = text.slice(i).match(PRINTF_RE);
      if (positional) {
        tokens.push(positional[0]);
        i += positional[0].length;
        continue;
      }
    }

    i += 1;
  }

  return tokens;
}

/** Sorted multiset of printf tokens in a string (Android, Apple, named). */
export function extractPrintfArgs(text: string): string[] {
  return scanPrintfArgs(text, false).sort();
}

export interface PrintfValidation {
  ok: boolean;
  missing: string[];
  extra: string[];
}

function multisetDiff(want: string[], got: string[]): { missing: string[]; extra: string[] } {
  const missing: string[] = [];
  const pool = [...got];
  for (const token of want) {
    const idx = pool.indexOf(token);
    if (idx === -1) {
      missing.push(token);
    } else {
      pool.splice(idx, 1);
    }
  }
  return { missing, extra: pool };
}

export function validatePrintfArgs(source: string, target: string): PrintfValidation {
  const want = extractPrintfArgs(source);
  const got = extractPrintfArgs(target);
  const { missing, extra } = multisetDiff(want, got);
  return { ok: missing.length === 0 && extra.length === 0, missing, extra };
}

/** Explicit retry hint when the source uses printf-style placeholders. */
export function formatPrintfRetryHint(source: string): string | undefined {
  const tokens = extractPrintfArgs(source);
  if (tokens.length === 0) {
    return undefined;
  }
  return `Printf placeholders must appear exactly as in the source: ${tokens.join(', ')}. Do not invent extra indices (e.g. if the source has only %1$s, do not add %2$s for translated text).`;
}
