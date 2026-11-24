import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scorePaths } from '../src/index.js';

// QAG-287 S7b: a negated assertion whose rejection a `.catch` discards is reported even when a later assertion
// targets the same subject. The fixtures under tests/fixtures/cells/pwscore__no-swallowed-assertion/-/ hold the
// labelled shapes; these pin the edges: which handlers count as discarding, and that non-negated chains and
// other handlers keep the E1 behaviour.

const SWALLOWED = 'pwscore/no-swallowed-assertion';

async function hits(body: string, head = ''): Promise<number> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-s7b-'));
  try {
    const file = path.join(dir, 'temp.spec.ts');
    fs.writeFileSync(file, `import { test, expect } from '@playwright/test';\n${head}\ntest('t', async ({ page }) => {\n  const banner = page.getByTestId('promo-banner');\n${body}\n});\n`);
    const r = await scorePaths({ paths: [file], profile: 'standard', threshold: 0, cwd: dir });
    return r.findings.filter((f) => f.rule === SWALLOWED).length;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const LATER = `  await expect(banner).toHaveText('Winter sale');`;

describe('QAG-287 S7b: a swallowed negated assertion is not re-checked by a later positive one', () => {
  it('reports each discarding handler on a negated chain followed by a same-subject assertion', async () => {
    for (const handler of ['() => {}', '(e) => {}', 'function () {}', 'async () => {}', '() => undefined']) {
      assert.equal(await hits(`  await expect(banner).not.toBeVisible().catch(${handler});\n${LATER}`), 1, handler);
    }
    assert.equal(await hits(`  await expect(banner).not.toBeVisible().catch(noop);\n${LATER}`, 'function noop() {}'), 1, 'function noop');
    assert.equal(await hits(`  await expect(banner).not.toBeVisible().catch(noop);\n${LATER}`, 'const noop = () => {};'), 1, 'const noop');
    assert.equal(await hits(`  await expect(banner).resolves.not.toBe(1).catch(() => {});\n${LATER}`), 1, 'resolves.not');
  });

  it('keeps the exemption when the later hard assertion repeats the same negated check', async () => {
    assert.equal(await hits(`  await expect(banner).not.toBeVisible({ timeout: 2000 }).catch(() => {});\n  await expect(banner).not.toBeVisible();`), 0);
    assert.equal(await hits(`  await expect(banner).not.toHaveText('Saving').catch(() => {});\n  await expect(banner).not.toHaveText('Saving');`), 0);
    // a different argument or option is a different check
    assert.equal(await hits(`  await expect(banner).not.toHaveText('Saving').catch(() => {});\n  await expect(banner).not.toHaveText('Error');`), 1);
    assert.equal(await hits(`  await expect(banner).not.toBeVisible().catch(() => {});\n  await expect(banner).not.toBeVisible({ visible: false });`), 1);
  });

  it('leaves non-negated chains and other handlers as they were', async () => {
    // E1: a positive probe followed by a hard same-subject assertion is not reported
    assert.equal(await hits(`  await expect(banner).toBeVisible().catch(() => {});\n${LATER}`), 0);
    // a named handler on a positive chain is not reported, empty or not
    assert.equal(await hits(`  await expect(banner).toBeVisible().catch(noop);`, 'function noop() {}'), 0);
    // a logging handler on a negated chain keeps the E1 exemption
    assert.equal(await hits(`  await expect(banner).not.toBeVisible().catch((e) => { console.log(e); });\n${LATER}`), 0);
    assert.equal(await hits(`  await expect(banner).not.toBeVisible().catch(console.log);\n${LATER}`), 0);
  });

  it('does not treat an imported, non-empty or reassigned name as discarding', async () => {
    assert.equal(await hits(`  await expect(banner).not.toBeVisible().catch(noop);`, "import { noop } from './helpers';"), 0);
    assert.equal(await hits(`  await expect(banner).not.toBeVisible().catch(noop);`, 'function noop(e: unknown) { throw e; }'), 0);
    assert.equal(await hits(`  await expect(banner).not.toBeVisible().catch(noop);`, 'let noop = () => {};\nnoop = (e: unknown) => { throw e; };'), 0);
    assert.equal(await hits(`  await expect(banner).not.toBeVisible().catch(noop);`, 'let noop = () => {};'), 0);
  });
});
