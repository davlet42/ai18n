import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const {
  collectArgOrder,
  toPositional,
  findIcuMessage,
  emitAndroidXml,
  androidResourceName,
  escapeAndroid,
  emitXcstrings,
  emitTsKeys,
  runExport,
} = await import('../dist/index.js');

describe('transform: argument order and positionalization', () => {
  it('derives order from first occurrence and reuses positions for duplicates', () => {
    const order = collectArgOrder('Hi {name}, you have {count} tasks, {name}!');
    assert.deepEqual(order, ['{name}', '{count}']);
    assert.equal(
      toPositional('У {name} задач: {count}. Привет, {name}!', order, (i) => `%${i}$s`),
      'У %1$s задач: %2$s. Привет, %1$s!',
    );
  });

  it('includes # for plural bodies when asked', () => {
    assert.deepEqual(collectArgOrder('# files from {user}', true), ['#', '{user}']);
  });

  it('finds a single top-level ICU block with surrounding text', () => {
    const icu = findIcuMessage('You have {count, plural, one {# file} other {# files}} today');
    assert.equal(icu.variable, 'count');
    assert.equal(icu.keyword, 'plural');
    assert.deepEqual(icu.categories.map((c) => c.name), ['one', 'other']);
    assert.equal(icu.before, 'You have ');
    assert.equal(icu.after, ' today');
    assert.equal(findIcuMessage('plain {name} string'), null, '{name} is not an ICU block');
  });
});

describe('android emitter', () => {
  it('emits strings with source-ordered positional args, plurals and arrays', () => {
    const sourceTree = {
      greet: 'Hello {name}, {count} new!',
      files: 'You have {count, plural, one {# file} other {# files}}.',
      quote: "Don't \"quote\" me & <tag>",
      list: ['One', 'Two'],
      version: 3,
    };
    const ruTree = {
      greet: '{count} новых — привет, {name}!', // reordered vs source
      files: 'У вас {count, plural, one {# файл} few {# файла} other {# файлов}}.',
      quote: 'Не "цитируй" меня & <тег>',
      list: ['Раз', 'Два'],
      version: 3,
    };

    const { xml, warnings } = emitAndroidXml([{ namespace: 'common', tree: ruTree, sourceTree }]);
    assert.deepEqual(warnings, []);

    // reordered translation still numbers args by SOURCE order: name=1, count=2
    assert.ok(xml.includes('<string name="common_greet">%2$s новых — привет, %1$s!</string>'), xml);

    // ICU → <plurals>, # → positional %1$d (count is the only arg)
    assert.ok(xml.includes('<plurals name="common_files">'));
    assert.ok(xml.includes('<item quantity="one">У вас %1$d файл.</item>'));
    assert.ok(xml.includes('<item quantity="few">У вас %1$d файла.</item>'));

    // escaping: apostrophe, quotes, ampersand, angle brackets
    assert.ok(xml.includes('Не \\"цитируй\\" меня &amp; &lt;тег&gt;'));

    // arrays → string-array; numbers skipped
    assert.ok(xml.includes('<string-array name="common_list">'));
    assert.ok(xml.includes('<item>Раз</item>'));
    assert.ok(!xml.includes('common_version'));
  });

  it('sanitizes resource names', () => {
    assert.equal(androidResourceName('auth', 'login.button-Big'), 'auth_login_button_big');
    assert.equal(androidResourceName('', '1st.key'), 'k1st_key');
    assert.equal(escapeAndroid("it's"), "it\\'s");
  });
});

describe('xcstrings emitter', () => {
  it('builds a catalog with plural variations and positional %n$@', () => {
    const treeByLang = new Map([
      ['en', { files: '{count, plural, one {# file} other {# files}}', hi: 'Hi {name} from {app}' }],
      ['ru', { files: '{count, plural, one {# файл} other {# файлов}}', hi: 'Из {app} привет, {name}' }],
    ]);
    const { json, warnings } = emitXcstrings({
      sourceLang: 'en',
      languages: ['en', 'ru'],
      namespaces: [{ namespace: 'common', treeByLang }],
    });
    assert.deepEqual(warnings, []);
    const catalog = JSON.parse(json);
    assert.equal(catalog.sourceLanguage, 'en');

    const files = catalog.strings['common.files'].localizations;
    assert.equal(files.ru.variations.plural.one.stringUnit.value, '%lld файл');
    assert.equal(files.en.variations.plural.other.stringUnit.value, '%lld files');

    const hi = catalog.strings['common.hi'].localizations;
    assert.equal(hi.en.stringUnit.value, 'Hi %1$@ from %2$@');
    assert.equal(hi.ru.stringUnit.value, 'Из %2$@ привет, %1$@', 'source-ordered args in translation');
  });
});

describe('ts-keys emitter', () => {
  it('emits namespace and key unions', () => {
    const out = emitTsKeys([
      { namespace: 'auth', tree: { login: { button: 'Sign in' }, n: 5 } },
      { namespace: 'common', tree: { hi: 'Hi' } },
    ]);
    assert.ok(out.includes("| 'auth'"));
    assert.ok(out.includes("| 'auth:login.button'"));
    assert.ok(out.includes("| 'common:hi'"));
    assert.ok(!out.includes('auth:n'), 'non-string leaves excluded');
  });
});

describe('export command e2e', () => {
  it('exports all configured platforms from a namespaced project', async () => {
    const root = mkdtempSync(join(tmpdir(), 'i18n-agent-export-'));
    mkdirSync(join(root, 'locales', 'en'), { recursive: true });
    mkdirSync(join(root, 'locales', 'ru'), { recursive: true });
    writeFileSync(
      join(root, 'locales', 'en', 'common.json'),
      JSON.stringify({ greet: 'Hello {name}!', files: '{count, plural, one {# file} other {# files}}' }),
    );
    writeFileSync(
      join(root, 'locales', 'ru', 'common.json'),
      JSON.stringify({ greet: 'Привет, {name}!', files: '{count, plural, one {# файл} other {# файлов}}' }),
    );
    writeFileSync(
      join(root, 'i18n-agent.config.yaml'),
      [
        'source: en',
        'targets: [ru]',
        'locales: locales',
        'exports:',
        '  - platform: android',
        '    out: out/android/res',
        '  - platform: ios-xcstrings',
        '    out: out/ios',
        '  - platform: web-json',
        '    out: out/web',
        '  - platform: ts-keys',
        '    out: out/web/src',
        '',
      ].join('\n'),
    );

    assert.equal(await runExport(root, []), 0);

    assert.ok(existsSync(join(root, 'out/android/res/values/strings.xml')), 'source lang → values/');
    assert.ok(existsSync(join(root, 'out/android/res/values-ru/strings.xml')));
    assert.ok(existsSync(join(root, 'out/ios/Localizable.xcstrings')));
    assert.ok(existsSync(join(root, 'out/web/ru/common.json')));
    assert.ok(existsSync(join(root, 'out/web/src/i18n-keys.d.ts')));

    const ruXml = readFileSync(join(root, 'out/android/res/values-ru/strings.xml'), 'utf8');
    assert.ok(ruXml.includes('quantity="one"'));
  });
});
