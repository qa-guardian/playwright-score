import { after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseForESLint } from '@typescript-eslint/parser';
import { createPostFilter } from '../src/eslint-postfilter.js';
import { createTriage } from '../src/finding-triage.js';
import { collectLocallyImportedFiles } from '../src/import-graph.js';
import { scorePaths } from '../src/index.js';
import { analyzeIsolated, startTimeLimit, type AnalysisInput } from '../src/isolate.js';
import { analyzeSource, extractHelperFacts, getTestSpans } from '../src/metrics.js';
import { clearParseCache, MAX_CACHED_TOKENS, parseAst, parseCacheStats, setParseCacheBudget, WORKER_MAX_CACHED_TOKENS } from '../src/parse-cache.js';
import { playwrightTies } from '../src/shared-files.js';
import { sourceTypeFor, SPEC_EXTENSION_RE } from '../src/source-type.js';
import { detectTestAliasNamesWithFactories } from '../src/test-aliases.js';
import type { Finding } from '../src/types.js';

// QAG-287 S5c: src/parse-cache.ts, the one entry point to the parser for this
// package's own syntax-tree checks. Each file is parsed once per thread.

function packageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'fixtures'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('package root not found');
}

const tmpDirs: string[] = [];
function suite(files: Record<string, string>): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-parse-')));
  tmpDirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}
after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});
beforeEach(() => {
  clearParseCache();
  setParseCacheBudget(MAX_CACHED_TOKENS);
});

/** Every source file under `dir`, sorted. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && SPEC_EXTENSION_RE.test(e.name)) out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

/** The parser options each reader passed before the cache existed. */
const base = (file: string) => ({
  ecmaVersion: 2022 as const,
  sourceType: sourceTypeFor(file),
  ecmaFeatures: { jsx: /\.(tsx|jsx)$/.test(file) },
});
const READER_OPTIONS: Array<[string, (file: string) => Parameters<typeof parseForESLint>[1]]> = [
  ['metrics, import-graph, test-aliases, finding-triage', (f) => base(f)],
  ['shared-files', (f) => ({ ...base(f), comment: true })],
  ['eslint-postfilter', (f) => ({ ...base(f), comment: true, loc: true, range: true })],
];

/** What a fresh parse gives: the tree, or the error's message. */
function fresh(source: string, file: string, options: Parameters<typeof parseForESLint>[1]): unknown {
  try {
    return parseForESLint(source, options).ast;
  } catch (e) {
    return `throws: ${(e as Error).message}`;
  }
}
function cached(source: string, file: string): unknown {
  try {
    return parseAst(source, file);
  } catch (e) {
    return `throws: ${(e as Error).message}`;
  }
}

const SPEC = `import { test, expect } from '@playwright/test';
import { openCart } from './support/cart';

test('cart shows the total', async ({ page }) => {
  await openCart(page);
  await page.waitForTimeout(500);
  await expect(page.getByTestId('total')).toHaveText('12.00');
});
`;
const HELPER = `import { expect, type Page } from '@playwright/test';

// opens the cart
export async function openCart(page: Page): Promise<void> {
  await page.goto('/cart');
  await expect(page.getByRole('heading', { name: 'Cart' })).toBeVisible();
}
`;
const BROKEN = `import { test } from '@playwright/test';\ntest('broken', async ({ page }) => {\n  await page.goto('/'\n});\n`;

