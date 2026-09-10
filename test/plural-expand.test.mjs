import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const {
  expandPluralCategories,
  expandPluralCategoriesIfNeeded,
  validateCldrPlural,
  buildSystemPrompt,
} = await import('../dist/index.js');

describe('expandPluralCategories', () => {
  const en = '{count, plural, one {# document} other {# documents}}';

  it('adds many for fr/es/it from other', () => {
    const frIn = '{count, plural, one {# document} other {# documents}}';
    const frOut = expandPluralCategories(frIn, 'fr');
    assert.ok(frOut.includes('many {# documents}'));
    assert.deepEqual(validateCldrPlural(frOut, 'fr'), []);
  });

  it('adds few and many for ru from other', () => {
    const ruIn = '{count, plural, one {# документ} other {# документов}}';
    const ruOut = expandPluralCategories(ruIn, 'ru');
    assert.ok(ruOut.includes('few {# документов}'));
    assert.ok(ruOut.includes('many {# документов}'));
    assert.deepEqual(validateCldrPlural(ruOut, 'ru'), []);
  });

  it('adds all six categories for ar', () => {
    const arIn = '{count, plural, one {# وثيقة} other {# وثائق}}';
    const arOut = expandPluralCategories(arIn, 'ar');
    for (const qty of ['zero', 'one', 'two', 'few', 'many', 'other']) {
      assert.ok(arOut.includes(`${qty} {`), `missing ${qty}`);
    }
    assert.deepEqual(validateCldrPlural(arOut, 'ar'), []);
  });

  it('is a no-op when categories are already complete', () => {
    const ruFull =
      '{count, plural, one {# документ} few {# документа} many {# документов} other {# документа}}';
    assert.equal(expandPluralCategories(ruFull, 'ru'), ruFull);
  });

  it('expandPluralCategoriesIfNeeded only runs when source is plural', () => {
    const plain = 'Hello';
    const frPartial = '{count, plural, one {# doc} other {# docs}}';
    assert.equal(expandPluralCategoriesIfNeeded(plain, frPartial, 'fr'), frPartial);
    const expanded = expandPluralCategoriesIfNeeded(en, frPartial, 'fr');
    assert.ok(expanded.includes('many'));
  });
});

describe('translate system prompt', () => {
  it('lists required plural categories for the target language', () => {
    const prompt = buildSystemPrompt({ sourceLang: 'en', targetLang: 'ru' });
    assert.match(prompt, /one, few, many, other/);
  });
});
