import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scorePaths } from '../src/index.js';
import { expectAliases } from '../src/expect-alias.js';
import type { Finding } from '../src/types.js';

// QAG-287 S4b.2: a `const` alias of Playwright's `expect` (`const verify = expect; verify(locator)...`) is checked
// like `expect` by the six assertion rules, and only where the binding resolver proves the alias at the call.
// Oracle: each added finding is the finding the same rule gives when the alias at that call is renamed to
// `expect`. The alias `verify` has the length of `expect`, so a rename keeps every column.
// Names, selectors and values are invented.

const BODY = (e: string): string => `test('orders', async ({ page }) => {
  await page.goto('/orders');
  ${e}(page.locator('#total')).toBeTruthy();
  ${e}(true).toBe(true);
  ${e}(page.title()).toBe('Orders');
  ${e}(await page.isVisible('#total')).toBe(true);
  ${e}(page.getByRole('status')).toBeVisible();
  ${e}(page.getByRole('heading'));
});
`;
/** The six rules of the slice, one finding each on lines 4 to 9. */
const SIX = [
  'pwscore/no-weak-assertion', 'pwscore/no-trivial-assertion', 'pwscore/no-unawaited-expect-value',
  'playwright/prefer-web-first-assertions', 'playwright/missing-playwright-await', 'playwright/valid-expect',
];
const UNASSERTED = 'pwscore/unasserted';
const MATCHER = `{ toHaveAmount(received: unknown, amount: number) { return { pass: received === amount, message: () => 'amount' }; } }`;