const INLINE: Record<string, string> = {
  'view.spec.tsx': `import { test, expect } from '@playwright/experimental-ct-react';\n/** @type {number} */\nconst n = 1;\ntest('renders', async ({ mount }) => {\n  const c = await mount(<button title="x">ok</button>);\n  await expect(c).toContainText('ok');\n});\n`,
  'cast.spec.ts': `import { test, expect } from '@playwright/test';\nconst v = <number>(1 as unknown);\ntest('cast', async ({ page }) => { await expect(page).toHaveTitle(String(v)); });\n`,
  'legacy.spec.cjs': `const { test, expect } = require('@playwright/test');\ntest('legacy', async ({ page }) => {\n  await expect(page).toHaveTitle('x'); // trailing\n});\n`,
  'legacy.spec.cts': `import pw = require('@playwright/test');\npw.test('legacy', async ({ page }) => { await pw.expect(page).toHaveTitle('x'); });\n`,
  'module.spec.mjs': `import { test, expect } from '@playwright/test';\ntest('m', async ({ page }) => { await expect(page).toHaveTitle('x'); });\n`,
  'module.spec.mts': `import { test, expect } from '@playwright/test';\ntest('m', async ({ page }) => { await expect(page).toHaveTitle('x' satisfies string); });\n`,
  'view.spec.jsx': `import { test } from '@playwright/experimental-ct-react';\ntest('renders', async ({ mount }) => { await mount(<p>hi</p>); });\n`,
  'broken.spec.ts': BROKEN,
  'empty.spec.ts': '',
};

describe('QAG-287 S5c: the cached tree is the tree each reader parsed before', () => {
  it('every fixture file and every module flavour: deep-equal to a fresh parse with each reader\'s options', () => {
    const root = packageRoot();
    const samples: Array<[string, string]> = Object.entries(INLINE).map(([name, src]) => [path.join('/inline', name), src]);
    for (const dir of [path.join(root, 'fixtures'), path.join(root, 'tests', 'fixtures')]) {
      for (const file of sourceFiles(dir)) samples.push([file, fs.readFileSync(file, 'utf8')]);
    }
    assert.ok(samples.length > 300, `only ${samples.length} samples`);
    let threw = 0;
    for (const [file, source] of samples) {
      const fromCache = cached(source, file);
      if (typeof fromCache === 'string') threw++;
      for (const [reader, options] of READER_OPTIONS) {
        assert.deepStrictEqual(fromCache, fresh(source, file, options(file)), `${reader}: ${path.basename(file)}`);
      }
      clearParseCache();
    }
    assert.ok(threw >= 1, 'no sample that does not parse');
  });
});

describe('QAG-287 S5c: the key is the path, the text and the options', () => {
  it('the same file read again: the same tree object, one parse', () => {
    const before = parseCacheStats();
    const a = parseAst(SPEC, '/s/a.spec.ts');
    assert.equal(parseAst(SPEC, '/s/a.spec.ts'), a);
    const now = parseCacheStats();
    assert.equal(now.misses - before.misses, 1);
    assert.equal(now.hits - before.hits, 1);
  });

  it('two files with the same text at different paths never share a tree object', () => {
    const a = parseAst(SPEC, '/s/a/login.spec.ts');
    const b = parseAst(SPEC, '/s/b/login.spec.ts');
    assert.notEqual(a, b);
    assert.deepStrictEqual(a, b);
    assert.equal(parseAst(SPEC, '/s/a/login.spec.ts'), a);
    assert.equal(parseAst(SPEC, '/s/b/login.spec.ts'), b);
    assert.equal(parseCacheStats().entries, 2);
  });

  it('the same path with another text: parsed again, and the old tree is dropped', () => {
    const a = parseAst(SPEC, '/s/a.spec.ts');
    const b = parseAst(SPEC + '\n// edited\n', '/s/a.spec.ts');
    assert.notEqual(a, b);
    assert.equal(b.comments?.length, 1);
    assert.equal(parseCacheStats().entries, 1);
    assert.notEqual(parseAst(SPEC, '/s/a.spec.ts'), a);
  });

  it('the same text under an extension that parses differently: its own tree', () => {
    const source = `const v = <T>(x);\n`;
    assert.equal(cached(source, '/s/v.ts') === cached(source, '/s/v.tsx'), false);
    assert.equal(typeof cached(source, '/s/v.ts'), 'object');
    assert.equal(typeof cached(source, '/s/v.tsx'), 'string');
  });

  it('a source that does not parse is cached as its error and throws again on each read', () => {
    const before = parseCacheStats();
    const errors: unknown[] = [];
    for (let i = 0; i < 3; i++) {
      try {
        parseAst(BROKEN, '/s/broken.spec.ts');
        assert.fail('parsed');
      } catch (e) {
        errors.push(e);
      }
    }
    assert.ok(errors[0] instanceof Error);
    assert.equal(errors[1], errors[0]);
    assert.equal(errors[2], errors[0]);
    assert.equal(parseCacheStats().misses - before.misses, 1);
    assert.equal(parseCacheStats().hits - before.hits, 2);
    // A reader's own catch path is what it was: nothing found, no throw.
    assert.deepEqual(extractHelperFacts(BROKEN, '/s/broken.spec.ts'), []);
    assert.deepEqual(getTestSpans(BROKEN, '/s/broken.spec.ts'), { tests: [], hooks: [] });
    assert.deepEqual(playwrightTies(BROKEN, '/s/broken.spec.ts'), { importsPlaywright: false, bound: false });
    assert.equal(createPostFilter(() => BROKEN, '/s/broken.spec.ts').tree(), undefined);
  });
});

