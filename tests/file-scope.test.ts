import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scorePaths } from '../src/index.js';
import { looksLikeNonPlaywrightTest } from '../src/metrics.js';
import { formatMarkdown } from '../src/formatters/markdown.js';

// QAG-287 slice C: findings must sit on files that are Playwright specs, and
// their paths must open from the directory the user scored.

function repo(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-scope-'));
  fs.mkdirSync(path.join(dir, '.git'));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  return dir;
}

describe('non-Playwright unit tests are not specs', () => {
  it('skips vite-plus/test, vitest subpaths and @vitest/*', () => {
    for (const mod of ['vite-plus/test', 'vitest/globals', '@vitest/expect']) {
      assert.equal(looksLikeNonPlaywrightTest(`import { describe, it, expect } from "${mod}";\nit('a', () => { expect(1).toBe(1); });`), true, mod);
    }
  });

  it('skips a global-API unit test with no import', () => {
    assert.equal(
      looksLikeNonPlaywrightTest(`describe('x', () => {\n  it('works', () => {\n    expect(add(1, 2)).toBe(3);\n  });\n});\n`),
      true
    );
    assert.equal(looksLikeNonPlaywrightTest(`const f = vi.fn();\nexpect(f).toBeDefined();`), true);
  });

  it('keeps real specs that import test from a fixtures file, alias or package', () => {
    for (const from of ['./fixtures', '@/fixtures/base', '@acme/e2e-kit', '../../support']) {
      assert.equal(
        looksLikeNonPlaywrightTest(`import { test, expect } from '${from}';\ntest.describe('s', () => {\n  test('a', async ({ page }) => {\n    await expect(page).toHaveURL('/');\n  });\n});\n`),
        false,
        from
      );
    }
  });

  it('keeps a spec that renames test to it/describe', () => {
    assert.equal(
      looksLikeNonPlaywrightTest(`import { test as it, expect } from './fixtures';\nit('a', async ({ page }) => {});\nit('b', async ({ page }) => {});\n`),
      false
    );
  });
});

describe('test.fixme / test.skip declarations', () => {
  it('are not reported as missing an assertion', async () => {
    const dir = repo({
      'a.spec.ts':
        `import { test, expect } from '@playwright/test';\n` +
        `test.fixme('later', async ({ page }) => {});\n` +
        `test.skip('seed script', async ({ page }) => {\n  await page.goto('/');\n});\n` +
        `test('real', async ({ page }) => {\n  await page.goto('/');\n  await expect(page).toHaveURL('/');\n});\n`,
    });
    const r = await scorePaths({ paths: [dir], cwd: dir });
    assert.deepEqual(r.findings.filter((f) => f.rule === 'playwright/expect-expect'), []);
  });

  it('still flags an active test with no assertion', async () => {
    const dir = repo({
      'a.spec.ts':
        `import { test } from '@playwright/test';\n` +
        `test('no assert', async ({ page }) => {\n  await page.goto('/');\n});\n`,
    });
    const r = await scorePaths({ paths: [dir], cwd: dir });
    assert.equal(r.findings.filter((f) => f.rule === 'playwright/expect-expect').length, 1);
  });
});

describe('finding paths are relative to the scored directory', () => {
  const noAssert = `import { test } from '@playwright/test';\ntest('no assert', async ({ page }) => {\n  await page.goto('/');\n});\n`;

  it('resolves from the scored parent dir when specs live in a sub-directory', async () => {
    const dir = repo({
      'playwright.config.ts': `export default { testDir: './e2e/tests' };\n`,
      'e2e/tests/a.spec.ts': noAssert,
      'e2e/tests/deep/b.spec.ts': noAssert,
    });
    const r = await scorePaths({ paths: [dir], cwd: dir });
    const files = r.findings.filter((f) => f.rule === 'playwright/expect-expect').map((f) => f.file).sort();
    assert.deepEqual(files, ['e2e/tests/a.spec.ts', 'e2e/tests/deep/b.spec.ts']);
    for (const f of files) assert.ok(fs.existsSync(path.join(dir, f)), f);
  });

  it('works from a different cwd, and a single file is relative to its directory', async () => {
    const dir = repo({ 'x/y/a.spec.ts': noAssert });
    const r = await scorePaths({ paths: [path.join(dir, 'x')], cwd: os.tmpdir() });
    const f = r.findings.find((x) => x.rule === 'playwright/expect-expect');
    assert.equal(f?.file, 'y/a.spec.ts');
    assert.equal(r.baseDir, path.join(dir, 'x'));
    const one = await scorePaths({ paths: [path.join(dir, 'x/y/a.spec.ts')], cwd: dir });
    assert.equal(one.findings.find((x) => x.rule === 'playwright/expect-expect')?.file, 'a.spec.ts');
  });

  it('uses the common ancestor of several paths and leaks no absolute path', async () => {
    const dir = repo({ 'p/one/a.spec.ts': noAssert, 'p/two/b.spec.ts': noAssert });
    const r = await scorePaths({ paths: [path.join(dir, 'p/one'), path.join(dir, 'p/two')], cwd: dir });
    const files = r.findings.filter((f) => f.rule === 'playwright/expect-expect').map((f) => f.file).sort();
    assert.deepEqual(files, ['one/a.spec.ts', 'two/b.spec.ts']);
    const { baseDir: _b, ...shareable } = r;
    assert.ok(!JSON.stringify(shareable).includes(dir));
    assert.ok(!formatMarkdown(r).includes(dir));
  });
});
