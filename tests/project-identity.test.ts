import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scorePaths } from '../src/index.js';
import { apiUnderTest, applyApiUnderTest, nearestPackageJson, projectIdentity } from '../src/project-identity.js';
import { API_UNDER_TEST_COPY, API_UNDER_TEST_RULES, PLAYWRIGHT_PACKAGE_NAMES, apiUnderTestRows } from '../src/catalogue/api-under-test.js';
import { ROWS, rowFor, rowsOf, tierOf } from '../src/catalogue/index.js';
import type { Finding } from '../src/types.js';

// QAG-287 S3c: the API-under-test rule. In a project that is the Playwright implementation, the findings of the five
// discouraged-API rules are still reported, with form `api-under-test` (advisory). Everywhere else nothing changes.
// Shapes are written from playwright.dev with invented names.

/** The five rules of the slice, written out: the suite fails if the list or the step drops one. */
const IDLE = 'playwright/no-networkidle';
const SELECTOR = 'playwright/no-wait-for-selector';
const NAVIGATION = 'playwright/no-wait-for-navigation';
const HANDLE = 'playwright/no-element-handle';
const PAUSE = 'playwright/no-page-pause';
const FIVE = [IDLE, SELECTOR, NAVIGATION, HANDLE, PAUSE];
const LINE: Record<string, number> = { [IDLE]: 4, [SELECTOR]: 5, [NAVIGATION]: 6, [HANDLE]: 7, [PAUSE]: 9 };

const BODY = `test('stock list', async ({ page }) => {
  await page.goto('/stock');
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('#stock-table');
  await Promise.all([page.waitForNavigation(), page.getByRole('link', { name: 'Next' }).click()]);
  const rows = await page.$$('tr');
  expect(rows.length).toBe(2);
  await page.pause();
});
`;
const TS = `import { test, expect } from '@playwright/test';\n${BODY}`;
const JS = `const { test, expect } = require('@playwright/test');\n${BODY}`;
/** A receiver the scorer cannot prove: form `unresolved` in any other project. */
const UNPROVEN = `import { test } from '@playwright/test';\nasync function halt(page) {\n  await page.pause();\n}\ntest('halt', async ({ page }) => {\n  await halt(page);\n});\n`;

const pkg = (name: string, extra: Record<string, unknown> = {}): string => JSON.stringify({ name, version: '0.0.0', ...extra });
const lock = (packages: Record<string, unknown>): string => JSON.stringify({ name: 'root', lockfileVersion: 3, packages: { '': { name: 'root' }, ...packages } });
const LINKED = lock({ 'node_modules/@playwright/test': { resolved: 'packages/playwright-test', link: true } });
const REGISTRY = lock({
  'node_modules/@playwright/test': { version: '1.50.0', resolved: 'https://registry.npmjs.org/@playwright/test/-/test-1.50.0.tgz', dev: true },
  'node_modules/playwright': { version: '1.50.0', resolved: 'https://registry.npmjs.org/playwright/-/playwright-1.50.0.tgz', dev: true },
  'node_modules/playwright-core': { version: '1.50.0', resolved: 'https://registry.npmjs.org/playwright-core/-/playwright-core-1.50.0.tgz', dev: true },
});

function withTree<T>(files: Record<string, string>, fn: (dir: string) => T): T {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-identity-')));
  const done = (): void => fs.rmSync(dir, { recursive: true, force: true });
  let out: T;
  try {
    for (const [name, body] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      if (name.endsWith('/')) fs.mkdirSync(path.join(dir, name), { recursive: true });
      else fs.writeFileSync(path.join(dir, name), body);
    }
    out = fn(dir);
  } catch (e) {
    done();
    throw e;
  }
  if (out instanceof Promise) return out.finally(done) as T;
  done();
  return out;
}
const matchedBy = (files: Record<string, string>, root = 'tests'): string | undefined =>
  withTree({ 'tests/': '', ...files }, (dir) => projectIdentity(path.join(dir, root)).matchedBy);
const scoreTree = (files: Record<string, string>, paths: string[] = ['tests']): Promise<Finding[]> =>
  withTree(files, async (dir) => (await scorePaths({ paths: paths.map((p) => path.join(dir, p)), profile: 'standard', threshold: 0, cwd: dir })).findings);

