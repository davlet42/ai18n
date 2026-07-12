import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const { loadConfig, computeSync, applySync } = await import('../dist/index.js');
const { runInit } = await import('../dist/commands/init.js');
const { runCheck } = await import('../dist/commands/check.js');

// A deterministic "translator": prefixes with the target language.
function fakeTransport(counter) {
  return async ({ user }) => {
    counter.calls += 1;
    const payload = JSON.parse(user.slice(user.indexOf('[')));
    const out = {};
    for (const item of payload) {
      out[item.id] = `[${counter.lang}] ${item.text}`;
    }
    return JSON.stringify(out);
  };
}

function setupProject() {
  const root = mkdtempSync(join(tmpdir(), 'i18n-agent-proj-'));
  mkdirSync(join(root, 'locales', 'en'), { recursive: true });
  writeFileSync(
    join(root, 'locales', 'en', 'common.json'),
    JSON.stringify({ greet: 'Hello {name}!', bye: 'Bye', count: 5 }, null, 2),
  );
  writeFileSync(
    join(root, 'locales', 'en', 'auth.json'),
    JSON.stringify({ login: { button: 'Sign in' } }, null, 2),
  );
  // pre-existing hand translation in ru (must be adopted, never overwritten)
  mkdirSync(join(root, 'locales', 'ru'), { recursive: true });
  writeFileSync(join(root, 'locales', 'ru', 'common.json'), JSON.stringify({ greet: 'Привет, {name}!' }, null, 2));
  writeFileSync(
    join(root, 'i18n-agent.config.yaml'),
    'source: en\ntargets: [ru, es]\nlocales: locales\n',
  );
  return root;
}

