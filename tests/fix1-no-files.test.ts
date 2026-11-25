import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scorePaths } from '../src/index.js';
import { formatSarif } from '../src/formatters/sarif.js';

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
});