/** The finding of each of the five rules on its BODY line in one file. */
function five(all: Finding[], file: string): Finding[] {
  return FIVE.map((rule) => {
    const hit = all.filter((f) => f.rule === rule && f.line === LINE[rule] && f.file.split(path.sep).join('/').endsWith(file));
    assert.equal(hit.length, 1, `${rule}: one finding on line ${LINE[rule]} of ${file}, got ${hit.length}`);
    return hit[0];
  });
}
const cells = (fs_: Finding[]): string[] => fs_.map((f) => `${f.rule}:${f.form}:${f.tier}`);
const MOVED = FIVE.map((rule) => `${rule}:api-under-test:advisory`);
const copyOf = (f: Finding) => ({ title: f.title, what: f.what, why: f.why, fix: f.fix });
const IDENT = ['rule', 'file', 'line', 'column', 'message'] as const;
const ident = (f: Finding): string => JSON.stringify(IDENT.map((k) => f[k]));
/** Every field a narrowing step must leave alone. */
const NARROWED = new Set(['form', 'tier', 'title', 'what', 'why', 'fix']);
const rest = (f: Finding): string => JSON.stringify(Object.entries(f).filter(([k]) => !NARROWED.has(k)).sort(([a], [b]) => (a < b ? -1 : 1)));

describe('QAG-287 S3c: the catalogue holds the api-under-test cells as one data entry', () => {
  it('each of the five rules has one advisory api-under-test row with the neutral copy, and no other rule has one', () => {
    assert.deepEqual([...API_UNDER_TEST_RULES], FIVE);
    assert.deepEqual(ROWS.filter((r) => r.form === 'api-under-test').map((r) => r.rule), FIVE);
    assert.equal(apiUnderTestRows.length, 5);
    for (const rule of FIVE) {
      const row = rowFor(rule, 'api-under-test')!;
      const base = rowFor(rule, '-')!;
      assert.equal(row.design, 'advisory', rule);
      assert.equal(tierOf(row), 'advisory', rule);
      assert.equal(row.bcEligible, false, rule);
      assert.equal(row.cls, undefined, rule);
      assert.deepEqual([row.family, row.basis, row.docs, row.dimension, row.label], [base.family, base.basis, base.docs, base.dimension, base.label], rule);
      assert.deepEqual({ title: row.title, what: row.what, why: row.why, fix: row.fix }, API_UNDER_TEST_COPY, rule);
      assert.equal(rowsOf(rule)[0].form, '-', `${rule}: the default row stays the rule's own`);
    }
  });

  it('the names are the three Playwright packages and the copy names no tool', () => {
    assert.deepEqual([...PLAYWRIGHT_PACKAGE_NAMES], ['playwright', 'playwright-core', '@playwright/test']);
    for (const text of Object.values(API_UNDER_TEST_COPY)) assert.doesNotMatch(text, /claude|anthropic|\bAI\b|\bLLM\b/i);
  });
});

