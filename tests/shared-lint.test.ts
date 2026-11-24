import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { scorePaths } from '../src/index.js';
import { ROWS } from '../src/catalogue/table.js';
import type { RuleRow } from '../src/catalogue/types.js';
import { clock } from '../src/isolate.js';
import { analysisFiles, listedOnShared, planSharedLint, sharedRuleIds, sharedRules } from '../src/shared-lint.js';
import { attributeFindingScopes } from '../src/metrics.js';
import type { Finding, ScoreResult } from '../src/types.js';

// QAG-287 S6b: shared-file linting behind the `shared` option. Findings and fields only: nothing here reads a
// score, a grade or a pass value.

const execFileAsync = promisify(execFile);

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
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-shared-lint-')));
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

const spec = (name: string, helper: string): string => `import { test, expect } from '@playwright/test';
import { ${helper} } from '../support/helpers';

test('${name} page', async ({ page }) => {
  await page.goto('/${name}');
  await ${helper}(page);
  await expect(page.getByRole('heading', { name: '${name}' })).toBeVisible();
});
`;

/** Two specs, a helper both import, a helper only reached through it, a fixture file one spec uses, a plain utility. */
const SUITE: Record<string, string> = {
  'tests/b-orders.spec.ts': spec('orders', 'openPanel'),
  'tests/a-billing.spec.ts': spec('billing', 'openPanel'),
  'tests/c-profile.spec.ts': `import { test, expect } from '../support/fixtures';

test('profile page', async ({ profilePanel }) => {
  await expect(profilePanel.getByRole('heading', { name: 'Profile' })).toBeVisible();
});
`,
  'support/helpers.ts': `import { expect, type Page } from '@playwright/test';
import { settle } from './deep/settle';
import { formatTotal } from './format';

export async function openPanel(page: Page) {
  await settle(page);
  page.getByRole('button', { name: 'Open' }).click();
  // Not on the shared list: a raw locator, a branch, a value read that is used again.
  if (formatTotal(3) === '3.00') await page.locator('#panel').click();
  const shown = await page.getByRole('alert').isVisible();
  expect(shown).toBe(true);
  console.log(shown);
}
`,
  'support/deep/settle.ts': `import type { Page } from '@playwright/test';

export async function settle(page: Page) {
  await page.waitForTimeout(750);
}
`,
  'support/format.ts': `export function formatTotal(n: number): string {
  return n.toFixed(2);
}
`,
  'support/fixtures.ts': `import { test as base, expect, type Page } from '@playwright/test';

export const test = base.extend<{ profilePanel: Page }>({
  profilePanel: async ({ page }, use) => {
    await page.goto('/profile');
    await page.waitForLoadState('networkidle');
    await use(page);
  },
});
export { expect };
`,
};

const brief = (r: ScoreResult): string[] =>
  r.findings.filter((f) => f.scope === 'shared').map((f) => `${f.file}:${f.line}|${f.rule}|${f.form}|${f.tier}|${(f.usedBy ?? []).join(',')}`).sort();

