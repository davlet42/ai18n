import { cldrPluralCategoriesForLocale } from '../android-plural-rules.js';
import { findIcuMessage } from '../exporters/transform.js';

const EXPLICIT_QUANTITY: Record<string, string> = { '=0': 'zero', '=1': 'one', '=2': 'two' };

function pluralCategoryName(name: string): string {
  return EXPLICIT_QUANTITY[name] ?? name;
}

export function validateAndroidPlural(text: string, lang: string): string[] {
  const icu = findIcuMessage(text);
  if (!icu || icu.keyword !== 'plural') {
    return [];
  }

  const required = cldrPluralCategoriesForLocale(lang);
  const have = new Set(icu.categories.map((category) => pluralCategoryName(category.name)));
  const missing = required.filter((quantity) => !have.has(quantity));
  if (missing.length === 0) {
    return [];
  }
  return [`missing plural categories for ${lang}: ${missing.join(', ')}`];
}

export function validateAndroidPluralPair(source: string, target: string, lang: string): string[] {
  const srcIcu = findIcuMessage(source);
  if (!srcIcu || srcIcu.keyword !== 'plural') {
    return [];
  }

  const tgtIcu = findIcuMessage(target);
  if (!tgtIcu || tgtIcu.keyword !== 'plural') {
    return ['target is missing ICU plural block'];
  }

  return validateAndroidPlural(target, lang);
}
