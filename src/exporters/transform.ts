// Shared string transforms for platform emitters.
//
// Mobile platforms use POSITIONAL format arguments; our canonical strings use
// named ICU-style placeholders. The argument ORDER is derived from the SOURCE
// language string (first occurrence), so every language agrees on the same
// numbering even when a translation reorders the words — the placeholder
// guard already guarantees the token multisets match.

const CURLY_SIMPLE_RE = /\{\{[^{}]+\}\}|\{[^{},]+\}/;
const ICU_HEAD_RE = /^([\w.]+)\s*,\s*(plural|selectordinal|select)\s*,([\s\S]*)$/;
const PRINTF_RE = /^%(\d+\$)?(?:ll)?[sdif@]/;
const NAMED_PRINTF_RE = /^%\(([^)]+)\)[sdif]/;

export interface IcuMessage {
  variable: string;
  keyword: 'plural' | 'select' | 'selectordinal';
  categories: { name: string; body: string }[];
  before: string;
  after: string;
}

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

// Find the single top-level ICU plural/select block in a string. Returns null
// for plain strings. Strings with more than one ICU block are not supported by
// the mobile emitters (v1 limitation — exported verbatim with a warning).
export function findIcuMessage(text: string): IcuMessage | null {
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') {
      continue;
    }
    const end = findBalanced(text, i, '{', '}');
    if (end === -1) {
      return null;
    }
    const inner = text.slice(i + 1, end);
    const head = inner.match(ICU_HEAD_RE);
    if (head) {
      return {
        variable: head[1],
        keyword: head[2] as IcuMessage['keyword'],
        categories: parseCategories(head[3]),
        before: text.slice(0, i),
        after: text.slice(end + 1),
      };
    }
    i = end;
  }
  return null;
}

export function hasSecondIcuMessage(text: string): boolean {
  const first = findIcuMessage(text);
  if (!first) {
    return false;
  }
  return findIcuMessage(first.after) !== null || findIcuMessage(first.before) !== null;
}

function pushToken(order: string[], token: string): void {
  if (!order.includes(token)) {
    order.push(token);
  }
}

function normalizeCurly(inner: string): string {
  return `{${inner
    .split(',')
    .map((part) => part.trim())
    .join(',')}}`;
}

function scanPlainTokens(text: string, order: string[], includeHash: boolean): void {
  let i = 0;
  while (i < text.length) {
    if (includeHash && text[i] === '#') {
      pushToken(order, '#');
      i += 1;
      continue;
    }

    if (text[i] === '{' && text[i + 1] === '{') {
      const end = text.indexOf('}}', i + 2);
      if (end !== -1) {
        pushToken(order, `{{${text.slice(i + 2, end).trim()}}}`);
        i = end + 2;
        continue;
      }
    }

    if (text[i] === '{') {
      const end = findBalanced(text, i, '{', '}');
      if (end !== -1) {
        const inner = text.slice(i + 1, end);
        if (!ICU_HEAD_RE.test(inner)) {
          pushToken(order, normalizeCurly(inner));
        }
        i = end + 1;
        continue;
      }
    }

    if (text[i] === '%') {
      if (text[i + 1] === '%') {
        i += 2;
        continue;
      }
      const named = text.slice(i).match(NAMED_PRINTF_RE);
      if (named) {
        pushToken(order, named[0]);
        i += named[0].length;
        continue;
      }
      const positional = text.slice(i).match(PRINTF_RE);
      if (positional) {
        pushToken(order, positional[0]);
        i += positional[0].length;
        continue;
      }
    }

    i += 1;
  }
}

// Distinct placeholder tokens in first-occurrence order. For ICU plurals with
// includeHash, scans before/after text and every category body (# only inside bodies).
export function collectArgOrder(sourceText: string, includeHash = false): string[] {
  const order: string[] = [];
  const icu = findIcuMessage(sourceText);
  if (icu?.keyword === 'plural' && includeHash) {
    scanPlainTokens(icu.before, order, false);
    for (const category of icu.categories) {
      scanPlainTokens(category.body, order, true);
    }
    scanPlainTokens(icu.after, order, false);
    return order;
  }
  scanPlainTokens(sourceText, order, includeHash);
  return order;
}

const PRINTF_TYPE_RE = /^%(\d+\$)?(?:ll)?([sdif@])/;

export function androidPositionalToken(index: number, token: string): string {
  if (token === '#') {
    return `%${index}$d`;
  }
  const printf = token.match(PRINTF_TYPE_RE);
  if (printf) {
    return `%${index}$${printf[2]}`;
  }
  return `%${index}$s`;
}

// Replace every named token with a positional form. `format` receives the
// 1-based argument index and the token ('#' or '{name}'/'{{name}}').
export function toPositional(
  text: string,
  order: string[],
  format: (index: number, token: string) => string,
): string {
  let out = text;
  for (const [i, token] of order.entries()) {
    out = out.split(token).join(format(i + 1, token));
  }
  return out;
}