describe('QAG-287 S6b: the shared rule list is a catalogue property', () => {
  const NAMED = [
    'playwright/no-wait-for-timeout',
    'pwscore/no-swallowed-assertion',
    'playwright/missing-playwright-await',
    'playwright/valid-expect',
    'pwscore/no-unawaited-action',
  ];
  /** Rows of a class C1 to C12 that lack the property. C13 (a focused test) is test structure. */
  const lacking = (rows: readonly RuleRow[]): string[] =>
    rows.filter((r) => r.cls !== undefined && /^C([1-9]|1[0-2])$/.test(r.cls) && r.onShared !== true).map((r) => `${r.rule}|${r.form}`);

  it('every C1-C12 cell in the build carries onShared, and a cell that lost it is reported', () => {
    assert.deepEqual(lacking(ROWS), []);
    const classes = new Set(ROWS.filter((r) => r.onShared && r.cls).map((r) => r.cls));
    for (const c of ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'C11', 'C12']) assert.ok(classes.has(c), `${c} is on the shared list`);
    const first = ROWS.find((r) => r.cls === 'C8')!;
    const stripped = ROWS.map((r) => (r === first ? { ...r, onShared: undefined } : r));
    assert.deepEqual(lacking(stripped), [`${first.rule}|${first.form}`]);
  });

  it('the rules named in the design are on the list, and no test-structure rule is', () => {
    const ids = sharedRuleIds();
    for (const rule of NAMED) assert.ok(ids.includes(rule), `${rule} is on the shared list`);
    const structure = [
      'playwright/expect-expect',
      'playwright/no-focused-test',
      'pwscore/no-skipped-test-declaration',
      'pwscore/no-fixme-test',
      'playwright/max-nested-describe',
      'playwright/no-conditional-in-test',
      'playwright/no-conditional-expect',
      'pwscore/no-shared-mutable-state',
      'pwscore/serial-mode-dependency',
      'pwscore/no-excessive-timeout',
      'pwscore/eslint-disable-comment',
      'metrics/oversized-file',
      'playwright/no-raw-locators',
    ];
    for (const rule of structure) assert.ok(!ids.includes(rule), `${rule} never runs on a shared file`);
    assert.deepEqual(
      [...ids].sort(),
      [
        ...NAMED,
        'pwscore/no-unawaited-expect-value',
        'pwscore/no-weak-assertion',
        'playwright/prefer-web-first-assertions',
        'playwright/no-networkidle',
        'playwright/no-wait-for-selector',
        'playwright/no-wait-for-navigation',
        'playwright/no-element-handle',
        'playwright/no-page-pause',
        // C5, built by S7a on lane R2: joins the list through its catalogue row at merge-all.
        'pwscore/no-floating-callback-assertion',
      ].sort()
    );
  });

  it('the config block keeps the listed rules with their settings and drops the rest', () => {
    const block = sharedRules({ 'playwright/no-networkidle': 'error', 'playwright/expect-expect': ['error', {}], 'pwscore/no-fixme-test': 'warn', 'playwright/valid-expect': 'error' });
    assert.deepEqual(block, { 'playwright/no-networkidle': 'error', 'playwright/valid-expect': 'error' });
  });

  it('a form that is not on the list is not listed: a reused read, an assertion from another library', () => {
    assert.equal(listedOnShared({ rule: 'playwright/prefer-web-first-assertions', form: 'read-direct' }), true);
    assert.equal(listedOnShared({ rule: 'playwright/prefer-web-first-assertions', form: 'read-reused' }), false);
    assert.equal(listedOnShared({ rule: 'pwscore/no-weak-assertion', form: 'foreign-expect' }), false);
    assert.equal(listedOnShared({ rule: 'playwright/no-page-pause', form: 'unresolved' }), true);
    assert.equal(listedOnShared({ rule: 'playwright/missing-playwright-await' }), true);
    assert.equal(listedOnShared({ rule: 'playwright/expect-expect' }), false);
    assert.equal(listedOnShared({ rule: 'playwright/expect-expect', form: '-' }), false);
  });
});

