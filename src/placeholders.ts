// Placeholder guard. We do NOT mask placeholders before translation — masking
// breaks ICU messages whose inner text must be translated. Instead we extract
// a comparable SIGNATURE (a sorted multiset of canonical tokens) from the
// source and the translation, and reject translations whose signatures differ.
//
// Covered: {var} and {{var}} interpolation, ICU plural/select/selectordinal
// (variable + keyword + category names + inner placeholders + `#`), printf
// (%s, %1$s, %(name)s), i18next $t(...) nesting, HTML-ish tags (<b>, </b>,
// <br/>, react-i18next numeric <0>). Tag attributes are ignored on purpose —
// translators may reorder them; the tag structure is what must survive.

// `@` and the `ll` length modifier cover Apple-style specifiers (%@, %1$@, %lld)
// that arrive via the ios-xcstrings importer.
const PRINTF_RE = /^%(\d+\$)?(?:ll)?[sdif@]/;
const NAMED_PRINTF_RE = /^%\(([^)]+)\)[sdif]/;
const TAG_RE = /^<(\/?)([a-zA-Z0-9]+)([^<>]*?)(\/?)>/;
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

function normalizeArg(inner: string): string {
  return inner
    .split(',')
    .map((part) => part.trim())
    .join(',');
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

export function extractPlaceholderSignature(text: string): string[] {
  const tokens: string[] = [];
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

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
        if (icu) {
          const [, variable, keyword, rest] = icu;
          const categories = parseIcuCategories(rest);
          const names = categories.map((c) => c.name).sort();
          tokens.push(`{${variable},${keyword},categories:${names.join('|')}}`);
          for (const category of categories) {
            for (const hash of category.body.match(/#/g) ?? []) {
              tokens.push(hash);
            }
            tokens.push(...extractPlaceholderSignature(category.body.replace(/#/g, '')));
          }
        } else {
          tokens.push(`{${normalizeArg(inner)}}`);
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

    if (ch === '$' && text.startsWith('$t(', i)) {
      const end = findBalanced(text, i + 2, '(', ')');
      if (end !== -1) {
        tokens.push(`$t(${text.slice(i + 3, end).trim()})`);
        i = end + 1;
        continue;
      }
    }

    if (ch === '<') {
      const tag = text.slice(i).match(TAG_RE);
      if (tag) {
        const [full, closing, name, , selfClosing] = tag;
        tokens.push(closing ? `</${name}>` : selfClosing ? `<${name}/>` : `<${name}>`);
        i += full.length;
        continue;
      }
    }

    i += 1;
  }

  return tokens.sort();
}

export interface PlaceholderValidation {
  ok: boolean;
  missing: string[]; // present in source, absent in translation
  extra: string[]; // invented by the translation
}

export function validatePlaceholders(source: string, translated: string): PlaceholderValidation {
  const want = extractPlaceholderSignature(source);
  const got = extractPlaceholderSignature(translated);

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

  return { ok: missing.length === 0 && pool.length === 0, missing, extra: pool };
}
