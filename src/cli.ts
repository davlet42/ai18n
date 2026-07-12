#!/usr/bin/env node
import { runInit } from './commands/init.js';
import { runTranslate } from './commands/translate.js';
import { runCheck } from './commands/check.js';
import { runStatus } from './commands/status.js';
import { runAddLocale } from './commands/add-locale.js';
import { runReport } from './commands/report.js';

const args = process.argv.slice(2);
const command = args[0];

function printHelp(): void {
  console.log(`ai18n — locale files translated by the coding-agent subscription you already pay for

Usage:
  ai18n init [--locales <dir>] [--source <lang>]     detect layout, write config + templates
  ai18n translate [--dry-run] [--review] [--retranslate-stale] [--lang <l>]…
  ai18n check                                        CI gate: exit 1 when locales drift
  ai18n status                                       per-language sync overview
  ai18n add-locale <lang> [<lang>…] [--translate]    add target languages
  ai18n report [--days 7] [--all]                    volumes, spend receipts, DeepL-API equivalent

Files: ai18n.config.yaml · ai18n.context.yaml (translator hints) · ai18n.glossary.yaml · ai18n.lock
Docs:  https://github.com/davlet42/ai18n
`);
}

async function main(): Promise<void> {
  const cwd = process.cwd();
  switch (command) {
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      return;
    case 'init':
      process.exitCode = runInit(cwd, args.slice(1));
      return;
    case 'translate':
      process.exitCode = await runTranslate(cwd, args.slice(1));
      return;
    case 'check':
      process.exitCode = runCheck(cwd);
      return;
    case 'status':
      process.exitCode = runStatus(cwd);
      return;
    case 'add-locale':
      process.exitCode = await runAddLocale(cwd, args.slice(1));
      return;
    case 'report':
      process.exitCode = runReport(cwd, args.slice(1));
      return;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
