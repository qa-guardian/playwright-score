import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scorePaths } from '../src/index.js';
import { rowFor, tierOf } from '../src/catalogue/index.js';
import { foreignExpectRows } from '../src/catalogue/foreign-expect.js';
import { expectBinding } from '../src/expect-binding.js';

// QAG-287 S7a: pwscore/no-floating-callback-assertion (class C5). An awaited assertion inside an async forEach
// callback, or an async map callback whose result is discarded. Widening: one new rule id, form '-', nothing else.

const RULE = 'pwscore/no-floating-callback-assertion';
const here = path.dirname(fileURLToPath(import.meta.url));
// The package root (the source tree, not dist-tests), found as tests/rule-fixtures.test.ts finds it.
const root = ((): string => {
  let dir = here;
  for (let i = 0; i < 6; i++, dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'fixtures'))) return dir;
  }
  throw new Error('package root not found');
})();
const cells = path.join(root, 'tests', 'fixtures', 'cells');
const cell = path.join(cells, 'pwscore__no-floating-callback-assertion', '-');

type F = Awaited<ReturnType<typeof scorePaths>>['findings'][number];
const mine = (fs_: F[]): F[] => fs_.filter((f) => f.rule === RULE);

async function scoreFile(file: string): Promise<F[]> {
  return (await scorePaths({ paths: [file], profile: 'standard', threshold: 0, cwd: cells })).findings;
}

