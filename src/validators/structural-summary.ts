import type { AndroidCheckIssue, AndroidCheckKind } from './android-check.js';

export interface StructuralIssueSummary {
  plural: number;
  placeholder: number;
  markup: number;
  total: number;
}

export function summarizeStructuralIssuesByLang(
  issues: AndroidCheckIssue[],
): Map<string, StructuralIssueSummary> {
  const byLang = new Map<string, StructuralIssueSummary>();

  for (const issue of issues) {
    const lang = issue.lang;
    const row = byLang.get(lang) ?? { plural: 0, placeholder: 0, markup: 0, total: 0 };
    row[issue.kind as AndroidCheckKind] += 1;
    row.total += 1;
    byLang.set(lang, row);
  }

  return byLang;
}

export function formatStructuralSummaryLine(lang: string, summary: StructuralIssueSummary): string {
  const parts: string[] = [];
  if (summary.plural > 0) {
    parts.push(`${summary.plural} plural`);
  }
  if (summary.placeholder > 0) {
    parts.push(`${summary.placeholder} placeholder`);
  }
  if (summary.markup > 0) {
    parts.push(`${summary.markup} markup`);
  }
  const breakdown = parts.length > 0 ? ` (${parts.join(', ')})` : '';
  return `[${lang}] ${summary.total} structural issue(s)${breakdown}`;
}
