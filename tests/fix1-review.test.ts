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
