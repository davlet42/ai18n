// CLDR plural categories per target locale (BCP-47 base language).
// Shared by translate expansion, structural checks, and native exporters
// that map ICU plurals to platform quantity buckets (Android <plurals>, …).

export const CLDR_PLURAL_CATEGORIES_BY_LOCALE: Record<string, readonly string[]> = {
  de: ['one', 'other'],
  fr: ['one', 'many', 'other'],
  es: ['one', 'many', 'other'],
  it: ['one', 'many', 'other'],
  ru: ['one', 'few', 'many', 'other'],
  ar: ['zero', 'one', 'two', 'few', 'many', 'other'],
};

/** @deprecated Use {@link CLDR_PLURAL_CATEGORIES_BY_LOCALE}. */
export const ANDROID_CLDR_PLURAL_CATEGORIES = CLDR_PLURAL_CATEGORIES_BY_LOCALE;

const DEFAULT_CATEGORIES: readonly string[] = ['one', 'other'];

const EXPLICIT_QUANTITY: Record<string, string> = { '=0': 'zero', '=1': 'one', '=2': 'two' };

export function normalizePluralCategoryName(name: string): string {
  return EXPLICIT_QUANTITY[name] ?? name;
}

export function cldrPluralCategoriesForLocale(lang: string): readonly string[] {
  const base = lang.split('-')[0].toLowerCase();
  return CLDR_PLURAL_CATEGORIES_BY_LOCALE[base] ?? DEFAULT_CATEGORIES;
}
