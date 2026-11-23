import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scorePaths } from '../src/index.js';
import { formatJson } from '../src/formatters/json.js';
import { decideStatus } from '../src/coverage.js';
import { classifyShared, playwrightTies } from '../src/shared-files.js';
import type { Coverage, ScoreResult } from '../src/types.js';

// QAG-287 S6a: the shared files of a run (the files the specs import) are
// split into Playwright-bound and not, and reported in `coverage`. Nothing
// else in a result depends on them. Every expected list below is written out
// by hand; none is computed from the code under test.

const tmpDirs: string[] = [];
function suite(files: Record<string, string>): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-shared-')));
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

const spec = (title: string, imports: string[]): string =>
  `import { test, expect } from '@playwright/test';\n` +
  imports.map((i) => `import '${i}';\n`).join('') +
  `\ntest('${title}', async ({ page }) => {\n  await page.goto('/ledger');\n  await expect(page.getByRole('heading', { name: 'Ledger' })).toBeVisible();\n});\n`;

const linted = (r: ScoreResult): string[] => r.coverage?.sharedLintedFiles ?? ['<none>'];
const skipped = (r: ScoreResult): string[] => (r.coverage?.sharedSkippedFiles ?? []).map((s) => `${s.file}|${s.reason}`);
function withoutShared(r: ScoreResult): unknown {
  const copy = JSON.parse(formatJson(r)) as { coverage: Record<string, unknown> };
  for (const k of ['sharedLinted', 'sharedSkipped', 'sharedLintedFiles', 'sharedSkippedFiles']) delete copy.coverage[k];
  return copy;
}

const TS_SHARED: Record<string, string> = {
  // one qualifying condition per file, and no other tie in the file
  'kit/imports-test.ts': `import type { Page } from '@playwright/test';\nexport type LedgerPage = Page;\n`,
  'kit/imports-playwright.ts': `import { chromium } from 'playwright';\nexport const engine = chromium;\n`,
  'kit/imports-core.ts': `export { errors } from 'playwright-core';\n`,
  'kit/through-closure.ts': `import { engine } from './imports-playwright';\nexport const engineName = String(engine);\n`,
  'kit/annot-page.ts': `export function ledgerTitle(tab: Page): string {\n  return String(tab);\n}\n`,
  'kit/annot-locator.ts': `export class LedgerRow {\n  readonly cell!: Locator;\n}\n`,
  'kit/annot-frame.ts': `export interface Embedded {\n  host: Frame;\n}\n`,
  'kit/annot-context.ts': `export class Session {\n  constructor(private readonly ctx: BrowserContext | undefined) {}\n}\n`,
  'kit/annot-request.ts': `export const seedLedger = async (api: pw.APIRequestContext): Promise<void> => {\n  void api;\n};\n`,
  'kit/test-extend.ts': `declare const test: { extend(f: object): unknown };\nexport const ledgerTest = test.extend({});\n`,
  'kit/page-param.ts': `export async function openLedger(page: any): Promise<void> {\n  await page.goto('/ledger');\n}\n`,
  // not bound
  'kit/pure-util.ts': `export const cents = (amount: number): number => Math.round(amount * 100);\n`,
  'kit/page-no-call.ts': `export function pageLabel(page: { number: number; render(): string }): string {\n  return page.render() + page.number;\n}\n`,
  'kit/two-hops.ts': `import { engineName } from './through-closure';\nexport const shout = engineName.toUpperCase();\n`,
  // imports a bound file that does not itself import Playwright: binding is not passed on
  'kit/beside-annotated.ts': `import { ledgerTitle } from './annot-page';\nexport const titleOf = ledgerTitle;\n`,
  'kit/ambient.d.ts': `declare function ledgerGlobal(tab: Page): void;\n`,
};

const JS_SHARED: Record<string, string> = {
  'kit/imports-test.js': `import { expect } from '@playwright/test';\nexport const check = expect;\n`,
  'kit/imports-playwright.cjs': `const { chromium } = require('playwright');\nmodule.exports = { engine: chromium };\n`,
  'kit/imports-core.mjs': `export * from 'playwright-core';\n`,
  'kit/through-closure.js': `import { check } from './imports-test.js';\nexport const checkName = String(check);\n`,
  'kit/annot-page.js': `/**\n * @param {Page} tab\n */\nexport function ledgerTitle(tab) {\n  return String(tab);\n}\n`,
  'kit/annot-locator.js': `export class LedgerRow {\n  /** @type {Locator} */\n  cell;\n}\n`,
  'kit/annot-frame.js': `/**\n * @typedef {object} Embedded\n * @property {Frame} host\n */\nexport const embedded = {};\n`,
  'kit/annot-context.js': `/** @param {import('@playwright/test').BrowserContext} ctx */\nexport function session(ctx) {\n  return [ctx];\n}\n`,
  'kit/annot-request.js': `/**\n * @param {APIRequestContext} [api]\n */\nexport const seedLedger = async (api) => {\n  void api;\n};\n`,
  'kit/test-extend.js': `export const makeTest = (test) => test.extend({});\n`,
  'kit/page-param.js': `export const openLedger = async ({ page }) => {\n  await page.goto('/ledger');\n};\n`,
  'kit/pure-util.js': `export const cents = (amount) => Math.round(amount * 100);\n`,
  'kit/page-no-call.js': `export function pageLabel(page) {\n  return page.render() + page.number;\n}\n`,
  'kit/two-hops.js': `import { checkName } from './through-closure.js';\nexport const shout = checkName.toUpperCase();\n`,
  'kit/beside-annotated.js': `import { ledgerTitle } from './annot-page.js';\nexport const titleOf = ledgerTitle;\n`,
  'kit/ambient.d.ts': `declare function ledgerGlobal(tab: Page): void;\n`,
};

