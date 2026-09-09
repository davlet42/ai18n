import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const { extractPlaceholderSignature, validatePlaceholders, validateFormatArgSet } = await import(
  '../dist/index.js'
);

describe('extractPlaceholderSignature', () => {
  it('extracts curly, double-curly, printf, $t and tags', () => {
    const sig = extractPlaceholderSignature(
      'Hi {name}, {{count}} msgs, %s and %1$s and %(user)s, see $t(common.faq) <b>now</b><br/>',
    );
    assert.deepEqual(
      sig,
      [
        '$t(common.faq)',
        '%(user)s',
        '%1$s',
        '%s',
        '<b>',
        '</b>',
        '<br/>',
        '{name}',
        '{{count}}',
      ].sort(),
    );
  });

  it('normalizes spaces in arguments and ignores %% and tag attributes', () => {
    assert.deepEqual(extractPlaceholderSignature('{ name } and { count , number }'), [
      '{count,number}',
      '{name}',
    ]);
    assert.deepEqual(extractPlaceholderSignature('100%% done'), []);
    assert.deepEqual(extractPlaceholderSignature('<a href="/x" class="y">link</a>'), ['</a>', '<a>']);
  });

  it('builds an ICU signature: variable + keyword + inner tokens (# and categories checked elsewhere)', () => {
    const sig = extractPlaceholderSignature(
      'You have {count, plural, one {# file from {user}} other {# files from {user}}}.',
    );
    assert.deepEqual(sig, ['{count,plural}', '{user}', '{user}'].sort());
  });
});

describe('validatePlaceholders', () => {
  it('accepts a translation with identical tokens in any order', () => {
    const check = validatePlaceholders('Hello {name}, <b>{count}</b>!', '<b>{count}</b> — привет, {name}!');
    assert.equal(check.ok, true);
  });

  it('reports missing and invented tokens', () => {
    const check = validatePlaceholders('Hello {name}!', 'Привет, {имя}! {{oops}}');
    assert.equal(check.ok, false);
    assert.deepEqual(check.missing, ['{name}']);
    assert.deepEqual(check.extra.sort(), ['{имя}', '{{oops}}'].sort());
  });

  it('accepts CLDR-expanded plural categories when inner placeholders match', () => {
    const source = '{count, plural, one {# document} other {# documents}}';
    const expanded = '{count, plural, one {# document} many {# documents} other {# documents}}';
    assert.equal(validatePlaceholders(source, expanded).ok, true);
    assert.deepEqual(validateFormatArgSet(source, expanded), []);
  });

  it('accepts a correct ICU translation with translated bodies', () => {
    const source = '{count, plural, one {# file} other {# files}}';
    const good = '{count, plural, one {# файл} other {# файлов}}';
    assert.equal(validatePlaceholders(source, good).ok, true);
  });

  it('accepts printf repeated per CLDR category in matching ICU plural pairs', () => {
    const source = '{count, plural, one {# payment from %2$s} other {# payments from %2$s}}';
    const expanded =
      '{count, plural, zero {# دفعات من %2$s} one {# دفعة من %2$s} two {# دفعات من %2$s} few {# دفعات من %2$s} many {# دفعات من %2$s} other {# دفعات من %2$s}}';
    assert.equal(validatePlaceholders(source, expanded).ok, true);
  });
});
