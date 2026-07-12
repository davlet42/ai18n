import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const { extractPlaceholderSignature, validatePlaceholders } = await import('../dist/index.js');

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

  it('builds an ICU signature: variable + keyword + sorted categories + inner tokens + #', () => {
    const sig = extractPlaceholderSignature(
      'You have {count, plural, one {# file from {user}} other {# files from {user}}}.',
    );
    assert.deepEqual(
      sig,
      ['#', '#', '{count,plural,categories:one|other}', '{user}', '{user}'].sort(),
    );
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

  it('catches a dropped ICU category', () => {
    const source = '{count, plural, one {# item} few {# items} other {# items}}';
    const bad = '{count, plural, one {# элемент} other {# элементов}}';
    const check = validatePlaceholders(source, bad);
    assert.equal(check.ok, false, 'few category dropped must fail');
  });

  it('accepts a correct ICU translation with translated bodies', () => {
    const source = '{count, plural, one {# file} other {# files}}';
    const good = '{count, plural, one {# файл} other {# файлов}}';
    assert.equal(validatePlaceholders(source, good).ok, true);
  });
});
