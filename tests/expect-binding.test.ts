import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scorePaths, formatJson } from '../src/index.js';
import { applyExpectBinding, expectBinding, settleExpectBinding, unresolvedReason, voidedTier, EXPECT_BOUND_RULES, FOREIGN_PACKAGES } from '../src/expect-binding.js';
import { FOREIGN_EXPECT_COPY, foreignExpectRows } from '../src/catalogue/foreign-expect.js';
import { ROWS, rowFor, tierOf } from '../src/catalogue/index.js';
import type { Finding, ScoreResult } from '../src/types.js';

// QAG-287 S4b: expect binding. A finding of a rule about Playwright assertions is unchanged when its `expect` is
// proven to be Playwright's, moves to form `foreign-expect` (advisory) when it is proven to come from another
// assertion library, and gets tier `needs-check` with the reason when the binding is not resolved.
// Shapes are written from playwright.dev and the other libraries' docs, with invented names.

/** The six rules of the slice, written out: the suite fails if the list or the step drops one. */
const AWAIT = 'playwright/missing-playwright-await';
const VALID = 'playwright/valid-expect';
const VALUE = 'pwscore/no-unawaited-expect-value';
const WEAK = 'pwscore/no-weak-assertion';
const TRIVIAL = 'pwscore/no-trivial-assertion';
const WEB_FIRST = 'playwright/prefer-web-first-assertions';
const SIX = [AWAIT, VALID, VALUE, WEAK, TRIVIAL, WEB_FIRST];
/** The form each rule's finding has in BODY when `expect` is Playwright's. */
const SHAPE: Record<string, string> = { [AWAIT]: 'assertion', [VALID]: 'matcherless', [VALUE]: '-', [WEAK]: '-', [TRIVIAL]: 'literal', [WEB_FIRST]: 'read-direct' };

/** One finding of each of the six rules, on lines 4 to 9 after a one-line header. */
const BODY = `test('orders', async ({ page }) => {
  await page.goto('/orders');
  expect(page.locator('#total')).toBeTruthy();
  expect(true).toBe(true);
  expect(page.title()).toBe('Orders');
  expect(await page.isVisible('#total')).toBe(true);
  expect(page.getByRole('status')).toBeVisible();
  expect(page.getByRole('heading'));
});
`;
const LINE: Record<string, number> = { [WEAK]: 4, [TRIVIAL]: 5, [VALUE]: 6, [WEB_FIRST]: 7, [AWAIT]: 8, [VALID]: 9 };
const PW = `import { test, expect } from '@playwright/test';\n`;
const T = `import { test } from '@playwright/test';`;

