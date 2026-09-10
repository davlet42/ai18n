import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Leaf, LocaleTree } from '../locale-files.js';
import { escapeAndroidForResources } from '../android-markup.js';
import {
  androidPositionalToken,
  collectArgOrder,
  findIcuMessage,
  hasSecondIcuMessage,
  toPositional,
} from './transform.js';

// Android emitter: values-<lang>/strings.xml (source language → values/).
// Keys `ns:a.b` become resource names `ns_a_b` by default (or bare `a_b` when
// prefixNamespace is false); ICU plural → <plurals>; string arrays →
// <string-array>; named placeholders → positional %n$s with the argument
// order taken from the SOURCE language string.

const ANDROID_PLURAL_QUANTITIES = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);
const EXPLICIT_QUANTITY: Record<string, string> = { '=0': 'zero', '=1': 'one', '=2': 'two' };

export interface AndroidEmitOptions {
  /**
   * When true (default), resource names are `<namespace>_<key>`
   * (`android_nav_overview`). When false, only the key is used (`nav_overview`)
   * so names match `R.string.*` in an Android client that authored the source.
   */
  prefixNamespace?: boolean;
}

export function androidResourceName(
  namespace: string,
  key: string,
  options: AndroidEmitOptions = {},
): string {
  const prefix = options.prefixNamespace !== false;
  const raw = prefix && namespace ? `${namespace}_${key}` : key;
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'k$1');
}

export function escapeAndroid(text: string): string {
  return escapeAndroidForResources(text);
}

function positionalize(value: string, sourceValue: string, hash: boolean): string {
  const order = collectArgOrder(sourceValue, hash);
  return toPositional(value, order, (i, token) => androidPositionalToken(i, token));
}

export interface AndroidWarnings {
  warnings: string[];
}

interface Entry {
  kind: 'string' | 'plurals' | 'array';
  name: string;
  value?: string;
  items?: { quantity: string; value: string }[];
  arrayItems?: string[];
  fromNs: string;
  fromPath: string;
}

function walk(
  tree: LocaleTree,
  sourceTree: LocaleTree,
  namespace: string,
  prefix: string,
  out: Entry[],
  warn: AndroidWarnings,
  options: AndroidEmitOptions,
): void {
  if (Array.isArray(tree)) {
    return; // handled by parent as string-array
  }
  for (const [k, v] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${k}` : k;
    const sourceValue = Array.isArray(sourceTree) ? undefined : (sourceTree as Record<string, LocaleTree | Leaf>)[k];
    if (Array.isArray(v)) {
      const items = v.filter((x): x is string => typeof x === 'string');
      out.push({
        kind: 'array',
        name: androidResourceName(namespace, path, options),
        arrayItems: items,
        fromNs: namespace,
        fromPath: path,
      });
      continue;
    }
    if (v !== null && typeof v === 'object') {
      walk(v, (sourceValue ?? {}) as LocaleTree, namespace, path, out, warn, options);
      continue;
    }
    if (typeof v !== 'string' || v === '') {
      continue; // numbers/booleans/null/empty are not string resources
    }
    const src = typeof sourceValue === 'string' ? sourceValue : v;
    const name = androidResourceName(namespace, path, options);

    if (hasSecondIcuMessage(src)) {
      warn.warnings.push(`${namespace}:${path} — multiple ICU blocks; exported verbatim`);
      out.push({ kind: 'string', name, value: escapeAndroid(v), fromNs: namespace, fromPath: path });
      continue;
    }

    const icu = findIcuMessage(v);
    const srcIcu = findIcuMessage(src);
    if (icu && srcIcu && icu.keyword === 'plural') {
      const items: { quantity: string; value: string }[] = [];
      for (const category of icu.categories) {
        const quantity = ANDROID_PLURAL_QUANTITIES.has(category.name)
          ? category.name
          : EXPLICIT_QUANTITY[category.name];
        if (!quantity) {
          warn.warnings.push(`${namespace}:${path} — plural category "${category.name}" has no Android quantity; skipped`);
          continue;
        }
        const srcBody = srcIcu.categories.find((c) => c.name === category.name)?.body ?? category.body;
        const full = `${icu.before}${category.body}${icu.after}`;
        const srcFull = `${srcIcu.before}${srcBody}${srcIcu.after}`;
        items.push({ quantity, value: escapeAndroid(positionalize(full, srcFull, true)) });
      }
      out.push({ kind: 'plurals', name, items, fromNs: namespace, fromPath: path });
      continue;
    }
    if (icu && icu.keyword !== 'plural') {
      warn.warnings.push(`${namespace}:${path} — ICU ${icu.keyword} has no Android equivalent; exported verbatim`);
      out.push({ kind: 'string', name, value: escapeAndroid(v), fromNs: namespace, fromPath: path });
      continue;
    }

    out.push({
      kind: 'string',
      name,
      value: escapeAndroid(positionalize(v, src, false)),
      fromNs: namespace,
      fromPath: path,
    });
  }
}

function warnDuplicateNames(entries: Entry[], warn: AndroidWarnings): void {
  const first = new Map<string, Entry>();
  for (const e of entries) {
    const prev = first.get(e.name);
    if (prev) {
      warn.warnings.push(
        `duplicate Android resource name "${e.name}" from ${prev.fromNs}:${prev.fromPath} and ${e.fromNs}:${e.fromPath}`,
      );
    } else {
      first.set(e.name, e);
    }
  }
}

export function emitAndroidXml(
  namespaces: { namespace: string; tree: LocaleTree; sourceTree: LocaleTree }[],
  options: AndroidEmitOptions = {},
): { xml: string; warnings: string[] } {
  const warn: AndroidWarnings = { warnings: [] };
  const entries: Entry[] = [];
  for (const { namespace, tree, sourceTree } of namespaces) {
    walk(tree, sourceTree, namespace, '', entries, warn, options);
  }
  warnDuplicateNames(entries, warn);

  const lines: string[] = ['<?xml version="1.0" encoding="utf-8"?>', '<!-- generated by i18n-agent — do not edit -->', '<resources>'];
  for (const e of entries) {
    if (e.kind === 'string') {
      lines.push(`    <string name="${e.name}">${e.value}</string>`);
    } else if (e.kind === 'plurals') {
      lines.push(`    <plurals name="${e.name}">`);
      for (const item of e.items ?? []) {
        lines.push(`        <item quantity="${item.quantity}">${item.value}</item>`);
      }
      lines.push('    </plurals>');
    } else {
      lines.push(`    <string-array name="${e.name}">`);
      for (const item of e.arrayItems ?? []) {
        lines.push(`        <item>${escapeAndroid(item)}</item>`);
      }
      lines.push('    </string-array>');
    }
  }
  lines.push('</resources>', '');
  return { xml: lines.join('\n'), warnings: warn.warnings };
}

export function writeAndroidResources(
  outDir: string,
  lang: string,
  isSource: boolean,
  xml: string,
): string {
  const dir = join(outDir, isSource ? 'values' : `values-${lang}`);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'strings.xml');
  writeFileSync(path, xml, 'utf8');
  return path;
}
