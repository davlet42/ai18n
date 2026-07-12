export {
  detectLayout,
  listNamespaces,
  localeFilePath,
  readLocaleTree,
  writeLocaleTree,
  flattenTree,
  buildTargetTree,
  FLAT_NS,
} from './locale-files.js';
export type { Leaf, LocaleTree, LocaleLayout, LocaleExt } from './locale-files.js';

export {
  sha256,
  keyId,
  readLockfile,
  writeLockfile,
  recordTranslation,
  recordHumanValue,
  pruneKey,
} from './lockfile.js';
export type { Lockfile, LockEntry, LockTarget } from './lockfile.js';

export { planNamespace, countPlan } from './planner.js';
export type { KeyAction, NamespacePlan, PlanCounts } from './planner.js';

export { extractPlaceholderSignature, validatePlaceholders } from './placeholders.js';
export type { PlaceholderValidation } from './placeholders.js';

export {
  translateBatch,
  chunkItems,
  buildSystemPrompt,
  claudeCliTransport,
} from './translate-batch.js';
export type {
  BatchItem,
  BatchTransport,
  TranslateBatchOptions,
  TranslateBatchResult,
} from './translate-batch.js';

export { loadConfig, findConfigPath, CONFIG_NAMES } from './config.js';
export type { I18nAgentConfig } from './config.js';

export { loadContextMap, loadGlossaryTerms } from './context-glossary.js';

export { computeSync, applySync } from './sync.js';
export type { SyncState, ApplySyncOptions, ApplySyncResult, ReviewItem } from './sync.js';

export {
  i18nAgentHome,
  metricsPath,
  appendRunMetrics,
  readRunMetrics,
  aggregateRunMetrics,
  formatReport,
  DEEPL_USD_PER_MILLION_CHARS,
} from './metrics.js';
export type { RunMetricsEntry, ReportAggregate } from './metrics.js';

export { runExport, parseExports, EXPORT_PLATFORMS } from './commands/export.js';
export type { ExportEntry, ExportPlatform } from './commands/export.js';
export { emitAndroidXml, androidResourceName, escapeAndroid } from './exporters/android.js';
export { emitXcstrings } from './exporters/xcstrings.js';
export { emitTsKeys } from './exporters/simple.js';
export { collectArgOrder, toPositional, findIcuMessage } from './exporters/transform.js';

export { buildBundle, BundleReader, BUNDLE_MANIFEST } from './bundle.js';
export type { BundleManifest, BundleManifestFile, BuildBundleResult } from './bundle.js';
