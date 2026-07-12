import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const {
  detectLayout,
  listNamespaces,
  readLocaleTree,
  writeLocaleTree,
  flattenTree,
  buildTargetTree,
  FLAT_NS,
  keyId,
  readLockfile,
  writeLockfile,
  recordTranslation,
  sha256,
  planNamespace,
  countPlan,
} = await import('../dist/index.js');

function tmp() {
  return mkdtempSync(join(tmpdir(), 'ai18n-test-'));
}

describe('locale-files: layouts and IO', () => {
  it('detects flat layout and reads/writes preserving key order', () => {
    const dir = tmp();
    writeFileSync(
      join(dir, 'en.json'),
      JSON.stringify({ zebra: 'Z', apple: 'A', nested: { b: 'B', a: 'A' } }, null, 2),
    );
    const layout = detectLayout(dir, 'en');
    assert.equal(layout.kind, 'flat');
    assert.deepEqual(listNamespaces(layout, 'en'), [FLAT_NS]);

    const tree = readLocaleTree(layout, 'en', FLAT_NS);
    assert.deepEqual(Object.keys(tree), ['zebra', 'apple', 'nested'], 'insertion order preserved');

    const path = writeLocaleTree(layout, 'ru', FLAT_NS, tree);
    const written = JSON.parse(readFileSync(path, 'utf8'));
    assert.deepEqual(Object.keys(written), ['zebra', 'apple', 'nested']);
  });

  it('detects namespaces layout and lists namespaces sorted', () => {
    const dir = tmp();
    mkdirSync(join(dir, 'en'), { recursive: true });
    writeFileSync(join(dir, 'en', 'common.json'), '{"hello":"Hello"}');
    writeFileSync(join(dir, 'en', 'auth.json'), '{"login":"Sign in"}');
    const layout = detectLayout(dir, 'en');
    assert.equal(layout.kind, 'namespaces');
    assert.deepEqual(listNamespaces(layout, 'en'), ['auth', 'common']);
    assert.deepEqual(listNamespaces(layout, 'ru'), [], 'missing language → no namespaces');
  });

  it('reads and writes YAML', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'en.yaml'), 'title: Hello\nitems:\n  - one\n  - two\n');
    const layout = detectLayout(dir, 'en');
    assert.equal(layout.ext, 'yaml');
    const tree = readLocaleTree(layout, 'en', FLAT_NS);
    assert.equal(tree.title, 'Hello');
    writeLocaleTree(layout, 'ru', FLAT_NS, tree);
    const back = readLocaleTree(layout, 'ru', FLAT_NS);
    assert.deepEqual(back, tree);
  });

  it('flattens nested objects and arrays; rebuilds mirroring source structure', () => {
    const source = { a: { b: 'text', n: 5 }, list: ['one', 'two'], flag: true };
    const flat = flattenTree(source);
    assert.deepEqual(
      [...flat.entries()],
      [
        ['a.b', 'text'],
        ['a.n', 5],
        ['list.0', 'one'],
        ['list.1', 'two'],
        ['flag', true],
      ],
    );

    const values = new Map([
      ['a.b', 'текст'],
      ['list.0', 'один'],
      ['list.1', 'два'],
    ]);
    const target = buildTargetTree(source, values);
    assert.deepEqual(target, { a: { b: 'текст', n: 5 }, list: ['один', 'два'], flag: true });
    assert.deepEqual(Object.keys(target), ['a', 'list', 'flag'], 'source order mirrored');
  });
});