describe('QAG-287 S3c: the three-manifest check', () => {
  it('manifest 1: the name of the nearest package.json', () => {
    for (const name of ['playwright', 'playwright-core', '@playwright/test']) assert.equal(matchedBy({ 'package.json': pkg(name) }), 'name', name);
    for (const name of ['playwright-extra', '@playwright/experimental-ct-react', 'my-playwright', 'Playwright', '@playwright/test ', 'shop-e2e']) {
      assert.equal(matchedBy({ 'package.json': pkg(name) }), undefined, name);
    }
    assert.equal(matchedBy({ 'package.json': JSON.stringify({ name: ['playwright'] }) }), undefined, 'a name that is not a string');
  });

  it('manifest 2: a package.json that the workspaces globs match on disk', () => {
    const member = { 'packages/engine/package.json': pkg('playwright-core') };
    assert.equal(matchedBy({ 'package.json': pkg('root', { workspaces: ['packages/*'] }), ...member }), 'workspace');
    assert.equal(matchedBy({ 'package.json': pkg('root', { workspaces: { packages: ['packages/*'] } }), ...member }), 'workspace', 'the object form');
    assert.equal(matchedBy({ 'package.json': pkg('root', { workspaces: ['./packages/engine/'] }), ...member }), 'workspace', 'a plain directory');
    assert.equal(matchedBy({ 'package.json': pkg('root', { workspaces: ['apps/*'] }), ...member }), undefined, 'a glob that does not match the directory');
    assert.equal(matchedBy({ 'package.json': pkg('root'), ...member }), undefined, 'no workspaces field');
    assert.equal(matchedBy({ 'package.json': pkg('root', { workspaces: ['packages/*', '!packages/engine'] }), ...member }), undefined, 'a negated glob takes it out');
    assert.equal(matchedBy({ 'package.json': pkg('root', { workspaces: ['packages/*'] }), 'packages/shop/package.json': pkg('shop') }), undefined, 'another member name');
    assert.equal(matchedBy({ 'package.json': pkg('root', { workspaces: 'packages/*' }), ...member }), undefined, 'a workspaces value that is not a list');
  });

  it('manifest 2 never leaves the project or enters node_modules', () => {
    assert.equal(
      matchedBy({ 'app/package.json': pkg('app', { workspaces: ['../outside', '../*'] }), 'outside/package.json': pkg('playwright'), 'app/tests/': '' }, 'app/tests'),
      undefined,
      'a glob with a .. segment',
    );
    assert.equal(
      matchedBy({ 'package.json': pkg('root', { workspaces: ['**'] }), 'node_modules/playwright-core/package.json': pkg('playwright-core') }),
      undefined,
      'an installed dependency is not a workspace',
    );
  });

  it('manifest 3: a link: true entry of package-lock.json, with no workspace directory on disk', () => {
    const root = { 'package.json': pkg('root', { workspaces: ['packages/*'] }) };
    assert.equal(matchedBy({ ...root, 'package-lock.json': LINKED }), 'lockfile');
    for (const name of ['playwright', 'playwright-core']) {
      assert.equal(matchedBy({ ...root, 'package-lock.json': lock({ [`node_modules/${name}`]: { resolved: 'packages/x', link: true } }) }), 'lockfile', name);
    }
    assert.equal(matchedBy({ 'package.json': pkg('shop-e2e'), 'package-lock.json': REGISTRY }), undefined, 'registry entries: a customer project');
    assert.equal(matchedBy({ ...root, 'package-lock.json': lock({ 'node_modules/@playwright/test': { resolved: 'x', link: 'true' } }) }), undefined, 'link must be the boolean');
    assert.equal(matchedBy({ ...root, 'package-lock.json': lock({ 'node_modules/@playwright/test': { resolved: 'x', link: false } }) }), undefined);
    assert.equal(matchedBy({ ...root, 'package-lock.json': lock({ 'node_modules/playwright-extra': { resolved: 'x', link: true } }) }), undefined, 'another linked package');
    assert.equal(matchedBy({ ...root, 'package-lock.json': lock({ 'packages/playwright-test': { name: '@playwright/test', version: '0.0.0' } }) }), undefined, 'only the node_modules entry counts');
    assert.equal(matchedBy({ ...root, 'package-lock.json': lock({ 'node_modules/shop/node_modules/playwright': { resolved: 'x', link: true } }) }), undefined, 'a nested entry');
    assert.equal(matchedBy({ ...root, 'package-lock.json': JSON.stringify({ lockfileVersion: 1, dependencies: { playwright: { version: 'file:packages/playwright' } } }) }), undefined, 'no packages map');
  });

  it('other lockfile formats are not read', () => {
    const root = { 'package.json': pkg('root', { workspaces: ['packages/*'] }) };
    assert.equal(matchedBy({ ...root, 'yarn.lock': '"@playwright/test@workspace:packages/playwright-test":\n  version: 0.0.0-use.local\n  linkType: soft\n' }), undefined);
    assert.equal(matchedBy({ ...root, 'pnpm-lock.yaml': "importers:\n  packages/playwright-test:\n    name: '@playwright/test'\n" }), undefined);
    assert.equal(matchedBy({ ...root, 'npm-shrinkwrap.json': LINKED }), undefined);
  });

  it('P is the nearest package.json at or above the scanned root, and only P is read', () => {
    assert.equal(matchedBy({ 'package.json': pkg('playwright'), 'tests/package.json': pkg('shop-e2e') }), undefined, 'a nearer package.json decides');
    assert.equal(matchedBy({ 'package.json': pkg('shop'), 'tests/package.json': pkg('playwright') }), 'name', 'the scanned root itself');
    assert.equal(matchedBy({ 'package.json': pkg('playwright'), 'a/b/c/': '' }, 'a/b/c'), 'name', 'several levels above');
    assert.equal(matchedBy({ 'package.json': pkg('shop'), 'package-lock.json': LINKED, 'tests/package.json': pkg('shop-e2e') }), undefined, 'the lockfile beside P only');
    assert.equal(matchedBy({ 'tests/x.txt': '' }), undefined, 'no package.json');
  });

  it('the walk stops at the repository root', () => {
    const files = { 'package.json': pkg('playwright'), 'clone/.git/HEAD': 'ref: refs/heads/main\n', 'clone/tests/': '' };
    assert.equal(matchedBy(files, 'clone/tests'), undefined, 'a package.json above the directory that holds .git is not the project');
    assert.equal(matchedBy({ ...files, 'clone/package.json': pkg('playwright-core') }, 'clone/tests'), 'name');
    withTree(files, (dir) => assert.equal(nearestPackageJson(path.join(dir, 'clone', 'tests')), undefined));
  });

  it('a manifest that cannot be read is a manifest that does not match, and nothing throws', () => {
    assert.equal(matchedBy({ 'package.json': '{ "name": "playwright", ' }), undefined, 'malformed package.json');
    assert.equal(matchedBy({ 'package.json': '"playwright"' }), undefined, 'not an object');
    assert.equal(matchedBy({ 'package.json': 'null' }), undefined);
    assert.equal(matchedBy({ 'package.json': pkg('root'), 'package-lock.json': '{ "packages": ' }), undefined, 'malformed lockfile');
    assert.equal(matchedBy({ 'package.json': pkg('root'), 'package-lock.json': JSON.stringify({ packages: [] }) }), undefined);
    assert.equal(matchedBy({ 'package.json': pkg('root'), 'package-lock.json': JSON.stringify({ packages: { 'node_modules/playwright': null } }) }), undefined);
    assert.equal(matchedBy({ 'package.json': pkg('root', { workspaces: [3, null, '', '[', '/abs/*'] }), 'package-lock.json': '' }), undefined);
    assert.equal(matchedBy({ 'package.json': '{ broken', 'package-lock.json': LINKED }), 'lockfile', 'the lockfile is still read beside a broken package.json');
    assert.equal(matchedBy({ 'package.json/x': '' }), undefined, 'package.json is a directory');
    assert.deepEqual(projectIdentity(path.join(os.tmpdir(), 'pw-score-no-such-dir', 'a', 'b')), {});
    assert.equal(matchedBy({ 'package.json': JSON.stringify({ name: 'root', __proto__: { name: 'playwright' }, workspaces: ['packages/*'] }), 'package-lock.json': '{"packages":{"__proto__":{"link":true}}}' }), undefined);
  });
});

