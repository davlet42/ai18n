import { loadConfig } from '../config.js';
import { computeSync } from '../sync.js';

export function runStatus(cwd: string): number {
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
    console.log(`\n${state.reviews.length} key(s) await review — \`ai18n translate --review\`.`);
  }
  return 0;
}
