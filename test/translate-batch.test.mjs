import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const { translateBatch, chunkItems } = await import('../dist/index.js');

const OPTS = { sourceLang: 'en', targetLang: 'ru' };

function items(...pairs) {
  return pairs.map(([id, text, context]) => (context ? { id, text, context } : { id, text }));
}

describe('chunkItems', () => {
  it('splits by max items and max chars', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ id: String(i), text: 'x'.repeat(40) }));
    assert.equal(chunkItems(many, 2, 10_000).length, 3);
    assert.equal(chunkItems(many, 100, 100).length, 3, '2×40 chars per 100-char chunk');
    assert.equal(chunkItems([], 10, 100).length, 0);
  });
});

describe('translateBatch', () => {
  it('happy path: one call, translations mapped', async () => {
    const calls = [];
    const transport = async ({ user }) => {
      calls.push(user);
      return JSON.stringify({ 'common:hello': 'Привет', 'common:bye': 'Пока' });
    };
    const result = await translateBatch(
      items(['common:hello', 'Hello'], ['common:bye', 'Bye']),
      { ...OPTS, transport },
    );
    assert.equal(result.calls, 1);
    assert.equal(result.translations.get('common:hello'), 'Привет');
    assert.deepEqual(result.failed, []);
    assert.ok(calls[0].includes('"id": "common:hello"'));
  });

  it('passes context through to the payload', async () => {
    let seen = '';
    const transport = async ({ user }) => {
      seen = user;
      return JSON.stringify({ 'a:k': 'ок' });
    };
    await translateBatch(items(['a:k', 'OK', 'button on the payment screen']), { ...OPTS, transport });
    assert.ok(seen.includes('button on the payment screen'));
  });

  it('retries once when the response is fenced garbage, then succeeds', async () => {
    let n = 0;
    const transport = async () => {
      n += 1;
      return n === 1 ? 'Sure! Here you go:' : '```json\n{"a:k":"ок"}\n```';
    };
    const result = await translateBatch(items(['a:k', 'OK']), { ...OPTS, transport });
    assert.equal(result.calls, 2);
    assert.equal(result.translations.get('a:k'), 'ок');
  });

  it('placeholder violation → corrective per-item retry → fixed', async () => {
    let n = 0;
    const transport = async ({ user }) => {
      n += 1;
      if (n === 1) {
        return JSON.stringify({ 'a:greet': 'Привет, имя!' }); // dropped {name}
      }
      assert.ok(user.includes('PLACEHOLDER ERROR'), 'corrective context attached');
      assert.ok(user.includes('{name}'), 'expected token spelled out');
      return JSON.stringify({ 'a:greet': 'Привет, {name}!' });
    };
    const result = await translateBatch(items(['a:greet', 'Hello, {name}!']), { ...OPTS, transport });
    assert.equal(result.translations.get('a:greet'), 'Привет, {name}!');
    assert.deepEqual(result.failed, []);
  });

  it('persistent violation → item failed, healthy items unaffected', async () => {
    const transport = async () =>
      JSON.stringify({ 'a:good': 'Хорошо', 'a:bad': 'сломано без токена' });
    const result = await translateBatch(
      items(['a:good', 'Good'], ['a:bad', 'Bad {token}']),
      { ...OPTS, transport },
    );
    assert.equal(result.translations.get('a:good'), 'Хорошо');
    assert.equal(result.translations.has('a:bad'), false);
    assert.deepEqual(result.failed, [{ id: 'a:bad', reason: 'placeholder_violation' }]);
  });

  it('transport throwing quota_exhausted fails the chunk gracefully', async () => {
    const transport = async () => {
      throw new Error('quota_exhausted');
    };
    const result = await translateBatch(items(['a:k', 'OK']), { ...OPTS, transport });
    assert.deepEqual(result.failed, [{ id: 'a:k', reason: 'quota_exhausted' }]);
    assert.equal(result.translations.size, 0);
  });

  it('glossary terms land in the system prompt', async () => {
    let sys = '';
    const transport = async ({ system }) => {
      sys = system;
      return JSON.stringify({ 'a:k': 'ок' });
    };
    await translateBatch(items(['a:k', 'OK']), {
      ...OPTS,
      transport,
      glossaryTerms: ['Poieton', 'Кошелёк = Wallet'],
    });
    assert.ok(sys.includes('Poieton'));
    assert.ok(sys.includes('Кошелёк = Wallet'));
  });
});
