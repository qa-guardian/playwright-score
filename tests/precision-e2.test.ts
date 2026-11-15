import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scorePaths } from '../src/index.js';

// QAG-287 slice E2: precision fixes from the corpus hand-check (part A2).
// Each FALSE shape must stop firing; each TRUE shape must keep firing.

async function findingsFor(rule: string, body: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-e2-'));
  try {
    const file = path.join(dir, 'temp.spec.ts');
    fs.writeFileSync(file, `import { test, expect, type Page } from '@playwright/test';\n${body}\n`);
    const r = await scorePaths({ paths: [file], profile: 'standard', threshold: 0, cwd: dir });
    return r.findings.filter((f) => f.rule === rule);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const ruleHits = async (rule: string, body: string) => (await findingsFor(rule, body)).length;

const SLEEP = 'pwscore/no-timer-sleep';

describe('QAG-287 E2: no-timer-sleep skips sleeps that are not a wait', () => {
  it('latency injected in a page.route / context.route handler', async () => {
    assert.equal(
      await ruleHits(SLEEP, `
test('slow image', async ({ page, context }) => {
  await page.route('**/img.png', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });
  await context.route('**/*.wasm', async (route) => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 5_000);
    });
    await route.continue();
  });
  await page.goto('/');
  await expect(page.getByRole('img')).toBeVisible();
});`),
      0
    );
  });

  it('monkey-patched stub that fakes latency', async () => {
    assert.equal(
      await ruleHits(SLEEP, `
test('slow rename', async ({ page }) => {
  await page.evaluate(() => {
    const rename = (window as any).fs.rename;
    (window as any).fs.rename = (...args: unknown[]) =>
      new Promise((resolve) => setTimeout(() => resolve(rename(...args)), 800));
  });
});`),
      0
    );
  });

  it('0 ms macrotask drain, and one arm of Promise.race', async () => {
    assert.equal(
      await ruleHits(SLEEP, `
test('drain', async ({ page }) => {
  await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
  const seen = new Promise<string>(() => {});
  const result = await Promise.race([
    seen,
    new Promise<string>((resolve) => setTimeout(() => resolve('none'), 5000)),
  ]);
  expect(result).toBe('none');
});`),
      0
    );
  });

  it('delay in a bounded poll/retry loop that can exit', async () => {
    assert.equal(
      await ruleHits(SLEEP, `
test('seed', async ({ request }) => {
  let ok = false;
  for (let i = 0; i < 15; i++) {
    try {
      await request.post('/seed');
      ok = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const res = await request.get('/ready');
    if (res.ok()) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
});`),
      0
    );
  });

  it('TRUE: an unbounded fixed-interval poll of the UI still fires', async () => {
    assert.equal(
      await ruleHits(SLEEP, `
test('wait for banner', async ({ page }) => {
  while (true) {
    if (await page.getByRole('banner').isVisible()) break;
    await new Promise((r) => setTimeout(r, 500));
  }
});`),
      1
    );
  });

  it('TRUE: plain fixed sleep before an assertion still fires', async () => {
    assert.equal(
      await ruleHits(SLEEP, `
test('no toast', async ({ page }) => {
  await page.reload();
  await new Promise((resolve) => setTimeout(resolve, 2000));
  await expect(page.getByRole('alert')).toHaveCount(0);
});`),
      1
    );
  });

  it('TRUE: in-browser sleep in page.evaluate and a loop without an exit still fire', async () => {
    assert.equal(
      await ruleHits(SLEEP, `
test('blocks', async ({ page }) => {
  await page.evaluate(async () => {
    await new Promise((res) => setTimeout(res, 200));
  });
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 5));
    await page.keyboard.press('ArrowDown');
  }
});`),
      2
    );
  });

  it('TRUE: node:timers/promises sleep fires, but not inside a route handler', async () => {
    assert.equal(
      await ruleHits(SLEEP, `
import { setTimeout as delay } from 'node:timers/promises';
test('sync', async ({ page }) => {
  await page.route('**/api', async (route) => {
    await delay(300);
    await route.continue();
  });
  await delay(1000);
  await page.goBack();
});`),
      1
    );
  });
});

const FIXME = 'pwscore/no-fixme-test';

describe('QAG-287 E2: no-fixme-test message matches what is on the page', () => {
  it('TRUE: bare test.fixme() in a body and a bare declaration keep the warning and ask for a reason', async () => {
    const body = await findingsFor(FIXME, `
test('shot', async ({ page }) => {
  test.fixme();
  await expect(page).toHaveTitle('x');
});
test.fixme('no reason given', async ({ page }) => {
  await expect(page).toHaveTitle('x');
});`);
    assert.equal(body.length, 2);
    assert.ok(body.every((f) => f.severity === 'warning'));
    assert.match(body[0].message, /no condition and no reason/);
    assert.match(body[1].message, /nothing says why/);
  });

  it('TRUE: describe-level bare fixme with an unrelated comment still warns', async () => {
    const f = await findingsFor(FIXME, `
// Create a ticket for this for the team to fix
test.describe('errors', () => {
  test.fixme();
  test('a', async ({ page }) => { await expect(page).toHaveTitle('x'); });
});`);
    assert.equal(f.length, 1);
    assert.equal(f[0].severity, 'warning');
  });

  it('test.fixme(true, reason) names its reason, so the message does not ask for one', async () => {
    const f = await findingsFor(FIXME, `
test.describe('feedback', () => {
  test.fixme(true, 'dialog is lost due to an IPC race at startup');
  test('a', async ({ page }) => { await expect(page).toHaveTitle('x'); });
});
test('b', async ({ page }) => {
  test.fixme(true, "return flow strands users on / (tracked)");
  await expect(page).toHaveTitle('x');
});`);
    assert.equal(f.length, 2);
    for (const x of f) {
      assert.equal(x.severity, 'info');
      assert.doesNotMatch(x.message, /inside a test|nothing says why|no reason/);
      assert.match(x.message, /a reason is given/);
    }
  });

  it('declaration with a tracker reference or re-enable note above it, or an annotation, is info', async () => {
    const f = await findingsFor(FIXME, `
// Host bug, see TESTOPS-49.
test.fixme('events fire', async ({ page }) => { await expect(page).toHaveTitle('x'); });
// Re-enable once the app is upgraded to v7.
test.fixme('spans', async ({ page }) => { await expect(page).toHaveTitle('x'); });
test('tracked', async ({ page }) => {
  test.info().annotations.push({ type: 'issue', description: 'https://github.com/o/r/issues/30550' });
  test.fixme();
  await expect(page).toHaveTitle('x');
});`);
    assert.equal(f.length, 3);
    assert.ok(f.every((x) => x.severity === 'info'));
  });

  it('empty-body fixme placeholders are info with a placeholder message', async () => {
    const f = await findingsFor(FIXME, `
test.describe('receipts', () => {
  test.fixme('a threaded receipt does nothing', () => {});
  test.fixme('a main receipt does nothing', async () => {});
});`);
    assert.equal(f.length, 2);
    assert.ok(f.every((x) => x.severity === 'info' && /placeholder/.test(x.message)));
  });
});

const SHARED = 'pwscore/no-shared-mutable-state';

describe('QAG-287 E2: no-shared-mutable-state needs a real collection, a real order and the same property', () => {
  it('an SDK client assigned in a hook is not a Map/Set: payload.delete() is a call, not a mutation', async () => {
    assert.equal(
      await ruleHits(SHARED, `
let payload: any;
test.beforeAll(async () => { payload = await getClient(); });
test('creates', async () => { await payload.create({ name: 'a' }); await payload.delete({ id: 1 }); });
test('lists', async () => { const rows = await payload.find(); expect(rows.length).toBe(0); });`),
      0
    );
  });

  it('a reader that runs before the writer does not depend on it', async () => {
    assert.equal(
      await ruleHits(SHARED, `
const emits: string[] = [];
test('reads first', async () => { expect(emits.length).toBe(0); });
test('writes later', async () => { emits.push('x'); });`),
      0
    );
  });

  it('a reader of another property than the writer touches', async () => {
    assert.equal(
      await ruleHits(SHARED, `
const made: { team?: string; yearTeam?: string } = {};
test.beforeAll(async () => { made.team = 'seeded'; });
test('records for cleanup', async () => { made.yearTeam = 'y'; });
test('uses the seeded team', async () => { expect(made.team).toBe('seeded'); });`),
      0
    );
  });

  it('a reader that calls a same-file helper which assigns the variable itself', async () => {
    assert.equal(
      await ruleHits(SHARED, `
let masterdata: string | undefined;
async function createMasterdata() { masterdata = 'm'; }
test('a', async () => { masterdata = 'x'; });
test('b', async () => { await createMasterdata(); expect(masterdata).toBe('m'); });`),
      0
    );
  });

  it('TRUE: an array pushed by earlier tests and read by a later one still fires', async () => {
    assert.equal(
      await ruleHits(SHARED, `
const errorMessages: string[] = [];
test('first error', async () => { errorMessages.push('boom'); });
test('tracer inspect', async ({ page }) => {
  for (const m of errorMessages) await expect(page.getByText(m)).toBeVisible();
});`),
      1
    );
  });

  it('TRUE: an id assigned in a create test and used by a later test still fires; so does a same-property read', async () => {
    assert.equal(
      await ruleHits(SHARED, `
let couponId: string;
test('create', async ({ request }) => { couponId = (await (await request.post('/c')).json()).id; });
test('retrieve', async ({ request }) => { expect((await request.get('/c/' + couponId)).ok()).toBe(true); });`),
      1
    );
    assert.equal(
      await ruleHits(SHARED, `
const state: { token?: string } = {};
test('login', async () => { state.token = 't'; });
test('uses token', async () => { expect(state.token).toBe('t'); });`),
      1
    );
  });
});

const TIMEOUT = 'pwscore/no-excessive-timeout';

describe('QAG-287 E2: no-excessive-timeout skips hook budgets and has no score effect', () => {
  it('setTimeout inside beforeAll/afterAll is setup, not a test budget', async () => {
    assert.equal(
      await ruleHits(TIMEOUT, `
test.beforeAll(async () => { test.setTimeout(600_000); });
test.afterAll(async ({}, testInfo) => { testInfo.setTimeout(300_000); });
test('x', async ({ page }) => { await expect(page).toHaveTitle('x'); });`),
      0
    );
  });

  it('TRUE: a long setTimeout in a test and a long action timeout still fire, as info findings (no score effect)', async () => {
    const f = await findingsFor(TIMEOUT, `
test('big', async ({ page }) => {
  test.setTimeout(300_000);
  await page.waitForResponse('**/products', { timeout: 90_000 });
  await expect(page.getByRole('heading')).toBeHidden({ timeout: 1_000_000 });
});`);
    assert.equal(f.length, 3);
    assert.ok(f.every((x) => x.severity === 'info'));
    assert.ok(f.every((x) => !/one test/.test(x.message)));
  });
});