describe('QAG-287 S3c: the findings of the five rules move to form api-under-test', () => {
  const projects: Array<[string, Record<string, string>]> = [
    ['a project named playwright-core', { 'package.json': pkg('playwright-core') }],
    ['a workspace member on disk', { 'package.json': pkg('root', { workspaces: ['packages/*'] }), 'packages/playwright-test/package.json': pkg('@playwright/test') }],
    ['a lockfile-only project', { 'package.json': pkg('root', { workspaces: ['packages/*'] }), 'package-lock.json': LINKED }],
  ];
  const customer = { 'package.json': pkg('shop-e2e', { devDependencies: { '@playwright/test': '1.50.0' } }), 'package-lock.json': REGISTRY };
  const specs = { 'tests/a.spec.ts': TS, 'tests/b.spec.js': JS };

  for (const [label, manifests] of projects) {
    it(`${label}: TS and JS, with the copy`, async () => {
      const all = await scoreTree({ ...manifests, ...specs });
      for (const file of ['a.spec.ts', 'b.spec.js']) {
        const mine = five(all, file);
        assert.deepEqual(cells(mine), MOVED, file);
        for (const f of mine) assert.deepEqual(copyOf(f), API_UNDER_TEST_COPY, `${f.rule} ${file}`);
      }
      assert.equal(all.filter((f) => FIVE.includes(f.rule) && f.form !== 'api-under-test').length, 0);
    });
  }

  it('a customer project with registry lockfile entries: every finding keeps form -, TS and JS', async () => {
    const all = await scoreTree({ ...customer, ...specs });
    for (const file of ['a.spec.ts', 'b.spec.js']) {
      const mine = five(all, file);
      assert.deepEqual(mine.map((f) => f.form), FIVE.map(() => '-'), file);
      for (const f of mine) {
        assert.notEqual(f.tier, 'advisory', f.rule);
        const own = rowFor(f.rule, '-')!;
        assert.deepEqual(copyOf(f), { title: own.title, what: own.what, why: own.why, fix: own.fix }, f.rule);
      }
    }
    assert.equal(all.filter((f) => f.form === 'api-under-test').length, 0);
  });

  it('narrowing: against the step switched off, only form, tier and the copy of the five rules change', async () => {
    const files = { 'package.json': pkg('playwright'), ...specs, 'tests/c.spec.ts': UNPROVEN };
    const on = await scoreTree(files);
    apiUnderTest.enabled = false;
    let off: Finding[];
    try {
      off = await scoreTree(files);
    } finally {
      apiUnderTest.enabled = true;
    }
    assert.equal(off.filter((f) => f.form === 'api-under-test').length, 0, 'switched off, nothing moves');
    assert.deepEqual(on.map(ident), off.map(ident), 'the same findings in the same order');
    assert.deepEqual(on.map(rest), off.map(rest), 'no other field changes');
    const changed = on.filter((f, i) => JSON.stringify(f) !== JSON.stringify(off[i]));
    assert.equal(changed.length, 11, 'five per spec file and the unproven pause');
    for (const f of changed) assert.ok(FIVE.includes(f.rule) && f.form === 'api-under-test' && f.tier === 'advisory', `${f.rule} ${f.form}`);
    for (const f of off.filter((x) => FIVE.includes(x.rule))) assert.ok(f.form === '-' || f.form === 'unresolved', `${f.rule} has form ${f.form} with the step off`);
    assert.ok(on.some((f) => !FIVE.includes(f.rule)), 'the scan reports other rules too');
  });

  it('precedence: api-under-test wins over form unresolved', async () => {
    const control = (await scoreTree({ ...customer, 'tests/c.spec.ts': UNPROVEN })).filter((f) => f.rule === PAUSE);
    assert.deepEqual(control.map((f) => f.form), ['unresolved'], 'in a customer project the same line is unresolved');
    assert.notEqual(control[0].tier, 'advisory');
    const engine = (await scoreTree({ 'package.json': pkg('@playwright/test'), 'tests/c.spec.ts': UNPROVEN })).filter((f) => f.rule === PAUSE);
    assert.deepEqual(cells(engine), [`${PAUSE}:api-under-test:advisory`]);
    assert.deepEqual(copyOf(engine[0]), API_UNDER_TEST_COPY);
    assert.deepEqual(engine.map(ident), control.map(ident));
  });

  it('each scanned root is decided on its own', async () => {
    const files = {
      'engine/package.json': pkg('playwright-core'),
      'engine/tests/a.spec.ts': TS,
      'shop/package.json': pkg('shop-e2e'),
      'shop/package-lock.json': REGISTRY,
      'shop/tests/b.spec.js': JS,
    };
    const all = await scoreTree(files, ['engine/tests', 'shop/tests']);
    assert.deepEqual(cells(five(all, 'engine/tests/a.spec.ts')), MOVED);
    assert.deepEqual(five(all, 'shop/tests/b.spec.js').map((f) => f.form), FIVE.map(() => '-'));
    const oneRoot = await scoreTree(files, ['.']);
    assert.equal(oneRoot.filter((f) => f.form === 'api-under-test').length, 0, 'scanned from above, the root has no package.json: nothing moves');
  });

  it('a single file given as the path uses its directory as the scanned root', async () => {
    const all = await scoreTree({ 'package.json': pkg('playwright'), 'tests/a.spec.ts': TS }, ['tests/a.spec.ts']);
    assert.deepEqual(cells(five(all, 'a.spec.ts')), MOVED);
  });

  it('a dependency on Playwright, a name in a script or a vendored copy never moves a finding', async () => {
    const all = await scoreTree({
      'package.json': pkg('shop-e2e', { dependencies: { playwright: '1.50.0', 'playwright-core': '1.50.0' }, scripts: { test: 'playwright test' }, description: '@playwright/test' }),
      'node_modules/playwright/package.json': pkg('playwright'),
      'vendor/playwright/package.json': pkg('playwright'),
      'tests/a.spec.ts': TS,
    });
    assert.deepEqual(five(all, 'a.spec.ts').map((f) => f.form), FIVE.map(() => '-'));
  });
  it('decorating a finding of a one-shape rule that carries no form still gives it form -', async () => {
    const { decorateFindings } = await import('../src/catalogue/index.js');
    const f: Finding = { rule: IDLE, severity: 'warning', message: 'm', file: 'a.spec.ts', line: 1, column: 1, dimension: 'playwrightHygiene' };
    decorateFindings([f], undefined);
    assert.deepEqual([f.form, f.tier === 'needs-check' || f.tier === 'advisory'], ['-', false]);
  });
});

