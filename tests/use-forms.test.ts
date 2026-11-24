import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scorePaths } from '../src/index.js';
import { useForms } from '../src/use-forms.js';
import { rowFor } from '../src/catalogue/table.js';
import type { Finding } from '../src/types.js';

// QAG-287 B3b: handle-argument (no-element-handle), escaped (valid-expect), gated (no-page-pause). Narrowing only:
// the same findings at the same positions, with only form, tier and copy changed. Positions are counted by hand.
const EH = 'playwright/no-element-handle';
const VE = 'playwright/valid-expect';
const PP = 'playwright/no-page-pause';

const SPEC = `import { test, expect } from '@playwright/test';
import { auditAccessibility } from 'a11y-audit-kit';
import { track } from 'soft-check-queue';

test('shapes', async ({ page }) => {
  const panel = await page.$('#panel');
  await auditAccessibility(panel);
  const menu = await page.$('#menu');
  await menu.click();
  if (process.env.STEP) await page.pause();
  await page.pause();
  track(expect(page.getByRole('status')));
  expect(page.getByRole('alert'));
  await auditAccessibility(await page.getByRole('table').elementHandle());
  const unused = expect(page.getByRole('banner'));
});
test('arrow body', async ({ page }) => expect(page.getByRole('main')));
`;

const CHAI = `import { expect } from 'chai';
import { test } from '@playwright/test';
import { track } from 'soft-check-queue';

function expectTitle(value: string) {
  return expect(value);
}

test('title', async ({ page }) => {
  track(expectTitle(await page.title()));
});
`;

const HELPER = `import { test, expect } from '@playwright/test';
import { auditAccessibility } from 'a11y-audit-kit';

async function stop(page) {
  if (process.env.STEP) await page.pause();
  await auditAccessibility(await page.$('#panel'));
}

test('helper', async ({ page }) => {
  await stop(page);
  await expect(page.getByRole('heading')).toBeVisible();
});
`;

async function score(spec: string, opts: { on?: boolean; pkg?: string } = {}): Promise<Finding[]> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-uf-'));
  useForms.enabled = opts.on ?? true;
  try {
    if (opts.pkg) fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: opts.pkg, version: '0.0.0', private: true }));
    fs.mkdirSync(path.join(dir, 'tests'));
    const file = path.join(dir, 'tests', 'shapes.spec.ts');
    fs.writeFileSync(file, spec);
    // In process: the escaped form is decided in the lint, which runs in the worker otherwise.
    return (await scorePaths({ paths: [opts.pkg ? path.join(dir, 'tests') : file], profile: 'standard', threshold: 0, cwd: dir, isolate: false })).findings;
  } finally {
    useForms.enabled = true;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const MINE = [EH, VE, PP];
const where = (xs: Finding[]): string[] => xs.filter((f) => MINE.includes(f.rule)).map((f) => `${f.rule}@${f.line}:${f.column} ${f.form}`).sort();
const COPY = ['form', 'tier', 'title', 'what', 'why', 'fix', 'confidence', 'family', 'basis', 'docs'];
const ident = (f: Finding): string => JSON.stringify(Object.fromEntries(Object.entries(f).filter(([k]) => !COPY.includes(k)).sort()));

describe('QAG-287 B3b: use forms', () => {
  it('moves only the listed shapes, and only their form, tier and copy (step on vs off)', async () => {
    const on = await score(SPEC);
    const off = await score(SPEC, { on: false });
    assert.deepEqual(on.map(ident).sort(), off.map(ident).sort());
    assert.deepEqual(where(off), [
      `${EH}@14:34 locator-handle`,
      `${EH}@6:23 -`,
      `${EH}@8:22 -`,
      `${PP}@10:31 -`,
      `${PP}@11:9 -`,
      `${VE}@12:9 matcherless`,
      `${VE}@13:3 matcherless`,
      `${VE}@15:18 matcherless`,
      `${VE}@17:40 matcherless`,
    ]);
    assert.deepEqual(where(on), [
      `${EH}@14:34 handle-argument`,
      `${EH}@6:23 handle-argument`,
      `${EH}@8:22 -`,
      `${PP}@10:31 gated`,
      `${PP}@11:9 -`,
      `${VE}@12:9 escaped`,
      `${VE}@13:3 matcherless`,
      `${VE}@15:18 matcherless`,
      `${VE}@17:40 matcherless`,
    ]);
    for (const f of on.filter((x) => ['handle-argument', 'escaped', 'gated'].includes(x.form ?? ''))) assert.equal(f.tier, 'likely', `${f.rule} ${f.form}`);
    const rest = (xs: Finding[]) => xs.filter((f) => !MINE.includes(f.rule)).map((f) => JSON.stringify(f)).sort();
    assert.deepEqual(rest(on), rest(off));
  });

  it('api-under-test, foreign-expect and unresolved keep their form', async () => {
    const pkg = await score(SPEC, { pkg: 'playwright-core' });
    assert.deepEqual(pkg.filter((f) => f.rule === EH || f.rule === PP).map((f) => f.form), Array(5).fill('api-under-test'));
    assert.deepEqual(where(await score(CHAI)), [`${VE}@6:10 foreign-expect`]);
    assert.deepEqual(where(await score(HELPER)), [`${EH}@6:34 unresolved`, `${PP}@5:31 unresolved`]);
  });

  it('each form has a likely row with the narrowed row\'s docs, family and basis, and no docs sentence', () => {
    for (const [rule, from, form] of [[EH, '-', 'handle-argument'], [VE, 'matcherless', 'escaped'], [PP, '-', 'gated']]) {
      const row = rowFor(rule, form);
      const base = rowFor(rule, from)!;
      assert.ok(row, `${rule} ${form}`);
      assert.deepEqual([row.design, row.bcEligible, row.docsSentence], ['likely', false, undefined], form);
      for (const k of ['docs', 'family', 'basis', 'dimension', 'label'] as const) assert.equal(row[k], base[k], `${form} ${k}`);
    }
  });
});
