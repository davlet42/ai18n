// CLDR plural categories required by Android <plurals> for a target locale.
// English source strings often use only {one, other}; targets must still carry
// every quantity Android Lint expects for that language.

export const ANDROID_CLDR_PLURAL_CATEGORIES: Record<string, readonly string[]> = {
  de: ['one', 'other'],
  fr: ['one', 'many', 'other'],
  es: ['one', 'many', 'other'],
  it: ['one', 'many', 'other'],
  ru: ['one', 'few', 'many', 'other'],
  ar: ['zero', 'one', 'two', 'few', 'many', 'other'],
};

const DEFAULT_CATEGORIES: readonly string[] = ['one', 'other'];

export function cldrPluralCategoriesForLocale(lang: string): readonly string[] {
  const base = lang.split('-')[0].toLowerCase();
  return ANDROID_CLDR_PLURAL_CATEGORIES[base] ?? DEFAULT_CATEGORIES;
}