async function score(files: Record<string, string>, spec: string, aliases = true): Promise<Finding[]> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-alias-'));
  expectAliases.enabled = aliases;
  try {
    for (const [name, body] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      fs.writeFileSync(path.join(dir, name), body);
    }
    return (await scorePaths({ paths: [path.join(dir, spec)], profile: 'standard', threshold: 0, cwd: dir })).findings;
  } finally {
    expectAliases.enabled = true;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
/** Every field a reader sees of a finding. */
const full = (f: Finding): string =>
  JSON.stringify([f.rule, f.file, f.line, f.column, f.message, f.form, f.tier, f.severity, f.reportOnly, f.title, f.what, f.why, f.fix, f.docs]);
/** The six rules' findings on the BODY lines, as a reader sees them. */
const seen = (all: Finding[]): string[] =>
  all.filter((f) => SIX.includes(f.rule) && typeof f.line === 'number' && f.line >= 4 && f.line <= 9).map(full).sort();
/** `on` minus `off` as multisets of full findings; throws when `on` lacks a finding of `off` (not a superset). */
function added(on: Finding[], off: Finding[]): Finding[] {
  const left = new Map<string, number>();
  for (const f of on) left.set(full(f), (left.get(full(f)) ?? 0) + 1);
  for (const f of off) {
    const n = left.get(full(f)) ?? 0;
    assert.ok(n > 0, `a finding without the alias step is missing with it: ${full(f)}`);
    left.set(full(f), n - 1);
  }
  const extra: Finding[] = [];
  for (const f of on) {
    const n = left.get(full(f)) ?? 0;
    if (n > 0) {
      extra.push(f);
      left.set(full(f), n - 1);
    }
  }
  return extra;
}

const TS = (decl: string, imports = 'test, expect'): string => `import { ${imports} } from '@playwright/test'; ${decl}\n`;
const ALIASES: Array<[string, (e: string) => Record<string, string>, string]> = [
  ['TS const alias', (e) => ({ 'a.spec.ts': TS('const verify = expect;') + BODY(e) }), 'a.spec.ts'],
  ['JS const alias', (e) => ({ 'a.spec.js': `const { test, expect } = require('@playwright/test'); const verify = expect;\n${BODY(e)}` }), 'a.spec.js'],
  ['alias of an alias', (e) => ({ 'a.spec.ts': TS('const first = expect; const verify = first;') + BODY(e) }), 'a.spec.ts'],
  ['alias of an extended expect', (e) => ({ 'a.spec.ts': TS(`const expect = base.extend(${MATCHER}); const verify = expect;`, 'test, expect as base') + BODY(e) }), 'a.spec.ts'],
  ['alias of a configured expect', (e) => ({ 'a.spec.ts': TS('const expect = base.configure({ timeout: 10_000 }); const verify = expect;', 'test, expect as base') + BODY(e) }), 'a.spec.ts'],
  ['alias of a merged expect', (e) => ({ 'a.spec.ts': TS('const expect = mergeExpects(base, base); const verify = expect;', 'test, expect as base, mergeExpects') + BODY(e) }), 'a.spec.ts'],
  [
    'alias exported by a local module',
    (e) => ({
      'a.spec.ts': `import { test, expect, verify } from './fixtures';\n${BODY(e)}`,
      'fixtures.ts': `import { test, expect } from '@playwright/test';\nexport { test, expect };\nexport const verify = expect;\n`,
    }),
    'a.spec.ts',
  ],
];

const NOT_ALIASES: Array<[string, Record<string, string>, string]> = [
  ['a let alias that is reassigned', { 'a.spec.ts': TS('let verify = expect; verify = expect;') + BODY('verify') }, 'a.spec.ts'],
  ['a let alias', { 'a.spec.ts': TS('let verify = expect;') + BODY('verify') }, 'a.spec.ts'],
  ['a var alias', { 'a.spec.js': `const { test, expect } = require('@playwright/test'); var verify = expect;\n${BODY('verify')}` }, 'a.spec.js'],
  ['an alias of a chai expect', { 'a.spec.ts': `import { test } from '@playwright/test'; import { expect as assertThat } from 'chai'; const verify = assertThat;\n${BODY('verify')}` }, 'a.spec.ts'],
  ['an alias of an unresolved expect', { 'a.spec.ts': `import { test } from '@playwright/test'; import { expect } from './missing-helpers'; const verify = expect;\n${BODY('verify')}` }, 'a.spec.ts'],
  ['a function that calls expect', { 'a.spec.ts': TS('const verify = (value: unknown) => expect(value);') + BODY('verify') }, 'a.spec.ts'],
];

describe('S4b.2: a const alias of Playwright expect is checked like expect', () => {
  after(() => {
    expectAliases.enabled = true;
  });

  for (const [name, files, spec] of ALIASES) {
    it(`${name}: each of the six rules adds the finding the rename to expect gives, and nothing else`, async () => {
      const on = await score(files('verify'), spec);
      const off = await score(files('verify'), spec, false);
      const renamed = await score(files('expect'), spec);
      for (const rule of SIX) {
        const i = SIX.indexOf(rule);
        assert.equal(on.filter((f) => f.rule === rule && f.line === 4 + i).length, 1, `${rule} on line ${4 + i}`);
      }
      assert.deepEqual(seen(on), seen(renamed), 'the oracle: same rule, line, column, message, form, tier and copy');
      // pwscore/unasserted (S12) reads the test as a whole: without the step a test whose checks all go through the
      // alias can be unasserted, so the step may remove that finding. With the step it matches the rename to expect.
      const unasserted = (all: Finding[]): string[] => all.filter((f) => f.rule === UNASSERTED).map(full).sort();
      assert.deepEqual(unasserted(on), unasserted(renamed), 'pwscore/unasserted: same as the rename to expect');
      const extra = added(on, off.filter((f) => f.rule !== UNASSERTED));
      assert.equal(extra.length, seen(renamed).length);
      for (const f of extra) assert.ok(SIX.includes(f.rule) && (f.line as number) >= 4 && (f.line as number) <= 9, full(f));
      assert.equal(seen(off).length, 0, 'without the step no rule reads the alias');
    });
  }

  for (const [name, files, spec] of NOT_ALIASES) {
    it(`${name}: no finding is added`, async () => {
      const on = await score(files, spec);
      const off = await score(files, spec, false);
      assert.deepEqual(on.map(full).sort(), off.map(full).sort());
      assert.equal(seen(on).length, 0);
    });
  }

  it('a parameter that shadows the alias is not read as it; the alias in another test still is', async () => {
    const shadowed = BODY('verify').replace('async ({ page })', 'async ({ page, verify })');
    const later = `test('status', async ({ page }) => {\n  verify(page.getByRole('status')).toBeVisible();\n});\n`;
    const files = { 'a.spec.ts': TS('const verify = expect;') + shadowed + later };
    const on = await score(files, 'a.spec.ts');
    const off = await score(files, 'a.spec.ts', false);
    const extra = added(on, off).map((f) => `${f.rule}@${f.line}:${f.column}`);
    assert.deepEqual(extra, ['playwright/missing-playwright-await@12:3']);
  });

  it('an awaited aliased assertion adds nothing', async () => {
    const files = { 'a.spec.ts': TS('const verify = expect;') + `test('status', async ({ page }) => {\n  await verify(page.getByRole('status')).toBeVisible();\n});\n` };
    assert.deepEqual((await score(files, 'a.spec.ts')).map(full).sort(), (await score(files, 'a.spec.ts', false)).map(full).sort());
  });

  it('rules outside the six are unchanged: expect-expect on an alias-only test keeps its finding (report only)', async () => {
    // Not `verify`: expect-expect already counts a `verify(...)` call as an assertion by name
    // (assertFunctionPatterns), so it never fires there with or without the alias step.
    const files = {
      'a.spec.ts': TS('const affirm = expect;') + `test('status', async ({ page }) => {\n  await page.goto('/');\n  if (page.url()) affirm(page.getByRole('status')).toBeVisible();\n});\n`,
    };
    const on = await score(files, 'a.spec.ts');
    const off = await score(files, 'a.spec.ts', false);
    const outside = (all: Finding[]): string[] => all.filter((f) => !SIX.includes(f.rule)).map(full).sort();
    assert.deepEqual(outside(on), outside(off));
    assert.ok(on.some((f) => f.rule === 'playwright/expect-expect'), 'expect-expect does not see the alias (out of scope)');
    assert.deepEqual(added(on, off).map((f) => f.rule), ['playwright/missing-playwright-await']);
  });
});
