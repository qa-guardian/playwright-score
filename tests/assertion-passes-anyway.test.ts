import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scorePaths } from '../src/index.js';
import { passesAnywayProof, PASSES_ANYWAY_RULE } from '../src/passes-anyway-forms.js';
import { passesAnywayForm } from '../src/rules/assertion-passes-anyway.js';
import { isTextlessInputSelector } from '../src/rules/input-selector.js';
import { ROWS, rowFor, tierOf } from '../src/catalogue/index.js';
import type { Finding } from '../src/types.js';

// QAG-287 N1: pwscore/assertion-passes-anyway. Four forms, each its own cell; a document-root finding needs a
// proven Page or Frame, a foreign expect gives none, an unresolved expect gives needs-check.
// Shapes are written from playwright.dev, with invented names.

const RULE = 'pwscore/assertion-passes-anyway';
const PW = `import { test, expect } from '@playwright/test';\n`;
const FORMS = ['root-content', 'match-anything', 'empty-fallback', 'form-control-text'];

async function score(source: string, spec = 'a.spec.ts'): Promise<Finding[]> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-anyway-'));
  try {
    fs.writeFileSync(path.join(dir, spec), source);
    const result = await scorePaths({ paths: [path.join(dir, spec)], profile: 'standard', threshold: 0, cwd: dir });
    return result.findings.filter((f) => f.rule === RULE);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const inTest = (lines: string[], header = PW): string => `${header}test('t', async ({ page }) => {\n${lines.map((l) => `  ${l}\n`).join('')}});\n`;
/** `line:form` of every finding of the rule; the first body line is line 3. */
const at = (fs_: Finding[]): string[] => fs_.map((f) => `${f.line}:${f.form}`).sort();

describe('QAG-287 N1: catalogue cells of assertion-passes-anyway', () => {
  it('has exactly the four forms, likely by design, in passes-regardless, each with a docs URL', () => {
    const rows = ROWS.filter((r) => r.rule === RULE);
    assert.deepEqual(rows.map((r) => r.form), FORMS);
    for (const r of rows) {
      assert.deepEqual([r.family, r.design, r.basis, tierOf(r), r.dimension], ['passes-regardless', 'likely', 'docs', 'likely', 'assertions'], r.form);
      assert.match(r.docs ?? '', /^https:\/\/playwright\.dev\/docs\/api\/class-locator(assertions)?#/, r.form);
    }
    assert.equal(rowFor(RULE, 'foreign-expect'), undefined, 'a foreign expect gives no finding, so the rule has no foreign-expect cell');
    assert.equal(PASSES_ANYWAY_RULE, RULE);
  });

  it('maps each message id to its form and nothing else', () => {
    assert.deepEqual(['rootContent', 'matchAnything', 'emptyFallback', 'formControlText'].map(passesAnywayForm), FORMS);
    assert.equal(passesAnywayForm('other'), undefined);
    assert.equal(passesAnywayForm(undefined), undefined);
  });
});

describe('QAG-287 N1: the first three forms on a proven Playwright expect', () => {
  it('reports each shape once, with its form, tier likely and the row copy', async () => {
    const found = await score(inTest([
      `await expect(page.locator('body')).toBeVisible();`, // 3
      `await expect(page).toHaveURL(/.*/);`, // 4
      `const heading = await page.locator('h1').textContent();`, // 5
      `await expect(page.getByRole('navigation')).toContainText(heading ?? '');`, // 6
    ]));
    assert.deepEqual(at(found), ['3:root-content', '4:match-anything', '6:empty-fallback']);
    for (const f of found) {
      const row = rowFor(RULE, f.form!)!;
      assert.deepEqual([f.tier, f.family, f.docs, f.severity], ['likely', 'passes-regardless', row.docs, 'warning'], f.form);
    }
  });

  it('root-content: every root selector and matcher of the form, and nothing next to it', async () => {
    const found = await score(inTest([
      `await expect(page.locator('html')).toBeAttached();`, // 3
      `await expect(page.locator(':root')).not.toBeEmpty();`, // 4
      `await expect(page.locator('body')).toBeVisible({ timeout: 2000 });`, // 5
      `await expect(page.mainFrame().locator('body')).toBeVisible();`, // 6
      `await expect(page.frameLocator('#a').frameLocator('#b').locator('body')).toBeAttached();`, // 7
      `await expect(page.locator('body')).not.toBeVisible();`, // 8: can fail
      `await expect(page.locator('body')).toBeEmpty();`, // 9: can fail
      `await expect(page.locator('body')).toBeVisible({ visible: false });`, // 10
      `await expect(page.locator('body')).toBeAttached({ attached: false });`, // 11
      `await expect(page.locator('body', { hasText: 'Saved' })).toBeVisible();`, // 12
      `await expect(page.locator('body > main')).toBeVisible();`, // 13
      `await expect(page.getByRole('main').locator('body')).toBeVisible();`, // 14: not a Page or Frame
      `await expect.poll(() => page.locator('body')).toBeVisible();`, // 15
    ]));
    assert.deepEqual(at(found), ['3:root-content', '4:root-content', '5:root-content', '6:root-content', '7:root-content']);
  });

  it('match-anything: the listed patterns and the empty string, only in the listed matchers', async () => {
    const found = await score(inTest([
      `await expect(page.getByRole('heading')).toHaveText(/.*/i);`, // 3
      `await expect(page).toHaveTitle(/[\\s\\S]*/);`, // 4
      `await expect(page.getByRole('status')).toContainText(\`\`);`, // 5
      `expect(page.url()).toContain('');`, // 6
      `await expect(page).toHaveURL(/.*\\/orders/);`, // 7: a real pattern
      `await expect(page.getByRole('heading')).toHaveText(/.+/);`, // 8
      `await expect(page.getByRole('heading')).toHaveText('');`, // 9: exact, can fail
      `await expect(page.getByRole('textbox')).toHaveValue(/.*/);`, // 10: not a listed matcher
      `await expect(page).not.toHaveURL(/.*/);`, // 11: always fails, not this rule
      `const cells: string[] = await page.getByRole('cell').allTextContents();`, // 12
      `expect(cells).toContain('');`, // 13: an array
    ]));
    assert.deepEqual(at(found), ['3:match-anything', '4:match-anything', '5:match-anything', '6:match-anything']);
  });

  it('empty-fallback: both operators, the RegExp form, and only an empty fallback of a non-literal', async () => {
    const found = await score(inTest([
      `const name = await page.getByTestId('name').textContent();`, // 3
      `const list = page.getByRole('list');`, // 4
      `await expect(list).toContainText(name || '');`, // 5
      `await expect(list).toContainText(name ?? '');`, // 6
      `expect(await list.innerText()).toContain(name ?? '');`, // 7
      `expect(await list.innerText()).toMatch(new RegExp(name || ''));`, // 8
      `await expect(list).toContainText(name ?? 'Unnamed');`, // 9
      `await expect(list).toHaveText(name ?? '');`, // 10: exact
      `await expect(list).toContainText('Name' || '');`, // 11
      `await expect(list).toContainText(String(name));`, // 12
      `await expect(list).toContainText(name!);`, // 13
      `await expect(list).not.toContainText(name ?? '');`, // 14
      `expect(await list.innerText()).toMatch(new RegExp(name ?? 'x'));`, // 15
    ]));
    assert.deepEqual(at(found), ['5:empty-fallback', '6:empty-fallback', '7:empty-fallback', '8:empty-fallback']);
  });
});

describe('QAG-287 N1: where the expect and the page come from', () => {
  const BODY = [
    `await expect(page.locator('body')).toBeVisible();`,
    `await expect(page).toHaveTitle(/.*/);`,
  ];

  it('an unresolved expect is reported as needs-check with the reason', async () => {
    const found = await score(inTest(BODY, `import { test } from '@playwright/test';\n`));
    assert.deepEqual(found.map((f) => `${f.line}:${f.form}:${f.tier}`).sort(), ['3:root-content:needs-check', '4:match-anything:needs-check']);
    for (const f of found) assert.match(f.what ?? '', /expect binding not resolved/);
  });

  it('a proven foreign expect gives no finding of the rule, in any form', async () => {
    const source = `import { test } from '@playwright/test';\nimport { expect } from 'vitest';\ntest('t', async ({ page }) => {\n${BODY.map((l) => `  ${l}\n`).join('')}  expect(page.url()).toContain('');\n});\n`;
    assert.deepEqual(await score(source), []);
    // The same body is reported when the expect is Playwright's: the lines above are not silent for another reason.
    const own = source.replace(`import { test } from '@playwright/test';\nimport { expect } from 'vitest';`, `import { test, expect } from '@playwright/test';`);
    assert.equal((await score(own)).length, 3);
  });

  it('a document root on something that is not a proven Page or Frame gives no finding; the proof step is what removes it', async () => {
    const source = `${PW}async function shell(view) {\n  await expect(view.locator('body')).toBeVisible();\n}\ntest('t', async ({ page }) => {\n  await shell(page);\n  await expect(page.locator('body')).toBeAttached();\n});\n`;
    assert.deepEqual(at(await score(source)), ['7:root-content']);
    passesAnywayProof.enabled = false;
    try {
      assert.deepEqual(at(await score(source)), ['3:root-content', '7:root-content']);
    } finally {
      passesAnywayProof.enabled = true;
    }
  });

  it('a typed Page parameter and a const alias of the page are proven', async () => {
    const source = `import { test, expect } from '@playwright/test'; import type { Page } from '@playwright/test';\nasync function shell(view: Page) {\n  await expect(view.locator('body')).toBeVisible();\n}\ntest('t', async ({ page }) => {\n  const tab = page;\n  const root = tab.locator('html');\n  await shell(page);\n  await expect(root).not.toBeEmpty();\n});\n`;
    assert.deepEqual(at(await score(source)), ['3:root-content', '9:root-content']);
  });

  it('the step never touches a finding of another rule', async () => {
    const source = inTest([`expect(page.locator('#total')).toBeTruthy();`, `await expect(page.locator('body')).toBeVisible();`]);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-anyway-'));
    try {
      fs.writeFileSync(path.join(dir, 'a.spec.ts'), source);
      const run = async (): Promise<string[]> =>
        (await scorePaths({ paths: [path.join(dir, 'a.spec.ts')], profile: 'standard', threshold: 0, cwd: dir })).findings
          .filter((f) => f.rule !== RULE)
          .map((f) => JSON.stringify(f));
      const on = await run();
      passesAnywayProof.enabled = false;
      try {
        assert.deepEqual(await run(), on);
      } finally {
        passesAnywayProof.enabled = true;
      }
      assert.ok(on.length > 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// B4b: form-control-text. P-FC (Playwright 1.57.0, chromium, firefox, webkit): a filled input passes toHaveText('');
// a textarea with initial text fails it; an input type=submit with a value fails it. So the shape needs an input
// with a type other than button, submit or reset; textarea, role textbox and placeholder locators are not read.
describe('QAG-287 N1 B4b: form-control-text', () => {
  it('reports toHaveText(\'\') and a negated text check of a non-blank text on a typed input, and none of the controls', async () => {
    const found = await score(inTest([
      `await expect(page.locator('input[type=email]')).toHaveText('');`, // 3
      `await expect(page.locator('input[type=text][name=city]')).not.toHaveText('Springfield');`, // 4
      `await expect(page.locator('form#signup input[type="email"]').first()).not.toContainText('@');`, // 5
      `const zip = page.getByRole('form').locator('css=input[type=tel]:visible');`, // 6
      `await expect.soft(zip.nth(0)).toHaveText('');`, // 7
      `await expect(page.locator('input[type=email]')).toHaveValue('');`, // 8
      `await expect(page.getByRole('textbox', { name: 'Email' })).toHaveText('');`, // 9
      `await expect(page.getByRole('status')).toHaveText('');`, // 10
      `await expect(page.locator('select[name=country]')).toHaveText('');`, // 11
      `await expect(page.locator('textarea[name=notes]')).toHaveText('');`, // 12
      `await expect(page.getByPlaceholder('you@example.com')).toHaveText('');`, // 13
      `await expect(page.locator('input')).toHaveText('');`, // 14
      `await expect(page.locator('input[name=q]')).not.toHaveText('shoes');`, // 15
      `await expect(page.locator('input[type=submit]')).toHaveText('');`, // 16
    ]));
    assert.deepEqual(at(found), ['3:form-control-text', '4:form-control-text', '5:form-control-text', '7:form-control-text']);
    for (const f of found) {
      const row = rowFor(RULE, 'form-control-text')!;
      assert.deepEqual([f.tier, f.family, f.docs, f.severity, f.what], ['likely', 'passes-regardless', row.docs, 'warning', row.what]);
    }
  });

  it('leaves checks that can fail, other matchers and selectors it does not read', async () => {
    const found = await score(inTest([
      `await expect(page.locator('input[type=email]')).not.toHaveText('');`, // 3: always fails
      `await expect(page.locator('input[type=email]')).not.toContainText('  ');`, // 4: blank
      `await expect(page.locator('input[type=email]')).toContainText('');`, // 5: match-anything
      `await expect(page.locator('input[type=email]')).toHaveText('a@b.example');`, // 6: always fails
      `await expect(page.locator('input[type=RESET]')).not.toContainText('x');`, // 7
      `await expect(page.locator('input[type=button i]')).toHaveText('');`, // 8
      `await expect(page.locator('input[type=email], textarea')).toHaveText('');`, // 9
      `await expect(page.locator('input[type=email] >> nth=0')).toHaveText('');`, // 10
      `await expect(page.locator('input[type=email]:not([disabled])')).toHaveText('');`, // 11
      `await expect(page.locator('input[type^=sub]')).toHaveText('');`, // 12
      `await expect(page.locator('input[type]')).toHaveText('');`, // 13
      `await expect(page.locator('input[type=email] + span')).toHaveText('');`, // 14
      `await expect(page.locator('input[type=email]', { hasText: 'x' })).toHaveText('');`, // 15
      `await expect(page.locator('input[type=email]').filter({ hasText: 'x' })).toHaveText('');`, // 16
      `const town = 'Springfield';`, // 17
      `await expect(page.locator('input[type=search]')).not.toHaveText(town);`, // 18
      `await expect(page.locator('input[type=search]')).not.toHaveText(/x/);`, // 19
      `await expect(page.locator('input[type=search]')).toHaveText(['']);`, // 20
    ]));
    assert.deepEqual(at(found), ['18:form-control-text', '5:match-anything']);
  });

  it('an unresolved expect gives needs-check, a proven foreign expect gives none', async () => {
    const BODY = [`await expect(page.locator('input[type=email]')).toHaveText('');`];
    const unresolved = await score(inTest(BODY, `import { test } from '@playwright/test';\n`));
    assert.deepEqual(unresolved.map((f) => `${f.line}:${f.form}:${f.tier}`), ['3:form-control-text:needs-check']);
    assert.match(unresolved[0].what ?? '', /expect binding not resolved/);
    assert.deepEqual(await score(inTest(BODY, `import { test } from '@playwright/test';\nimport { expect } from 'vitest';\n`)), []);
  });

  it('reads the selector string by its last compound', () => {
    const yes = ['input[type=email]', ' input[type="text"][name=city] ', "form > input[type='tel' i]", 'css=input.wide#zip[type=number]:visible', 'INPUT[TYPE=Password]', 'div input[type=checkbox][type]'];
    const no = ['input', 'input[name=q]', 'input[type=submit]', 'input[type=Button]', 'input[type="reset"]', 'input[type=""]', 'textarea[type=text]',
      'select', 'input[type=email], input[type=text]', 'input[type=email] >> nth=0', 'input[type=email]:not(.x)', 'input[type*=e]', 'input[type]',
      'input[type=email] span', 'xpath=//input', 'text=Email', '#email', 'input[type=email]::placeholder', 'input[type=email][type=submit]', 'input[type=email'];
    for (const s of yes) assert.equal(isTextlessInputSelector(s), true, s);
    for (const s of no) assert.equal(isTextlessInputSelector(s), false, s);
  });
});
