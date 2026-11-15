import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scorePaths } from '../src/index.js';

// QAG-287 slice E3: precision fixes from the corpus hand-check (part B1).
// Each FALSE shape must stop firing; each TRUE shape must keep firing.

async function findingsFor(body: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-e3-'));
  try {
    const file = path.join(dir, 'temp.spec.ts');
    fs.writeFileSync(file, `import { test, expect } from '@playwright/test';\n${body}\n`);
    const r = await scorePaths({ paths: [file], profile: 'standard', threshold: 0, cwd: dir });
    return r.findings;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const hits = async (rule: string, body: string) => (await findingsFor(body)).filter((f) => f.rule === rule).length;

const BRITTLE = 'pwscore/no-brittle-selector';
const SERIAL = 'pwscore/serial-mode-dependency';
const SHARED = 'pwscore/no-shared-mutable-state';
const FALLBACK = 'pwscore/no-self-fulfilling-fallback';

describe('QAG-287 E3: no-brittle-selector positional picks', () => {
  it('comma-union selector with .first() is an either/or wait, not a position', async () => {
    assert.equal(
      await hits(BRITTLE, `
test('either state', async ({ page }) => {
  await page.goto('/');
  await page.locator('.result-ok, .result-error').first().waitFor();
  await expect(page.locator('.alert, [role=alert]').first()).toBeVisible();
});`),
      0
    );
  });

  it('existence, count and attribute probes on .first() do not fire', async () => {
    assert.equal(
      await hits(BRITTLE, `
test('probes', async ({ page }) => {
  await page.goto('/');
  const shown = await page.locator('.card').first().isVisible();
  const href = await page.locator('.nav a').first().getAttribute('href');
  expect(shown).toBe(true);
  expect(href).toContain('/docs');
  await expect(page.locator('.card').first()).toBeVisible();
  await expect(page.locator('.card').last()).not.toBeHidden();
  await expect(page.locator('.card').nth(1)).toHaveAttribute('data-state', 'open');
});`),
      0
    );
  });

  it('a locator already scoped under a test id or role parent does not fire', async () => {
    assert.equal(
      await hits(BRITTLE, `
test('scoped', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('results').locator('.row').first().click();
  await page.getByRole('dialog').locator('input.name').first().fill('x');
  await page.locator('[data-testid=panel]').locator('.item').nth(2).click();
});`),
      0
    );
  });

  it('bare positional pick used for a click on an unscoped CSS locator still fires', async () => {
    assert.equal(
      await hits(BRITTLE, `
test('pick', async ({ page }) => {
  await page.goto('/');
  await page.locator('.btn.primary').first().click();
});`),
      1
    );
  });

  it('nth() pick for fill, and a text assertion on a raw .last(), still fire', async () => {
    assert.equal(
      await hits(BRITTLE, `
test('pick more', async ({ page }) => {
  await page.goto('/');
  await page.locator('form input.field').nth(2).fill('x');
  await expect(page.locator('.row').last()).toHaveText('done');
});`),
      2
    );
  });

  it('XPath selectors keep firing', async () => {
    assert.equal(
      await hits(BRITTLE, `
test('xpath', async ({ page }) => {
  await page.locator('//div[@class="a"]/span[2]').click();
  await page.locator('xpath=..').click();
});`),
      2
    );
  });
});

describe('QAG-287 E3: serial-mode-dependency needs a real order dependency', () => {
  it('a serial scope with a single test is not reported', async () => {
    assert.equal(
      await hits(SERIAL, `
test.describe.serial('only one', () => {
  test('alone', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL('/');
  });
});`),
      0
    );
    assert.equal(
      await hits(SERIAL, `
test.describe.configure({ mode: 'serial' });
test('only test in file', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL('/');
});`),
      0
    );
  });

  it('serial used for exclusion, with no shared variable, is not reported', async () => {
    assert.equal(
      await hits(SERIAL, `
test.describe.serial('mock toggle', () => {
  test('a', async ({ page }) => {
    await page.goto('/a');
    await expect(page).toHaveURL('/a');
  });
  test('b', async ({ page }) => {
    await page.goto('/b');
    await expect(page).toHaveURL('/b');
  });
});`),
      0
    );
  });

  it('a variable only read, or written by a LATER test, is not an order dependency', async () => {
    assert.equal(
      await hits(SERIAL, `
test.describe.serial('flow', () => {
  let token = 'fixed';
  let late: string | undefined;
  test('one', async ({ page }) => {
    await page.goto('/?t=' + token + late);
    await expect(page).toHaveURL(/t=/);
  });
  test('two', async ({ page }) => {
    late = 'x';
    await expect(page).toHaveURL(/t=/);
  });
});`),
      0
    );
  });

  it('describe.serial where a later test reads what an earlier one wrote is reported', async () => {
    const f = (await findingsFor(`
test.describe.serial('order flow', () => {
  let orderId = '';
  test('create order', async ({ page }) => {
    await page.goto('/orders/new');
    orderId = (await page.getByTestId('order-id').textContent()) ?? '';
    expect(orderId).not.toBe('');
  });
  test('open order', async ({ page }) => {
    await page.goto('/orders/' + orderId);
    await expect(page.getByRole('heading')).toContainText(orderId);
  });
});`)).filter((x) => x.rule === SERIAL);
    assert.equal(f.length, 1);
    assert.match(f[0]!.message, /"open order" reads `orderId`.*"create order"/);
  });

  it('file-level serial configure with a module variable is reported once per scope', async () => {
    assert.equal(
      await hits(SERIAL, `
test.describe.configure({ mode: 'serial' });
let draft = '';
test('write draft', async ({ page }) => {
  await page.goto('/');
  draft = 'hello';
  await expect(page).toHaveURL('/');
});
test('read draft', async ({ page }) => {
  await page.goto('/?d=' + draft);
  await expect(page).toHaveURL(/d=hello/);
});
test('read draft again', async ({ page }) => {
  await page.goto('/?d=' + draft);
  await expect(page).toHaveURL(/d=hello/);
});`),
      1
    );
  });

  it('no double report: an unordered pair is no-shared-mutable-state only', async () => {
    const f = await findingsFor(`
let shared = '';
test.describe.serial('writer group', () => {
  test('writer', async ({ page }) => {
    await page.goto('/');
    shared = 'x';
    await expect(page).toHaveURL('/');
  });
  test('other', async ({ page }) => {
    await page.goto('/o');
    await expect(page).toHaveURL('/o');
  });
});
test('reader outside serial', async ({ page }) => {
  await page.goto('/?s=' + shared);
  await expect(page).toHaveURL(/s=x/);
});`);
    assert.equal(f.filter((x) => x.rule === SHARED).length, 1);
    assert.equal(f.filter((x) => x.rule === SERIAL).length, 0);
  });

  it('a pair inside serial scope is not reported by no-shared-mutable-state', async () => {
    const f = await findingsFor(`
test.describe.serial('flow', () => {
  let id = '';
  test('w', async ({ page }) => {
    await page.goto('/');
    id = 'a';
    await expect(page).toHaveURL('/');
  });
  test('r', async ({ page }) => {
    await page.goto('/' + id);
    await expect(page).toHaveURL(/a/);
  });
});`);
    assert.equal(f.filter((x) => x.rule === SHARED).length, 0);
    assert.equal(f.filter((x) => x.rule === SERIAL).length, 1);
  });
});

describe('QAG-287 E3: no-self-fulfilling-fallback only when the fallback supplies the asserted value', () => {
  it('create-the-data-if-missing guard with an assertion on something else is setup', async () => {
    assert.equal(
      await hits(FALLBACK, `
test('colour resets', async ({ page }) => {
  const label = page.getByRole('link', { name: 'To Reply' });
  if ((await label.count()) === 0) {
    await page.getByRole('button', { name: 'Create label' }).click();
    await page.getByRole('textbox', { name: 'New label name' }).fill('To Reply');
    await page.getByRole('button', { name: 'Add' }).click();
  }
  await expect(label).toBeVisible();
  await label.click();
  await expect(page.getByRole('dialog')).toBeHidden();
});`),
      0
    );
  });

  it('conditional fill whose later assertion is "the card renders" is setup', async () => {
    assert.equal(
      await hits(FALLBACK, `
test('cards render', async ({ page }) => {
  const field = page.getByRole('textbox').first();
  if (!(await field.isEditable())) {
    await field.fill('Ada');
  }
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(field).toBeVisible();
});`),
      0
    );
  });

  it('filter added as setup, then a layout check, is setup', async () => {
    assert.equal(
      await hits(FALLBACK, `
test('pill width', async ({ page }) => {
  const drawer = page.getByRole('dialog');
  const filter = drawer.getByTestId('filter');
  if (!(await filter.count())) {
    await drawer.getByRole('button', { name: 'Add Filter' }).click();
    await drawer.getByPlaceholder('Search...').fill('created');
  }
  await expect(filter).toBeVisible();
  await expect(drawer.getByPlaceholder('Search...')).toHaveCSS('width', '200px');
});`),
      0
    );
  });

  it('missing-product guard followed by a boolean check is setup', async () => {
    assert.equal(
      await hits(FALLBACK, `
test('completeness', async ({ page }) => {
  const edit = page.getByTitle('Edit').first();
  const has = await edit.isVisible().catch(() => false);
  if (!has) {
    await page.getByRole('button', { name: 'Create Product' }).click();
    await page.getByLabel('SKU').fill('sku-1');
  }
  expect(await edit.isVisible()).toBeTruthy();
});`),
      0
    );
  });

  it('fallback fills a value and the test asserts that same value: fires', async () => {
    assert.equal(
      await hits(FALLBACK, `
test('automation name', async ({ page }) => {
  const nameInput = page.getByLabel('Automation name');
  if (!(await nameInput.isVisible())) {
    await page.getByRole('button', { name: 'New automation' }).click();
    await nameInput.fill('nightly');
  }
  await expect(nameInput).toHaveValue('nightly');
});`),
      1
    );
  });

  it('catch block that selects the expected option and re-asserts it: fires', async () => {
    assert.equal(
      await hits(FALLBACK, `
const WANTED = 'daily';
test('preset applied', async ({ page }) => {
  const preset = page.getByLabel('Preset');
  try {
    await expect(preset).toHaveValue(WANTED);
  } catch {
    await preset.selectOption(WANTED);
  }
  await expect(preset).toHaveValue('daily');
});`),
      1
    );
  });
});

describe('QAG-287 E3b: serial scope whose author states the order dependency', () => {
  const tests = `
  test('saves a revision', async ({ page }) => { await page.goto('/'); await expect(page).toHaveURL('/'); });
  test('lists the revision', async ({ page }) => { await page.goto('/'); await expect(page).toHaveURL('/'); });`;

  it('a comment next to describe.configure saying later tests use earlier ones is reported', async () => {
    assert.equal(
      await hits(SERIAL, `
test.describe('Revisions', () => {
  // Later tests use the revisions that earlier tests save.
  test.describe.configure({ mode: 'serial' });
${tests}
});`),
      1
    );
  });

  it('a comment above describe.serial saying the tests must run in order is reported', async () => {
    assert.equal(
      await hits(SERIAL, `
// These tests must run in order (deactivate then activate)
test.describe.serial('Plugin', () => {
${tests}
});`),
      1
    );
  });

  it('"in order to" is not an order claim, and no comment means no report without a variable flow', async () => {
    assert.equal(
      await hits(SERIAL, `
test.describe('Locked', () => {
  // Serial in order to share one expensive login.
  test.describe.configure({ mode: 'serial' });
${tests}
});`),
      0
    );
    assert.equal(await hits(SERIAL, `test.describe.serial('Plain', () => {\n${tests}\n});`), 0);
  });
});
