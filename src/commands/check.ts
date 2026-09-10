import { loadConfig } from '../config.js';
import { computeSync } from '../sync.js';
import {
  formatAndroidCheckIssues,
  runAndroidStructuralCheck,
  runMaskMarkerCheck,
} from '../validators/android-check.js';

export interface CheckOptions {
  platformAndroid?: boolean;
}

function parseCheckArgs(args: string[]): CheckOptions {
  const options: CheckOptions = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--platform' && args[i + 1] === 'android') {
      options.platformAndroid = true;
      i += 1;
    }
  }
  return options;
}

// CI gate: exit 1 when any target language drifted from the source —
// missing/stale machine translations, keys to prune or rename, or human
// translations whose source changed (review). `adopt` (recording pre-existing
// values into the lock) is not drift: the content on disk is already right.
//
// With `--platform android`, also validates target strings against structural
// rules for Android exports: CLDR plural categories and format-arg parity (all
// platforms) plus Android `<annotation>` markup when present in source.
export function runCheck(cwd: string, args: string[] = []): number {
  const options = parseCheckArgs(args);
  const config = loadConfig(cwd);
  const state = computeSync(config);

  let failed = false;

  for (const [lang, counts] of state.countsByLang) {
    const drift = counts.translate + counts.retranslate + counts.rename + counts.prune + counts.review;
    if (drift === 0) {
      console.log(`[${lang}] in sync`);
      continue;
    }
    failed = true;
    const parts: string[] = [];
    if (counts.translate > 0) parts.push(`${counts.translate} missing`);
    if (counts.retranslate > 0) parts.push(`${counts.retranslate} stale`);
    if (counts.rename > 0) parts.push(`${counts.rename} renamed`);
    if (counts.prune > 0) parts.push(`${counts.prune} orphaned`);
    if (counts.review > 0) parts.push(`${counts.review} awaiting review`);
    console.log(`[${lang}] OUT OF SYNC: ${parts.join(', ')}`);
  }

  if (failed) {
    console.log('\nRun `i18n-agent translate` to sync (reviews need a human — see `i18n-agent translate --review`).');
  } else {
    console.log('All locales in sync.');
  }

  const maskIssues = runMaskMarkerCheck(config);
  if (maskIssues.length > 0) {
    failed = true;
    console.log(`\nAnnotation mask check: ${maskIssues.length} issue(s)`);
    for (const line of formatAndroidCheckIssues(maskIssues)) {
      console.log(`  ${line}`);
    }
  }

  if (options.platformAndroid) {
    const issues = runAndroidStructuralCheck(config);
    if (issues.length === 0) {
      console.log('Android structural check: OK');
    } else {
      failed = true;
      console.log(`\nAndroid structural check: ${issues.length} issue(s)`);
      for (const line of formatAndroidCheckIssues(issues)) {
        console.log(`  ${line}`);
      }
    }
  }

  return failed ? 1 : 0;
}
