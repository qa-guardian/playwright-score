import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scorePaths } from '../src/index.js';

// QAG-287 fix round 1: the 2.4.0 review found exemptions that hid real
// defects. Every snippet below is the reviewer's failing probe: it fired on
// main and must still fire; the "good" twins must stay quiet.

async function findingsFor(rule: string, files: Record<string, string>, entry = 'temp.spec.ts') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-fix1-'));
  try {
    for (const [name, body] of Object.entries(files)) {
      const f = path.join(dir, name);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, body);
    }
    const r = await scorePaths({ paths: [path.join(dir, entry)], profile: 'standard', threshold: 0, cwd: dir });
    return r.findings.filter((f) => f.rule === rule);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const spec = (body: string) => ({ 'temp.spec.ts': `import { test, expect } from '@playwright/test';\n${body}\n` });

const SLEEP = 'pwscore/no-timer-sleep';

describe('fix1 item 1: no-timer-sleep loop bound must be in the loop exit condition', () => {
  it('endless UI poll with a counter assigned from an awaited count still fires', async () => {
    const f = await findingsFor(SLEEP, spec(`
test('unbounded count poll', async ({ page }) => {
  let count = 0;
  for (;;) {
    count = await page.locator('.row').count();
    if (count > 0) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
});`));
    assert.equal(f.length, 1);
  });

  it('a fixed sleep after every click in a for...of with a throw still fires', async () => {
    const f = await findingsFor(SLEEP, spec(`
test('per row', async ({ page }) => {
  for (const r of ['#r1', '#r2']) {
    await page.locator(r).click();
    await new Promise((r2) => setTimeout(r2, 2000));
    if (await page.getByText('Error').isVisible()) throw new Error('failed');
  }
});`));
    assert.equal(f.length, 1);
  });

  it('a loop that only logs a timestamp still fires', async () => {
    const f = await findingsFor(SLEEP, spec(`
test('log', async ({ page }) => {
  while (true) {
    console.log('poll', new Date().toISOString());
    if (await page.locator('#done').isVisible()) break;
    await new Promise((r) => setTimeout(r, 500));
  }
});`));
    assert.equal(f.length, 1);
  });

  it('GOOD: counter or deadline in the loop test or in the guard of the exit stays exempt', async () => {
    const f = await findingsFor(SLEEP, spec(`
test('bounded', async ({ request }) => {
  for (let i = 0; i < 15; i++) {
    try { await request.post('/seed'); break; } catch { await new Promise((r) => setTimeout(r, 2000)); }
  }
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if ((await request.get('/ready')).ok()) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  let attempt = 0;
  while (true) {
    attempt++;
    if ((await request.get('/x')).ok()) break;
    if (attempt >= 5) throw new Error('gave up');
    await new Promise((r) => setTimeout(r, 1000));
  }
  const start = Date.now();
  for (;;) {
    if ((await request.get('/y')).ok()) break;
    const elapsed = Date.now() - start;
    if (elapsed > 20_000) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 500));
  }
  let retries = 3;
  while (retries-- > 0) {
    if ((await request.get('/z')).ok()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
});`));
    assert.equal(f.length, 0, JSON.stringify(f));
  });
});

const EXPECT_EXPECT = 'playwright/expect-expect';
const CART = `import { expect } from '@playwright/test';
export class CartPage {
  constructor(private page: any) {}
  async open() { await this.page.goto('/cart'); await expect(this.page.getByRole('heading')).toBeVisible(); }
}
`;

describe('fix1 item 2: cross-file helper evidence needs an imported binding or traceable receiver', () => {
  it('a spec helper calling api.open() on a parameter does not inherit an imported open() that asserts', async () => {
    const f = await findingsFor(
      EXPECT_EXPECT,
      {
        'pages/cart.ts': CART,
        'collide.spec.ts': `import { test, expect } from '@playwright/test';
import { CartPage } from './pages/cart';
async function addItem(page, api) { await api.open(); await page.locator('#add').click(); }
test('adds item asserts nothing', async ({ page, request }) => { await addItem(page, request); });
`,
      },
      'collide.spec.ts'
    );
    assert.equal(f.length, 1, JSON.stringify(f));
  });

  it('GOOD: a spec helper that builds the imported page object and calls its asserting method is an assertion helper', async () => {
    const f = await findingsFor(
      EXPECT_EXPECT,
      {
        'pages/cart.ts': CART,
        'ok.spec.ts': `import { test } from '@playwright/test';
import { CartPage } from './pages/cart';
async function addItem(page) { const cart = new CartPage(page); await cart.open(); await page.locator('#add').click(); }
test('adds item', async ({ page }) => { await addItem(page); });
`,
      },
      'ok.spec.ts'
    );
    assert.equal(f.length, 0, JSON.stringify(f));
  });

  it('GOOD: a spec helper calling an imported asserting function is an assertion helper', async () => {
    const f = await findingsFor(
      EXPECT_EXPECT,
      {
        'pages/check.ts': `import { expect } from '@playwright/test';
export async function checkCart(page) { await expect(page.getByRole('heading')).toBeVisible(); }
`,
        'ok.spec.ts': `import { test } from '@playwright/test';
import { checkCart } from './pages/check';
async function addItem(page) { await page.locator('#add').click(); await checkCart(page); }
test('adds item', async ({ page }) => { await addItem(page); });
`,
      },
      'ok.spec.ts'
    );
    assert.equal(f.length, 0, JSON.stringify(f));
  });
});

describe('fix1 item 2b: a parameter typed with an imported class is a traceable receiver', () => {
  it('GOOD: runPick(panel: Panel) delegating to an asserting imported method is an assertion helper', async () => {
    const f = await findingsFor(
      EXPECT_EXPECT,
      {
        'panel.ts': CART.replace('CartPage', 'Panel'),
        'ok.spec.ts': `import { test } from '@playwright/test';
import { Panel } from './panel';
test('picks', async ({ page }) => { await runPick(new Panel(page)); });
async function runPick(panel: Panel) { await panel.open(); }
`,
      },
      'ok.spec.ts'
    );
    assert.equal(f.length, 0, JSON.stringify(f));
  });
});
