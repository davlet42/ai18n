import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const {
  maskAndroidMarkup,
  escapeAndroidForResources,
  escapeAndroid,
  emitAndroidXml,
  validateAndroidMarkup,
  translateBatch,
} = await import('../dist/index.js');

const AUTH_SIGNIN_TERMS =
  'By continuing, you agree to our <annotation type="terms">Terms</annotation> and <annotation type="privacy">Privacy Policy</annotation>';

describe('maskAndroidMarkup', () => {
  it('replaces inner annotation text with markers', () => {
    const { masked } = maskAndroidMarkup(AUTH_SIGNIN_TERMS);
    assert.ok(masked.includes('<annotation type="terms">⟦0⟧</annotation>'));
    assert.ok(masked.includes('<annotation type="privacy">⟦1⟧</annotation>'));
    assert.ok(!masked.includes('>Terms</annotation>'));
  });
});

describe('escapeAndroidForResources', () => {
  it('preserves annotation tags but escapes other angle brackets', () => {
    const text =
      'Read <annotation type="terms">Terms</annotation> and <b>not this</b>';
    const escaped = escapeAndroidForResources(text);
    assert.ok(escaped.includes('<annotation type="terms">Terms</annotation>'));
    assert.ok(escaped.includes('&lt;b&gt;'));
    assert.ok(!escaped.includes('&lt;annotation'));
  });

  it('matches escapeAndroid for plain strings', () => {
    const plain = "Don't \"quote\" me & <tag>";
    assert.equal(escapeAndroid(plain), escapeAndroidForResources(plain));
  });
});

describe('android export with annotation markup', () => {
  it('does not entity-escape inline annotation tags', () => {
    const sourceTree = { auth_signin_terms: AUTH_SIGNIN_TERMS };
    const ruTree = {
      auth_signin_terms:
        'Продолжая, вы соглашаетесь с <annotation type="terms">Условиями</annotation> и <annotation type="privacy">Политикой</annotation>',
    };
    const { xml } = emitAndroidXml([{ namespace: 'android', tree: ruTree, sourceTree }], {
      prefixNamespace: false,
    });
    assert.ok(xml.includes('<annotation type="terms">Условиями</annotation>'));
    assert.ok(!xml.includes('&lt;annotation'));
  });
});

describe('translateBatch annotation markup', () => {
  it('validates preserved annotation tags on translation', async () => {
    const transport = async () =>
      JSON.stringify({
        'android:auth_signin_terms':
          'Продолжая, вы соглашаетесь с <annotation type="terms">Условиями</annotation> и <annotation type="privacy">Политикой</annotation>',
      });
    const result = await translateBatch(
      [{ id: 'android:auth_signin_terms', text: AUTH_SIGNIN_TERMS }],
      { sourceLang: 'en', targetLang: 'ru', transport },
    );
    assert.equal(result.failed.length, 0);
    assert.ok(result.translations.get('android:auth_signin_terms')?.includes('<annotation type="terms">'));
  });

  it('fails when annotation tags are stripped', async () => {
    const transport = async () =>
      JSON.stringify({
        'android:auth_signin_terms': 'Продолжая, вы соглашаетесь с Условиями и Политикой',
      });
    const result = await translateBatch(
      [{ id: 'android:auth_signin_terms', text: AUTH_SIGNIN_TERMS }],
      { sourceLang: 'en', targetLang: 'ru', transport },
    );
    assert.equal(result.translations.size, 0);
    assert.equal(result.failed[0]?.reason, 'placeholder_violation');
    assert.deepEqual(validateAndroidMarkup(AUTH_SIGNIN_TERMS, 'Продолжая, вы соглашаетесь с Условиями и Политикой').length, 1);
  });
});
