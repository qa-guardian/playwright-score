import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scorePaths } from '../src/index.js';
import { notScoredState } from '../src/report-model.js';
import { sourceTypeFor } from '../src/source-type.js';

// QAG-287 slice B: a real suite must never be reported as empty because of
// its file extension or the way its playwright config spells testMatch.

function repo(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-discovery-'));
  fs.mkdirSync(path.join(dir, '.git'));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  return dir;
}

const esm = (title: string) =>
  `import { test, expect } from '@playwright/test';\n` +
  `test('${title}', async ({ page }) => {\n` +
  `  await page.goto('/');\n` +
  `  await expect(page.getByRole('heading')).toBeVisible();\n` +
  `});\n`;

const cjs = (title: string) =>
  `const { test, expect } = require('@playwright/test');\n` +
  `test('${title}', async ({ page }) => {\n` +
  `  await page.goto('/');\n` +
  `  await expect(page.getByRole('heading')).toBeVisible();\n` +
  `});\n`;

async function score(dir: string) {
  return scorePaths({ paths: [dir], cwd: dir });
}

describe('QAG-287 B: every Playwright spec extension is discovered', () => {
  it('sourceTypeFor: .cjs/.cts are CommonJS, everything else a module', () => {
    assert.equal(sourceTypeFor('a.cjs'), 'commonjs');
    assert.equal(sourceTypeFor('a.cts'), 'commonjs');
    assert.equal(sourceTypeFor('a.mjs'), 'module');
    assert.equal(sourceTypeFor('a.ts'), 'module');
    assert.equal(sourceTypeFor(undefined), 'module');
  });

  it('scores .spec.mjs (ESM) and .spec.cjs (require) files, counting their tests', async () => {
    const dir = repo({
      'tests/a.spec.mjs': esm('esm one'),
      'tests/b.spec.cjs': cjs('cjs one'),
      'tests/c.test.mts': esm('mts one'),
      'tests/d.test.cts': cjs('cts one'),
    });
    try {
      const r = await score(dir);
      assert.equal(r.summary.files, 4, JSON.stringify(r.summary));
      assert.equal(r.summary.tests, 4, JSON.stringify(r.summary));
      assert.equal(r.ruleCrashes, undefined);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('parses a .cjs file as CommonJS (top-level return is legal there)', async () => {
    const dir = repo({
      'tests/guard.spec.cjs': `if (!process.env.RUN) return;\n` + cjs('guarded'),
    });
    try {
      const r = await score(dir);
      assert.equal(r.summary.tests, 1, JSON.stringify(r.findings.map((f) => f.message)));
      assert.ok(!r.findings.some((f) => f.rule === 'playwright-score/parse-error'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('applies the lint rules to .mjs specs (a hard wait is still reported)', async () => {
    const dir = repo({
      'tests/wait.spec.mjs':
        `import { test, expect } from '@playwright/test';\n` +
        `test('waits', async ({ page }) => {\n  await page.goto('/');\n  await page.waitForTimeout(3000);\n  await expect(page).toHaveURL('/');\n});\n`,
    });
    try {
      const r = await score(dir);
      assert.ok(r.findings.some((f) => /wait-for-timeout/.test(f.rule)), JSON.stringify(r.findings.map((f) => f.rule)));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('QAG-287 B: testMatch / testDir / testIgnore in the playwright config', () => {
  it('honours a regex testMatch with testDir: __dirname (neomjs/neo shape)', async () => {
    const dir = repo({
      'playwright.config.mjs':
        `import { defineConfig } from '@playwright/test';\n` +
        `import path from 'path';\nimport { fileURLToPath } from 'url';\n` +
        `const __dirname = path.dirname(fileURLToPath(import.meta.url));\n` +
        `export default defineConfig({ testDir: __dirname, testMatch: /.*\\.spec\\.mjs/, testIgnore: /skipped\\// });\n`,
      'unit/a.spec.mjs': esm('a'),
      'unit/skipped/b.spec.mjs': esm('b'),
      'unit/c.other.mjs': esm('c'),
    });
    try {
      const r = await score(dir);
      assert.equal(r.summary.files, 1, JSON.stringify(r.summary));
      assert.equal(r.summary.tests, 1);
      assert.equal(r.configWarnings, undefined);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('honours a string testMatch, a regex and an array, per project', async () => {
    const dir = repo({
      'playwright.config.ts':
        `import { defineConfig } from '@playwright/test';\n` +
        `export default defineConfig({\n  projects: [\n` +
        `    { name: 'str', testDir: './checks', testMatch: '*.check.ts' },\n` +
        `    { name: 'rx', testDir: './verify', testMatch: /.*\\.verify\\.mjs$/ },\n` +
        `    { name: 'arr', testDir: './misc', testMatch: ['one.ts', /two\\.ts$/] },\n` +
        `  ],\n});\n`,
      'checks/deep/a.check.ts': esm('a'),
      'checks/ignored.spec.ts': esm('not matched by the project'),
      'verify/b.verify.mjs': esm('b'),
      'misc/one.ts': esm('one'),
      'misc/x/two.ts': esm('two'),
      'misc/three.ts': esm('three'),
    });
    try {
      const r = await score(dir);
      assert.equal(r.summary.files, 4, JSON.stringify(r.summary));
      assert.equal(r.summary.tests, 4);
      assert.equal(r.configWarnings, undefined);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads `const config = {...}; export default config`', async () => {
    const dir = repo({
      'playwright.config.mjs': `const config = { testDir: './tests', testMatch: '*.pw-check.mjs' };\nexport default config;\n`,
      'tests/a.pw-check.mjs': esm('a'),
    });
    try {
      const r = await score(dir);
      assert.equal(r.summary.tests, 1, JSON.stringify(r.summary));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('matches testMatch against the absolute path (pattern names directories above testDir)', async () => {
    const dir = repo({
      'e2e/enrichment/playwright.config.js':
        `export default { testMatch: '**/e2e/enrichment/tests/*.e2e.spec.js' };\n`,
      'e2e/enrichment/tests/a.e2e.spec.js': esm('a'),
    });
    try {
      const r = await score(path.join(dir, 'e2e/enrichment'));
      assert.equal(r.summary.tests, 1, JSON.stringify(r.summary));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps config-matched, spec-named files that import test from a wrapper package or path alias', async () => {
    const dir = repo({
      'playwright.config.ts': `import { defineConfig } from '@playwright/test';\nexport default defineConfig({ testDir: './tests' });\n`,
      'tests/a.test.ts':
        `import { test, expect } from '@lib/base-test';\n` +
        `test('wrapped', async ({ page }) => {\n  await expect(page).toHaveURL('/');\n});\n`,
    });
    try {
      const r = await score(dir);
      assert.equal(r.summary.tests, 1, JSON.stringify(r.summary));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to the default pattern (with a warning) for a config it cannot read', async () => {
    const dir = repo({
      'playwright.config.ts': `import { defineConfig } from '@playwright/test';\nexport default defineConfig({ testMatch: process.env.MATCH });\n`,
      'tests/a.spec.mjs': esm('a'),
    });
    try {
      const r = await score(dir);
      assert.equal(r.summary.tests, 1);
      assert.ok(r.configWarnings && r.configWarnings.length === 1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('QAG-287 B: a directory that is not a Playwright suite', () => {
  it('reports "not scored / no tests", not a graded F with findings about the code', async () => {
    const dir = repo({
      'test/unit/a.test.mjs':
        `import test from 'node:test';\nimport assert from 'node:assert/strict';\n` +
        `test('adds', () => { assert.equal(1 + 1, 2); });\n`,
      'test/unit/b.spec.js': `import { describe, it, expect } from 'vitest';\ndescribe('x', () => { it('y', () => { expect(1).toBe(1); }); });\n`,
      'test/unit/c.test.cjs': `const test = require('node:test');\ntest('z', () => {});\n`,
    });
    try {
      const r = await score(dir);
      assert.equal(r.summary.tests, 0);
      assert.equal(notScoredState(r), 'no-tests');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
