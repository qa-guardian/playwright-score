import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scorePaths } from '../src/index.js';

// QAG-287 B1: forms of playwright/prefer-web-first-assertions (S3b read-reused, S7c read-url-count).

const RULE = 'playwright/prefer-web-first-assertions';

async function reads(body: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-read-'));
  try {
    const file = path.join(dir, 'a.spec.ts');
    fs.writeFileSync(file, `import { test, expect } from '@playwright/test';\n\ntest('t', async ({ page }) => {\n${body}\n});\n`);
    const r = await scorePaths({ paths: [file], profile: 'standard', threshold: 0, cwd: dir });
    return r.findings.filter((f) => f.rule === RULE);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('QAG-287 S3b: read-reused', () => {
  it('a direct read is read-direct and likely', async () => {
    const f = await reads("  expect(await page.getByRole('alert').isVisible()).toBe(true);");
    assert.equal(f.length, 1);
    assert.equal(f[0].form, 'read-direct');
    assert.equal(f[0].tier, 'likely');
    assert.equal(f[0].line, 4);
    assert.equal(f[0].column, 3);
  });

  it('a read used once through a variable stays read-direct', async () => {
    const f = await reads("  const t = await page.getByTestId('total').textContent();\n  expect(t).toBe('$10');");
    assert.deepEqual(f.map((x) => x.form), ['read-direct']);
  });

  it('a read referenced again is read-reused, on each of its assertions', async () => {
    const f = await reads("  const t = await page.getByTestId('total').textContent();\n  expect(t).toBe('$');\n  expect(t).toBe('$10');");
    assert.deepEqual(f.map((x) => x.form), ['read-reused', 'read-reused']);
    assert.ok(f.every((x) => x.tier === 'likely'));
    assert.deepEqual(f.map((x) => x.line), [5, 6]);
  });

  it('a member of the same name is not a reference', async () => {
    const f = await reads("  const t = await page.getByTestId('total').textContent();\n  expect(t).toBe(String(page.viewportSize()!.t));");
    assert.deepEqual(f.map((x) => x.form), ['read-direct']);
  });

  it('only the rule, position and message of a read-direct finding are what they were', async () => {
    const f = await reads("  const shown = await page.getByRole('alert').isVisible();\n  if (shown) { await page.getByRole('button').click(); }\n  expect(shown).toBe(true);");
    assert.equal(f.length, 1);
    assert.equal(f[0].form, 'read-reused');
    assert.match(f[0].message, /isVisible\(\)/);
  });
});

describe('QAG-287 S7c: read-url-count', () => {
  it('page.url() and a locator count are read-url-count, likely, and new findings', async () => {
    const f = await reads("  expect(page.url()).toContain('/cart');\n  expect(await page.getByRole('row').count()).toBe(3);");
    assert.deepEqual(f.map((x) => x.form), ['read-url-count', 'read-url-count']);
    assert.ok(f.every((x) => x.tier === 'likely' && x.severity === 'error'));
    assert.deepEqual(f.map((x) => [x.line, x.column]), [[4, 3], [5, 3]]);
  });

  it('a const-bound page or locator and a stored count are recognised', async () => {
    const f = await reads("  const p = page;\n  const rows = page.locator('tr');\n  expect(p.url()).toBe('/x');\n  const n = await rows.count();\n  expect(n).toBe(2);");
    assert.deepEqual(f.map((x) => x.form), ['read-url-count', 'read-url-count']);
  });

  it('read-reused wins over read-url-count', async () => {
    const f = await reads("  const n = await page.getByRole('row').count();\n  expect(n).toBe(3);\n  expect(n).toBeGreaterThan(0);");
    assert.deepEqual(f.map((x) => x.form), ['read-reused', 'read-reused']);
  });

  it('leaves retrying and non-page shapes alone', async () => {
    const f = await reads(
      [
        "  await expect(page).toHaveURL('/cart');",
        "  await expect(page.getByRole('row')).toHaveCount(3);",
        "  await expect.poll(() => page.url()).toContain('/cart');",
        "  await expect(async () => { expect(page.url()).toContain('/cart'); }).toPass();",
        "  const tally = { count: () => 4, url: () => 'x' };",
        "  expect(tally.count()).toBe(4);",
        "  expect(tally.url()).toBe('x');",
        "  expect(page.url());",
      ].join('\n')
    );
    assert.deepEqual(f, []);
  });
});
