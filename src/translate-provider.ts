import { runCursorAgent } from '@cursor-translate/core';
import { claudeCliTransport, type BatchTransport } from './translate-batch.js';

export type TranslateProvider = 'claude-cli' | 'cursor-cli';

const CURSOR_DEFAULT_MODEL = 'composer-2.5';

export function parseTranslateProvider(value: string | undefined | null): TranslateProvider | null {
  if (value === 'claude-cli' || value === 'anthropic' || value === 'claude') {
    return 'claude-cli';
  }
  if (value === 'cursor-cli' || value === 'cursor') {
    return 'cursor-cli';
  }
  return null;
}

export function resolveTranslateProvider(configProvider?: string): TranslateProvider {
  return (
    parseTranslateProvider(configProvider) ??
    parseTranslateProvider(process.env.I18N_AGENT_PROVIDER) ??
    parseTranslateProvider(process.env.CURSOR_TRANSLATE_PROVIDER) ??
    'claude-cli'
  );
}

export function resolveTranslateModel(provider: TranslateProvider, configModel?: string): string | undefined {
  if (configModel) {
    return configModel;
  }
  const fromEnv = process.env.I18N_AGENT_MODEL;
  if (fromEnv) {
    return fromEnv;
  }
  if (provider === 'cursor-cli') {
    return process.env.CURSOR_TRANSLATE_MODEL ?? CURSOR_DEFAULT_MODEL;
  }
  return undefined;
}

export function cursorCliTransport(options: { model?: string } = {}): BatchTransport {
  const model = options.model ?? CURSOR_DEFAULT_MODEL;
  return async ({ system, user }) => {
    const result = runCursorAgent({
      args: ['--mode', 'ask', '--model', model],
      prompt: `${system}\n\nStrings:\n\n${user}`,
    });
    if (result.exitCode !== 0) {
      throw new Error(`cursor agent exited ${result.exitCode}: ${result.stderr.trim() || 'unknown error'}`);
    }
    const text = result.stdout.trim();
    if (!text) {
      throw new Error('cursor agent returned empty translation');
    }
    return { text };
  };
}

export function createBatchTransport(provider: TranslateProvider, model?: string): BatchTransport {
  if (provider === 'cursor-cli') {
    return cursorCliTransport({ model });
  }
  return claudeCliTransport({ model });
}

export function providerLabel(provider: TranslateProvider): string {
  return provider === 'cursor-cli' ? 'cursor agent' : 'claude -p';
}