describe('sync end-to-end (fake transport)', () => {
  it('first run: translates missing, adopts existing, creates new language, writes lock', async () => {
    const root = setupProject();
    const config = loadConfig(root);
    const state = computeSync(config);

    const ruCounter = { calls: 0, lang: 'x' };
    const transport = async (call) => {
      // one transport serves both langs; tag by request content
      ruCounter.calls += 1;
      const payload = JSON.parse(call.user.slice(call.user.indexOf('[')));
      return JSON.stringify(Object.fromEntries(payload.map((i) => [i.id, `[t] ${i.text}`])));
    };

    const result = await applySync(config, state, { transport });

    // ru: greet adopted (hand value intact), bye+auth translated; es: everything translated
    const ruCommon = JSON.parse(readFileSync(join(root, 'locales', 'ru', 'common.json'), 'utf8'));
    assert.equal(ruCommon.greet, 'Привет, {name}!', 'pre-existing translation adopted, not overwritten');
    assert.equal(ruCommon.bye, '[t] Bye');
    assert.equal(ruCommon.count, 5, 'non-string leaf mirrored');
    assert.deepEqual(Object.keys(ruCommon), ['greet', 'bye', 'count'], 'source key order mirrored');

    const esAuth = JSON.parse(readFileSync(join(root, 'locales', 'es', 'auth.json'), 'utf8'));
    assert.equal(esAuth.login.button, '[t] Sign in', 'new language materialized');

    assert.ok(existsSync(join(root, 'i18n-agent.lock')));
    assert.ok(result.translated >= 4);

    // second run: everything in sync → zero agent calls
    const before = ruCounter.calls;
    const state2 = computeSync(loadConfig(root));
    assert.equal(state2.counts.translate + state2.counts.retranslate, 0);
    const result2 = await applySync(config, state2, { transport });
    assert.equal(ruCounter.calls, before, 'no agent calls on a clean second run');
    assert.equal(result2.translated, 0);
  });

  it('source change retranslates; human edit becomes review and survives retranslation runs', async () => {
    const root = setupProject();
    const config = loadConfig(root);
    const transport = async (call) => {
      const payload = JSON.parse(call.user.slice(call.user.indexOf('[')));
      return JSON.stringify(Object.fromEntries(payload.map((i) => [i.id, `[t] ${i.text}`])));
    };
    await applySync(config, computeSync(config), { transport });

    // human polishes a machine translation in es
    const esCommonPath = join(root, 'locales', 'es', 'common.json');
    const esCommon = JSON.parse(readFileSync(esCommonPath, 'utf8'));
    esCommon.bye = '¡Adiós!';
    writeFileSync(esCommonPath, JSON.stringify(esCommon, null, 2));

    // run again — the polish must be adopted, not reverted
    await applySync(config, computeSync(config), { transport });
    assert.equal(
      JSON.parse(readFileSync(esCommonPath, 'utf8')).bye,
      '¡Adiós!',
      'manual polish survives a sync run',
    );

    // now the SOURCE of that key changes → review, value still untouched
    const enCommonPath = join(root, 'locales', 'en', 'common.json');
    const enCommon = JSON.parse(readFileSync(enCommonPath, 'utf8'));
    enCommon.bye = 'Goodbye!';
    writeFileSync(enCommonPath, JSON.stringify(enCommon, null, 2));

    const state = computeSync(loadConfig(root));
    const esReviews = state.reviews.filter((r) => r.lang === 'es');
    assert.equal(esReviews.length, 1);
    assert.equal(esReviews[0].key, 'bye');

    const result = await applySync(config, state, { transport });
    assert.equal(JSON.parse(readFileSync(esCommonPath, 'utf8')).bye, '¡Adiós!', 'review value untouched');
    assert.equal(result.reviews.length, 1);

    // ru copy of the same key was machine-owned → silently retranslated
    assert.equal(
      JSON.parse(readFileSync(join(root, 'locales', 'ru', 'common.json'), 'utf8')).bye,
      '[t] Goodbye!',
    );

    // --retranslate-stale overrides the review
    const result2 = await applySync(loadConfig(root), computeSync(loadConfig(root)), {
      transport,
      retranslateStale: true,
    });
    assert.equal(JSON.parse(readFileSync(esCommonPath, 'utf8')).bye, '[t] Goodbye!');
    assert.equal(result2.reviews.length, 0);
  });

  it('failed translations ship source text as fallback and retry next run', async () => {
    const root = setupProject();
    const config = loadConfig(root);
    let fail = true;
    const transport = async (call) => {
      const payload = JSON.parse(call.user.slice(call.user.indexOf('[')));
      if (fail) {
        throw new Error('quota_exhausted');
      }
      return JSON.stringify(Object.fromEntries(payload.map((i) => [i.id, `[t] ${i.text}`])));
    };

    const r1 = await applySync(config, computeSync(config), { transport });
    assert.ok(r1.failed.length > 0);
    const esCommon = JSON.parse(readFileSync(join(root, 'locales', 'es', 'common.json'), 'utf8'));
    assert.equal('bye' in esCommon, false, 'failed key omitted — no fake translation, i18n runtime falls back');
    assert.equal(esCommon.count, 5, 'non-string leaves still mirrored');

    fail = false;
    const r2 = await applySync(loadConfig(root), computeSync(loadConfig(root)), { transport });
    assert.ok(r2.translated > 0, 'fallback keys retried on the next run');
    assert.equal(
      JSON.parse(readFileSync(join(root, 'locales', 'es', 'common.json'), 'utf8')).bye,
      '[t] Bye',
    );
  });
});

describe('init + check commands', () => {
  it('init detects languages and writes documented templates; check reports drift', () => {
    const root = mkdtempSync(join(tmpdir(), 'i18n-agent-init-'));
    mkdirSync(join(root, 'locales', 'en'), { recursive: true });
    mkdirSync(join(root, 'locales', 'de'), { recursive: true });
    writeFileSync(join(root, 'locales', 'en', 'common.json'), '{"hi":"Hi"}');
    writeFileSync(join(root, 'locales', 'de', 'common.json'), '{}');

    assert.equal(runInit(root, []), 0);
    const config = readFileSync(join(root, 'i18n-agent.config.yaml'), 'utf8');
    assert.match(config, /source: en/);
    assert.match(config, /targets: \[de\]/);
    assert.ok(readFileSync(join(root, 'i18n-agent.context.yaml'), 'utf8').includes('WHY:'), 'context template documented');

    assert.equal(runCheck(root), 1, 'de missing a key → drift');
  });
});
