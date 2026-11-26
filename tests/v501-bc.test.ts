import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scorePaths } from '../src/index.js';

// 3.0.1 lane 2. B: a promise made on purpose and handed on is not a dropped await (shared files), and `x?.t ?? ''` is
// not an empty fallback. C: a CommonJS `require('./helper')` reaches the helper like an ES import, and a swallowed
// negated probe is not re-checked by the same check after the page changed.

async function run(files: Record<string, string>, spec = 'a.spec.ts') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-v501bc-'));
  try {
    for (const [name, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      fs.writeFileSync(path.join(dir, name), text);
    }
    return await scorePaths({ paths: [path.join(dir, spec)], profile: 'standard', threshold: 0, cwd: dir });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const SPEC = `import { test } from '@playwright/test';\nimport { Po } from './po';\ntest('t', async ({ page }) => { await new Po(page).go(); });\n`;
const po = (body: string) => `import type { Page } from '@playwright/test';\nexport class Po {\n  pending: Promise<unknown> | undefined;\n  constructor(readonly page: Page) {}\n${body}\n}\n`;
const missing = (r: Awaited<ReturnType<typeof run>>, file = 'po.ts') => r.findings.filter((f) => f.rule === 'playwright/missing-playwright-await' && f.file.endsWith(file));

describe('3.0.1 B: a promise handed on is not a dropped await', () => {
  it('drops the arming idioms of a page object', async () => {
    const bodies = [
      `  async go() { this.pending = this.page.waitForResponse('**/api'); }`,
      `  async go() { const sent = this.page.waitForRequest('**/api'); return { sent }; }`,
      `  async go() { const sent = this.page.waitForRequest('**/api'); sent.catch(() => {}); return sent; }`,
      `  async go() { const sent = this.page.waitForEvent('framenavigated'); this.keep(sent); }\n  keep(_p: unknown) {}`,
      `  async go() { const r = this.page.waitForResponse('**/api').then((x) => x.finished()); return [r]; }`,
    ];
    for (const b of bodies) assert.equal(missing(await run({ 'a.spec.ts': SPEC, 'po.ts': po(b) })).length, 0, b);
  });

  it('keeps a promise that is dropped', async () => {
    const bodies = [
      `  async go() { const sent = this.page.waitForResponse('**/api'); }`,
      `  async go() { const sent = this.page.waitForResponse('**/api'); console.log(sent.url); }`,
    ];
    for (const b of bodies) assert.equal(missing(await run({ 'a.spec.ts': SPEC, 'po.ts': po(b) })).length, 1, b);
  });
});

describe('3.0.1 B1: handed-on exemption is narrow', () => {
  const specMissing = async (body: string) =>
    missing(await run({ 'a.spec.ts': `import { test, expect } from '@playwright/test';\ntest('t', async ({ page }) => {\n${body}\n});\n` }), 'a.spec.ts').length;
  it('never applies in a spec file', async () => {
    assert.equal(await specMissing(`  const r = page.waitForResponse('**/a');\n  expect(r).toBeTruthy();`), 1);
    assert.equal(await specMissing(`  const nav = page.waitForResponse('**/a');\n  const all = [nav];`), 1);
    assert.equal(await specMissing(`  const ctx: any = {};\n  ctx.saved = page.waitForRequest('**/a');`), 1);
  });
  it('keeps the finding in a shared file for expect, shadows, push and unreturned literals', async () => {
    const bodies = [
      `  async go() { const r = this.page.waitForResponse('**/a'); expect(r).toBeTruthy(); }`,
      `  async go() { const response = this.page.waitForResponse('**/a'); this.page.on('response', (response) => { console.log(response); }); }`,
      `  async go() { const nav = this.page.waitForResponse('**/a'); const all = [nav]; void all; }`,
      `  async go() { const ctx: any = {}; ctx.saved = this.page.waitForRequest('**/a'); }`,
      `  async go() { const pending: unknown[] = []; const p = this.page.waitForRequest('**/a'); pending.push(p); }`,
      `  async go() { const p = this.page.waitForRequest('**/a'); console.log({ p }); }`,
    ];
    for (const b of bodies) {
      const text = `import { expect, type Page } from '@playwright/test';\nexport class Po {\n  constructor(readonly page: Page) {}\n${b}\n}\n`;
      assert.equal(missing(await run({ 'a.spec.ts': SPEC, 'po.ts': text })).length, 1, b);
    }
  });
});

describe('3.0.1 B: empty fallback', () => {
  const spec = (expr: string) => `import { test, expect } from '@playwright/test';\ntest('t', async ({ page }) => {\n  const doc = { text: 'x' } as { text?: string } | undefined;\n  await expect(page.locator('p')).toContainText(${expr});\n});\n`;
  const empty = async (expr: string) => (await run({ 'a.spec.ts': spec(expr) })).findings.filter((f) => f.rule === 'pwscore/assertion-passes-anyway' && f.form === 'empty-fallback').length;
  it('reports a plain read, not an optional chain', async () => {
    assert.equal(await empty(`doc!.text ?? ''`), 1);
    assert.equal(await empty(`doc?.text ?? ''`), 1);
  });
  it('exempts an optional chain on an awaited const only', async () => {
    const run2 = async (decl: string) =>
      (await run({ 'a.spec.ts': `import { test, expect } from '@playwright/test';\ntest('t', async ({ page }) => {\n  ${decl}\n  await expect(page.locator('p')).toContainText(item?.name ?? '');\n});\n` })).findings.filter((f) => f.rule === 'pwscore/assertion-passes-anyway' && f.form === 'empty-fallback').length;
    assert.equal(await run2(`const item = await page.evaluate(() => ({ name: 'x' }));`), 0);
    assert.equal(await run2(`const item = [{ name: 'x' }].find((u) => u.name === 'x');`), 1);
  });
});

describe('3.0.1 C: CommonJS require reaches the helper', () => {
  const HELPER = `const { expect } = require('@playwright/test');\nasync function check(page) {\n  expect(page.locator('body')).toBeVisible();\n}\nmodule.exports = { check };\n`;
  const js = (req: string) => `const { test } = require('@playwright/test');\n${req}\ntest('t', async ({ page }) => { await check(page); });\n`;
  const hits = async (req: string) => missing(await run({ 'a.spec.js': js(req), 'helper.js': HELPER }, 'a.spec.js'), 'helper.js').length;
  it('follows a top-level require', async () => {
    assert.equal(await hits(`const { check } = require('./helper');`), 1);
    assert.equal(await hits(`const check = require('./helper').check;`), 1);
    assert.equal(await hits(`const { check } = require('./helper.js');`), 1);
  });
  it('does not follow a require inside a function or one it cannot read', async () => {
    assert.equal(await hits(`function load() { return require('./helper'); }\nconst check = () => {};`), 0);
    assert.equal(await hits(`const name = './helper';\nconst { check } = require(name);`), 0);
  });
});

describe('3.0.1 C: a swallowed negated probe repeated after the page changed', () => {
  const swallowed = async (body: string) => {
    const spec = `import { test, expect } from '@playwright/test';\ntest('t', async ({ page }) => {\n  const bar = page.locator('.bar');\n${body}\n});\n`;
    return (await run({ 'a.spec.ts': spec })).findings.filter((f) => f.rule === 'pwscore/no-swallowed-assertion').length;
  };
  const PROBE = `  await expect(bar).not.toHaveCSS('width', '50%').catch(() => {});`;
  const REPEAT = `  await expect(bar).not.toHaveCSS('width', '50%');`;
  it('reports it when an action sits between the probe and the repeat', async () => {
    assert.equal(await swallowed(`${PROBE}\n  await page.evaluate(() => window.scrollBy(0, 600));\n${REPEAT}`), 1);
    assert.equal(await swallowed(`${PROBE}\n  await page.getByRole('button').click();\n${REPEAT}`), 1);
  });
  it('keeps the exemption when nothing changed the page in between', async () => {
    assert.equal(await swallowed(`${PROBE}\n${REPEAT}`), 0);
    assert.equal(await swallowed(`${PROBE}\n  await bar.count();\n  await page.screenshot();\n${REPEAT}`), 0);
    assert.equal(await swallowed(`${PROBE}\n  await test.step('verify', async () => {\n  ${REPEAT}\n  });`), 0);
    assert.equal(await swallowed(`${PROBE}\n  await page.waitForLoadState();\n  await expect(page).toHaveTitle('x');\n${REPEAT}`), 0);
  });
});

describe('3.0.1 C: expect-expect evidence follows ES imports only', () => {
  const GOOD = `async function verifyBody(page) {\n  await expect(page.locator('body')).toBeVisible();\n}\n`;
  const noExpect = async (files: Record<string, string>, spec: string) =>
    (await run({ '.git/HEAD': 'ref: refs/heads/main\n', ...files }, spec)).findings.filter((f) => f.rule === 'playwright/expect-expect' && f.file.endsWith(spec)).length;
  it('a helper reached only through require() does not clear the test', async () => {
    const cjs = `const { expect } = require('@playwright/test');\n${GOOD}module.exports = { verifyBody };\n`;
    const spec = `const { test } = require('@playwright/test');\nconst { verifyBody } = require('./helper');\ntest('t', async ({ page }) => { await verifyBody(page); });\n`;
    assert.equal(await noExpect({ 'a.spec.js': spec, 'helper.js': cjs }, 'a.spec.js'), 1);
  });
  it('an ES-imported asserting helper still clears it', async () => {
    const es = `import { expect } from '@playwright/test';\nexport ${GOOD}`;
    const spec = `import { test } from '@playwright/test';\nimport { verifyBody } from './helper';\ntest('t', async ({ page }) => { await verifyBody(page); });\n`;
    assert.equal(await noExpect({ 'a.spec.ts': spec, 'helper.ts': es }, 'a.spec.ts'), 0);
  });
});
