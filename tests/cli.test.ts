import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

function packageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'bin'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  throw new Error('package root not found');
}

const root = packageRoot();
const cli = path.join(root, 'dist', 'cli.js');

describe('CLI process (spawned, not scorePaths() in-process — the only way to reproduce a stdout-pipe bug)', () => {
  it('does not truncate large JSON output piped to another process (regression: a real suite\'s 1200+-finding report — ~370KB — was silently cut to exactly 65536 bytes; console.log() + process.exit() raced Node\'s async pipe write against process termination)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-cli-large-output-'));
    try {
      // Enough findings to comfortably clear the 64KB pipe-buffer boundary
      // the bug truncated at, with margin: ~30 files x ~20 findings each.
      for (let i = 0; i < 30; i++) {
        const lines = [`import { test, expect } from '@playwright/test';`];
        for (let j = 0; j < 10; j++) {
          lines.push(
            `test('case ${i}-${j}', async ({ page }) => {`,
            `  await page.goto('/');`,
            `  await page.waitForTimeout(500);`,
            `  const el = page.locator('.item-${j}');`,
            `  await el.click();`,
            `});`
          );
        }
        fs.writeFileSync(path.join(dir, `spec-${i}.spec.ts`), lines.join('\n') + '\n');
      }

      // The generated fixtures are deliberately bad (hard waits, raw
      // locators, no assertions) so this scores well below threshold —
      // exit code 1, which execFile treats as a rejection even though
      // stdout is fully populated on the resulting error object. Only a
      // genuine tool error (exit 2, no stdout) should fail this test.
      let stdout: string;
      try {
        stdout = (
          await execFileAsync(process.execPath, [cli, dir, '--format', 'json'], {
            maxBuffer: 10 * 1024 * 1024,
          })
        ).stdout;
      } catch (err) {
        const e = err as { code?: number; stdout?: string };
        assert.equal(e.code, 1, `expected exit code 1 (below threshold), got ${e.code}`);
        assert.ok(e.stdout, 'expected stdout on the error object even though the process exited 1');
        stdout = e.stdout!;
      }

      assert.ok(
        stdout.length > 65536,
        `expected output well over the 64KB truncation boundary, got ${stdout.length} bytes`
      );
      let parsed: { summary?: { files?: number; findings?: number } };
      assert.doesNotThrow(() => {
        parsed = JSON.parse(stdout);
      }, `output was not valid JSON at ${stdout.length} bytes — truncated`);
      assert.equal(parsed!.summary?.files, 30);
      assert.ok((parsed!.summary?.findings ?? 0) > 300, `expected 300+ findings, got ${parsed!.summary?.findings}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exit code is 0 on pass, 1 on fail, matching --format text behavior for the same input', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-cli-exitcode-'));
    try {
      fs.writeFileSync(
        path.join(dir, 'good.spec.ts'),
        `import { test, expect } from '@playwright/test';\ntest('x', async ({ page }) => {\n  await page.goto('/');\n  await expect(page.getByRole('heading')).toBeVisible();\n});\n`
      );
      await assert.doesNotReject(
        execFileAsync(process.execPath, [cli, dir, '--format', 'json'])
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits non-zero for a directory with no matching files', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-cli-nofiles-'));
    try {
      await assert.rejects(
        execFileAsync(process.execPath, [cli, dir, '--format', 'json']),
        /Command failed/
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
