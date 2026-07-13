import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const { loadConfig, buildBundle, BundleReader } = await import('../dist/index.js');

function setupProject() {
  const root = mkdtempSync(join(tmpdir(), 'i18n-agent-bundle-'));
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
  writeFileSync(join(root, 'i18n-agent.config.yaml'), 'source: en\ntargets: [ru]\nlocales: locales\n');
  return root;
}

describe('buildBundle', () => {
  it('produces the full layout with a manifest of hashes and a stable etag', () => {
    const root = setupProject();
    const config = loadConfig(root);

    const first = buildBundle(config);
    assert.ok(existsSync(join(first.outDir, 'manifest.json')));
    assert.ok(existsSync(join(first.outDir, 'web', 'ru', 'common.json')));
    assert.ok(existsSync(join(first.outDir, 'android', 'res', 'values-ru', 'strings.xml')));
    assert.ok(existsSync(join(first.outDir, 'android', 'res', 'values', 'strings.xml')));
    assert.ok(existsSync(join(first.outDir, 'ios', 'Localizable.xcstrings')));
    assert.ok(existsSync(join(first.outDir, 'ts', 'i18n-keys.d.ts')));

    for (const [rel, meta] of Object.entries(first.manifest.files)) {
      assert.ok(existsSync(join(first.outDir, rel)), rel);
      assert.equal(typeof meta.sha256, 'string');
      assert.ok(meta.bytes > 0);
    }

    // identical content → identical etag on regeneration
    const second = buildBundle(config);
    assert.equal(second.manifest.etag, first.manifest.etag, 'etag is content-derived, not time-derived');

    // content change → different etag
    writeFileSync(
      join(root, 'locales', 'ru', 'common.json'),
      JSON.stringify({ greet: 'Здравствуйте, {name}!', files: '{count, plural, one {# файл} other {# файлов}}' }),
    );
    const third = buildBundle(config);
    assert.notEqual(third.manifest.etag, first.manifest.etag);
  });

  it('honors --out override and bundle.out config', () => {
    const root = setupProject();
    writeFileSync(
      join(root, 'i18n-agent.config.yaml'),
      'source: en\ntargets: [ru]\nlocales: locales\nbundle:\n  out: dist-i18n\n',
    );
    const fromConfig = buildBundle(loadConfig(root));
    assert.ok(fromConfig.outDir.endsWith('dist-i18n'));
    const overridden = buildBundle(loadConfig(root), 'custom-out');
    assert.ok(overridden.outDir.endsWith('custom-out'));
  });
});

describe('BundleReader', () => {
  it('serves manifest-listed files with etags, rejects everything else', () => {
    const root = setupProject();
    const { outDir, manifest } = buildBundle(loadConfig(root));
    const reader = new BundleReader(outDir);

    assert.equal(reader.manifest().etag, manifest.etag);

    const rel = reader.webPath('ru', 'common');
    assert.equal(rel, 'web/ru/common.json');
    const file = reader.read(rel);
    assert.ok(file);
    assert.equal(file.etag, `"${manifest.files[rel].sha256}"`);
    assert.ok(file.content.toString('utf8').includes('Привет'));

    assert.equal(reader.read('web/xx/common.json'), null, 'unknown path → null');
    assert.equal(reader.read('../../../etc/passwd'), null, 'traversal → null');
    assert.equal(reader.read('manifest.json'), null, 'manifest itself is not in files map');
  });

  it('reloads the manifest when the bundle is regenerated in place', () => {
    const root = setupProject();
    const config = loadConfig(root);
    const { outDir } = buildBundle(config);
    const reader = new BundleReader(outDir, { statIntervalMs: 0 });
    const before = reader.manifest().etag;

    writeFileSync(
      join(root, 'locales', 'ru', 'common.json'),
      JSON.stringify({ greet: 'Салют, {name}!', files: '{count, plural, one {# файл} other {# файлов}}' }),
    );
    buildBundle(config);
    // ensure mtime moves even on coarse-grained filesystems
    const future = new Date(Date.now() + 2000);
    utimesSync(join(outDir, 'manifest.json'), future, future);

    assert.notEqual(reader.manifest().etag, before, 'manifest reloaded after regeneration');
    assert.ok(reader.read('web/ru/common.json').content.toString('utf8').includes('Салют'));
  });

  it('returns null manifest for a missing bundle', () => {
    const reader = new BundleReader(join(tmpdir(), 'no-such-bundle'));
    assert.equal(reader.manifest(), null);
    assert.equal(reader.read('web/en.json'), null);
  });

  it('serves repeat reads from memory (no filesystem on the hot path)', () => {
    const root = setupProject();
    const { outDir } = buildBundle(loadConfig(root));
    const reader = new BundleReader(outDir);

    const first = reader.read('web/ru/common.json');
    assert.ok(first.content.toString('utf8').includes('Привет'));

    rmSync(join(outDir, 'web', 'ru', 'common.json'));
    const second = reader.read('web/ru/common.json');
    assert.ok(second, 'cached content survives the file being gone');
    assert.equal(second.content, first.content);
  });

  it('rejects prototype-inherited property names as paths', () => {
    const root = setupProject();
    const { outDir } = buildBundle(loadConfig(root));
    const reader = new BundleReader(outDir);

    assert.equal(reader.read('constructor'), null);
    assert.equal(reader.read('__proto__'), null);
    assert.equal(reader.read('toString'), null);
  });

  it('serves but does not cache content that mismatches the manifest hash', () => {
    const root = setupProject();
    const { outDir } = buildBundle(loadConfig(root));
    const reader = new BundleReader(outDir, { statIntervalMs: 0 });
    const rel = 'web/ru/common.json';

    writeFileSync(join(outDir, rel), '{"greet":"swapped mid-regeneration"}');
    const mismatched = reader.read(rel);
    assert.ok(mismatched.content.toString('utf8').includes('swapped'));

    rmSync(join(outDir, rel));
    assert.equal(reader.read(rel), null, 'mismatched content was not pinned in the cache');
  });

  it('drops the content cache when the manifest etag changes', () => {
    const root = setupProject();
    const config = loadConfig(root);
    const { outDir } = buildBundle(config);
    const reader = new BundleReader(outDir, { statIntervalMs: 0 });
    assert.ok(reader.read('web/ru/common.json').content.toString('utf8').includes('Привет'));

    writeFileSync(
      join(root, 'locales', 'ru', 'common.json'),
      JSON.stringify({ greet: 'Салют, {name}!', files: '{count, plural, one {# файл} other {# файлов}}' }),
    );
    buildBundle(config);
    const future = new Date(Date.now() + 2000);
    utimesSync(join(outDir, 'manifest.json'), future, future);

    assert.ok(
      reader.read('web/ru/common.json').content.toString('utf8').includes('Салют'),
      'new etag invalidates previously cached content',
    );
  });
});