describe('QAG-287 S5c: the memory bound', () => {
  it('over the budget, the trees read longest ago are dropped; the one just parsed stays', () => {
    const one = parseAst(SPEC, '/s/0.spec.ts');
    const costOfOne = parseCacheStats().tokens;
    assert.equal(costOfOne, 1 + (one.tokens?.length ?? 0) + (one.comments?.length ?? 0));
    clearParseCache();
    setParseCacheBudget(costOfOne * 3);
    const trees = [0, 1, 2].map((i) => parseAst(SPEC, `/s/${i}.spec.ts`));
    assert.equal(parseCacheStats().entries, 3);
    assert.equal(parseAst(SPEC, '/s/0.spec.ts'), trees[0]); // 0 is now the most recently read
    parseAst(SPEC, '/s/3.spec.ts'); // drops 1, the one read longest ago
    assert.equal(parseCacheStats().entries, 3);
    assert.equal(parseCacheStats().tokens, costOfOne * 3);
    assert.equal(parseAst(SPEC, '/s/0.spec.ts'), trees[0]);
    assert.equal(parseAst(SPEC, '/s/2.spec.ts'), trees[2]);
    assert.notEqual(parseAst(SPEC, '/s/1.spec.ts'), trees[1]);
  });

  it('a file larger than the whole budget is still served, alone', () => {
    setParseCacheBudget(1);
    const a = parseAst(SPEC, '/s/a.spec.ts');
    assert.equal(parseAst(SPEC, '/s/a.spec.ts'), a);
    parseAst(HELPER, '/s/b.ts');
    assert.equal(parseCacheStats().entries, 1);
  });

  it('the budgets are fixed constants', () => {
    assert.equal(MAX_CACHED_TOKENS, 3_000_000);
    assert.equal(WORKER_MAX_CACHED_TOKENS, 400_000);
  });
});

function demoSuite(): string {
  return suite({
    'a/login.spec.ts': SPEC,
    'a/support/cart.ts': HELPER,
    'b/login.spec.ts': SPEC,
    'b/support/cart.ts': HELPER,
    'c/other.spec.ts': SPEC.replace('cart shows the total', 'another test'),
    'c/support/cart.ts': HELPER,
  });
}

