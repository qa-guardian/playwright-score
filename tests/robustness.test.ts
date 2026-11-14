import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scorePaths } from '../src/index.js';
import { contain, ruleCrashes } from '../src/rules/base-plugin.js';
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
    const md = formatMarkdown(result);
    const line = md.split('\n').find((l) => l.includes('no-shared-mutable-state'));
    assert.ok(line, md);
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
