import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

process.env.I18N_AGENT_HOME = mkdtempSync(join(tmpdir(), 'i18n-agent-metrics-home-'));

const {
  appendRunMetrics,
  readRunMetrics,
  aggregateRunMetrics,
  formatReport,
  metricsPath,
  loadConfig,
  computeSync,
  applySync,
  translateBatch,
  DEEPL_USD_PER_MILLION_CHARS,
} = await import('../dist/index.js');

describe('metrics module', () => {
  it('appends, reads with a window, and filters by project', () => {
    appendRunMetrics({
      ts: new Date().toISOString(),
      project: 'demo',
      lang: 'ru',
      translated: 10,
      failed: 1,
      calls: 2,
      chars_source: 500,
      chars_translated: 620,
      cost_usd: 0.012,
    });
    appendRunMetrics({
      ts: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(), // a month old
      project: 'demo',
      lang: 'ru',
      translated: 99,
      failed: 0,
      calls: 1,
      chars_source: 9,
      chars_translated: 9,
    });
    appendRunMetrics({
      ts: new Date().toISOString(),
      project: 'other',
      lang: 'es',
      translated: 5,
      failed: 0,
      calls: 1,
      chars_source: 100,
      chars_translated: 110,
    });

    const window = readRunMetrics({ days: 7, project: 'demo' });
    assert.equal(window.length, 1, 'old entries and other projects filtered out');

    const agg = aggregateRunMetrics(window);
    assert.equal(agg.translated, 10);
    assert.equal(agg.costUsd, 0.012);
    assert.ok(Math.abs(agg.deeplEquivalentUsd - (500 / 1_000_000) * DEEPL_USD_PER_MILLION_CHARS) < 1e-9);

    const text = formatReport(agg, 'hdr');
    assert.ok(text.includes('DeepL API equivalent'));
    assert.ok(text.includes('$0.0120'));
  });

  it('tolerates malformed lines', () => {
    writeFileSync(metricsPath(), `${readFileSync(metricsPath(), 'utf8')}not-json\n`, 'utf8');
    assert.ok(readRunMetrics({ days: 7 }).length >= 2);
  });
});

describe('receipts flow end-to-end', () => {
  it('transport receipts reach translateBatch and applySync, and land in metrics', async () => {
    const transport = async ({ user }) => {
      const payload = JSON.parse(user.slice(user.indexOf('[')));
      return {
        text: JSON.stringify(Object.fromEntries(payload.map((i) => [i.id, `[t] ${i.text}`]))),
        costUsd: 0.005,
      };
    };

    const batch = await translateBatch([{ id: 'a:k', text: 'Hello' }], {
      sourceLang: 'en',
      targetLang: 'ru',
      transport,
    });
    assert.equal(batch.costUsd, 0.005);

    // through applySync into the metrics file
    const root = mkdtempSync(join(tmpdir(), 'i18n-agent-receipts-proj-'));
    mkdirSync(join(root, 'locales', 'en'), { recursive: true });
    writeFileSync(join(root, 'locales', 'en', 'common.json'), '{"hello":"Hello world"}');
    writeFileSync(join(root, 'i18n-agent.config.yaml'), 'source: en\ntargets: [ru]\nlocales: locales\n');

    const config = loadConfig(root);
    const result = await applySync(config, computeSync(config), { transport });
    assert.equal(result.costUsd, 0.005);

    const projectName = root.split('/').pop();
    const entries = readRunMetrics({ days: 1, project: projectName });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].translated, 1);
    assert.equal(entries[0].cost_usd, 0.005);
    assert.ok(entries[0].chars_source > 0);
  });
});
