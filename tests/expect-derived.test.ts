import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scorePaths } from '../src/index.js';
import type { Finding } from '../src/types.js';

// QAG-287 S4b.1: an expect made by Playwright's own APIs is Playwright's. `expect.extend(...)`,
// `expect.configure(...)` (playwright.dev/docs/test-assertions) and `mergeExpects(...)`
// (playwright.dev/docs/test-fixtures) each return an expect, so a finding on such an expect is the same finding
// as on the imported one. The same call on a foreign or unresolved expect proves nothing: needs-check.
// Names, selectors and values are invented.

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
/** The six rules of the slice, one finding each on lines 4 to 9. */
const SIX = [
  'pwscore/no-weak-assertion', 'pwscore/no-trivial-assertion', 'pwscore/no-unawaited-expect-value',
  'playwright/prefer-web-first-assertions', 'playwright/missing-playwright-await', 'playwright/valid-expect',
];
const MATCHER = `{ toHaveAmount(received: unknown, amount: number) { return { pass: received === amount, message: () => 'amount' }; } }`;

async function score(files: Record<string, string>, spec = 'a.spec.ts'): Promise<Finding[]> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-derived-'));
  try {
    for (const [name, body] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      fs.writeFileSync(path.join(dir, name), body);
    }
    return (await scorePaths({ paths: [path.join(dir, spec)], profile: 'standard', threshold: 0, cwd: dir })).findings;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
/** Everything a reader sees of the findings on the BODY lines. */
const seen = (all: Finding[]): string[] =>
  all
    .filter((f) => typeof f.line === 'number' && f.line >= 4 && f.line <= 9)
    .map((f) => JSON.stringify([f.rule, f.line, f.column, f.message, f.form, f.tier, f.title, f.what, f.why, f.fix, f.docs]))
    .sort();
const six = (all: Finding[]): Finding[] => SIX.map((rule, i) => {
  const hit = all.filter((f) => f.rule === rule && f.line === 4 + i);
  assert.equal(hit.length, 1, `${rule}: one finding on line ${4 + i}, got ${hit.length}`);
  return hit[0];
});

const TS_HEAD = (init: string): string => `import { test, expect as base, mergeExpects } from '@playwright/test'; const expect = ${init};\n${BODY}`;
const JS_HEAD = (init: string): string => `const { test, expect: base, mergeExpects } = require('@playwright/test'); const expect = ${init};\n${BODY}`;
const SPEC = `import { test, expect } from './fixtures';\n${BODY}`;
const FX = (rest: string): string => `import { test, expect as base, mergeExpects } from '@playwright/test';\nexport { test };\n${rest}`;

const PROVEN: Array<[string, Record<string, string>, string?]> = [
  ['TS extend', { 'a.spec.ts': TS_HEAD(`base.extend(${MATCHER})`) }],
  ['TS configure', { 'a.spec.ts': TS_HEAD(`base.configure({ timeout: 10_000 })`) }],
  ['TS configure of extend', { 'a.spec.ts': TS_HEAD(`base.extend(${MATCHER}).configure({ soft: true })`) }],
  ['TS mergeExpects', { 'a.spec.ts': TS_HEAD(`mergeExpects(base.extend(${MATCHER}), base)`) }],
  ['TS extend through a const', { 'a.spec.ts': `import { test, expect as base } from '@playwright/test'; const money = base.extend(${MATCHER}); const expect = money;\n${BODY}` }],
  ['TS playwright/test', { 'a.spec.ts': `import { test, expect as base } from 'playwright/test'; const expect = base.extend(${MATCHER});\n${BODY}` }],
  ['JS extend', { 'a.spec.js': JS_HEAD(`base.extend({ toHaveAmount(received, amount) { return { pass: received === amount, message: () => 'amount' }; } })`) }, 'a.spec.js'],
  ['JS configure', { 'a.spec.js': JS_HEAD(`base.configure({ soft: true })`) }, 'a.spec.js'],
  ['JS mergeExpects', { 'a.spec.js': JS_HEAD(`mergeExpects(base, base.configure({ timeout: 2_000 }))`) }, 'a.spec.js'],
  ['cross-module extend', { 'a.spec.ts': SPEC, 'fixtures.ts': FX(`export const expect = base.extend(${MATCHER});\n`) }],
  ['cross-module configure', { 'a.spec.ts': SPEC, 'fixtures.ts': FX(`export const expect = base.configure({ timeout: 10_000 });\n`) }],
  ['cross-module mergeExpects of two modules', {
    'a.spec.ts': SPEC,
    'fixtures.ts': `import { mergeExpects } from '@playwright/test';\nimport { expect as money } from './money';\nimport { expect as slow } from './slow';\nexport { test } from '@playwright/test';\nexport const expect = mergeExpects(money, slow);\n`,
    'money.ts': `import { expect as base } from '@playwright/test';\nexport const expect = base.extend(${MATCHER});\n`,
    'slow.ts': `import { expect as base } from '@playwright/test';\nexport const expect = base.configure({ timeout: 10_000 });\n`,
  }],
  ['cross-module extend of an imported extend', {
    'a.spec.ts': `import { test } from '@playwright/test'; import { expect as money } from './money'; const expect = money.extend({});\n${BODY}`,
    'money.ts': `import { expect as base } from '@playwright/test';\nexport const expect = base.extend(${MATCHER});\n`,
  }],
  ['cross-module JS extend', {
    'a.spec.js': `const { test, expect } = require('./fixtures');\n${BODY}`,
    'fixtures.js': `const { test, expect: base } = require('@playwright/test');\nconst expect = base.extend({});\nmodule.exports = { test, expect };\n`,
  }, 'a.spec.js'],
];

const NOT_PROVEN: Array<[string, Record<string, string>]> = [
  ['extend on a chai expect', { 'a.spec.ts': `import { test } from '@playwright/test'; import { expect as base } from 'chai'; const expect = base.extend({});\n${BODY}` }],
  ['configure on a vitest expect', { 'a.spec.ts': `import { test } from '@playwright/test'; import { expect as base } from 'vitest'; const expect = base.configure({});\n${BODY}` }],
  ['extend on a global expect', { 'a.spec.ts': `import { test } from '@playwright/test'; const expect = globalThis.expect.extend({});\n${BODY}` }],
  ['extend on an expect of an unknown package', { 'a.spec.ts': `import { test } from '@playwright/test'; import { expect as base } from '@acme/test-kit'; const expect = base.extend({});\n${BODY}` }],
  ['extend on a let binding', { 'a.spec.ts': `import { test, expect as first } from '@playwright/test'; let base = first; const expect = base.extend({});\n${BODY}` }],
  ['extend on Playwright\'s test', { 'a.spec.ts': `import { test } from '@playwright/test'; const expect = test.extend({});\n${BODY}` }],
  ['another method of Playwright\'s expect', { 'a.spec.ts': TS_HEAD(`base.poll(() => 1)`) }],
  ['a computed extend', { 'a.spec.ts': TS_HEAD(`base['extend']({})`) }],
  ['mergeExpects with one chai argument', { 'a.spec.ts': `import { test, expect as base, mergeExpects } from '@playwright/test'; import { expect as other } from 'chai'; const expect = mergeExpects(base, other);\n${BODY}` }],
  ['mergeExpects with one unresolved argument', { 'a.spec.ts': TS_HEAD(`mergeExpects(base, globalThis.expect)`) }],
  ['mergeExpects with a spread argument', { 'a.spec.ts': TS_HEAD(`mergeExpects(...[base, base])`) }],
  ['mergeExpects with no argument', { 'a.spec.ts': TS_HEAD(`(mergeExpects as any)()`) }],
  ['a local mergeExpects', { 'a.spec.ts': `import { test, expect as base } from '@playwright/test'; import { mergeExpects } from './merge'; const expect = mergeExpects(base, base);\n${BODY}`, 'merge.ts': `export const mergeExpects = (a: unknown, b: unknown): any => b;\n` }],
  ['mergeExpects of another package', { 'a.spec.ts': `import { test, expect as base } from '@playwright/test'; import { mergeExpects } from '@acme/test-kit'; const expect = mergeExpects(base, base);\n${BODY}` }],
  ['cross-module extend on a chai expect', { 'a.spec.ts': SPEC, 'fixtures.ts': `import { expect as base } from 'chai';\nexport { test } from '@playwright/test';\nexport const expect = base.extend({});\n` }],
  ['cross-module mergeExpects with one module on chai', {
    'a.spec.ts': SPEC,
    'fixtures.ts': `import { mergeExpects } from '@playwright/test';\nimport { expect as money } from './money';\nimport { expect as other } from './other';\nexport { test } from '@playwright/test';\nexport const expect = mergeExpects(money, other);\n`,
    'money.ts': `import { expect as base } from '@playwright/test';\nexport const expect = base.extend({});\n`,
    'other.ts': `export { expect } from 'chai';\n`,
  }],
];

describe('QAG-287 S4b.1: an expect made by extend, configure or mergeExpects is Playwright\'s', () => {
  const baseline: Record<string, Promise<string[]>> = {};
  const plain = (spec: string): Promise<string[]> =>
    (baseline[spec] ??= score({ [spec]: spec.endsWith('.js') ? `const { test, expect } = require('@playwright/test');\n${BODY}` : `import { test, expect } from '@playwright/test';\n${BODY}` }, spec).then(seen));

  it('the plain import gives one finding of each of the six rules, none needs-check', async () => {
    const all = await score({ 'a.spec.ts': `import { test, expect } from '@playwright/test';\n${BODY}` });
    assert.ok(six(all).every((f) => f.tier !== 'needs-check' && f.form !== 'foreign-expect'));
    assert.ok(six(all).some((f) => f.tier === 'certain'));
  });

  for (const [name, files, spec = 'a.spec.ts'] of PROVEN) {
    it(`${name}: every finding is the one the plain import gives`, async () => {
      const mine = await score(files, spec);
      six(mine);
      assert.deepEqual(seen(mine), await plain(spec));
    });
  }
});

describe('QAG-287 S4b.1: the same call on any other expect proves nothing', () => {
  for (const [name, files] of NOT_PROVEN) {
    it(`${name}: all six rules are needs-check with the reason`, async () => {
      for (const f of six(await score(files))) {
        assert.equal(f.tier, 'needs-check', f.rule);
        assert.notEqual(f.form, 'foreign-expect', f.rule);
        assert.match(f.what ?? '', /expect binding not resolved \(global or unknown package\) in (a\.spec|fixtures)\.ts:\d+\.$/, f.rule);
      }
    });
  }
});