const PW = "import { test, expect } from '@playwright/test';";
async function score(body: string, head = PW): Promise<F[]> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-floating-'));
  try {
    const file = path.join(dir, 'a.spec.ts');
    fs.writeFileSync(file, `${head}\ntest('t', async ({ page }) => {\n  await page.goto('/cart');\n  const names = ['Tea', 'Milk'];\n${body}\n});\n`);
    return (await scorePaths({ paths: [file], profile: 'standard', threshold: 0, cwd: dir })).findings;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const SHOWN = 'await expect(page.getByText(name)).toBeVisible();';

// Pinned by hand from the files, not derived from the manifest: file -> line of the forEach / map call.
const TRUE_AT: Array<[string, number]> = [
  ['true-foreach-async.ts', 6],
  ['true-map-async-statement.ts', 6],
  ['true-locator-all-foreach.ts', 6],
  ['true-js-foreach-async.js', 6],
  ['true-aliased-test.ts', 7],
  ['true-alias-const-locator.ts', 6],
  ['true-alias-const-page.ts', 6],
  ['true-js-map-async-statement.js', 5],
  ['true-poll-foreach.ts', 6],
  ['true-to-pass-map-statement.ts', 6],
  ['true-function-expression-callback.ts', 6],
];
const FALSE_FILES = [
  'false-for-of-awaited.ts',
  'false-js-for-of.js',
  'false-promise-all-map.ts',
  'false-sync-foreach-on-values.ts',
  'false-foreach-custom-awaiting-collection.ts',
  'false-foreach-custom-awaiting-js.js',
  'false-for-of-awaited-locator-all.ts',
  'false-promise-all-items-map.ts',
  'false-map-assigned-then-awaited.ts',
  'false-map-returned-from-helper.ts',
  'false-chai-expect-foreach-async.ts',
];

describe('QAG-287 S7a: the catalogue row', () => {
  it('is a C5 passes-regardless candidate on the assertions docs, likely until measured, with no foreign-expect cell', () => {
    const row = rowFor(RULE, '-')!;
    assert.ok(row);
    assert.deepEqual([row.family, row.design, row.cls, row.basis, row.docs, row.bcEligible], ['passes-regardless', 'candidate', 'C5', 'docs', 'https://playwright.dev/docs/test-assertions', true]);
    assert.ok(row.docsSentence?.includes('Note that retrying assertions are async, so you must await them.'));
    assert.equal(tierOf(row), 'likely');
    assert.equal(rowFor(RULE, 'foreign-expect'), undefined);
    assert.equal(foreignExpectRows.length, 6);
  });
});

describe('QAG-287 S7a: TRUE fixtures', () => {
  for (const [name, line] of TRUE_AT) {
    it(`${name}: one finding at the forEach/map name on line ${line}, form '-', tier likely`, async () => {
      const file = path.join(cell, name);
      const hits = mine(await scoreFile(file));
      assert.deepEqual(hits.map((f) => [f.line, f.form, f.tier]), [[line, '-', 'likely']]);
      const text = fs.readFileSync(file, 'utf8').split('\n')[line - 1];
      assert.match(text.slice(hits[0].column! - 1), /^(forEach|map)\(async /);
    });
  }
});

describe('QAG-287 S7a: FALSE fixtures', () => {
  for (const name of FALSE_FILES) {
    it(`${name}: no finding`, async () => {
      assert.deepEqual(mine(await scoreFile(path.join(cell, name))), []);
    });
  }

  it('the chai fixture is silent because the binding proves the expect foreign, not because the shape is missed', async () => {
    const file = path.join(cell, 'false-chai-expect-foreach-async.ts');
    let off: F[];
    try {
      expectBinding.enabled = false;
      off = mine(await scoreFile(file));
    } finally {
      expectBinding.enabled = true;
    }
    assert.deepEqual(off.map((f) => f.line), [7]);
  });
});

describe('QAG-287 S7a: shapes', () => {
  it('flags through an optional call and an assertion nested in a block of the callback', async () => {
    assert.equal(mine(await score(`  names?.forEach(async (name) => {\n    ${SHOWN}\n  });`)).length, 1);
    assert.equal(mine(await score(`  names.forEach(async (name) => {\n    if (name) {\n      try {\n        ${SHOWN}\n      } finally {\n        await page.goto('/cart');\n      }\n    }\n  });`)).length, 1);
  });

  it('a renamed import of Playwright expect is read as expect and proven: likely', async () => {
    const hits = mine(await score('  names.forEach(async (name) => {\n    await check(page.getByText(name)).toBeVisible();\n  });', "import { test, expect as check } from '@playwright/test';"));
    assert.deepEqual(hits.map((f) => f.tier), ['likely']);
  });

  it('an unresolved expect gives the finding with tier needs-check and the reason', async () => {
    const hits = mine(await score(`  names.forEach(async (name) => {\n    ${SHOWN}\n  });`, "import { test } from '@playwright/test';"));
    assert.equal(hits.length, 1);
    assert.equal(hits[0].tier, 'needs-check');
    assert.match(hits[0].what ?? '', /expect binding not resolved/);
  });

  it('a proven foreign expect gives no finding; one Playwright assertion next to it keeps the finding', async () => {
    const vitest = "import { test } from '@playwright/test';\nimport { expect } from 'vitest';";
    assert.deepEqual(mine(await score('  names.forEach(async (name) => {\n    await expect(name).toBeTruthy();\n  });', vitest)), []);
    const both = `${PW}\nimport { expect as chaiExpect } from 'chai';`;
    const hits = mine(await score(`  names.forEach(async (name) => {\n    await chaiExpect(name).to.be.a('string');\n    ${SHOWN}\n  });`, both));
    assert.deepEqual(hits.map((f) => [f.form, f.tier]), [['-', 'likely']]);
  });

  it('is silent on an awaited forEach, an unawaited assertion, a nested function and a non-async callback', async () => {
    for (const body of [
      `  await names.forEach(async (name) => {\n    ${SHOWN}\n  });`,
      '  names.forEach(async (name) => {\n    expect(name).toBeTruthy();\n  });',
      `  names.forEach(async (name) => {\n    const check = async () => {\n      ${SHOWN}\n    };\n    await check();\n  });`,
      '  names.forEach((name) => {\n    void expect(page.getByText(name)).toBeVisible();\n  });',
      `  names.filter(async (name) => {\n    ${SHOWN}\n  });`,
    ]) {
      assert.deepEqual(mine(await score(body)), [], body);
    }
  });
});
