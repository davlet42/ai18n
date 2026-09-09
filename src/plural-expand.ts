import { cldrPluralCategoriesForLocale, normalizePluralCategoryName } from './cldr-plural-rules.js';
import { findIcuMessage } from './exporters/transform.js';

function categoryMap(icu: NonNullable<ReturnType<typeof findIcuMessage>>): Map<string, string> {
  const out = new Map<string, string>();
  for (const category of icu.categories) {
    out.set(normalizePluralCategoryName(category.name), category.body);
  }
  return out;
}

function pickDonorBody(categories: Map<string, string>, fallback: string): string {
  return categories.get('other') ?? categories.get('one') ?? fallback;
}

function serializePluralIcu(icu: NonNullable<ReturnType<typeof findIcuMessage>>, lang: string): string {
  const categories = categoryMap(icu);
  const donor = pickDonorBody(categories, icu.categories.at(-1)?.body ?? '');
  const required = cldrPluralCategoriesForLocale(lang);

  for (const quantity of required) {
    if (!categories.has(quantity)) {
      categories.set(quantity, donor);
    }
  }

  const parts = required.map((quantity) => `${quantity} {${categories.get(quantity)!}}`);
  return `${icu.before}{${icu.variable}, plural, ${parts.join(' ')}}${icu.after}`;
}

/** Add missing CLDR plural categories by copying the `other` form (or `one`). */
export function expandPluralCategories(text: string, lang: string): string {
  const icu = findIcuMessage(text);
  if (!icu || icu.keyword !== 'plural') {
    return text;
  }

  const required = cldrPluralCategoriesForLocale(lang);
  const have = new Set(icu.categories.map((category) => normalizePluralCategoryName(category.name)));
  const missing = required.some((quantity) => !have.has(quantity));
  if (!missing) {
    return text;
  }

  return serializePluralIcu(icu, lang);
}

/** Expand target plurals when the source string is an ICU plural message. */
export function expandPluralCategoriesIfNeeded(sourceText: string, targetText: string, lang: string): string {
  const srcIcu = findIcuMessage(sourceText);
  if (!srcIcu || srcIcu.keyword !== 'plural') {
    return targetText;
  }
  const tgtIcu = findIcuMessage(targetText);
  if (!tgtIcu || tgtIcu.keyword !== 'plural') {
    return targetText;
  }
  return expandPluralCategories(targetText, lang);
}
