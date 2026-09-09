import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const { runStatus } = await import('../dist/commands/status.js');

function captureStatus(root, args = []) {
  const lines = [];
  const original = console.log;
  console.log = (...parts) => {
    lines.push(parts.join(' '));
  };
  try {
    return { code: runStatus(root, args), output: lines.join('\n') };
  } finally {
    console.log = original;
  }
}

describe('runStatus', () => {
  it('prints sync overview and android structural summary by language', () => {
    const root = mkdtempSync(join(tmpdir(), 'i18n-agent-status-'));
    mkdirSync(join(root, 'locales', 'en'), { recursive: true });
    mkdirSync(join(root, 'locales', 'fr'), { recursive: true });
    writeFileSync(
      join(root, 'locales', 'en', 'common.json'),
      JSON.stringify({
        docs: '{count, plural, one {# document} other {# documents}}',
        invite: '%1$s invited you to join their team.',
      }),
    );
    writeFileSync(
      join(root, 'locales', 'fr', 'common.json'),
      JSON.stringify({
        docs: '{count, plural, one {# document} other {# documents}}',
        invite: '%1$s vous a invité à rejoindre %2$s.',
      }),
    );
    writeFileSync(
      join(root, 'i18n-agent.config.yaml'),
      `source: en
targets: [fr]
locales: locales
exports:
  - platform: android
    namespaces: [common]
`,
    );
    const { code, output } = captureStatus(root, ['--platform', 'android']);
    assert.equal(code, 0);
    assert.match(output, /\[fr\] ok:/);
    assert.match(output, /Android structural check:/);
    assert.match(output, /\[fr\] \d+ structural issue\(s\)/);
    assert.match(output, /plural|placeholder/);
  });
});
