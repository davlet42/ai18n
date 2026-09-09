import { findIcuMessage } from '../exporters/transform.js';
import { extractPrintfArgs } from '../printf-args.js';

const ICU_HEAD_RE = /^([\w.]+)\s*,\s*(plural|selectordinal|select)\s*,([\s\S]*)$/;

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

function parseCategories(body: string): { name: string; body: string }[] {
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

function normalizeArg(inner: string): string {
  return inner
    .split(',')
    .map((part) => part.trim())
    .join(',');
}

function scanFormatArgs(text: string, insideIcuCategory: boolean): string[] {
  const tokens: string[] = [];
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (insideIcuCategory && ch === '#') {
      tokens.push('#');
      i += 1;
      continue;
    }

    if (ch === '{' && text[i + 1] === '{') {
      const end = text.indexOf('}}', i + 2);
      if (end !== -1) {
        tokens.push(`{{${text.slice(i + 2, end).trim()}}}`);
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
          for (const category of parseCategories(icu[3])) {
            tokens.push(...scanFormatArgs(category.body, true));
          }
        } else if (!icu) {
          tokens.push(`{${normalizeArg(inner)}}`);
        }
        i = end + 1;
        continue;
      }
    }

    i += 1;
  }

  return tokens;
}

/** Format arguments for structural parity checks: printf tokens, simple `{name}` / `{{name}}`, and `#` in ICU bodies. */
export function extractFormatArgs(text: string): string[] {
  return [...extractPrintfArgs(text), ...scanFormatArgs(text, false)].sort();
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

function formatArgsForPluralPair(source: string, target: string): { want: string[]; got: string[] } {
  let want = extractFormatArgs(source);
  let got = extractFormatArgs(target);
  const srcIcu = findIcuMessage(source);
  const tgtIcu = findIcuMessage(target);
  if (
    srcIcu?.keyword === 'plural' &&
    tgtIcu?.keyword === 'plural' &&
    srcIcu.variable === tgtIcu.variable
  ) {
    want = want.filter((token) => token !== '#');
    got = got.filter((token) => token !== '#');
  }
  return { want, got };
}

export function validateFormatArgSet(source: string, target: string): string[] {
  const { want, got } = formatArgsForPluralPair(source, target);
  const { missing, extra } = multisetDiff(want, got);
  const issues: string[] = [];
  if (missing.length > 0) {
    issues.push(`missing format args: ${missing.join(', ')}`);
  }
  if (extra.length > 0) {
    issues.push(`extra format args: ${extra.join(', ')}`);
  }
  return issues;
}
