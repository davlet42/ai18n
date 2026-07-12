import { loadConfig } from '../config.js';
import { computeSync } from '../sync.js';

// CI gate: exit 1 when any target language drifted from the source —
// missing/stale machine translations, keys to prune or rename, or human
// translations whose source changed (review). `adopt` (recording pre-existing
// values into the lock) is not drift: the content on disk is already right.
export function runCheck(cwd: string): number {
  const config = loadConfig(cwd);
  const state = computeSync(config);

  let drifted = false;
  for (const [lang, counts] of state.countsByLang) {
    const drift = counts.translate + counts.retranslate + counts.rename + counts.prune + counts.review;
    if (drift === 0) {
      console.log(`[${lang}] in sync`);
      continue;
    }
    drifted = true;
    const parts: string[] = [];
    if (counts.translate > 0) parts.push(`${counts.translate} missing`);
    if (counts.retranslate > 0) parts.push(`${counts.retranslate} stale`);
    if (counts.rename > 0) parts.push(`${counts.rename} renamed`);
    if (counts.prune > 0) parts.push(`${counts.prune} orphaned`);
    if (counts.review > 0) parts.push(`${counts.review} awaiting review`);
    console.log(`[${lang}] OUT OF SYNC: ${parts.join(', ')}`);
  }

  if (drifted) {
    console.log('\nRun `i18n-agent translate` to sync (reviews need a human — see `i18n-agent translate --review`).');
    return 1;
  }
  console.log('All locales in sync.');
  return 0;
}
