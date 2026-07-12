// Shared string transforms for platform emitters.
//
// Mobile platforms use POSITIONAL format arguments; our canonical strings use
// named ICU-style placeholders. The argument ORDER is derived from the SOURCE
// language string (first occurrence), so every language agrees on the same
// numbering even when a translation reorders the words — the placeholder
// guard already guarantees the token multisets match.

const CURLY_RE = /\{\{[^{}]+\}\}|\{[^{},]+\}/; // {{name}} or simple {name} (no ICU commas)
const ICU_HEAD_RE = /^([\w.]+)\s*,\s*(plural|selectordinal|select)\s*,([\s\S]*)$/;

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
    if (text[i] === open) depth += 1;
    else if (text[i] === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function parseCategories(body: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  let i = 0;
  while (i < body.length) {
    while (i < body.length && /\s/.test(body[i])) i += 1;
    let name = '';
    while (i < body.length && body[i] !== '{' && !/\s/.test(body[i])) {
      name += body[i];
      i += 1;
    }
    while (i < body.length && /\s/.test(body[i])) i += 1;
    if (i >= body.length || body[i] !== '{' || name === '') break;
    const end = findBalanced(body, i, '{', '}');
    if (end === -1) break;
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
    if (text[i] !== '{') continue;
    const end = findBalanced(text, i, '{', '}');
    if (end === -1) return null;
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
    i = end; // skip non-ICU braces ({name})
  }
  return null;
}

export function hasSecondIcuMessage(text: string): boolean {
  const first = findIcuMessage(text);
  if (!first) return false;
  return findIcuMessage(first.after) !== null || findIcuMessage(first.before) !== null;
}

// Distinct placeholder tokens of a plain (non-ICU) string, in first-occurrence
// order. `#` participates when scanning ICU category bodies.
export function collectArgOrder(sourceText: string, includeHash = false): string[] {
  const order: string[] = [];
  let rest = sourceText;
  let offset = 0;
  void offset;
  for (;;) {
    const m = rest.match(CURLY_RE);
    const hashIdx = includeHash ? rest.indexOf('#') : -1;
    if (!m && hashIdx === -1) break;
    const curlyIdx = m ? rest.indexOf(m[0]) : Infinity;
    if (hashIdx !== -1 && hashIdx < curlyIdx) {
      if (!order.includes('#')) order.push('#');
      rest = rest.slice(hashIdx + 1);
      continue;
    }
    if (!m) break;
    if (!order.includes(m[0])) order.push(m[0]);
    rest = rest.slice(curlyIdx + m[0].length);
  }
  return order;
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