const TS_BOUND = ['annot-context', 'annot-frame', 'annot-locator', 'annot-page', 'annot-request', 'imports-core', 'imports-playwright', 'imports-test', 'page-param', 'test-extend', 'through-closure'];
const NOT_BOUND = ['kit/ambient.d.ts|declaration-file', 'kit/beside-annotated|not-playwright-bound', 'kit/page-no-call|not-playwright-bound', 'kit/pure-util|not-playwright-bound', 'kit/two-hops|not-playwright-bound'];

describe('QAG-287 S6a: shared files are split into Playwright-bound and not, and reported in coverage', () => {
  it('TypeScript: one file per qualifying condition is in sharedLinted; a pure util, a page parameter with no Playwright call, a file two imports away, a file that imports an annotated one and a .d.ts are in sharedSkipped; a spec is in neither', async () => {
    const dir = suite({
      ...TS_SHARED,
      'specs/ledger.spec.ts': spec('opens the ledger', [...Object.keys(TS_SHARED).map((f) => `../${f.replace(/\.ts$/, f.endsWith('.d.ts') ? '.ts' : '')}`), './totals.spec']),
      'specs/totals.spec.ts': spec('shows the totals', []),
    });
    const r = await scorePaths({ paths: [dir], cwd: dir });
    assert.deepEqual(linted(r), TS_BOUND.map((n) => `kit/${n}.ts`));
    assert.deepEqual(skipped(r), NOT_BOUND.map((e) => e.replace(/^(kit\/[a-z-]+)\|/, '$1.ts|')));
    assert.equal(r.coverage?.sharedLinted, 11);
    assert.equal(r.coverage?.sharedSkipped, 5);
    // The shared lists never touch the status, the spec counts or the other two lists.
    assert.equal(r.status, 'scored');
    assert.equal(r.coverage?.filesFound, 2);
    assert.equal(r.coverage?.filesScored, 2);
    assert.deepEqual(r.coverage?.skipped, []);
    assert.equal(r.skippedFiles, undefined);
    assert.deepEqual((JSON.parse(formatJson(r)) as ScoreResult).coverage?.sharedLintedFiles, linted(r));
  });

  it('JavaScript (.js, .cjs, .mjs; JSDoc types for the annotations): the same split', async () => {
    const importPath = (f: string): string => `../${f}`;
    const dir = suite({
      ...JS_SHARED,
      'specs/ledger.spec.js': spec('opens the ledger', [...Object.keys(JS_SHARED).map(importPath), './totals.spec.js']),
      'specs/totals.spec.js': spec('shows the totals', []),
    });
    const r = await scorePaths({ paths: [dir], cwd: dir });
    assert.deepEqual(linted(r), [
      'kit/annot-context.js', 'kit/annot-frame.js', 'kit/annot-locator.js', 'kit/annot-page.js', 'kit/annot-request.js',
      'kit/imports-core.mjs', 'kit/imports-playwright.cjs', 'kit/imports-test.js', 'kit/page-param.js', 'kit/test-extend.js', 'kit/through-closure.js',
    ]);
    assert.deepEqual(skipped(r), [
      'kit/ambient.d.ts|declaration-file', 'kit/beside-annotated.js|not-playwright-bound', 'kit/page-no-call.js|not-playwright-bound', 'kit/pure-util.js|not-playwright-bound', 'kit/two-hops.js|not-playwright-bound',
    ]);
    assert.equal(r.status, 'scored');
  });

  it('each condition on its own text: playwrightTies', () => {
    for (const [file, source] of [...Object.entries(TS_SHARED), ...Object.entries(JS_SHARED)]) {
      if (file.endsWith('.d.ts')) continue;
      const name = path.basename(file).replace(/\.[a-z]+$/, '');
      const own = playwrightTies(source, file);
      // through-closure is bound only through the file it imports, so on its own text it is not.
      assert.equal(own.bound, TS_BOUND.includes(name) && name !== 'through-closure', file);
      assert.equal(own.importsPlaywright, name.startsWith('imports-'), file);
    }
    // More forms of the same conditions.
    const bound = (source: string, file = 'x.ts'): boolean => playwrightTies(source, file).bound;
    assert.equal(bound(`const pw = await import('@playwright/test');\n`), true);
    assert.equal(bound(`import { devices } from '@playwright/test/reporter';\n`), true);
    assert.equal(bound(`import { x } from '@playwright/experimental-ct-react';\n`), false);
    assert.equal(bound(`import { x } from 'playwright-extra-tools';\n`), false);
    assert.equal(bound(`export function f(pages: Page[]): number { return pages.length; }\n`), false);
    assert.equal(bound(`export function f(row: PageModel): string { return row.slug; }\n`), false);
    assert.equal(bound(`export function f(page: any) { return [1, 2].map((n) => page.locator('li').nth(n)); }\n`), true);
    assert.equal(bound(`export function f(page: any) { return page.items.filter(Boolean); }\n`), false);
    assert.equal(bound(`export function f(doc: any) { return doc.goto('/x'); }\n`), false);
    assert.equal(bound(`export const t = base.extend({});\n`), false);
    assert.equal(bound(`/** @returns {Page} */\nexport function f() { return undefined; }\n`, 'x.js'), false);
    assert.equal(bound(`// @param {Page} tab\nexport function f(tab) { return tab; }\n`, 'x.js'), false);
    assert.equal(bound(`export function f(page) { return page.goto( }\n`, 'x.js'), false, 'a file that does not parse has no tie');
  });

  it('classifyShared: a spec in the closure is in neither list, and importing a spec that imports Playwright binds nothing', () => {
    const closure = new Map([
      ['/s/kit/a.ts', `import './b.spec';\nexport const a = 1;\n`],
      ['/s/kit/b.spec.ts', `import { test } from '@playwright/test';\ntest('t', async () => {});\n`],
    ]);
    const edges = new Map([['/s/kit/a.ts', ['/s/kit/b.spec.ts']]]);
    const out = classifyShared(closure, edges, (f) => f.endsWith('.spec.ts'));
    assert.deepEqual(out, { linted: [], skipped: [{ file: '/s/kit/a.ts', reason: 'not-playwright-bound' }] });
  });

  it('a spec named explicitly: the spec it imports was not asked for and is not scored; it is a spec, so it is in neither shared list', async () => {
    const dir = suite({
      'specs/ledger.spec.ts': spec('opens the ledger', ['./totals.spec', './support/pure-util']),
      'specs/totals.spec.ts': spec('shows the totals', []),
      'specs/support/pure-util.ts': TS_SHARED['kit/pure-util.ts'],
    });
    const r = await scorePaths({ paths: [path.join(dir, 'specs', 'ledger.spec.ts')], cwd: dir });
    assert.equal(r.coverage?.filesFound, 1);
    assert.deepEqual(linted(r), []);
    assert.deepEqual(skipped(r), ['support/pure-util.ts|not-playwright-bound']);
  });

  it('shared counts never feed the status: decideStatus gives the same answer with and without them', () => {
    const base: Coverage = { filesFound: 3, filesScored: 3, testsCounted: 5, skipped: [] };
    const shared = { sharedLinted: 0, sharedSkipped: 9, sharedLintedFiles: [], sharedSkippedFiles: [{ file: 'kit/u.ts', reason: 'not-playwright-bound' as const }] };
    assert.deepEqual(decideStatus({ ...base, ...shared }), { status: 'scored' });
    assert.deepEqual(decideStatus({ ...base, ...shared, testsCounted: 0 }), decideStatus({ ...base, testsCounted: 0 }));
    assert.deepEqual(decideStatus({ ...base, ...shared, filesFound: 0 }), decideStatus({ ...base, filesFound: 0 }));
  });

  it('no files and no local imports: the four keys are present and empty', async () => {
    const empty = suite({ 'notes.txt': 'nothing here\n' });
    const none = await scorePaths({ paths: [empty], cwd: empty });
    assert.equal(none.status, 'not-scored');
    assert.deepEqual(none.coverage, { filesFound: 0, filesScored: 0, testsCounted: 0, skipped: [], sharedLinted: 0, sharedSkipped: 0, sharedLintedFiles: [], sharedSkippedFiles: [] });
    const dir = suite({ 'ledger.spec.ts': spec('opens the ledger', []) });
    const r = await scorePaths({ paths: [dir], cwd: dir });
    assert.deepEqual(r.coverage, { filesFound: 1, filesScored: 1, testsCounted: 1, skipped: [], sharedLinted: 0, sharedSkipped: 0, sharedLintedFiles: [], sharedSkippedFiles: [] });
  });
});

