import { findConfigPath } from '../config.js';
import { aggregateRunMetrics, formatReport, readRunMetrics } from '../metrics.js';
import { dirname } from 'node:path';

export function runReport(cwd: string, args: string[]): number {
  const daysIdx = args.indexOf('--days');
  const days = daysIdx !== -1 ? Number(args[daysIdx + 1]) : 7;
  if (!Number.isFinite(days) || days <= 0) {
    console.error('report: --days expects a positive number');
    return 1;
  }
  const all = args.includes('--all');

  let project: string | undefined;
  if (!all) {
    const configPath = findConfigPath(cwd);
    if (configPath) {
      project = dirname(configPath).split('/').pop();
    }
  }

  const entries = readRunMetrics({ days, project });
  const scope = all ? 'all projects' : `project "${project ?? '<none>'}"`;
  console.log(formatReport(aggregateRunMetrics(entries), `ai18n report — last ${days} day(s), ${scope}`));
  if (!all && entries.length === 0) {
    console.log('  (tip: `ai18n report --all` shows every project)');
  }
  return 0;
}