describe('planner: three-state key lifecycle', () => {
  const NS = 'common';
  const LANG = 'ru';

  it('walks a key through translate → keep → retranslate → human edit → review', () => {
    const lock = { version: 1, keys: {} };
    const src = new Map([['greet', 'Hello {name}!']]);

    // 1) missing in target → translate
    let plan = planNamespace({ namespace: NS, lang: LANG, source: src, target: new Map(), lock });
    assert.deepEqual(plan.actions, [{ type: 'translate', key: 'greet', sourceText: 'Hello {name}!' }]);

    // ...ai18n translates and records
    recordTranslation(lock, keyId(NS, 'greet'), LANG, 'Hello {name}!', 'Привет, {name}!');
    const target = new Map([['greet', 'Привет, {name}!']]);

    // 2) unchanged → keep (zero calls)
    plan = planNamespace({ namespace: NS, lang: LANG, source: src, target, lock });
    assert.equal(plan.actions[0].type, 'keep');

    // 3) source changed, value still machine-owned → retranslate
    const src2 = new Map([['greet', 'Hello there, {name}!']]);
    plan = planNamespace({ namespace: NS, lang: LANG, source: src2, target, lock });
    assert.equal(plan.actions[0].type, 'retranslate');

    // 4) human fixes the translation → adopt (sacred), no retranslation while source stable
    const edited = new Map([['greet', 'Здравствуйте, {name}!']]);
    plan = planNamespace({ namespace: NS, lang: LANG, source: src, target: edited, lock });
    assert.equal(plan.actions[0].type, 'adopt');

    // ...adoption recorded as human
    const { recordHumanValue } = awaitImportCache;
    recordHumanValue(lock, keyId(NS, 'greet'), LANG, 'Hello {name}!', 'Здравствуйте, {name}!');

    // 5) source changes AFTER the human edit → review, never overwrite
    plan = planNamespace({ namespace: NS, lang: LANG, source: src2, target: edited, lock });
    assert.equal(plan.actions[0].type, 'review');
    assert.equal(plan.actions[0].currentValue, 'Здравствуйте, {name}!');

    // 6) the human edits the value again — that IS the review action → adopt
    const reReviewed = new Map([['greet', 'Здравствуйте же, {name}!']]);
    plan = planNamespace({ namespace: NS, lang: LANG, source: src2, target: reReviewed, lock });
    assert.equal(plan.actions[0].type, 'adopt', 'editing the value resolves the review');
  });

  it('adopts pre-existing translations on first run (no lock entry)', () => {
    const plan = planNamespace({
      namespace: NS,
      lang: LANG,
      source: new Map([['title', 'Title']]),
      target: new Map([['title', 'Заголовок']]),
      lock: { version: 1, keys: {} },
    });
    assert.deepEqual(plan.actions, [{ type: 'adopt', key: 'title', value: 'Заголовок' }]);
  });

  it('copies non-string leaves and empty strings verbatim, prunes keys gone from source', () => {
    const plan = planNamespace({
      namespace: NS,
      lang: LANG,
      source: new Map([
        ['count', 5],
        ['flag', true],
        ['empty', ''],
      ]),
      target: new Map([['stale', 'Старый ключ']]),
      lock: { version: 1, keys: {} },
    });
    const types = plan.actions.map((a) => a.type);
    assert.deepEqual(types, ['copy', 'copy', 'copy', 'prune']);
    const counts = countPlan([plan]);
    assert.equal(counts.copy, 3);
    assert.equal(counts.prune, 1);
  });
});

describe('planner: key rename detection', () => {
  it('migrates a human-polished translation to the renamed key instead of pruning it', () => {
    const lock = { version: 1, keys: {} };
    const { recordHumanValue } = awaitImportCache;
    // key auth.signin was translated and then hand-polished
    recordHumanValue(lock, keyId('auth', 'signin'), 'ru', 'Sign in', 'Войти в систему');

    // dev renames signin → login in the source, text unchanged
    const plan = planNamespace({
      namespace: 'auth',
      lang: 'ru',
      source: new Map([['login', 'Sign in']]),
      target: new Map([['signin', 'Войти в систему']]),
      lock,
    });

    const rename = plan.actions.find((a) => a.type === 'rename');
    assert.ok(rename, 'rename detected instead of translate');
    assert.equal(rename.key, 'login');
    assert.equal(rename.fromKey, 'signin');
    assert.equal(rename.value, 'Войти в систему');
    assert.equal(rename.by, 'human', 'ownership survives the rename');
    assert.ok(plan.actions.some((a) => a.type === 'prune' && a.key === 'signin'), 'old key still pruned');
    assert.ok(!plan.actions.some((a) => a.type === 'translate'), 'no machine retranslation');
  });

  it('does not fake a rename when texts differ — translates the new key, prunes the old', () => {
    const lock = { version: 1, keys: {} };
    recordTranslation(lock, keyId('auth', 'signin'), 'ru', 'Sign in', 'Войти');
    const plan = planNamespace({
      namespace: 'auth',
      lang: 'ru',
      source: new Map([['login', 'Log in']]),
      target: new Map([['signin', 'Войти']]),
      lock,
    });
    const types = plan.actions.map((a) => a.type).sort();
    assert.deepEqual(types, ['prune', 'translate']);
  });
});

describe('lockfile', () => {
  it('round-trips with sorted keys for clean git diffs', () => {
    const dir = tmp();
    const path = join(dir, 'ai18n.lock');
    const lock = { version: 1, keys: {} };
    recordTranslation(lock, 'common:z', 'ru', 'Z', 'З');
    recordTranslation(lock, 'auth:a', 'ru', 'A', 'А');
    recordTranslation(lock, 'auth:a', 'es', 'A', 'A-es');
    writeLockfile(path, lock);

    const raw = readFileSync(path, 'utf8');
    assert.ok(raw.indexOf('"auth:a"') < raw.indexOf('"common:z"'), 'ids sorted');
    assert.ok(raw.indexOf('"es"') < raw.indexOf('"ru"'), 'langs sorted');

    const back = readLockfile(path);
    assert.equal(back.keys['auth:a'].targets.ru.by, 'ai18n');
    assert.equal(back.keys['auth:a'].targets.ru.source, sha256('A'), 'source sha tracked per target');
    assert.equal(back.keys['auth:a'].targets.es.source, sha256('A'));
  });

  it('returns an empty lockfile when the file is missing', () => {
    const lock = readLockfile(join(tmp(), 'ai18n.lock'));
    assert.deepEqual(lock, { version: 1, keys: {} });
  });
});

// recordHumanValue is used mid-test; import once here to keep the test body tidy.
const awaitImportCache = await import('../dist/index.js');