describe('QAG-287 S6b: findings on shared files', () => {
  it('by default the shared findings are listed (S6c); shared: false lists none and no usedBy; the spec findings and the coverage are the same', async () => {
    const dir = suite(SUITE);
    const byDefault = await scorePaths({ paths: [path.join(dir, 'tests')], cwd: dir, threshold: 0 });
    const off = await scorePaths({ paths: [path.join(dir, 'tests')], cwd: dir, threshold: 0, shared: false });
    const on = await scorePaths({ paths: [path.join(dir, 'tests')], cwd: dir, threshold: 0, shared: true });
    assert.deepEqual(brief(off), []);
    assert.ok(!JSON.stringify(off).includes('"usedBy"'));
    assert.equal(brief(on).length, 3);
    assert.deepEqual(JSON.parse(JSON.stringify(byDefault)), JSON.parse(JSON.stringify(on)));
    assert.deepEqual(on.findings.filter((f) => f.scope !== 'shared'), off.findings);
    assert.deepEqual(on.coverage, off.coverage);
    assert.equal(on.status, off.status);
    assert.deepEqual(on.coverage?.sharedLintedFiles, ['../support/deep/settle.ts', '../support/fixtures.ts', '../support/helpers.ts']);
    assert.deepEqual(on.coverage?.sharedSkippedFiles, [{ file: '../support/format.ts', reason: 'not-playwright-bound' }]);
  });

  it('lists the listed rules only, with scope shared, tier likely and the sorted specs that reach the file', async () => {
    const dir = suite(SUITE);
    const on = await scorePaths({ paths: [path.join(dir, 'tests')], cwd: dir, threshold: 0, shared: true });
    assert.deepEqual(brief(on), [
      '../support/deep/settle.ts:4|playwright/no-wait-for-timeout|-|likely|a-billing.spec.ts,b-orders.spec.ts',
      '../support/fixtures.ts:6|playwright/no-networkidle|-|likely|c-profile.spec.ts',
      '../support/helpers.ts:7|pwscore/no-unawaited-action|-|likely|a-billing.spec.ts,b-orders.spec.ts',
    ]);
    for (const f of on.findings.filter((x) => x.scope === 'shared')) {
      assert.equal(f.testKey, undefined);
      assert.equal(f.confidence, null);
      assert.equal(f.quotable, false);
      for (const key of ['severity', 'message', 'dimension', 'family', 'basis', 'title', 'what', 'why', 'fix', 'excerpt', 'evidence'] as const) {
        assert.ok(f[key] !== undefined && f[key] !== '', `${f.rule}: ${key} is filled as for a spec finding`);
      }
      assert.ok(fs.existsSync(path.resolve(on.baseDir!, f.file)));
    }
  });

  it('gives the same shared findings in the calling thread and in the worker', async () => {
    const dir = suite(SUITE);
    const worker = await scorePaths({ paths: [path.join(dir, 'tests')], cwd: dir, threshold: 0, shared: true });
    const inline = await scorePaths({ paths: [path.join(dir, 'tests')], cwd: dir, threshold: 0, shared: true, isolate: false });
    assert.deepEqual(inline.findings, worker.findings);
    assert.equal(brief(worker).length, 3);
  });

  it('the receiver step and the expect binding run on a shared file', async () => {
    const helper = (expectFrom: string): string => `import type { Page } from '@playwright/test';
import { expect } from '${expectFrom}';

export async function check(page: Page, opts: { frame: { waitForNavigation(): Promise<void> } }) {
  const frame = opts.frame;
  await frame.waitForNavigation();
  await page.pause();
  expect(page.getByRole('alert')).toBeTruthy();
}
`;
    const specText = `import { test, expect } from '@playwright/test';
import { check } from './helper';

test('orders page', async ({ page }) => {
  await page.goto('/orders');
  await check(page, { frame: page.mainFrame() });
  await expect(page).toHaveURL('/orders');
});
`;
    const own = suite({ 'orders.spec.ts': specText, 'helper.ts': helper('@playwright/test') });
    const r = await scorePaths({ paths: [own], cwd: own, threshold: 0, shared: true });
    assert.deepEqual(brief(r), [
      'helper.ts:6|playwright/no-wait-for-navigation|unresolved|likely|orders.spec.ts',
      'helper.ts:7|playwright/no-page-pause|-|likely|orders.spec.ts',
      'helper.ts:8|pwscore/no-weak-assertion|-|likely|orders.spec.ts',
    ]);
    // The same helper with expect from another assertion library: the assertion finding is not listed.
    const foreign = suite({ 'orders.spec.ts': specText, 'helper.ts': helper('chai') });
    const f = await scorePaths({ paths: [foreign], cwd: foreign, threshold: 0, shared: true });
    assert.deepEqual(brief(f), [
      'helper.ts:6|playwright/no-wait-for-navigation|unresolved|likely|orders.spec.ts',
      'helper.ts:7|playwright/no-page-pause|-|likely|orders.spec.ts',
    ]);
  });

  it('a helper named like an expect is not a matcherless expect (the spec triage runs on shared files)', async () => {
    const dir = suite({
      'orders.spec.ts': `import { test, expect } from '@playwright/test';
import { openOrders } from './helper';

test('orders page', async ({ page }) => {
  await openOrders(page);
  await expect(page).toHaveURL('/orders');
});
`,
      'helper.ts': `import { expect, type Page } from '@playwright/test';

async function clickAndExpect(page: Page, name: string) {
  await page.getByRole('link', { name }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

export async function openOrders(page: Page) {
  await clickAndExpect(page, 'Orders');
  expect(page.getByRole('heading'));
}
`,
    });
    const r = await scorePaths({ paths: [dir], cwd: dir, threshold: 0, shared: true });
    assert.deepEqual(brief(r).filter((x) => x.includes('valid-expect')).map((x) => x.split('|')[0]), ['helper.ts:10']);
  });
});

