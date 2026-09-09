import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const {
  cldrPluralCategoriesForLocale,
  validateAndroidPlural,
  validateAndroidPluralPair,
  validateFormatArgSet,
  validateAndroidMarkup,
  extractFormatArgs,
  extractAnnotationTags,
} = await import('../dist/index.js');

describe('android plural rules', () => {
  it('maps locales to CLDR categories', () => {
    assert.deepEqual(cldrPluralCategoriesForLocale('de'), ['one', 'other']);
    assert.deepEqual(cldrPluralCategoriesForLocale('fr'), ['one', 'many', 'other']);
    assert.deepEqual(cldrPluralCategoriesForLocale('ru'), ['one', 'few', 'many', 'other']);
    assert.deepEqual(cldrPluralCategoriesForLocale('ar'), ['zero', 'one', 'two', 'few', 'many', 'other']);
    assert.deepEqual(cldrPluralCategoriesForLocale('ja'), ['one', 'other']);
  });

  it('flags missing categories on KinCassa-style plurals', () => {
    const en = '{count, plural, one {# document} other {# documents}}';
    const frBad = '{count, plural, one {# document} other {# documents}}';
    const frGood = '{count, plural, one {# document} many {# documents} other {# documents}}';
    const ruBad = '{count, plural, one {# документ} other {# документов}}';
    const ruGood =
      '{count, plural, one {# документ} few {# документа} many {# документов} other {# документа}}';

    assert.deepEqual(validateAndroidPluralPair(en, frBad, 'fr'), [
      'missing plural categories for fr: many',
    ]);
    assert.deepEqual(validateAndroidPluralPair(en, frGood, 'fr'), []);
    assert.deepEqual(validateAndroidPluralPair(en, ruBad, 'ru'), [
      'missing plural categories for ru: few, many',
    ]);
    assert.deepEqual(validateAndroidPluralPair(en, ruGood, 'ru'), []);
  });

  it('requires ICU plural block when source has plural', () => {
    const en = '{count, plural, one {# waiting} other {# waiting}}';
    assert.deepEqual(validateAndroidPluralPair(en, 'plain text', 'ru'), [
      'target is missing ICU plural block',
    ]);
  });
});

describe('format arg parity', () => {
  it('detects extra printf placeholders (auth_invited_subtitle)', () => {
    const source = '%1$s invited you to join their AI Family Treasury and Payment Hub on KinCassa.';
    const bad = '%1$s пригласил вас присоединиться к %2$s на KinCassa.';
    const good = '%1$s пригласил вас присоединиться к AI Family Treasury and Payment Hub на KinCassa.';

    assert.deepEqual(validateFormatArgSet(source, bad), ['extra format args: %2$s']);
    assert.deepEqual(validateFormatArgSet(source, good), []);
    assert.deepEqual(extractFormatArgs(source), ['%1$s']);
  });

  it('keeps # parity inside ICU plural bodies', () => {
    const source = '{count, plural, one {# file} other {# files}}';
    const target = '{count, plural, one {# fichier} other {# fichiers}}';
    assert.deepEqual(validateFormatArgSet(source, target), []);
  });
});

describe('android annotation markup', () => {
  const source =
    'By continuing, you agree to our <annotation type="terms">Terms</annotation> and <annotation type="privacy">Privacy Policy</annotation>';

  it('extracts annotation tags verbatim', () => {
    assert.deepEqual(extractAnnotationTags(source), [
      '</annotation>',
      '</annotation>',
      '<annotation type="privacy">',
      '<annotation type="terms">',
    ]);
  });

  it('flags stripped markup in translations', () => {
    const bad = 'Продолжая, вы соглашаетесь с Условиями и Политикой конфиденциальности';
    const issues = validateAndroidMarkup(source, bad);
    assert.ok(issues.some((line) => line.startsWith('missing annotation tags:')));
  });

  it('accepts preserved tags', () => {
    const good =
      'Продолжая, вы соглашаетесь с <annotation type="terms">Условиями</annotation> и <annotation type="privacy">Политикой конфиденциальности</annotation>';
    assert.deepEqual(validateAndroidMarkup(source, good), []);
  });
});
