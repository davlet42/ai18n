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

export { runExport, parseExports, parseAndroidExportOptions, selectNamespaces, androidOptionsFromConfig, EXPORT_PLATFORMS } from './commands/export.js';
export { runImport, IMPORT_PLATFORMS } from './commands/import.js';
export { parseAndroidStringsXml, androidLangFromValuesDir } from './importers/android-xml-import.js';
export { parseXcstrings } from './importers/xcstrings-import.js';
export type { ExportEntry, ExportPlatform, AndroidExportOptions } from './commands/export.js';
export { emitAndroidXml, androidResourceName, escapeAndroid } from './exporters/android.js';
export type { AndroidEmitOptions } from './exporters/android.js';
export { emitXcstrings } from './exporters/xcstrings.js';
export { emitTsKeys } from './exporters/simple.js';
export { collectArgOrder, toPositional, findIcuMessage } from './exporters/transform.js';

export {
  cldrPluralCategoriesForLocale,
  CLDR_PLURAL_CATEGORIES_BY_LOCALE,
  ANDROID_CLDR_PLURAL_CATEGORIES,
  normalizePluralCategoryName,
} from './cldr-plural-rules.js';
export { validateCldrPlural, validateCldrPluralPair } from './validators/cldr-plural.js';
export { validateDuplicatePluralCategories } from './validators/cldr-plural-duplicate.js';
export {
  summarizeStructuralIssuesByLang,
  formatStructuralSummaryLine,
} from './validators/structural-summary.js';
export type { StructuralIssueSummary } from './validators/structural-summary.js';
export { expandPluralCategories, expandPluralCategoriesIfNeeded } from './plural-expand.js';
export {
  extractPrintfArgs,
  validatePrintfArgs,
  formatPrintfRetryHint,
} from './printf-args.js';
export type { PrintfValidation } from './printf-args.js';
export { extractFormatArgs, validateFormatArgSet } from './validators/placeholder-set.js';
export {
  extractAnnotationTags,
  validateAndroidMarkup,
  validateAnnotationMaskMarkers,
  hasAnnotationMaskMarkers,
  hasAndroidAnnotationMarkup,
  maskAndroidMarkup,
  unmaskAndroidMarkup,
  escapeAndroidForResources,
} from './android-markup.js';
export type { AndroidMarkupMask } from './android-markup.js';
export { validateAndroidPlural, validateAndroidPluralPair } from './validators/android-plural.js';
export {
  runAndroidStructuralCheck,
  runMaskMarkerCheck,
  formatAndroidCheckIssues,
} from './validators/android-check.js';
export {
  createBatchTransport,
  cursorCliTransport,
  parseTranslateProvider,
  resolveTranslateProvider,
  resolveTranslateModel,
  providerLabel,
} from './translate-provider.js';
export type { TranslateProvider } from './translate-provider.js';
export { sourceMatchesGlossary, parseGlossarySearchTerms, readGlossaryFileSha } from './glossary-match.js';
export type { AndroidCheckIssue, AndroidCheckKind, AndroidCheckOptions } from './validators/android-check.js';

export { buildBundle, BundleReader, BUNDLE_MANIFEST } from './bundle.js';
export type { BundleManifest, BundleManifestFile, BuildBundleResult, BundleReaderOptions, BundleFile } from './bundle.js';
