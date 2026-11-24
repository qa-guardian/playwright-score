import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scorePaths } from '../src/index.js';
import { basePlugin, contain, ruleCrashes } from '../src/rules/base-plugin.js';
import { INCOMPLETE_NOTE } from '../src/report-model.js';
import { formatJson } from '../src/formatters/json.js';
import { formatText } from '../src/formatters/text.js';
import { formatReport } from '../src/formatters/report.js';
import { formatMarkdown } from '../src/formatters/markdown.js';

// QAG-287 fix round 1: output built from untrusted names must stay well formed.

function packageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'fixtures'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('package root not found');
}
const fixtures = path.join(packageRoot(), 'fixtures', 'robustness');

describe('QAG-287 fix round 1: markdown formatter escaping', () => {
  it('a test title with a pipe or newline cannot split a finding line or table row', async () => {
    const result = await scorePaths({
      paths: [path.join(fixtures, 'shared-pipe-title.spec.ts')],
      profile: 'standard',
      threshold: 0,
      cwd: fixtures,
    });
    const hit = result.findings.find((f) => f.rule === 'pwscore/no-shared-mutable-state');
    assert.ok(hit, JSON.stringify(result.findings));
    assert.match(hit.message, /create \| the record/); // raw data keeps the pipe
    // S10a: group lines carry the title and locations, not the message; a message reaches the
    // markdown only as a needs-check reason (--advice). Both paths keep every line whole.
    const md = formatMarkdown(result, { advice: true });
    const group = md.split('\n').find((l) => l.includes('shared-pipe-title.spec.ts'));
    assert.ok(group, md);
    assert.ok(!/[^\\]\|/.test(group.replace(/\\\|/g, '')), group);
    const asReason = formatMarkdown({ ...result, findings: [{ ...hit, tier: 'needs-check' }] }, { advice: true });
    const line = asReason.split('\n').find((l) => l.includes('the record'));
    assert.ok(line, asReason);
    assert.ok(line.includes('create \\| the record second line'), line);
    assert.ok(!/[^\\]\|/.test(line.replace(/\\\|/g, '')), line);
  });
});

describe('QAG-287 fix round 1: a crashing rule does not take down the run', () => {
  it('contains exceptions from create() and from listeners', () => {
    ruleCrashes.length = 0;
    const boomCreate = contain('boom-create', { create: () => { throw new Error('x'); } } as never);
    assert.deepEqual(boomCreate.create({} as never), {});
    const boomListener = contain('boom-listener', {
      create: () => ({ CallExpression: () => { throw new Error('y'); }, 'Program:exit': () => 1 }),
    } as never);
    const l = boomListener.create({} as never) as Record<string, () => unknown>;
    assert.doesNotThrow(() => l.CallExpression());
    assert.equal(l['Program:exit'](), 1);
    assert.equal(ruleCrashes.length, 2);
    ruleCrashes.length = 0;
  });
});

describe('QAG-287 fix round 2: a crashed rule is reported, not silent', () => {
  const file = path.join(fixtures, 'shared-pipe-title.spec.ts');
  const original = basePlugin.rules['no-fixme-test']!;
  const crash = () => {
    basePlugin.rules['no-fixme-test'] = contain('no-fixme-test', {
      meta: original.meta,
      create: () => ({ Program: () => { throw new Error('boom'); } }),
    } as never);
  };
  const restore = () => { basePlugin.rules['no-fixme-test'] = original; };

  it('puts ruleCrashes on the result, resets between runs, and keeps clean JSON free of the key', async () => {
    crash();
    try {
      // In process: the rule is swapped in this thread's plugin object, which the analysis worker does not share.
      // (The CLI test below covers a crash inside the worker.)
      const bad = await scorePaths({ paths: [file], profile: 'standard', threshold: 0, cwd: fixtures, isolate: false });
      assert.deepEqual(bad.ruleCrashes, [{ rule: 'no-fixme-test', count: 1 }]);
      assert.ok(JSON.parse(formatJson(bad)).ruleCrashes);
      assert.ok(formatText(bad, { suiteName: 'x', version: '0' }).includes(INCOMPLETE_NOTE));
      assert.ok(formatMarkdown(bad).includes(INCOMPLETE_NOTE));
      assert.ok(formatReport(bad, { suiteName: 'x', version: '0', date: '2026-01-01' }).includes(INCOMPLETE_NOTE));
    } finally {
      restore();
    }
    const clean = await scorePaths({ paths: [file], profile: 'standard', threshold: 0, cwd: fixtures });
    assert.equal(clean.ruleCrashes, undefined);
    assert.ok(!('ruleCrashes' in JSON.parse(formatJson(clean))));
    assert.ok(!formatText(clean, { suiteName: 'x', version: '0' }).includes(INCOMPLETE_NOTE));
  });

  it('the CLI prints one stderr warning per crashed rule', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-crash-'));
    try {
      const dist = path.join(packageRoot(), 'dist');
      const preload = path.join(tmp, 'preload.mjs');
      fs.writeFileSync(
        preload,
        `import { basePlugin, contain } from ${JSON.stringify(pathToFileURL(path.join(dist, 'rules', 'base-plugin.js')).href)};\n` +
          `basePlugin.rules['no-fixme-test'] = contain('no-fixme-test', { meta: basePlugin.rules['no-fixme-test'].meta, create: () => ({ Program: () => { throw new Error('boom'); } }) });\n`
      );
      const { stderr } = await promisify(execFile)(
        process.execPath,
        ['--import', preload, path.join(dist, 'cli.js'), file, '--threshold', '0'],
        { cwd: tmp }
      ).catch((e) => e as { stderr: string });
      assert.match(stderr, /^warning: rule no-fixme-test crashed on 1 node\(s\); results may be incomplete$/m);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('QAG-287 fix round 2: no-tests state never prints the working directory', () => {
  it('text and markdown omit the hard-fail finding whose file is the absolute cwd', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-empty-'));
    try {
      const result = await scorePaths({ paths: [path.join(empty, 'nothing')], profile: 'standard', cwd: empty });
      assert.equal(result.summary.tests, 0);
      const seg = path.basename(empty);
      for (const out of [
        formatText(result, { suiteName: 'x', version: '0' }),
        formatMarkdown(result),
        formatReport(result, { suiteName: 'x', version: '0', date: '2026-01-01' }),
      ]) {
        assert.ok(!out.includes(seg), out);
      }
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});
