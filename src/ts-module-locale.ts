import { runInNewContext } from 'node:vm';
import type { Leaf, LocaleTree } from './locale-files.js';

// TS-module locale format: `export default { ... } as const;` — the layout
// typed web codebases use so t() keys stay compile-checked. Reading: the
// default-export object literal is captured with a string/comment-aware
// balanced scan (the words `as const` / `satisfies` inside translated text
// cannot confuse it), inner `as const` assertions are stripped, and the
// literal is evaluated in an empty vm sandbox — so the module must be
// self-contained: no imported values, no template interpolation.
// Writing: a deterministic serializer — bare identifier keys, single-quoted
// strings, 2-space indent — wrapped in `export default … as const;`.

const CODE = 1;
const NON_CODE = 0;

// Marks every index as code (1) or string/comment interior incl. delimiters (0).
// Template interpolation is rejected outright: evaluating it would need scope.
function maskRegions(src: string, path: string): Uint8Array {
  const mask = new Uint8Array(src.length).fill(CODE);
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') {
        mask[i] = NON_CODE;
        i += 1;
      }
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      mask[i] = NON_CODE;
      mask[i + 1] = NON_CODE;
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        mask[i] = NON_CODE;
        i += 1;
      }
      if (i < src.length) {
        mask[i] = NON_CODE;
        mask[i + 1] = NON_CODE;
        i += 2;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      mask[i] = NON_CODE;
      i += 1;
      while (i < src.length && src[i] !== ch) {
        if (src[i] === '\\') {
          mask[i] = NON_CODE;
          i += 1;
        }
        if (ch === '`' && src[i] === '$' && src[i + 1] === '{') {
          throw new Error(`Template interpolation is not supported in TS locale modules: ${path}`);
        }
        if (i < src.length) {
          mask[i] = NON_CODE;
          i += 1;
        }
      }
      if (i < src.length) {
        mask[i] = NON_CODE;
        i += 1;
      }
      continue;
    }
    i += 1;
  }
  return mask;
}

function findExportDefault(src: string, mask: Uint8Array, path: string): number {
  const pattern = /export\s+default/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(src)) !== null) {
    if (mask[match.index] === CODE) {
      return match.index + match[0].length;
    }
  }
  throw new Error(`No \`export default\` found in TS locale module: ${path}`);
}

function extractDefaultObjectLiteral(src: string, mask: Uint8Array, path: string): string {
  let i = findExportDefault(src, mask, path);
  while (i < src.length && (mask[i] === NON_CODE || /\s/.test(src[i]))) {
    i += 1;
  }
  if (src[i] !== '{') {
    throw new Error(`\`export default\` must be followed by an object literal in ${path}`);
  }
  let depth = 0;
  for (let j = i; j < src.length; j += 1) {
    if (mask[j] === NON_CODE) {
      continue;
    }
    if (src[j] === '{') {
      depth += 1;
    } else if (src[j] === '}') {
      depth -= 1;
      if (depth === 0) {
        return src.slice(i, j + 1);
      }
    }
  }
  throw new Error(`Unbalanced object literal in TS locale module: ${path}`);
}

// Removes `as const` assertions that sit in code (a nested `['a'] as const`
// would otherwise break plain-JS evaluation); occurrences inside translated
// strings are untouched.
function stripAsConstInCode(literal: string, path: string): string {
  const mask = maskRegions(literal, path);
  const ranges: [number, number][] = [];
  const pattern = /\bas\s+const\b/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(literal)) !== null) {
    if (mask[match.index] === CODE) {
      ranges.push([match.index, match.index + match[0].length]);
    }
  }
  let out = literal;
  for (const [start, end] of ranges.reverse()) {
    out = out.slice(0, start) + out.slice(end);
  }
  return out;
}

export function parseTsLocaleModule(raw: string, path: string): LocaleTree {
  const mask = maskRegions(raw, path);
  const literal = extractDefaultObjectLiteral(raw, mask, path);
  const cleaned = stripAsConstInCode(literal, path);
  let value: unknown;
  try {
    value = runInNewContext(`(${cleaned})`, {}, { timeout: 1000, filename: path });
  } catch (error) {
    throw new Error(
      `Failed to evaluate the default export of ${path} — a TS locale module must be a self-contained object literal (no imported values): ${(error as Error).message}`,
    );
  }
  if (value === null || typeof value !== 'object') {
    throw new Error(`Locale module default export is not an object: ${path}`);
  }
  // The sandbox lives in another realm — its Object/Array prototypes differ
  // from ours. A JSON round-trip normalizes the tree into this realm and
  // drops anything non-JSON (functions, undefined) that has no business in a
  // locale file; key order is preserved.
  return JSON.parse(JSON.stringify(value)) as LocaleTree;
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export function serializeTsLocaleModule(tree: LocaleTree): string {
  return `export default ${serializeNode(tree, 0)} as const;\n`;
}

function serializeNode(node: LocaleTree | Leaf, depth: number): string {
  if (node === null) {
    return 'null';
  }
  if (typeof node === 'string') {
    return quote(node);
  }
  if (typeof node !== 'object') {
    return String(node);
  }
  const pad = '  '.repeat(depth + 1);
  const close = '  '.repeat(depth);
  if (Array.isArray(node)) {
    if (node.length === 0) {
      return '[]';
    }
    const items = node.map((v) => `${pad}${serializeNode(v as LocaleTree | Leaf, depth + 1)}`);
    return `[\n${items.join(',\n')}\n${close}]`;
  }
  const entries = Object.entries(node);
  if (entries.length === 0) {
    return '{}';
  }
  const items = entries.map(
    ([k, v]) =>
      `${pad}${IDENTIFIER.test(k) ? k : quote(k)}: ${serializeNode(v as LocaleTree | Leaf, depth + 1)}`,
  );
  return `{\n${items.join(',\n')}\n${close}}`;
}

function quote(s: string): string {
  return `'${s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')}'`;
}
