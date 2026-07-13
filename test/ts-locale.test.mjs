import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const { loadConfig, computeSync, applySync, detectLayout, readLocaleTree } = await import('../dist/index.js');
const { parseTsLocaleModule, serializeTsLocaleModule } = await import('../dist/ts-module-locale.js');

describe('parseTsLocaleModule', () => {
  it('parses a typed TS locale module with comments, trailing commas and nesting', () => {
    const raw = `// authored locale
export default {
  greet: 'Hello {name}!',
  'kebab-key': "double quoted",
  nested: {
    deep: \`backtick text\`,
    count: 5,
    flag: true,
    nothing: null,
  },
  list: ['a', 'b'],
} as const;
`;
    const tree = parseTsLocaleModule(raw, 'en.ts');
    assert.equal(tree.greet, 'Hello {name}!');
    assert.equal(tree['kebab-key'], 'double quoted');
    assert.equal(tree.nested.deep, 'backtick text');
    assert.equal(tree.nested.count, 5);
    assert.deepEqual(tree.list, ['a', 'b']);
  });

  it('is not confused by `as const` or `satisfies` inside translated text', () => {
    const raw = `export default {
  a: 'this value says as const and } too',
  b: 'and this one satisfies the reviewer',
  c: ['x'] as const,
} as const satisfies Record<string, unknown>;
`;
    const tree = parseTsLocaleModule(raw, 'en.ts');
    assert.equal(tree.a, 'this value says as const and } too');
    assert.equal(tree.b, 'and this one satisfies the reviewer');
    assert.deepEqual(tree.c, ['x']);
  });

  it('rejects template interpolation, imports feeding the object, and non-objects', () => {
    assert.throws(
      () => parseTsLocaleModule('export default { a: `hi ${name}` };', 'en.ts'),
      /Template interpolation/,
    );
    assert.throws(
      () => parseTsLocaleModule("import { x } from './x';\nexport default { a: x };", 'en.ts'),
      /self-contained/,
    );
    assert.throws(() => parseTsLocaleModule('const a = 1;', 'en.ts'), /No `export default`/);
    assert.throws(() => parseTsLocaleModule('export default 42;', 'en.ts'), /object literal/);
  });

  it('roundtrips through the serializer', () => {
    const tree = {
      greet: "it's {name}",
      'multi\nline': 'a\nb',
      nested: { keep: 1, list: ['x', 'y'], empty: {} },
    };
    const raw = serializeTsLocaleModule(tree);
    assert.ok(raw.startsWith('export default {'));
    assert.ok(raw.trimEnd().endsWith('} as const;'));
    assert.deepEqual(parseTsLocaleModule(raw, 'ru.ts'), tree);
  });
});

function setupTsProject() {
  const root = mkdtempSync(join(tmpdir(), 'i18n-agent-ts-'));
  mkdirSync(join(root, 'locales', 'en'), { recursive: true });
  writeFileSync(
    join(root, 'locales', 'en', 'common.ts'),
    "export default {\n  greet: 'Hello {name}!',\n  bye: 'Bye',\n} as const;\n",
  );
  writeFileSync(join(root, 'locales', 'en', 'i18n-keys.d.ts'), 'export type K = string;\n');
  writeFileSync(
    join(root, 'i18n-agent.config.yaml'),
    'source: en\ntargets: [ru]\nlocales: locales\n',
  );
  return root;
}

describe('TS-module locale layout end-to-end', () => {
  it('detects the layout, skips .d.ts, translates and writes TS targets', async () => {
    const root = setupTsProject();
    const config = loadConfig(root);

    const layout = detectLayout(config.localesDir, 'en');
    assert.equal(layout.ext, 'ts');
    assert.equal(layout.kind, 'namespaces');

    const counter = { calls: 0 };
    const transport = async (call) => {
      counter.calls += 1;
      const payload = JSON.parse(call.user.slice(call.user.indexOf('[')));
      return JSON.stringify(Object.fromEntries(payload.map((i) => [i.id, `[ru] ${i.text}`])));
    };

    const result = await applySync(config, computeSync(config), { transport });
    assert.ok(result.translated > 0);

    const ruPath = join(root, 'locales', 'ru', 'common.ts');
    const ruRaw = readFileSync(ruPath, 'utf8');
    assert.ok(ruRaw.startsWith('export default {'), 'target is a TS module');
    const ruTree = readLocaleTree(layout, 'ru', 'common');
    assert.equal(ruTree.greet, '[ru] Hello {name}!');
    assert.equal(ruTree.bye, '[ru] Bye');

    // second run: lockfile says everything is in sync — zero calls
    const before = counter.calls;
    await applySync(config, computeSync(config), { transport });
    assert.equal(counter.calls, before, 'repeat run makes no translator calls');
  });
});
