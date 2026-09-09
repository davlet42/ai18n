import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const {
  extractPrintfArgs,
  validatePrintfArgs,
  formatPrintfRetryHint,
  validateFormatArgSet,
} = await import('../dist/index.js');

describe('extractPrintfArgs', () => {
  it('collects Android, Apple, and named printf tokens', () => {
    assert.deepEqual(extractPrintfArgs('Hi %s and %1$s and %(user)s and %@ and %lld'), [
      '%(user)s',
      '%1$s',
      '%@',
      '%lld',
      '%s',
    ]);
  });

  it('ignores escaped percent and finds tokens inside ICU bodies', () => {
    assert.deepEqual(extractPrintfArgs('100%% done'), []);
    const icu = '{count, plural, one {%1$s file} other {%1$s files}}';
    assert.deepEqual(extractPrintfArgs(icu), ['%1$s', '%1$s']);
  });
});

describe('validatePrintfArgs', () => {
  it('detects extra positional indices', () => {
    const source = '%1$s invited you to join their team on ExampleApp.';
    const bad = '%1$s пригласил вас присоединиться к %2$s в ExampleApp.';
    const good = '%1$s пригласил вас присоединиться к команде в ExampleApp.';

    const badCheck = validatePrintfArgs(source, bad);
    assert.equal(badCheck.ok, false);
    assert.deepEqual(badCheck.extra, ['%2$s']);
    assert.deepEqual(validatePrintfArgs(source, good).ok, true);
    assert.deepEqual(validateFormatArgSet(source, bad), ['extra format args: %2$s']);
  });

  it('compares unique printf tokens for matching ICU plural pairs', () => {
    const source = '{count, plural, one {# payment from %2$s} other {# payments from %2$s}}';
    const target =
      '{count, plural, one {# paiement de %2$s} many {# paiements de %2$s} other {# paiements de %2$s}}';
    assert.deepEqual(validatePrintfArgs(source, target).ok, true);
  });

  it('builds an explicit retry hint', () => {
    const source = '%1$s invited you.';
    const hint = formatPrintfRetryHint(source);
    assert.ok(hint?.includes('%1$s'));
    assert.ok(hint?.includes('do not add %2$s'));
    assert.equal(formatPrintfRetryHint('plain text'), undefined);
  });
});
