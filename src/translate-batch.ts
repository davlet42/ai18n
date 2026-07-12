import { translateTextClaudeCli } from '@cursor-translate/core';
import { validatePlaceholders } from './placeholders.js';

// Batch translation of UI strings through an injectable transport. The default
// transport is the subscription agent (`claude -p`, cheap tier) via
// @cursor-translate/core — no API keys. Tests inject fakes.
//
// Robustness ladder per call:
//   1. response must be a JSON object with every requested id → one corrective
//      retry on parse failure / missing ids;
//   2. every translation must pass the placeholder guard → one corrective
//      retry for the violating items only, with the expected tokens spelled
//      out; a second violation marks the item failed (caller keeps the source
//      text and reports).

export interface BatchItem {
  id: string;
  text: string;
  context?: string;
}

export type BatchTransport = (call: { system: string; user: string }) => Promise<string>;

export interface TranslateBatchOptions {
  sourceLang: string;
  targetLang: string;
  glossaryTerms?: string[];
  transport?: BatchTransport;
  model?: string;
  maxItemsPerCall?: number;
  maxCharsPerCall?: number;
}

export interface TranslateBatchResult {
  translations: Map<string, string>;
  failed: { id: string; reason: string }[];
  calls: number;
}

export function buildSystemPrompt(options: TranslateBatchOptions): string {
  const glossary =
    options.glossaryTerms && options.glossaryTerms.length > 0
      ? `\nGlossary (follow strictly; "term = translation" pins a translation, a bare term must stay untranslated):\n${options.glossaryTerms.map((t) => `- ${t}`).join('\n')}\n`
      : '';
  return `You translate user-interface strings from ${options.sourceLang} to ${options.targetLang}.

Rules:
- Respond with ONLY a JSON object mapping every input id to its translation. No commentary, no code fences.
- Preserve EVERY placeholder exactly as in the source: {var}, {{var}}, printf (%s, %1$s, %(name)s), $t(...) references, HTML tags such as <b>, </b>, <0>, <br/>.
- ICU messages ({var, plural, ...} / {var, select, ...}): keep the variable, keyword and category names untouched; translate only the human text inside category bodies; keep every # as is.
- Translations must sound natural and terse, appropriate for UI labels, buttons and messages.
- A "context" field, when present, describes where the string is used — follow it.
${glossary}`;
}

function buildUserPrompt(items: BatchItem[]): string {
  const payload = items.map(({ id, text, context }) =>
    context ? { id, text, context } : { id, text },
  );
  return `Translate these strings. Return a JSON object: { "<id>": "<translation>", ... }\n\n${JSON.stringify(payload, null, 2)}`;
}

export function chunkItems(items: BatchItem[], maxItems: number, maxChars: number): BatchItem[][] {
  const chunks: BatchItem[][] = [];
  let current: BatchItem[] = [];
  let chars = 0;
  for (const item of items) {
    const size = item.text.length + (item.context?.length ?? 0);
    if (current.length > 0 && (current.length >= maxItems || chars + size > maxChars)) {
      chunks.push(current);
      current = [];
      chars = 0;
    }
    current.push(item);
    chars += size;
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  let text = raw.trim();
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) {
    text = fence[1].trim();
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  return null;
}

export function claudeCliTransport(options: { model?: string } = {}): BatchTransport {
  return async ({ system, user }) => {
    const result = translateTextClaudeCli(user, {
      systemPrompt: system,
      glossaryTerms: [], // the glossary lives in our own system prompt
      model: options.model,
      contentLabel: 'Strings',
      maxChunkChars: 1_000_000, // never let the markdown splitter touch our JSON payload
      allowFallback: false,
    });
    if (result.quotaExhausted) {
      throw new Error('quota_exhausted');
    }
    return result.text;
  };
}

async function requestTranslations(
  transport: BatchTransport,
  system: string,
  items: BatchItem[],
  state: { calls: number },
): Promise<Record<string, unknown> | null> {
  const user = buildUserPrompt(items);
  state.calls += 1;
  let parsed = parseJsonObject(await transport({ system, user }));

  const complete = (obj: Record<string, unknown> | null): boolean =>
    !!obj && items.every((item) => typeof obj[item.id] === 'string');

  if (!complete(parsed)) {
    state.calls += 1;
    const corrective = `${user}\n\nYour previous response was not a valid JSON object containing every id. Respond again with ONLY the JSON object, one entry per id.`;
    parsed = parseJsonObject(await transport({ system, user: corrective }));
  }
  return parsed;
}

export async function translateBatch(
  items: BatchItem[],
  options: TranslateBatchOptions,
): Promise<TranslateBatchResult> {
  const transport = options.transport ?? claudeCliTransport({ model: options.model });
  const system = buildSystemPrompt(options);
  const result: TranslateBatchResult = { translations: new Map(), failed: [], calls: 0 };
  if (items.length === 0) {
    return result;
  }

  const chunks = chunkItems(items, options.maxItemsPerCall ?? 40, options.maxCharsPerCall ?? 3000);

  for (const chunk of chunks) {
    let parsed: Record<string, unknown> | null;
    try {
      parsed = await requestTranslations(transport, system, chunk, result);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      for (const item of chunk) {
        result.failed.push({ id: item.id, reason });
      }
      continue;
    }

    const violations: BatchItem[] = [];
    for (const item of chunk) {
      const translated = parsed?.[item.id];
      if (typeof translated !== 'string' || translated.trim() === '') {
        result.failed.push({ id: item.id, reason: 'missing_in_response' });
        continue;
      }
      const check = validatePlaceholders(item.text, translated);
      if (check.ok) {
        result.translations.set(item.id, translated);
      } else {
        violations.push({
          ...item,
          context: `${item.context ? `${item.context}. ` : ''}PLACEHOLDER ERROR in your previous attempt — the translation MUST contain exactly these tokens: ${[...check.missing, ...check.extra].join(' ')}`,
        });
      }
    }

    if (violations.length > 0) {
      let retryParsed: Record<string, unknown> | null = null;
      try {
        retryParsed = await requestTranslations(transport, system, violations, result);
      } catch {
        retryParsed = null;
      }
      for (const item of violations) {
        const translated = retryParsed?.[item.id];
        const original = items.find((i) => i.id === item.id)!;
        if (
          typeof translated === 'string' &&
          translated.trim() !== '' &&
          validatePlaceholders(original.text, translated).ok
        ) {
          result.translations.set(item.id, translated);
        } else {
          result.failed.push({ id: item.id, reason: 'placeholder_violation' });
        }
      }
    }
  }

  return result;
}