describe('QAG-287 S6b: scope and usedBy come from attributeFindingScopes', () => {
  it('a finding in a file of the map is shared; every other finding is attributed as before', () => {
    const mk = (file: string, line: number): Finding => ({ rule: 'x/y', severity: 'error', message: 'm', file, line, dimension: 'structure' });
    const spans = new Map([['a.spec.ts', { tests: [{ startLine: 3, endLine: 6 }], hooks: [] }]]);
    const usedBy = new Map([['lib/h.ts', ['a.spec.ts', 'b.spec.ts']]]);
    const before = attributeFindingScopes([mk('a.spec.ts', 4), mk('a.spec.ts', 9), mk('lib/h.ts', 2)], spans as never);
    const withMap = attributeFindingScopes([mk('a.spec.ts', 4), mk('a.spec.ts', 9), mk('lib/h.ts', 2)], spans as never, usedBy);
    assert.deepEqual(withMap.slice(0, 2), before.slice(0, 2));
    assert.equal(before[2].scope, 'module');
    assert.equal(before[2].usedBy, undefined);
    assert.equal(withMap[2].scope, 'shared');
    assert.deepEqual(withMap[2].usedBy, ['a.spec.ts', 'b.spec.ts']);
    assert.notEqual(withMap[2].usedBy, usedBy.get('lib/h.ts'), 'the list is a copy');
  });

  it('the plan names, per shared file, the sorted specs that reach it through any chain of imports', () => {
    const edges = new Map<string, string[]>([
      ['/r/t/z.spec.ts', ['/r/s/h.ts']],
      ['/r/t/a.spec.ts', ['/r/s/h.ts', '/r/s/only-a.ts']],
      ['/r/s/h.ts', ['/r/s/deep.ts']],
      ['/r/s/deep.ts', ['/r/s/h.ts']],
    ]);
    const closure = new Map([['/r/s/h.ts', 'H'], ['/r/s/deep.ts', 'D'], ['/r/s/only-a.ts', 'A']]);
    const plan = planSharedLint({ linted: ['/r/s/deep.ts', '/r/s/h.ts', '/r/s/only-a.ts'], skipped: [] }, { closure, edges }, ['/r/t/z.spec.ts', '/r/t/a.spec.ts'], '/r/t');
    assert.deepEqual([...plan.usedBy], [
      ['../s/deep.ts', ['a.spec.ts', 'z.spec.ts']],
      ['../s/h.ts', ['a.spec.ts', 'z.spec.ts']],
      ['../s/only-a.ts', ['a.spec.ts']],
    ]);
    assert.deepEqual([...plan.sources.keys()], plan.files);
    assert.deepEqual(planSharedLint(undefined, undefined, ['/r/t/a.spec.ts'], '/r/t').files, []);
  });

  it('the analysis is given one sorted list, and the spec list itself when there is no shared file', () => {
    const files = ['/r/t/a.spec.ts', '/r/t/z.spec.ts'];
    assert.equal(analysisFiles({ files }), files);
    assert.equal(analysisFiles({ files, sharedFiles: [] }), files);
    assert.deepEqual(analysisFiles({ files, sharedFiles: ['/r/s/h.ts', '/r/t/m.ts'] }), ['/r/s/h.ts', '/r/t/a.spec.ts', '/r/t/m.ts', '/r/t/z.spec.ts']);
  });
});