describe('QAG-287 S5c: each file is parsed once per thread', () => {
  it('every reader of one file gets the one tree', () => {
    const dir = suite({ 'login.spec.ts': SPEC, 'support/cart.ts': HELPER });
    const spec = path.join(dir, 'login.spec.ts');
    const helper = path.join(dir, 'support', 'cart.ts');
    const sources = new Map([[spec, SPEC]]);
    const before = parseCacheStats();
    const tree = parseAst(SPEC, spec);
    extractHelperFacts(SPEC, spec); // metrics
    const imported = collectLocallyImportedFiles(sources, dir); // import-graph
    assert.deepEqual([...imported.keys()], [helper]);
    detectTestAliasNamesWithFactories(sources, imported, dir); // test-aliases
    assert.equal(playwrightTies(SPEC, spec).importsPlaywright, true); // shared-files
    assert.equal(playwrightTies(HELPER, helper).bound, true);
    assert.equal(createPostFilter(() => SPEC, spec).tree()?.root, tree); // eslint-postfilter
    analyzeSource(SPEC, 'login.spec.ts', [], spec); // metrics, as the analysis calls it
    assert.equal(getTestSpans(SPEC, spec).tests.length, 1);
    const triage = createTriage({ filesBase: dir, sources, importedFiles: imported, importBoundary: dir }); // finding-triage
    triage([{ rule: 'playwright/expect-expect', file: 'login.spec.ts', line: 4, column: 1, severity: 'error', message: 'm' } as Finding]);
    const now = parseCacheStats();
    assert.equal(now.misses - before.misses, 2, 'one parse per file: the spec and its helper');
    assert.ok(now.hits - before.hits >= 8, `hits ${now.hits - before.hits}`);
  });

  it('a whole run in one thread parses each file once, and leaves nothing in the cache', async () => {
    const dir = demoSuite();
    const before = parseCacheStats();
    const r = await scorePaths({ paths: [dir], cwd: dir, isolate: false });
    const now = parseCacheStats();
    assert.equal(r.status, 'scored');
    assert.equal(now.misses - before.misses, 6, 'three specs and three helpers');
    assert.ok(now.hits - before.hits >= 6 * 3, `hits ${now.hits - before.hits}`);
    assert.equal(now.entries, 0);
  });

  it('two identical files at different paths: each keeps its own findings, under its own path', async () => {
    const dir = demoSuite();
    for (const isolate of [false, true]) {
      const r = await scorePaths({ paths: [dir], cwd: dir, isolate });
      const of = (file: string): string[] =>
        r.findings.filter((f) => f.file === file).map((f) => `${f.rule}|${f.line}|${f.column}|${f.message}`).sort();
      assert.ok(of('a/login.spec.ts').some((f) => f.startsWith('playwright/no-wait-for-timeout|6|')), of('a/login.spec.ts').join('\n'));
      assert.deepEqual(of('b/login.spec.ts'), of('a/login.spec.ts'));
      assert.equal(r.coverage?.filesScored, 3);
      // Each is also what it is when scored alone.
      for (const sub of ['a', 'b']) {
        const alone = await scorePaths({ paths: [path.join(dir, sub)], cwd: dir, isolate });
        // Alone, the file is named relative to its own directory.
        assert.deepEqual(
          alone.findings.map((f) => `${f.file}|${f.rule}|${f.line}|${f.column}|${f.message}`).sort(),
          of(`${sub}/login.spec.ts`).map((f) => `login.spec.ts|${f}`)
        );
      }
    }
  });
});

describe('QAG-287 S5c: the main thread holds no tree while the worker runs', () => {
  it('analyzeIsolated drops the main thread\'s trees before it starts the worker', async () => {
    const dir = suite({ 'login.spec.ts': SPEC, 'support/cart.ts': HELPER });
    const spec = path.join(dir, 'login.spec.ts');
    const helper = path.join(dir, 'support', 'cart.ts');
    parseAst(SPEC, spec);
    parseAst(HELPER, helper);
    assert.equal(parseCacheStats().entries, 2);
    const input: AnalysisInput = {
      files: [spec],
      sources: new Map([[spec, SPEC]]),
      importedFiles: new Map([[helper, HELPER]]),
      filesBase: dir,
      importBoundary: dir,
      profile: 'standard',
      cwd: dir,
      assertFunctionNamesByFile: new Map(),
      testAliasNames: [],
    };
    const out = await analyzeIsolated(input, { maxHeapMb: 4608, time: startTimeLimit(undefined) });
    assert.equal(out.batches.length, 1);
    assert.equal(out.skipped.length, 0);
    assert.equal(parseCacheStats().entries, 0);
  });

  it('a run through the worker ends with an empty cache in the main thread', async () => {
    const dir = demoSuite();
    const r = await scorePaths({ paths: [dir], cwd: dir });
    assert.equal(r.status, 'scored');
    assert.equal(parseCacheStats().entries, 0);
  });
});