async function run(files: Record<string, string>, spec = 'a.spec.ts'): Promise<ScoreResult> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-expect-'));
  try {
    for (const [name, body] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      fs.writeFileSync(path.join(dir, name), body);
    }
    return await scorePaths({ paths: [path.join(dir, spec)], profile: 'standard', threshold: 0, cwd: dir });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const score = async (files: Record<string, string> | string, spec = 'a.spec.ts'): Promise<Finding[]> =>
  (await run(typeof files === 'string' ? { [spec]: files } : files, spec)).findings;

/** The finding of each of the six rules on its BODY line. */
function six(all: Finding[]): Finding[] {
  return SIX.map((rule) => {
    const hit = all.filter((f) => f.rule === rule && f.line === LINE[rule]);
    assert.equal(hit.length, 1, `${rule}: one finding on line ${LINE[rule]}, got ${hit.length}`);
    return hit[0];
  });
}
const cells = (fs_: Finding[]): string[] => fs_.map((f) => `${f.rule}:${f.form}:${f.tier}`);
const shapeTier = (rule: string): string => tierOf(rowFor(rule, SHAPE[rule])!);
const proven = SIX.map((rule) => `${rule}:${SHAPE[rule]}:${shapeTier(rule)}`);
const foreign = SIX.map((rule) => `${rule}:foreign-expect:advisory`);
const unresolved = SIX.map((rule) => `${rule}:${SHAPE[rule]}:needs-check`);
const key = (f: Finding): string => JSON.stringify([f.rule, f.file, f.line, f.column, f.message]);

describe('QAG-287 S4b: the catalogue holds the foreign-expect cells as one data entry', () => {
  it('the list is the six rules and the two rules of later slices', () => {
    assert.deepEqual([...EXPECT_BOUND_RULES], [...[AWAIT, VALID, VALUE, WEAK, TRIVIAL, WEB_FIRST], 'pwscore/no-floating-callback-assertion', 'pwscore/assertion-passes-anyway']);
  });

  it('each of the six rules has one advisory foreign-expect row with the neutral copy, and no other rule has one', () => {
    assert.deepEqual(ROWS.filter((r) => r.form === 'foreign-expect').map((r) => r.rule).sort(), [...SIX].sort());
    assert.equal(foreignExpectRows.length, 6);
    for (const rule of SIX) {
      const row = rowFor(rule, 'foreign-expect')!;
      assert.equal(row.design, 'advisory', rule);
      assert.equal(tierOf(row), 'advisory', rule);
      assert.equal(row.bcEligible, false, rule);
      assert.equal(row.cls, undefined, rule);
      assert.deepEqual({ title: row.title, what: row.what, why: row.why, fix: row.fix }, FOREIGN_EXPECT_COPY, rule);
    }
  });

  it('the first row of every rule is still its own shape', () => {
    for (const rule of SIX) assert.notEqual(ROWS.find((r) => r.rule === rule)!.form, 'foreign-expect', rule);
  });

  it('the foreign packages are the five the slice names', () => {
    assert.deepEqual([...FOREIGN_PACKAGES], ['chai', '@jest/globals', 'vitest', 'expect', 'node:assert']);
  });

  it('the public copy names no tool', () => {
    for (const text of [...Object.values(FOREIGN_EXPECT_COPY), unresolvedReason('a.spec.ts:3')]) assert.doesNotMatch(text, /claude|anthropic|\bAI\b|\bLLM\b/i);
  });
});

describe('QAG-287 S4b: a proven Playwright expect is unchanged', () => {
  const cases: Array<[string, Record<string, string>]> = [
    ['@playwright/test', { 'a.spec.ts': PW + BODY }],
    ['playwright/test', { 'a.spec.ts': `import { test, expect } from 'playwright/test';\n${BODY}` }],
    ['a renamed import bound to a const', { 'a.spec.ts': `import { test, expect as baseExpect } from '@playwright/test'; const expect = baseExpect;\n${BODY}` }],
    ['a namespace import', { 'a.spec.ts': `import * as pw from '@playwright/test'; const { test, expect } = pw;\n${BODY}` }],
    ['a local re-export', { 'a.spec.ts': `import { test, expect } from './fixtures';\n${BODY}`, 'fixtures.ts': `export { test, expect } from '@playwright/test';\n` }],
    ['a local export *', { 'a.spec.ts': `import { test, expect } from './fixtures';\n${BODY}`, 'fixtures.ts': `export * from '@playwright/test';\n` }],
    ['a local import then export', { 'a.spec.ts': `import { test, expect } from './fixtures';\n${BODY}`, 'fixtures.ts': `import { test, expect } from '@playwright/test';\nexport { test, expect };\n` }],
    ['two local modules', { 'a.spec.ts': `import { test, expect } from './fixtures';\n${BODY}`, 'fixtures.ts': `export { test, expect } from './base';\n`, 'base.ts': `export { test, expect } from '@playwright/test';\n` }],
  ];
  for (const [name, files] of cases) {
    it(`${name}: form, tier and copy are the rule's own`, async () => {
      const mine = six(await score(files));
      assert.deepEqual(cells(mine), proven);
      for (const f of mine) {
        const row = rowFor(f.rule, SHAPE[f.rule])!;
        assert.deepEqual({ title: f.title, what: f.what, why: f.why, fix: f.fix }, { title: row.title, what: row.what, why: row.why, fix: row.fix }, f.rule);
      }
    });
  }

  it('JS: const { expect } = require of the package', async () => {
    const mine = six(await score(`const { test, expect } = require('@playwright/test');\n${BODY}`, 'a.spec.js'));
    assert.deepEqual(cells(mine), proven);
  });

  it('the certain cell of the six stays certain (the precision file lists it)', () => {
    assert.equal(shapeTier(WEAK), 'certain');
  });
});

describe('QAG-287 S4b: a proven foreign expect moves to form foreign-expect', () => {
  const headers: Array<[string, string, string?]> = [
    ['chai', `${T} import { expect } from 'chai';`],
    ['@jest/globals', `${T} import { expect } from '@jest/globals';`],
    ['vitest', `${T} import { expect } from 'vitest';`],
    ['the default export of expect', `${T} import expect from 'expect';`],
    ['the default export of node:assert', `${T} import expect from 'node:assert';`],
    ['a renamed import of chai bound to a const', `${T} import { expect as chaiExpect } from 'chai'; const expect = chaiExpect;`],
    ['a member of the chai namespace', `${T} import * as chai from 'chai'; const expect = chai.expect;`],
    ['JS require of chai, destructured', `const { test } = require('@playwright/test'); const { expect } = require('chai');`, 'a.spec.js'],
    ['JS require of chai, member', `const { test } = require('@playwright/test'); const expect = require('chai').expect;`, 'a.spec.js'],
    ['JS require of the expect package', `const { test } = require('@playwright/test'); const expect = require('expect');`, 'a.spec.js'],
  ];
  for (const [name, header, spec] of headers) {
    it(`${name}: all six rules`, async () => {
      const mine = six(await score(`${header}\n${BODY}`, spec));
      assert.deepEqual(cells(mine), foreign);
      for (const f of mine) {
        const from = rowFor(f.rule, SHAPE[f.rule])!;
        assert.deepEqual({ title: f.title, what: f.what, why: f.why, fix: f.fix }, FOREIGN_EXPECT_COPY, f.rule);
        assert.deepEqual([f.family, f.basis, f.docs], [from.family, from.basis, from.docs], `${f.rule}: family, basis and docs stay those of the shape row`);
      }
    });
  }

  it('through a local re-export of chai', async () => {
    const mine = six(await score({ 'a.spec.ts': `${T} import { expect } from './assertions';\n${BODY}`, 'assertions.ts': `export { expect } from 'chai';\n` }));
    assert.deepEqual(cells(mine), foreign);
  });

  it('the finding is in the JSON output, with its form and tier', async () => {
    const result = await run({ 'a.spec.ts': `${T} import { expect } from 'chai';\n${BODY}` });
    const out = JSON.parse(formatJson(result)) as { findings: Finding[] };
    assert.deepEqual(cells(six(out.findings)), foreign);
  });

  it('valid-expect in form other keeps its own docs', async () => {
    const src = (from: string): string => `${T} import { expect } from '${from}';\ntest('orders', async ({ page }) => {\n  expect(page.getByRole('heading'), 'shown', 3).toBeVisible();\n});\n`;
    const own = (await score(`import { test, expect } from '@playwright/test';\ntest('orders', async ({ page }) => {\n  expect(page.getByRole('heading'), 'shown', 3).toBeVisible();\n});\n`)).filter((f) => f.rule === VALID);
    const moved = (await score(src('chai'))).filter((f) => f.rule === VALID);
    assert.ok(own.length > 0 && own.every((f) => f.form === 'other'), JSON.stringify(cells(own)));
    assert.deepEqual(moved.map((f) => f.form), own.map(() => 'foreign-expect'));
    assert.deepEqual(moved.map((f) => [f.docs, f.family, f.basis]), own.map((f) => [f.docs, f.family, f.basis]));
  });
});

describe('QAG-287 S4b: an unresolved binding gives needs-check with the reason', () => {
  const cases: Array<[string, Record<string, string>, string, string?]> = [
    ['a global expect', { 'a.spec.ts': `${T}\n${BODY}` }, 'a.spec.ts:4'],
    ['an unknown package', { 'a.spec.ts': `${T} import { expect } from '@acme/test-kit';\n${BODY}` }, 'a.spec.ts:1'],
    ['a package that is not on the foreign list', { 'a.spec.ts': `${T} import { expect } from 'earl';\n${BODY}` }, 'a.spec.ts:1'],
    ['another export of a foreign package', { 'a.spec.ts': `${T} import { should as expect } from 'chai';\n${BODY}` }, 'a.spec.ts:1'],
    ['a let binding', { 'a.spec.ts': `import { test, expect as base } from '@playwright/test'; let expect = base;\n${BODY}` }, 'a.spec.ts:1'],
    ['a call result', { 'a.spec.ts': `import { test, expect as base } from '@playwright/test'; const expect = Object.freeze(base);\n${BODY}` }, 'a.spec.ts:1'],
    ['a local module that builds its own expect', { 'a.spec.ts': `import { test, expect } from './fixtures';\n${BODY}`, 'fixtures.ts': `import { test, expect as base } from '@playwright/test';\nexport { test };\nexport const expect = Object.freeze(base);\n` }, 'fixtures.ts:3'],
    ['a local module that is missing', { 'a.spec.ts': `${T} import { expect } from './gone';\n${BODY}` }, 'a.spec.ts:1'],
    ['a parameter', { 'a.spec.ts': `${T}\nfunction suite(expect) {\n${BODY}}\n` }, 'a.spec.ts:2', 'shifted'],
  ];
  for (const [name, files, at, shifted] of cases) {
    it(`${name}: all six rules, reason at ${at}`, async () => {
      const all = await score(files);
      const mine = shifted ? SIX.map((rule) => all.find((f) => f.rule === rule && f.line === LINE[rule] + 1)!) : six(all);
      assert.deepEqual(cells(mine), unresolved);
      for (const f of mine) {
        const row = rowFor(f.rule, SHAPE[f.rule])!;
        const where = name === 'a global expect' ? `a.spec.ts:${f.line}` : at;
        assert.equal(f.what, `${row.what} The scorer could not confirm that this expect is the one from Playwright: expect binding not resolved (global or unknown package) in ${where}.`, f.rule);
        assert.equal(f.fix, `First check where this expect comes from. If it is the one from Playwright: ${row.fix}`, f.rule);
        assert.deepEqual([f.title, f.why, f.family, f.basis, f.docs], [row.title, row.why, row.family, row.basis, row.docs], f.rule);
      }
    });
  }

  it('the reason is the sentence of the slice', () => {
    assert.equal(unresolvedReason('tests/a.spec.ts:3'), 'expect binding not resolved (global or unknown package) in tests/a.spec.ts:3');
  });

  it('the certain finding of no-weak-assertion is needs-check, not certain', async () => {
    const f = six(await score(`${T}\n${BODY}`)).find((x) => x.rule === WEAK)!;
    assert.equal(f.tier, 'needs-check');
  });
});

describe('QAG-287 S4b: only findings about an expect move', () => {
  it('an unawaited action in a file whose expect is foreign keeps form action', async () => {
    const all = await score(`${T} import { expect } from 'chai';\ntest('orders', async ({ page }) => {\n  page.waitForResponse('**/api/orders');\n  expect(1).to.equal(1);\n});\n`);
    const mine = all.filter((f) => f.rule === AWAIT);
    assert.deepEqual(cells(mine), [`${AWAIT}:action:${tierOf(rowFor(AWAIT, 'action')!)}`]);
  });

  it('a finding inside the callback of a foreign expect is judged on its own chain', async () => {
    const src = (expectFrom: string): string =>
      `${T} import { expect } from '${expectFrom}'; import { expect as pwExpect } from '@playwright/test';\ntest('orders', async ({ page }) => {\n  expect(async () => {\n    pwExpect(page.getByRole('status')).toBeVisible();\n  }).to.be.ok;\n});\n`;
    const inner = (await score(src('chai'))).filter((f) => f.rule === AWAIT && f.line === 4);
    assert.deepEqual(cells(inner), [`${AWAIT}:assertion:${shapeTier(AWAIT)}`]);
  });

  it('rules that fire the same way for any assertion library are untouched', async () => {
    const body = `test('orders', async ({ page }) => {\n  if (await page.isVisible('#a')) {\n    expect(1).toBe(1);\n  }\n});\nexpect(2).toBe(2);\ntest('empty', async ({ page }) => {\n  await page.goto('/orders');\n});\n`;
    // pwscore/unasserted (S12) is left out: a test's state depends on which library its expect binds to, by design.
    const others = (fs_: Finding[]): string[] => fs_.filter((f) => !SIX.includes(f.rule) && f.rule !== 'pwscore/unasserted').map((f) => `${f.rule}:${f.line}:${f.form}:${f.tier}:${f.title}`).sort();
    const pw = others(await score(PW + body));
    assert.ok(pw.some((x) => x.startsWith('playwright/no-conditional-expect:')) && pw.some((x) => x.startsWith('playwright/expect-expect:')), JSON.stringify(pw));
    assert.deepEqual(others(await score(`${T} import { expect } from 'chai';\n${body}`)), pw);
    assert.deepEqual(others(await score(`${T}\n${body}`)), pw);
  });

  it('a finding that already has form api-under-test is left alone', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-expect-'));
    try {
      const file = path.join(dir, 'a.spec.ts');
      const source = `${T} import { expect } from 'chai';\n${BODY}`;
      fs.writeFileSync(file, source);
      const make = (form: string | undefined): Finding => ({ rule: WEAK, severity: 'error', message: 'm', file: 'a.spec.ts', line: 4, column: 3, dimension: 'assertions', ...(form ? { form } : {}) });
      const [kept, moved] = [make('api-under-test'), make(undefined)];
      applyExpectBinding([kept, moved], { filesBase: dir, sources: new Map([[file, source]]) });
      assert.equal(kept.form, 'api-under-test');
      assert.equal(moved.form, 'foreign-expect');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('precedence: foreign-expect wins over form unresolved on a proven foreign expect', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-expect-'));
    try {
      const file = path.join(dir, 'a.spec.ts');
      const source = `${T} import { expect } from 'chai';\n${BODY}`;
      fs.writeFileSync(file, source);
      // No rule of the slice has an `unresolved` cell today; the order must already hold for the day one does.
      const findings = SIX.map((rule): Finding => ({ rule, severity: 'error', message: 'm', file: 'a.spec.ts', line: LINE[rule], column: 3, dimension: 'assertions', form: 'unresolved' }));
      applyExpectBinding(findings, { filesBase: dir, sources: new Map([[file, source]]) });
      settleExpectBinding(findings);
      for (const f of findings) {
        const foreign = rowFor(f.rule, 'foreign-expect')!;
        assert.ok(foreign.family && foreign.basis, f.rule);
        assert.deepEqual([f.form, f.family, f.basis], ['foreign-expect', foreign.family, foreign.basis], f.rule);
        assert.notEqual(f.tier, 'needs-check', f.rule);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('QAG-287 S4b: a void-ed expect is never certain', () => {
  it('voidedTier lowers certain to likely and nothing else', () => {
    assert.deepEqual(['certain', 'likely', 'needs-check', 'advisory'].map((t) => voidedTier(t)), ['likely', 'likely', 'needs-check', 'advisory']);
  });

  it('a void-ed Playwright expect is still reported, in its own form', async () => {
    const all = await score(`${PW}test('menu', async ({ page }) => {\n  void expect(page.getByRole('menu')).toBeVisible();\n});\n`);
    const mine = all.filter((f) => f.rule === AWAIT);
    assert.deepEqual(mine.map((f) => `${f.line}:${f.form}`), ['3:assertion']);
    assert.notEqual(mine[0].tier, 'certain');
  });

  it('wiring: with the cell certain, the void-ed finding is likely and the plain one stays certain', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-expect-'));
    try {
      const file = path.join(dir, 'a.spec.ts');
      const source = `${PW}test('menu', async ({ page }) => {\n  void expect(page.getByRole('menu')).toBeVisible();\n  expect(page.getByRole('menu')).toBeVisible();\n});\n`;
      fs.writeFileSync(file, source);
      const make = (line: number, column: number): Finding => ({ rule: AWAIT, severity: 'error', message: 'm', file: 'a.spec.ts', line, column, dimension: 'playwrightHygiene', form: 'assertion' });
      const [voided, plain] = [make(3, 8), make(4, 3)];
      applyExpectBinding([voided, plain], { filesBase: dir, sources: new Map([[file, source]]) });
      // What the catalogue step would write if the evaluator's file listed the cell as certain.
      voided.tier = 'certain';
      plain.tier = 'certain';
      settleExpectBinding([voided, plain]);
      assert.deepEqual([voided.tier, plain.tier, voided.form, plain.form], ['likely', 'certain', 'assertion', 'assertion']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('QAG-287 S4b: the step changes form, tier and copy only', () => {
  const sources: Array<[string, string]> = [
    ['playwright', PW + BODY],
    ['foreign', `${T} import { expect } from 'chai';\n${BODY}`],
    ['unresolved', `${T}\n${BODY}`],
  ];
  for (const [name, source] of sources) {
    it(`${name}: the same findings, score and summary with the step on and off`, async () => {
      const on = await run({ 'a.spec.ts': source });
      let off: ScoreResult;
      try {
        expectBinding.enabled = false;
        off = await run({ 'a.spec.ts': source });
      } finally {
        expectBinding.enabled = true;
      }
      assert.deepEqual(on.findings.map(key).sort(), off.findings.map(key).sort());
      assert.deepEqual([on.score, on.grade, on.summary, on.dimensions], [off.score, off.grade, off.summary, off.dimensions]);
      const rest = (r: ScoreResult): unknown[] =>
        r.findings.map((f) => {
          const { form: _form, tier: _tier, title: _title, what: _what, why: _why, fix: _fix, confidence: _confidence, ...other } = f;
          return other;
        });
      assert.deepEqual(rest(on), rest(off));
      assert.equal(six(on.findings).length, 6);
    });
  }
});

describe('QAG-287 S4b: findings that are not reported on the expect itself', () => {
  const stored = (header: string, more = ''): string =>
    `${header}\ntest('orders', async ({ page }) => {\n  await page.goto('/orders');\n  const names = await page.getByRole('listitem').allTextContents();\n  console.log(names.length);\n  expect(names).toEqual(['First', 'Second']);\n${more}});\n`;
  const reused = async (source: string): Promise<string[]> => cells((await score(source)).filter((f) => f.rule === WEB_FIRST));
  const own = `${WEB_FIRST}:read-reused:${tierOf(rowFor(WEB_FIRST, 'read-reused')!)}`;

  it('a stored read is judged by the expect its name is passed to', async () => {
    assert.deepEqual(await reused(stored(PW)), [own]);
    assert.deepEqual(await reused(stored(`${T} import { expect } from 'vitest';`)), [`${WEB_FIRST}:foreign-expect:advisory`]);
    assert.deepEqual(await reused(stored(T)), [`${WEB_FIRST}:read-reused:needs-check`]);
  });

  it('a stored read passed to a Playwright expect and a foreign one stays the rule\'s own', async () => {
    const header = `${T} import { expect } from 'chai'; import { expect as pwExpect } from '@playwright/test';`;
    assert.deepEqual(await reused(stored(header, `  pwExpect(names).toHaveLength(2);\n`)), [own]);
  });

  it('an expect with no argument is judged by its own binding', async () => {
    const src = (header: string): string => `${header}\ntest('orders', async () => {\n  expect().toBe(1);\n});\n`;
    const valid = async (source: string): Promise<string[]> => cells((await score(source)).filter((f) => f.rule === VALID));
    assert.deepEqual(await valid(src(PW)), [`${VALID}:other:${tierOf(rowFor(VALID, 'other')!)}`]);
    assert.deepEqual(await valid(src(`${T} import { expect } from 'chai';`)), [`${VALID}:foreign-expect:advisory`]);
    assert.deepEqual(await valid(src(T)), [`${VALID}:other:needs-check`]);
  });

  it('an unawaited test.step is not about an expect and keeps its form and tier', async () => {
    const src = (header: string): string => `${header}\ntest('cart', async ({ page }) => {\n  test.step('open the cart', async () => {\n    await page.goto('/cart');\n  });\n});\n`;
    const step = async (source: string): Promise<string[]> => cells((await score(source)).filter((f) => f.rule === AWAIT));
    const pw = await step(src(PW));
    assert.equal(pw.length, 1);
    assert.deepEqual(await step(src(`${T} import { expect } from 'chai';`)), pw);
    assert.deepEqual(await step(src(T)), pw);
  });
});
