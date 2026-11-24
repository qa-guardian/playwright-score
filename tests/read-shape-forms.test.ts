import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scorePaths } from '../src/index.js';
import { readShapeForms } from '../src/read-shape-forms.js';
import { captureWindow } from '../src/capture-window.js';
import { rowFor } from '../src/catalogue/index.js';

// QAG-287 B3: read-handle and read-compare (C7) of playwright/prefer-web-first-assertions, capture-window (C8)
// of playwright/no-networkidle. Narrowing only: a finding changes form and copy, never whether it is reported.

const READ = 'playwright/prefer-web-first-assertions';
const IDLE = 'playwright/no-networkidle';

// `inProcess`: for a test that flips a switch of this thread's modules, which the analysis worker does not share.
async function score(body: string, opts: { inProcess?: boolean; head?: string; args?: string } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-shape-'));
  try {
    const file = path.join(dir, 'a.spec.ts');
    const head = opts.head ?? "import { test, expect } from '@playwright/test';";
    fs.writeFileSync(file, `${head}\n\ntest('t', async (${opts.args ?? '{ page }'}) => {\n${body}\n});\n`);
    const r = await scorePaths({ paths: [file], profile: 'standard', threshold: 0, cwd: dir, ...(opts.inProcess ? { isolate: false } : {}) });
    return r.findings;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const reads = async (body: string, opts: Parameters<typeof score>[1] = {}) => (await score(body, opts)).filter((f) => f.rule === READ);
const idles = async (body: string, opts: Parameters<typeof score>[1] = {}) => (await score(body, opts)).filter((f) => f.rule === IDLE);
const forms = (fs: Array<{ form?: string }>) => fs.map((f) => f.form);

const PRIOR = "  const tile = page.getByRole('img');\n  const prior = await tile.getAttribute('src');\n  await page.getByRole('button').click();\n";

describe('QAG-287 B3: read-compare', () => {
  it('an expected value read earlier in the test is read-compare, likely, at the same position', async () => {
    const f = await reads(PRIOR + "  expect(await tile.getAttribute('src')).not.toBe(prior);");
    assert.deepEqual(forms(f), ['read-compare']);
    assert.equal(f[0].tier, 'likely');
    assert.deepEqual([f[0].line, f[0].column], [7, 3]);
    assert.equal(f[0].title, rowFor(READ, 'read-compare')!.title);
  });

  it('an expected value that is a second read, or derived from one, is read-compare', async () => {
    const second = await reads("  expect(await page.getByTestId('a').textContent()).toBe(await page.getByTestId('b').textContent());");
    assert.deepEqual(forms(second), ['read-compare']);
    const derived = await reads("  const draft = await page.getByLabel('Note').inputValue();\n  const expected = draft + ' (saved)';\n  expect(await page.getByRole('status').innerText()).toBe(expected);");
    assert.deepEqual(forms(derived), ['read-compare']);
    const assigned = await reads("  let prior;\n  prior = await page.getByRole('status').innerText();\n  expect(await page.getByRole('status').innerText()).not.toBe(prior);");
    assert.deepEqual(forms(assigned), ['read-compare']);
  });

  it('a stored subject compared with an earlier read is read-compare', async () => {
    const f = await reads("  const before = await page.getByRole('status').textContent();\n  await page.getByRole('button').click();\n  const after = await page.getByRole('status').textContent();\n  expect(after).not.toBe(before);");
    assert.deepEqual(forms(f), ['read-compare']);
  });

  it('a literal, test data, a later read and a read in another test stay read-direct', async () => {
    assert.deepEqual(forms(await reads("  expect(await page.getByRole('status').textContent()).toBe('Shipped');")), ['read-direct']);
    assert.deepEqual(forms(await reads("  const expected = ['a', 'b'].join('');\n  expect(await page.getByRole('status').textContent()).toBe(expected);")), ['read-direct']);
    // The variable is written only after the assertion.
    assert.deepEqual(forms(await reads("  let later;\n  expect(await page.getByRole('status').textContent()).toBe(later);\n  later = await page.getByRole('status').textContent();")), ['read-direct']);
    // A name of the same text bound inside the callback is not the outer read.
    assert.deepEqual(forms(await reads("  const prior = await page.getByRole('status').textContent();\n  console.log(prior);\n  for (const prior of ['a']) {\n    expect(await page.getByRole('status').textContent()).toBe(prior);\n  }")), ['read-direct']);
    // A function that would read the page is not a value read from it.
    assert.deepEqual(forms(await reads("  const read = () => page.getByRole('status').textContent();\n  expect(await page.getByRole('status').textContent()).toBe(String(read));")), ['read-direct']);
  });

  it('read-reused wins over read-compare; a url or count read keeps read-url-count', async () => {
    const reused = await reads("  const before = await page.getByRole('status').textContent();\n  const after = await page.getByRole('status').textContent();\n  console.log(after);\n  expect(after).not.toBe(before);");
    assert.deepEqual(forms(reused), ['read-reused']);
    const count = await reads("  const before = await page.getByRole('row').count();\n  await page.getByRole('button').click();\n  expect(await page.getByRole('row').count()).toBe(before + 1);");
    assert.deepEqual(forms(count), ['read-url-count']);
  });

  it('foreign-expect wins over read-compare', async () => {
    const f = await reads("  const prior = await page.getAttribute('#cover', 'src');\n  await page.click('#next');\n  expect(await page.getAttribute('#cover', 'src')).not.toBe(prior);", {
      head: "import { expect, test } from '@jest/globals';",
      args: '',
    });
    assert.deepEqual(forms(f), ['foreign-expect']);
    assert.equal(f[0].tier, 'advisory');
  });
});

describe('QAG-287 B3: read-handle', () => {
  it('a read on a handle from $, $$ or elementHandle() is read-handle, likely', async () => {
    const one = await reads("  const field = await page.$('#email');\n  expect(await field!.inputValue()).toBe('');");
    assert.deepEqual(forms(one), ['read-handle']);
    assert.equal(one[0].tier, 'likely');
    assert.deepEqual([one[0].line, one[0].column], [5, 3]);
    assert.equal(one[0].title, rowFor(READ, 'read-handle')!.title);
    assert.deepEqual(forms(await reads("  const rows = await page.$$('tr');\n  expect(await rows[0].textContent()).toBe('a');")), ['read-handle']);
    assert.deepEqual(forms(await reads("  for (const row of await page.$$('tr')) {\n    expect(await row.isVisible()).toBe(true);\n  }")), ['read-handle']);
    assert.deepEqual(forms(await reads("  const h = await page.getByRole('status').elementHandle();\n  expect(await h!.textContent()).toBe('a');")), ['read-handle']);
    assert.deepEqual(forms(await reads("  expect(await (await page.$('#total'))!.textContent()).toBe('a');")), ['read-handle']);
  });

  it('a stored read from a handle, used once, is read-handle', async () => {
    const f = await reads("  const cell = await page.$('.total');\n  const total = await cell!.textContent();\n  expect(total).toBe('$1');");
    assert.deepEqual(forms(f), ['read-handle']);
  });

  it('a locator read stays read-direct, also when a handle is nearby', async () => {
    assert.deepEqual(forms(await reads("  expect(await page.getByLabel('Email').inputValue()).toBe('');")), ['read-direct']);
    assert.deepEqual(forms(await reads("  const field = await page.$('#email');\n  await field!.click();\n  const row = page.locator('tr');\n  expect(await row.textContent()).toBe('a');")), ['read-direct']);
  });

  it('read-reused wins over read-handle, read-handle over read-compare', async () => {
    const reused = await reads("  const cell = await page.$('.total');\n  const total = await cell!.textContent();\n  console.log(total);\n  expect(total).toBe('$1');");
    assert.deepEqual(forms(reused), ['read-reused']);
    const both = await reads("  const field = await page.$('#email');\n  const prior = await page.getByLabel('Backup').inputValue();\n  expect(await field!.inputValue()).toBe(prior);");
    assert.deepEqual(forms(both), ['read-handle']);
  });
});

const LISTEN = "  const statuses: number[] = [];\n  page.on('response', (r) => statuses.push(r.status()));\n";

describe('QAG-287 B3: capture-window', () => {
  it('a listener before the idle wait and an assertion on its collection after is capture-window, likely', async () => {
    const f = await idles(LISTEN + "  await page.goto('/x', { waitUntil: 'networkidle' });\n  expect(statuses).not.toContain(500);");
    assert.deepEqual(forms(f), ['capture-window']);
    assert.equal(f[0].tier, 'likely');
    assert.equal(f[0].line, 6);
    assert.equal(f[0].title, rowFor(IDLE, 'capture-window')!.title);
  });

  it('each of the four events, a counter, a named handler and a derived value count', async () => {
    for (const event of ['request', 'response', 'requestfinished', 'console']) {
      const f = await idles(`  const seen: unknown[] = [];\n  page.on('${event}', (e) => { seen.push(e); });\n  await page.goto('/x');\n  await page.waitForLoadState('networkidle');\n  expect(seen.length).toBeGreaterThan(0);`);
      assert.deepEqual(forms(f), ['capture-window'], event);
    }
    assert.deepEqual(forms(await idles("  let failed = 0;\n  page.on('response', (r) => { if (!r.ok()) failed++; });\n  await page.waitForLoadState('networkidle');\n  expect(failed).toBe(0);")), ['capture-window']);
    assert.deepEqual(forms(await idles("  const urls: string[] = [];\n  const onRequest = (r: { url(): string }) => { urls.push(r.url()); };\n  page.on('request', onRequest);\n  await page.waitForLoadState('networkidle');\n  const tracked = urls.filter((u) => u.includes('/t'));\n  expect(tracked).toHaveLength(1);")), ['capture-window']);
  });

  it('the listener may sit in the test while the wait and the assertion sit in a step', async () => {
    const f = await idles(LISTEN + "  await test.step('load', async () => {\n    await page.goto('/x', { waitUntil: 'networkidle' });\n    expect(statuses).not.toContain(500);\n  });");
    assert.deepEqual(forms(f), ['capture-window']);
  });

  it('a readiness wait keeps form -', async () => {
    const plain = (f: Array<{ form?: string }>) => f.map((x) => x.form ?? '-');
    // No listener.
    assert.deepEqual(plain(await idles("  await page.goto('/x', { waitUntil: 'networkidle' });\n  await expect(page.getByRole('heading')).toBeVisible();")), ['-']);
    // The listener comes after the wait.
    assert.deepEqual(plain(await idles("  await page.goto('/x', { waitUntil: 'networkidle' });\n" + LISTEN + "  await page.getByRole('button').click();\n  expect(statuses).not.toContain(500);")), ['-']);
    // Nothing asserts on the collection.
    assert.deepEqual(plain(await idles(LISTEN + "  await page.goto('/x', { waitUntil: 'networkidle' });\n  await expect(page.getByRole('heading')).toBeVisible();")), ['-']);
    // The collection is asserted only before the wait.
    assert.deepEqual(plain(await idles(LISTEN + "  expect(statuses).toEqual([]);\n  await page.goto('/x', { waitUntil: 'networkidle' });")), ['-']);
    // Another event, and a listener on something that is not the page.
    assert.deepEqual(plain(await idles("  const errors: string[] = [];\n  page.on('pageerror', (e) => errors.push(e.message));\n  await page.goto('/x', { waitUntil: 'networkidle' });\n  expect(errors).toEqual([]);")), ['-']);
    assert.deepEqual(plain(await idles("  const seen: string[] = [];\n  const bus = { on: (_e: string, _f: (m: string) => void) => {} };\n  bus.on('response', (m) => seen.push(m));\n  await page.goto('/x', { waitUntil: 'networkidle' });\n  expect(seen).toEqual([]);")), ['-']);
    // The handler fills only its own local.
    assert.deepEqual(plain(await idles("  const statuses: number[] = [];\n  page.on('response', (r) => { const statuses: number[] = []; statuses.push(r.status()); });\n  await page.goto('/x', { waitUntil: 'networkidle' });\n  expect(statuses).toEqual([]);")), ['-']);
  });
});

describe('QAG-287 B3: narrowing only', () => {
  const sources = [
    PRIOR + "  expect(await tile.getAttribute('src')).not.toBe(prior);",
    "  const field = await page.$('#email');\n  expect(await field!.inputValue()).toBe('');",
    LISTEN + "  await page.goto('/x', { waitUntil: 'networkidle' });\n  expect(statuses).not.toContain(500);",
    "  expect(await page.getByRole('status').textContent()).toBe('Shipped');\n  await page.waitForLoadState('networkidle');",
  ];
  type F = Awaited<ReturnType<typeof score>>[number];
  const identity = (fs: F[]) => fs.map((f) => [f.rule, f.line, f.column, f.message, f.severity, f.dimension].join('|')).sort();
  const cells = (fs: F[]) => fs.filter((f) => f.rule === READ || f.rule === IDLE).map((f) => `${f.form ?? '-'}:${f.tier}`).sort();

  it('with the form steps off, every finding is where it was and carries the form it had before', async () => {
    const moved: string[] = [];
    for (const src of sources) {
      const on = await score(src, { inProcess: true });
      readShapeForms.enabled = false;
      captureWindow.enabled = false;
      let off: F[];
      try {
        off = await score(src, { inProcess: true });
      } finally {
        readShapeForms.enabled = true;
        captureWindow.enabled = true;
      }
      assert.deepEqual(identity(on), identity(off), src);
      assert.ok(off.every((f) => f.rule !== READ || f.form === 'read-direct'), src);
      assert.ok(off.every((f) => f.rule !== IDLE || (f.form ?? '-') === '-'), src);
      // Fields outside form, tier and copy are untouched.
      const strip = (f: F) => {
        const { form: _form, tier: _tier, title: _title, what: _what, why: _why, fix: _fix, ...rest } = f as F & Record<string, unknown>;
        return JSON.stringify(rest);
      };
      assert.deepEqual(on.map(strip).sort(), off.map(strip).sort(), src);
      if (cells(on).join() !== cells(off).join()) moved.push(`${cells(off).join()} -> ${cells(on).join()}`);
    }
    // The switches are live: three sources move, and only to the three new forms; the tier never changes.
    assert.deepEqual(moved, ['read-direct:likely -> read-compare:likely', 'read-direct:likely -> read-handle:likely', '-:likely -> capture-window:likely']);
  });

  it('the new rows are likely by design and carry copy of their own', () => {
    for (const [rule, form] of [[READ, 'read-compare'], [READ, 'read-handle'], [IDLE, 'capture-window']]) {
      const row = rowFor(rule, form)!;
      assert.equal(row.design, 'likely', form);
      assert.equal(row.bcEligible, false, form);
      assert.notEqual(row.title, rowFor(rule, rule === READ ? 'read-direct' : '-')!.title, form);
    }
  });
});
