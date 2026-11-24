import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scorePaths } from '../src/index.js';
import { extractHelperFacts } from '../src/metrics.js';

// QAG-287 fix round 2: the 2.4.0 round-2 review found two more variants where
// an exemption hid a defect that published 2.3.0 reports. Every snippet is the
// reviewer's probe; it must fire.

async function findingsFor(rule: string, files: Record<string, string>, entry = 'temp.spec.ts') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-fix2-'));
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

const VALID = 'playwright/valid-expect';
const EXPECT_EXPECT = 'playwright/expect-expect';

describe('fix2 item B: a returned expect is exempt only when EVERY in-file caller chains a matcher', () => {
  const mixed = spec(`
function banner(page) {
  return expect(page.getByText('Saved'));
}
test('chains', async ({ page }) => {
  await banner(page).toBeVisible();
});
test('second caller forgets the matcher', async ({ page }) => {
  await page.getByRole('button', { name: 'Save' }).click();
  await banner(page);
});`);

  it('one chaining caller does not exempt the helper for a caller that does not', async () => {
    const f = await findingsFor(VALID, mixed);
    assert.equal(f.length, 1);
    assert.equal(f[0].line, 4);
  });

  it('a helper that no caller ever chains reports expect-expect on its callers again', async () => {
    const f = await findingsFor(EXPECT_EXPECT, spec(`
function banner(page) {
  return expect(page.getByText('Saved'));
}
test('never chains', async ({ page }) => {
  await page.getByRole('button', { name: 'Save' }).click();
  await banner(page);
});`));
    assert.equal(f.length, 1);
    assert.equal(f[0].line, 6);
  });

  it('the chaining sibling of a non-chaining caller is not flagged (no false expect-expect)', async () => {
    const f = await findingsFor(EXPECT_EXPECT, mixed);
    assert.equal(f.filter((x) => x.line === 6).length, 0);
  });

  it('every caller chaining (direct, awaited, stored) stays exempt', async () => {
    const body = spec(`
function banner(page) {
  return expect(page.getByText('Saved'));
}
test('a', async ({ page }) => { await banner(page).toBeVisible(); });
test('b', async ({ page }) => { await (await banner(page)).not.toBeHidden(); });
test('c', async ({ page }) => { const e = banner(page); await e.toBeVisible(); });`);
    assert.equal((await findingsFor(VALID, body)).length, 0);
    assert.equal((await findingsFor(EXPECT_EXPECT, body)).length, 0);
  });
});

describe('fix2 item P: helper facts do not walk the whole file once per helper', () => {
  it('a page object with 1500 asserting methods yields its facts quickly', () => {
    const methods = Array.from(
      { length: 1500 },
      (_, i) =>
        `  async m${i}(x: string) { await this.page.getByRole('button', { name: x + '${i}' }).click(); await expect(this.page.getByText('ok${i}')).toBeVisible(); }`
    );
    const source = `import { expect, type Page } from '@playwright/test';\nexport class Big {\n  constructor(private page: Page) {}\n${methods.join('\n')}\n}\n`;
    // CPU time, not wall-clock time: the bar guards the work done (a walk of the
    // whole file per helper), which a loaded machine does not change; wall-clock
    // time under load (7.2 s at load 60) measured the queue for a core instead.
    const t0 = process.cpuUsage();
    const facts = extractHelperFacts(source, 'big.ts');
    const used = process.cpuUsage(t0);
    const ms = Math.round((used.user + used.system) / 1000);
    assert.ok(facts.length >= 1500, `expected a fact per method, got ${facts.length}`);
    // Was ~20 s with the per-helper caller walk; a few hundred ms now.
    assert.ok(ms < 5000, `extractHelperFacts used ${ms} ms of CPU`);
  });
});

describe('fix2 item S: publish-name restores package.json when interrupted', () => {
  // Stub `npm` on PATH: `view` finds nothing, `publish` announces itself and hangs.
  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]] as const) {
    it(`${signal} during npm publish restores package.json and exits ${code}`, async (t) => {
      if (process.platform === 'win32') return t.skip('POSIX stub');
      const { spawn } = await import('node:child_process');
      const root = path.resolve(import.meta.dirname ?? '.', '..', '..');
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-pub-'));
      try {
        fs.mkdirSync(path.join(dir, 'scripts'));
        for (const f of ['publish-name.mjs', 'set-package-name.mjs']) fs.copyFileSync(path.join(root, 'scripts', f), path.join(dir, 'scripts', f));
        const original = JSON.stringify({ name: '@qaguardian/playwright-score', version: '9.9.9' }, null, 2) + '\n';
        fs.writeFileSync(path.join(dir, 'package.json'), original);
        fs.mkdirSync(path.join(dir, 'bin'));
        const stub = path.join(dir, 'bin', 'npm');
        fs.writeFileSync(stub, `#!/bin/sh\nif [ "$1" = view ]; then exit 1; fi\ntouch "${dir}/publishing"\nexec sleep 30\n`, { mode: 0o755 });
        const child = spawn(process.execPath, ['scripts/publish-name.mjs', 'pwscore'], {
          cwd: dir,
          env: { ...process.env, PATH: `${path.join(dir, 'bin')}${path.delimiter}${process.env.PATH}` },
          stdio: 'ignore',
        });
        const exited = new Promise<number | null>((resolve) => child.on('close', (c, s) => resolve(c ?? (s ? 128 : null))));
        for (let i = 0; i < 100 && !fs.existsSync(path.join(dir, 'publishing')); i++) await new Promise((r) => setTimeout(r, 100));
        assert.ok(fs.existsSync(path.join(dir, 'publishing')), 'npm publish stub never started');
        assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).name, 'pwscore');
        child.kill(signal);
        assert.equal(await exited, code);
        assert.equal(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'), original);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});
