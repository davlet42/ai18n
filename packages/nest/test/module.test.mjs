import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import 'reflect-metadata';
import request from 'supertest';

const { Test } = await import('@nestjs/testing');
const { I18nAgentModule } = await import('../dist/index.js');
const { loadConfig, buildBundle } = await import('i18n-agent');

function setupBundle() {
  const root = mkdtempSync(join(tmpdir(), 'nest-bundle-'));
  mkdirSync(join(root, 'locales', 'en'), { recursive: true });
  mkdirSync(join(root, 'locales', 'ru'), { recursive: true });
  writeFileSync(join(root, 'locales', 'en', 'common.json'), JSON.stringify({ greet: 'Hello {name}!' }));
  writeFileSync(join(root, 'locales', 'ru', 'common.json'), JSON.stringify({ greet: 'Привет, {name}!' }));
  writeFileSync(join(root, 'i18n-agent.config.yaml'), 'source: en\ntargets: [ru]\nlocales: locales\n');
  return buildBundle(loadConfig(root));
}

describe('I18nAgentModule', () => {
  let app;
  let bundle;

  before(async () => {
    bundle = setupBundle();
    const moduleRef = await Test.createTestingModule({
      imports: [I18nAgentModule.forRoot({ bundleDir: bundle.outDir })],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  after(async () => {
    await app?.close();
  });

  it('serves the manifest with the bundle etag', async () => {
    const res = await request(app.getHttpServer()).get('/i18n/manifest.json').expect(200);
    assert.equal(res.headers.etag, `"${bundle.manifest.etag}"`);
    assert.equal(JSON.parse(res.text).sourceLanguage ?? JSON.parse(res.text).sourceLang, 'en');
  });

  it('serves a locale file with a per-file etag and honors If-None-Match', async () => {
    const first = await request(app.getHttpServer()).get('/i18n/web/ru/common.json').expect(200);
    assert.ok(first.text.includes('Привет'));
    assert.ok(first.headers.etag);
    assert.ok(first.headers['cache-control'].includes('max-age'));

    await request(app.getHttpServer())
      .get('/i18n/web/ru/common.json')
      .set('If-None-Match', first.headers.etag)
      .expect(304);
  });

  it('serves platform artifacts too (android xml)', async () => {
    const res = await request(app.getHttpServer())
      .get('/i18n/android/res/values-ru/strings.xml')
      .expect(200);
    assert.ok(res.text.includes('<resources>'));
    assert.ok(res.headers['content-type'].includes('xml'));
  });

  it('404s unknown and traversal paths', async () => {
    await request(app.getHttpServer()).get('/i18n/web/xx/common.json').expect(404);
    await request(app.getHttpServer()).get('/i18n/..%2F..%2Fetc%2Fpasswd').expect(404);
  });
});
