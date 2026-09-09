import { loadConfig } from '../config.js';
import { computeSync } from '../sync.js';
import { runAndroidStructuralCheck } from '../validators/android-check.js';
import {
  formatStructuralSummaryLine,
  summarizeStructuralIssuesByLang,
} from '../validators/structural-summary.js';

export interface StatusOptions {
  platformAndroid?: boolean;
}

function parseStatusArgs(args: string[]): StatusOptions {
  const options: StatusOptions = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--platform' && args[i + 1] === 'android') {
      options.platformAndroid = true;
      i += 1;
    }
  }
  return options;
}

export function runStatus(cwd: string, args: string[] = []): number {
  const options = parseStatusArgs(args);
  const config = loadConfig(cwd);
  const state = computeSync(config);

  let totalStrings = 0;
  for (const flat of state.sourceFlat.values()) {
    for (const value of flat.values()) {
      if (typeof value === 'string' && value !== '') {
        totalStrings += 1;
      }
    }
  }

  console.log(
    `source: ${config.source} · ${state.namespaces.length === 1 && state.namespaces[0] === '' ? 'flat layout' : `${state.namespaces.length} namespace(s)`} · ${totalStrings} translatable strings`,
  );
  for (const [lang, c] of state.countsByLang) {
    const ok = c.keep + c.adopt + c.rename;
    console.log(
      `[${lang}] ok: ${ok} (human-owned incl.) · missing: ${c.translate} · stale: ${c.retranslate} · review: ${c.review} · orphans: ${c.prune}`,
    );
  }
  if (state.reviews.length > 0) {
    console.log(`\n${state.reviews.length} key(s) await review — \`i18n-agent translate --review\`.`);
  }

  if (options.platformAndroid) {
    const issues = runAndroidStructuralCheck(config);
    const byLang = summarizeStructuralIssuesByLang(issues);
    console.log('\nAndroid structural check:');
    if (byLang.size === 0) {
      console.log('  OK — no CLDR plural, format-arg, or annotation issues');
    } else {
      for (const [lang, summary] of [...byLang.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        console.log(`  ${formatStructuralSummaryLine(lang, summary)}`);
      }
      console.log(`  total: ${issues.length} issue(s) — run \`i18n-agent check --platform android\` for details`);
    }
  }

  return 0;
}
