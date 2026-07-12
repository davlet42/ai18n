import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Run metrics: one JSONL entry per (translate run × language) under
// ~/.ai18n/metrics.jsonl (AI18N_HOME overrides — tests use a temp dir).
// The interesting economics: actual spend receipts from `claude -p`
// (notional API cost — $0 marginal on a subscription) versus what the same
// characters would have cost on the DeepL API.

// DeepL API Pro: ~$25 per 1M characters (plus base fee, ignored here).
export const DEEPL_USD_PER_MILLION_CHARS = 25;

export function ai18nHome(): string {
  return process.env.AI18N_HOME ?? join(homedir(), '.ai18n');
}

export function metricsPath(): string {
  return join(ai18nHome(), 'metrics.jsonl');
}

export interface RunMetricsEntry {
  ts: string;
  project: string;
  lang: string;
  translated: number;
  failed: number;
  calls: number;
  chars_source: number;
  chars_translated: number;
  cost_usd?: number;
  model?: string;
}

export function appendRunMetrics(entry: RunMetricsEntry): void {
  try {
    mkdirSync(ai18nHome(), { recursive: true });
    appendFileSync(metricsPath(), `${JSON.stringify(entry)}\n`, 'utf8');
  } catch {
    // metrics must never break a translate run
  }
}

export function readRunMetrics(options: { days?: number; project?: string } = {}): RunMetricsEntry[] {
  const path = metricsPath();
  if (!existsSync(path)) {
    return [];
  }
  const since = options.days !== undefined ? Date.now() - options.days * 24 * 60 * 60 * 1000 : 0;
  const out: RunMetricsEntry[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) {
      continue;
    }
    try {
      const entry = JSON.parse(line) as RunMetricsEntry;
      if (Date.parse(entry.ts) >= since && (!options.project || entry.project === options.project)) {
        out.push(entry);
      }
    } catch {
      // skip malformed lines
    }
  }
  return out;
}

export interface ReportAggregate {
  runs: number;
  translated: number;
  failed: number;
  calls: number;
  charsSource: number;
  charsTranslated: number;
  costUsd: number;
  receiptsSeen: number;
  deeplEquivalentUsd: number;
  byLang: Map<string, { translated: number; charsSource: number }>;
}

export function aggregateRunMetrics(entries: RunMetricsEntry[]): ReportAggregate {
  const agg: ReportAggregate = {
    runs: 0,
    translated: 0,
    failed: 0,
    calls: 0,
    charsSource: 0,
    charsTranslated: 0,
    costUsd: 0,
    receiptsSeen: 0,
    deeplEquivalentUsd: 0,
    byLang: new Map(),
  };
  for (const entry of entries) {
    agg.runs += 1;
    agg.translated += entry.translated;
    agg.failed += entry.failed;
    agg.calls += entry.calls;
    agg.charsSource += entry.chars_source;
    agg.charsTranslated += entry.chars_translated;
    if (typeof entry.cost_usd === 'number') {
      agg.costUsd += entry.cost_usd;
      agg.receiptsSeen += 1;
    }
    const lang = agg.byLang.get(entry.lang) ?? { translated: 0, charsSource: 0 };
    lang.translated += entry.translated;
    lang.charsSource += entry.chars_source;
    agg.byLang.set(entry.lang, lang);
  }
  agg.deeplEquivalentUsd = (agg.charsSource / 1_000_000) * DEEPL_USD_PER_MILLION_CHARS;
  return agg;
}

export function formatReport(agg: ReportAggregate, header: string): string {
  const lines: string[] = [header];
  if (agg.runs === 0) {
    lines.push('  no translate runs recorded in this window');
    return lines.join('\n');
  }
  lines.push(
    `  runs: ${agg.runs} · strings translated: ${agg.translated} (failed: ${agg.failed}) · agent calls: ${agg.calls}`,
  );
  lines.push(
    `  volume: ${agg.charsSource.toLocaleString('en-US')} source chars → ${agg.charsTranslated.toLocaleString('en-US')} translated chars`,
  );
  for (const [lang, l] of agg.byLang) {
    lines.push(`    [${lang}] ${l.translated} strings, ${l.charsSource.toLocaleString('en-US')} chars`);
  }
  const spend =
    agg.receiptsSeen > 0
      ? `$${agg.costUsd.toFixed(4)} (claude -p receipts; ~$0 marginal on a subscription)`
      : 'no receipts recorded';
  lines.push(`  spend: ${spend}`);
  lines.push(
    `  DeepL API equivalent for the same volume: ~$${agg.deeplEquivalentUsd.toFixed(2)} (@ $${DEEPL_USD_PER_MILLION_CHARS}/M chars)`,
  );
  return lines.join('\n');
}
