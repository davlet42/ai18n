import { cldrPluralCategoriesForLocale, normalizePluralCategoryName } from '../cldr-plural-rules.js';
import { findIcuMessage } from '../exporters/transform.js';

export function validateCldrPlural(text: string, lang: string): string[] {
  const icu = findIcuMessage(text);
  if (!icu || icu.keyword !== 'plural') {
    return [];
  }

  const required = cldrPluralCategoriesForLocale(lang);
  const have = new Set(icu.categories.map((category) => normalizePluralCategoryName(category.name)));
  const missing = required.filter((quantity) => !have.has(quantity));
  if (missing.length === 0) {
    return [];
  }
  return [`missing plural categories for ${lang}: ${missing.join(', ')}`];
}

export function validateCldrPluralPair(source: string, target: string, lang: string): string[] {
  const srcIcu = findIcuMessage(source);
  if (!srcIcu || srcIcu.keyword !== 'plural') {
    return [];
  }

  const tgtIcu = findIcuMessage(target);
  if (!tgtIcu || tgtIcu.keyword !== 'plural') {
    return ['target is missing ICU plural block'];
  }

  return validateCldrPlural(target, lang);
}