describe('QAG-287 S6b: shared files under the time limit', () => {
  const realNow = clock.now;
  after(() => {
    clock.now = realNow;
  });
  /** Time stands still until the checkpoint `at` asks, and the limit has passed from then on. */
  const passAt = (at: string): string[] => {
    const asked: string[] = [];
    let t = 0;
    clock.now = (checkpoint) => {
      asked.push(checkpoint);
      if (checkpoint === at) t = 1e12;
      return t;
    };
    return asked;
  };
  const run = async (at: string, shared: boolean): Promise<{ r: ScoreResult; asked: string[] }> => {
    const dir = suite(SUITE);
    const asked = passAt(at);
    try {
      return { r: await scorePaths({ paths: [path.join(dir, 'tests')], cwd: dir, threshold: 0, maxSeconds: 1000, shared }), asked };
    } finally {
      clock.now = realNow;
    }
  };
  const SPECS = ['a-billing.spec.ts', 'b-orders.spec.ts', 'c-profile.spec.ts'];

  it('the step that finds the shared files is inside the limit: when the limit has passed before it, it does not run', async () => {
    for (const shared of [false, true]) {
      const { r, asked } = await run('shared-files', shared);
      assert.equal(r.coverage?.sharedLinted, 0);
      assert.deepEqual(r.coverage?.sharedLintedFiles, []);
      assert.deepEqual(r.coverage?.skipped.map((s) => `${s.file}|${s.reason}`), SPECS.map((s) => `${s}|deadline`));
      assert.deepEqual(brief(r), []);
      assert.equal(asked[asked.length - 1], 'shared-files', 'no later step asked the clock: none started');
    }
  });

  it('when the limit passes right after it, the shared files are reported and nothing is analysed', async () => {
    for (const shared of [false, true]) {
      const { r, asked } = await run('analysis-input', shared);
      assert.equal(r.coverage?.sharedLinted, 3);
      assert.deepEqual(r.coverage?.skipped.map((s) => `${s.file}|${s.reason}`), SPECS.map((s) => `${s}|deadline`));
      assert.deepEqual(brief(r), []);
      assert.ok(asked.indexOf('shared-files') > 0 && asked.indexOf('shared-files') < asked.indexOf('analysis-input'));
    }
  });

  it('a shared file the limit cuts off before its batch is a skipped file like a spec, and adds no finding', async () => {
    const { r } = await run('batch:0', true);
    assert.deepEqual(
      r.coverage?.skipped.map((s) => `${s.file}|${s.reason}`).sort(),
      ['../support/deep/settle.ts', '../support/fixtures.ts', '../support/helpers.ts', ...SPECS].map((s) => `${s}|deadline`).sort()
    );
    assert.deepEqual(brief(r), []);
    assert.equal(r.coverage?.filesScored, 0);
    assert.equal(r.coverage?.filesFound, 3);
    // Without the option the shared files are never in a batch: only the specs are skipped.
    const off = await run('batch:0', false);
    assert.deepEqual(off.r.coverage?.skipped.map((s) => `${s.file}|${s.reason}`), SPECS.map((s) => `${s}|deadline`));
  });
});

describe('QAG-287 S6c: the CLI flags', () => {
  it('the JSON output lists the shared findings by default and with --shared; --no-shared lists none', async () => {
    const dir = suite(SUITE);
    const cli = path.join(packageRoot(), 'bin', 'playwright-score.js');
    const stdout = async (extra: string[]): Promise<string> => {
      const args = [cli, path.join(dir, 'tests'), '--format', 'json', '--threshold', '0', ...extra];
      return (await execFileAsync(process.execPath, args, { cwd: dir }).catch((e: { stdout?: string }) => ({ stdout: e.stdout ?? '' }))).stdout;
    };
    const [byDefault, on, off, lastWins] = [await stdout([]), await stdout(['--shared']), await stdout(['--no-shared']), await stdout(['--shared', '--no-shared'])];
    const parsed = (s: string) => JSON.parse(s) as ScoreResult;
    assert.equal(brief(parsed(byDefault)).length, 3);
    assert.equal(on, byDefault, '--shared restates the default, byte for byte');
    assert.deepEqual(brief(parsed(off)), []);
    assert.ok(!off.includes('"usedBy"'));
    assert.equal(lastWins, off, 'the last of the two flags wins');
    assert.deepEqual(parsed(byDefault).findings.filter((f) => f.scope !== 'shared'), parsed(off).findings);
    assert.deepEqual(parsed(byDefault).coverage, parsed(off).coverage);
  });
});