describe('QAG-287 S6a: a package nested inside the repository is resolved by its package.json name, for the shared set only', () => {
  const KIT: Record<string, string> = {
    'e2e/kit/src/index.ts': `import { expect } from '@playwright/test';\nexport { CartPanel } from './panels/cart';\nexport const check = expect;\n`,
    'e2e/kit/src/panels/cart.ts': `export class CartPanel {\n  constructor(private readonly page: Page) {}\n  rows() {\n    return this.page.getByRole('row');\n  }\n}\n`,
    'e2e/kit/src/flows/checkout.ts': `export const steps = ['cart', 'pay'];\n`,
  };
  const SPEC = `import { test, expect } from '@playwright/test';\nimport { CartPanel } from '@harbor/e2e-kit';\nimport { steps } from '@harbor/e2e-kit/flows/checkout';\n\ntest('lists the cart rows', async ({ page }) => {\n  await page.goto('/cart');\n  await expect(new CartPanel(page).rows()).toHaveCount(steps.length);\n});\n`;
  const BOUND = ['kit/src/index.ts', 'kit/src/panels/cart.ts'];
  const UNBOUND = ['kit/src/flows/checkout.ts|not-playwright-bound'];

  it('a package in a directory next to the specs, found by name (its entry points at dist, the source is under src)', async () => {
    const files = { ...KIT, 'e2e/specs/cart.spec.ts': SPEC, '.git/HEAD': 'ref: refs/heads/trunk\n' };
    const named = suite({ ...files, 'e2e/kit/package.json': JSON.stringify({ name: '@harbor/e2e-kit', main: 'dist/index.js' }) });
    const r = await scorePaths({ paths: [path.join(named, 'e2e')], cwd: named });
    assert.deepEqual(linted(r), BOUND);
    assert.deepEqual(skipped(r), UNBOUND);

    // The same tree with the package under another name: nothing resolves, the shared lists are
    // empty, and every other byte of the JSON is the same. The nested package changes nothing
    // but the shared lists (locator counts, helper names and the score come from the run's own closure).
    const other = suite({ ...files, 'e2e/kit/package.json': JSON.stringify({ name: '@harbor/other-kit', main: 'dist/index.js' }) });
    const o = await scorePaths({ paths: [path.join(other, 'e2e')], cwd: other });
    assert.deepEqual(linted(o), []);
    assert.deepEqual(skipped(o), []);
    assert.deepEqual(withoutShared(r), JSON.parse(JSON.stringify(withoutShared(o)).split(other).join(named)));
  });

  it('a package deeper down, declared as a workspace by the suite directory own package.json', async () => {
    const moved = Object.fromEntries(Object.entries(KIT).map(([f, s]) => [f.replace('e2e/kit/', 'e2e/packages/tools/kit/'), s]));
    const dir = suite({
      ...moved,
      'e2e/specs/cart.spec.ts': SPEC,
      'e2e/package.json': JSON.stringify({ name: 'harbor-e2e', workspaces: ['packages/tools/*'] }),
      'e2e/packages/tools/kit/package.json': JSON.stringify({ name: '@harbor/e2e-kit', exports: { '.': './src/index.ts' } }),
    });
    const r = await scorePaths({ paths: [path.join(dir, 'e2e')], cwd: dir });
    assert.deepEqual(linted(r), BOUND.map((f) => `packages/tools/${f}`));
    assert.deepEqual(skipped(r), UNBOUND.map((f) => `packages/tools/${f}`));
  });

  it('never outside the scored boundary, never through node_modules, a dot-directory or a symlinked directory', async () => {
    const pkg = JSON.stringify({ name: '@harbor/e2e-kit', main: 'src/index.ts' });
    const dir = suite({
      'repo/e2e/specs/cart.spec.ts': SPEC,
      // only a direct sub-directory is looked at, so these two are named as the package themselves
      'repo/e2e/node_modules/package.json': pkg,
      'repo/e2e/node_modules/src/index.ts': KIT['e2e/kit/src/index.ts'],
      'repo/e2e/.cache/package.json': pkg,
      'repo/e2e/.cache/src/index.ts': KIT['e2e/kit/src/index.ts'],
      // a package of the right name inside the repository but outside the boundary (the directory that holds the scored one)
      '.git/HEAD': 'ref: refs/heads/trunk\n',
      'kit/package.json': pkg,
      'kit/src/index.ts': KIT['e2e/kit/src/index.ts'],
    });
    fs.symlinkSync(path.join(dir, 'kit'), path.join(dir, 'repo', 'e2e', 'linked-kit'), 'dir');
    const r = await scorePaths({ paths: [path.join(dir, 'repo', 'e2e')], cwd: dir });
    assert.deepEqual(linted(r), []);
    assert.deepEqual(skipped(r), []);
    assert.equal(r.status, 'scored');
  });
});
