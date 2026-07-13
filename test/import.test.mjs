import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const {
  loadConfig,
  computeSync,
  applySync,
  extractPlaceholderSignature,
  parseAndroidStringsXml,
  androidLangFromValuesDir,
  parseXcstrings,
} = await import('../dist/index.js');
const { runImport } = await import('../dist/commands/import.js');

describe('parseAndroidStringsXml', () => {
  const XML = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="greet">Hello %1$s &amp; welcome</string>
    <string name="quoted">"  spaced  "</string>
    <string name="escaped">don\\'t stop\\nnow</string>
    <string name="brand" translatable="false">kincassa</string>
    <plurals name="files_count">
        <item quantity="one">%d file</item>
        <item quantity="other">%d files</item>
    </plurals>
    <string-array name="days">
        <item>Mon</item>
        <item>Tue</item>
    </string-array>
</resources>
`;

  it('parses strings, plurals and arrays with android unescaping', () => {
    const { tree, skipped } = parseAndroidStringsXml(XML);
    assert.equal(tree.greet, 'Hello %1$s & welcome');
    assert.equal(tree.quoted, '  spaced  ');
    assert.equal(tree.escaped, "don't stop\nnow");
    assert.equal(tree.files_count, '{count, plural, one {# file} other {# files}}');
    assert.deepEqual(tree.days, ['Mon', 'Tue']);
    assert.deepEqual(skipped, ['brand']);
    assert.equal(tree.brand, undefined);
  });

  it('maps values directories to languages and skips non-language qualifiers', () => {
    assert.equal(androidLangFromValuesDir('values', 'en'), 'en');
    assert.equal(androidLangFromValuesDir('values-ru', 'en'), 'ru');
    assert.equal(androidLangFromValuesDir('values-zh-rCN', 'en'), 'zh-CN');
    assert.equal(androidLangFromValuesDir('values-night', 'en'), null);
    assert.equal(androidLangFromValuesDir('values-v21', 'en'), null);
  });
});

describe('parseXcstrings', () => {
  const CATALOG = JSON.stringify({
    sourceLanguage: 'en',
    strings: {
      'auth.signIn.title': {
        localizations: {
          en: { stringUnit: { value: 'Sign in' } },
          ru: { stringUnit: { value: 'Войти' } },
        },
      },
      'auth.recentCount': {
        localizations: {
          en: {
            variations: {
              plural: {
                one: { stringUnit: { value: '%lld file' } },
                other: { stringUnit: { value: '%lld files' } },
              },
            },
          },
        },
      },
      standalone: {
        localizations: { en: { stringUnit: { value: 'Alone %@' } } },
      },
      'no.source.entry': {
        localizations: { ru: { stringUnit: { value: 'Только русский' } } },
      },
    },
  });

  it('nests dot keys, converts plural variations to ICU and keeps %@', () => {
    const { sourceLang, byLang, warnings } = parseXcstrings(CATALOG, 'Localizable.xcstrings');
    assert.equal(sourceLang, 'en');
    const en = byLang.get('en');
    assert.equal(en.auth.signIn.title, 'Sign in');
    assert.equal(en.auth.recentCount, '{count, plural, one {# file} other {# files}}');
    assert.equal(en.standalone, 'Alone %@');
    assert.equal(byLang.get('ru').auth.signIn.title, 'Войти');
    // missing source localization → key used as source value, with a warning
    assert.equal(en.no.source.entry, 'no.source.entry');
    assert.ok(warnings.some((w) => w.includes('no en localization')));
  });

  it('placeholder guard recognizes Apple printf specifiers', () => {
    assert.deepEqual(extractPlaceholderSignature('Open %@ of %lld at %1$@').sort(), [
      '%1$@',
      '%@',
      '%lld',
    ]);
  });
});

function setupConfig(root, targets) {
  writeFileSync(
    join(root, 'i18n-agent.config.yaml'),
    `source: en\ntargets: [${targets.join(', ')}]\nlocales: locales\n`,
  );
}

describe('runImport end-to-end', () => {
  it('android: imports values dirs, then translate adopts the existing translations', async () => {
    const root = mkdtempSync(join(tmpdir(), 'i18n-agent-import-'));
    setupConfig(root, ['ru']);
    const res = join(root, 'app-res');
    mkdirSync(join(res, 'values'), { recursive: true });
    mkdirSync(join(res, 'values-ru'), { recursive: true });
    mkdirSync(join(res, 'values-night'), { recursive: true });
    writeFileSync(
      join(res, 'values', 'strings.xml'),
      '<resources><string name="greet">Hello</string><string name="bye">Bye</string></resources>',
    );
    writeFileSync(
      join(res, 'values-ru', 'strings.xml'),
      '<resources><string name="greet">Привет</string></resources>',
    );
    writeFileSync(join(res, 'values-night', 'strings.xml'), '<resources/>');

    const code = runImport(root, ['--platform', 'android', '--in', 'app-res']);
    assert.equal(code, 0);
    const en = JSON.parse(readFileSync(join(root, 'locales', 'en', 'android.json'), 'utf8'));
    assert.deepEqual(en, { greet: 'Hello', bye: 'Bye' });
    assert.ok(existsSync(join(root, 'locales', 'ru', 'android.json')));

    const counter = { calls: 0, ids: [] };
    const transport = async (call) => {
      counter.calls += 1;
      const payload = JSON.parse(call.user.slice(call.user.indexOf('[')));
      counter.ids.push(...payload.map((i) => i.id));
      return JSON.stringify(Object.fromEntries(payload.map((i) => [i.id, `[ru] ${i.text}`])));
    };
    const config = loadConfig(root);
    const result = await applySync(config, computeSync(config), { transport });

    assert.equal(result.translated, 1, 'only the key missing in ru is translated');
    assert.ok(!counter.ids.includes('android:greet'), 'adopted key never hits the translator');
    const ru = JSON.parse(readFileSync(join(root, 'locales', 'ru', 'android.json'), 'utf8'));
    assert.equal(ru.greet, 'Привет');
    assert.equal(ru.bye, '[ru] Bye');
  });

  it('ios: splits top-level segments into namespaces and refuses to overwrite without --force', () => {
    const root = mkdtempSync(join(tmpdir(), 'i18n-agent-import-'));
    setupConfig(root, ['ru']);
    const catalog = join(root, 'Localizable.xcstrings');
    writeFileSync(
      catalog,
      JSON.stringify({
        sourceLanguage: 'en',
        strings: {
          'auth.title': { localizations: { en: { stringUnit: { value: 'Sign in' } } } },
          hello: { localizations: { en: { stringUnit: { value: 'Hi' } } } },
        },
      }),
    );

    assert.equal(runImport(root, ['--platform', 'ios-xcstrings', '--in', 'Localizable.xcstrings']), 0);
    assert.deepEqual(
      JSON.parse(readFileSync(join(root, 'locales', 'en', 'auth.json'), 'utf8')),
      { title: 'Sign in' },
    );
    assert.deepEqual(
      JSON.parse(readFileSync(join(root, 'locales', 'en', 'common.json'), 'utf8')),
      { hello: 'Hi' },
    );

    assert.equal(
      runImport(root, ['--platform', 'ios-xcstrings', '--in', 'Localizable.xcstrings']),
      1,
      'existing files are not clobbered without --force',
    );
    assert.equal(
      runImport(root, ['--platform', 'ios-xcstrings', '--in', 'Localizable.xcstrings', '--force']),
      0,
    );
  });

  it('respects an existing TS layout for the written files', () => {
    const root = mkdtempSync(join(tmpdir(), 'i18n-agent-import-'));
    setupConfig(root, []);
    mkdirSync(join(root, 'locales', 'en'), { recursive: true });
    writeFileSync(join(root, 'locales', 'en', 'app.ts'), "export default { x: 'y' } as const;\n");
    const res = join(root, 'res');
    mkdirSync(join(res, 'values'), { recursive: true });
    writeFileSync(
      join(res, 'values', 'strings.xml'),
      '<resources><string name="greet">Hello</string></resources>',
    );

    assert.equal(runImport(root, ['--platform', 'android', '--in', 'res']), 0);
    const raw = readFileSync(join(root, 'locales', 'en', 'android.ts'), 'utf8');
    assert.ok(raw.startsWith('export default {'), 'import follows the detected TS layout');
  });
});
