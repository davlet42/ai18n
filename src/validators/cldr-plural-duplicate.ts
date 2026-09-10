import { findIcuMessage } from '../exporters/transform.js';
import { normalizePluralCategoryName } from '../cldr-plural-rules.js';

const DUPLICATE_PLURAL_PAIRS_BY_LOCALE: Record<string, readonly (readonly [string, string])[]> = {
  ru: [['few', 'many']],
  ar: [['two', 'few'], ['few', 'many']],
};

function categoryBodies(icu: NonNullable<ReturnType<typeof findIcuMessage>>): Map<string, string> {
  const out = new Map<string, string>();
  for (const category of icu.categories) {
    out.set(normalizePluralCategoryName(category.name), category.body);
  }
  return out;
}

function bodyHasCountPlaceholder(body: string): boolean {
  return body.includes('#') || /%\d+\$?[ds]/i.test(body);
}

export function validateDuplicatePluralCategories(text: string, lang: string): string[] {
  const icu = findIcuMessage(text);
  if (!icu || icu.keyword !== 'plural') {
    return [];
  }

  const base = lang.split('-')[0].toLowerCase();
  const pairs = DUPLICATE_PLURAL_PAIRS_BY_LOCALE[base];
  if (!pairs) {
    return [];
  }

  const bodies = categoryBodies(icu);
  const issues: string[] = [];
  for (const [left, right] of pairs) {
    const leftBody = bodies.get(left);
    const rightBody = bodies.get(right);
    if (!leftBody || !rightBody || leftBody !== rightBody) {
      continue;
    }
    if (bodyHasCountPlaceholder(leftBody)) {
      issues.push(`duplicate plural categories ${left} and ${right} (identical bodies with count)`);
    }
  }
  return issues;
}
