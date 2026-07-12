import { loadConfig } from '../config.js';
import { applySync, computeSync } from '../sync.js';

function collectLangFlags(args: string[]): string[] | undefined {
  const langs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--lang' && args[i + 1]) {
      langs.push(args[i + 1]);
    }
  }
  return langs.length > 0 ? langs : undefined;
}

export async function runTranslate(cwd: string, args: string[]): Promise<number> {
  const config = loadConfig(cwd);
  if (config.targets.length === 0) {
    console.log('No target languages configured — add some with `i18n-agent add-locale <lang>`.');
    return 0;
  }
  const state = computeSync(config);

  if (args.includes('--review')) {
    if (state.reviews.length === 0) {
      console.log('Nothing to review — no human-edited keys with changed sources.');
      return 0;
    }
    console.log(`Keys needing human review (${state.reviews.length}) — source changed after a manual edit:`);
    for (const r of state.reviews) {
      console.log(`\n  [${r.lang}] ${r.namespace ? `${r.namespace}:` : ''}${r.key}`);
      console.log(`    source now: ${r.sourceText}`);
      console.log(`    your value: ${r.currentValue}`);
    }
    console.log(
      '\nResolve by: editing the value by hand (the edit clears the review), `--accept-stale` (current values are still right), or `--retranslate-stale` (machine-translate anew).',
    );
    return 0;
  }

  if (args.includes('--dry-run')) {
    for (const [lang, counts] of state.countsByLang) {
      console.log(
        `[${lang}] translate: ${counts.translate + counts.retranslate}, rename-migrate: ${counts.rename}, prune: ${counts.prune}, review: ${counts.review}, up-to-date: ${counts.keep + counts.adopt + counts.copy}`,
      );
    }
    console.log('\nDry run — nothing written.');
    return 0;
  }

  const result = await applySync(config, state, {
    retranslateStale: args.includes('--retranslate-stale'),
    acceptStale: args.includes('--accept-stale'),
    langs: collectLangFlags(args),
  });

  console.log(
    `Translated ${result.translated} strings (${result.calls} agent calls) · renamed-migrated: ${result.migrated} · pruned: ${result.pruned} · files written: ${result.writtenFiles.length}`,
  );
  if (result.costUsd !== undefined) {
    console.log(`Spend receipts: $${result.costUsd.toFixed(4)} (claude -p; ~$0 marginal on a subscription) — see \`i18n-agent report\`.`);
  }
  if (result.failed.length > 0) {
    console.log(`\nFailed (${result.failed.length}) — source text shipped as fallback, will retry next run:`);
    for (const f of result.failed) {
      console.log(`  [${f.lang}] ${f.id}: ${f.reason}`);
    }
  }
  if (result.reviews.length > 0) {
    console.log(
      `\n${result.reviews.length} key(s) await human review (source changed after manual edits) — see \`i18n-agent translate --review\`.`,
    );
  }
  return result.failed.length > 0 ? 1 : 0;
}
