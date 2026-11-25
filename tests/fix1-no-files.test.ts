import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scorePaths } from '../src/index.js';
import { formatSarif } from '../src/formatters/sarif.js';
import { noFilesPathLabel } from '../src/fs-util.js';

describe('QAG-287 FIX1 5: the no-files finding', () => {
  it('never echoes an absolute path the caller typed, and SARIF says error like the JSON severity', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-nofiles-'));
    try {
      const r = await scorePaths({ paths: [path.join(dir, 'missing', 'e2e'), 'rel/dir'], cwd: dir });
      const f = r.findings.find((x) => x.rule === 'playwright-score/no-files');
      assert.ok(f);
      assert.equal(f.message, 'No Playwright spec files matched: missing/e2e, rel/dir');
      assert.ok(!f.message.includes(dir));
      assert.equal(f.severity, 'error');
      const sarif = JSON.parse(formatSarif(r)) as { runs: Array<{ results: Array<{ ruleId: string; level: string }> }> };
      assert.equal(sarif.runs[0]!.results.find((x) => x.ruleId === 'playwright-score/no-files')?.level, 'error');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('FIX1 R2: a path outside the working directory, typed absolute, as ../ or as .//abs/path, shows only its last segment', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-nofiles-'));
    const cwd = path.join(root, 'work');
    fs.mkdirSync(cwd);
    try {
      const paths = [
        path.join(root, 'elsewhere', 'e2e'), // absolute, outside the working directory
        path.join(cwd, 'missing', 'specs'), // absolute, inside it: shown relative
        `./${path.join(root, 'gone', 'suite')}`, // "./" in front of an absolute path
        '../up/tests', // typed relative, outside it
        'rel/dir', // typed relative, inside it: shown as typed
      ];
      const r = await scorePaths({ paths, cwd });
      const f = r.findings.find((x) => x.rule === 'playwright-score/no-files');
      assert.ok(f);
      assert.equal(f.message, 'No Playwright spec files matched: e2e, missing/specs, suite, tests, rel/dir');
      assert.ok(!f.message.includes(root));
      assert.ok(!f.message.includes('..'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('FIX1 R2: the same rule for Windows paths (path.win32): another drive, outside, .\\ in front, inside', () => {
    const w = path.win32;
    const cwd = 'C:\\work\\repo';
    assert.equal(noFilesPathLabel('D:\\Users\\name\\e2e', cwd, w), 'e2e'); // path.relative across drives is absolute
    assert.equal(noFilesPathLabel('C:\\Users\\name\\e2e', cwd, w), 'e2e');
    assert.equal(noFilesPathLabel('.\\C:\\Users\\name\\e2e', cwd, w), 'e2e');
    assert.equal(noFilesPathLabel('D:\\', cwd, w), '(outside the working directory)');
    assert.equal(noFilesPathLabel('C:\\work\\repo\\missing\\e2e', cwd, w), 'missing/e2e');
    assert.equal(noFilesPathLabel(cwd, cwd, w), '.');
    assert.equal(noFilesPathLabel('rel\\dir', cwd, w), 'rel\\dir');
  });
});