describe('QAG-287 S3c: the step itself', () => {
  const base = { severity: 'warning', message: 'm', line: 1, column: 1, dimension: 'playwrightHygiene' } as const;
  const make = (rule: string, file: string, form?: string): Finding => ({ ...base, rule, file, ...(form ? { form } : {}) });

  it('wins over any form already set, leaves other rules alone, and gives a one-shape rule its form', () => {
    withTree({ 'engine/package.json': pkg('playwright'), 'engine/tests/': '', 'shop/package.json': pkg('shop'), 'shop/tests/': '' }, (dir) => {
      const ctx = { filesBase: dir, scanRoots: [path.join(dir, 'engine', 'tests'), path.join(dir, 'shop', 'tests')] };
      const findings = [
        make(PAUSE, 'engine/tests/a.spec.ts', 'unresolved'),
        make(HANDLE, 'engine/tests/a.spec.ts', '-'),
        make(IDLE, 'engine/tests/a.spec.ts'),
        make('playwright/no-wait-for-timeout', 'engine/tests/a.spec.ts'),
        make('pwscore/no-weak-assertion', 'engine/tests/a.spec.ts', 'foreign-expect'),
        make(IDLE, 'shop/tests/b.spec.ts'),
        make(SELECTOR, 'shop/tests/b.spec.ts'),
        make(PAUSE, 'shop/tests/b.spec.ts', 'unresolved'),
        make(NAVIGATION, 'shop/tests/b.spec.ts'),
      ];
      const before = findings.map((f) => ({ ...f, form: undefined }));
      applyApiUnderTest(findings, ctx);
      assert.deepEqual(findings.map((f) => f.form), ['api-under-test', 'api-under-test', 'api-under-test', undefined, 'foreign-expect', '-', '-', 'unresolved', undefined]);
      assert.deepEqual(findings.map((f) => ({ ...f, form: undefined })), before, 'only form is written');
    });
  });

  it('a file outside every scanned root follows the scan as a whole', () => {
    withTree({ 'engine/package.json': pkg('playwright'), 'engine/tests/': '', 'shop/package.json': pkg('shop'), 'shop/tests/': '', 'lib/': '' }, (dir) => {
      const [engine, shop] = [path.join(dir, 'engine', 'tests'), path.join(dir, 'shop', 'tests')];
      const one = [make(IDLE, 'lib/helper.ts')];
      applyApiUnderTest(one, { filesBase: dir, scanRoots: [engine] });
      assert.equal(one[0].form, 'api-under-test');
      const mixed = [make(IDLE, 'lib/helper.ts')];
      applyApiUnderTest(mixed, { filesBase: dir, scanRoots: [engine, shop] });
      assert.equal(mixed[0].form, '-', 'one root is a customer project: the finding stays');
    });
  });

  it('switched off or handed hostile input, it moves nothing and never throws', () => {
    withTree({ 'package.json': pkg('playwright'), 'tests/': '' }, (dir) => {
      apiUnderTest.enabled = false;
      try {
        const off = [make(IDLE, 'tests/a.spec.ts'), make(PAUSE, 'tests/a.spec.ts', 'unresolved')];
        applyApiUnderTest(off, { filesBase: dir, scanRoots: [path.join(dir, 'tests')] });
        assert.deepEqual(off.map((f) => f.form), ['-', 'unresolved']);
      } finally {
        apiUnderTest.enabled = true;
      }
      const none = [make(IDLE, 'tests/a.spec.ts')];
      applyApiUnderTest(none, { filesBase: dir, scanRoots: [] });
      assert.equal(none[0].form, '-', 'no scanned root: no match');
      const hostile = [make(IDLE, '\u0000'), { ...make(PAUSE, 'x'), file: undefined as unknown as string }, make(IDLE, '../../../../etc/passwd')];
      assert.doesNotThrow(() => applyApiUnderTest(hostile, { filesBase: dir, scanRoots: [path.join(dir, 'tests'), '\u0000', ''] }));
      assert.ok(hostile.every((f) => f.form !== 'api-under-test'));
    });
  });
});
