import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scorePaths } from '../src/index.js';
import { readForms } from '../src/read-forms.js';

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

  it('expect.soft on a reused read is read-reused', async () => {
    const f = await reads("  const shown = await page.getByRole('alert').isVisible();\n  if (shown) { await page.getByRole('button').click(); }\n  expect.soft(shown).toBe(true);");
    assert.deepEqual(f.map((x) => x.form), ['read-reused']);
  });

  it('a read upstream reports inside its declaration is judged on the declared variable', async () => {
    const reused = await reads("  const names = await page.getByRole('listitem').allTextContents();\n  console.log(names.length);\n  expect(names).toEqual(['a']);");
    assert.deepEqual(reused.map((x) => x.form), ['read-reused']);
    const once = await reads("  const names = await page.getByRole('listitem').allTextContents();\n  expect(names).toEqual(['a']);");
    assert.deepEqual(once.map((x) => x.form), ['read-direct']);
  });

  it('an inner binding of the same name is not a reuse of the outer read', async () => {
    const pre = "  const n = await page.getByRole('row').count();\n  console.log(n);\n";
    for (const use of ['[1, 2].forEach((n) => expect(n).toBe(1));', 'for (const n of [1, 2]) expect(n).toBe(1);', 'try { x(); } catch (n) { expect(n).toBe(1); }', 'const f = ({ n }) => expect(n).toBe(1);', '{ const n = 1; expect(n).toBe(1); }']) {
      assert.deepEqual(await reads(pre + '  ' + use), [], use);
    }
  });

  it('the same sources give the same (rule, file, line, column, message) with form assignment on and off', async () => {
    const sources = [
      "  const shown = await page.getByRole('alert').isVisible();\n  if (shown) { await page.getByRole('button').click(); }\n  expect(shown).toBe(true);",
      "  const names = await page.getByRole('listitem').allTextContents();\n  console.log(names.length);\n  expect(names).toEqual(['a']);",
      "  const t = await page.getByTestId('total').textContent();\n  expect(t).toBe('$10');",
      "  expect(await page.getByRole('alert').isVisible()).toBe(true);",
    ];
    const key = (fs: Awaited<ReturnType<typeof reads>>) => fs.map((f) => [f.rule, f.line, f.column, f.message].join('|')).sort();
    for (const src of sources) {
      const on = await reads(src);
      readForms.enabled = false;
      let off: Awaited<ReturnType<typeof reads>>;
      try {
        off = await reads(src);
      } finally {
        readForms.enabled = true;
      }
      assert.deepEqual(key(on), key(off), src);
      assert.ok(on.length > 0);
      assert.ok(off.every((f) => f.form === undefined));
    }
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
    const f = await reads("  const n = await page.getByRole('row').count();\n  expect(n).toBe(3);\n  expect(n).toEqual(3);");
    assert.deepEqual(f.map((x) => x.form), ['read-reused', 'read-reused']);
  });

  it('only matchers with a web-first equivalent are reported, so a weak count check is not charged twice', async () => {
    const f = await reads(
      [
        "  expect(await page.getByRole('row').count()).toBeGreaterThanOrEqual(0);",
        "  expect(await page.getByRole('row').count()).toBeDefined();",
        "  expect(await page.getByRole('row').count()).toBeGreaterThan(2);",
        "  expect(page.url()).toBeDefined();",
      ].join('\n')
    );
    assert.deepEqual(f, []);
  });

  it('expect.soft with a url read is reported', async () => {
    const f = await reads("  expect.soft(page.url()).toContain('/cart');");
    assert.deepEqual(f.map((x) => x.form), ['read-url-count']);
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
