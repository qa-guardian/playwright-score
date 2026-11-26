import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { computeScope, fullRunReason, scopeLine, type ScopeInput } from '../src/changed-files.js';
import { scorePaths } from '../src/index.js';

function packageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'bin'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('package root not found');
}
const cli = path.join(packageRoot(), 'dist', 'cli.js');

// ---- computeScope: pure -------------------------------------------------------------------

const R = '/r';
const input = (over: Partial<ScopeInput> & { changed?: string[]; deleted?: string[] }): ScopeInput => ({
  specs: [`${R}/tests/a.spec.ts`, `${R}/tests/b.spec.ts`, `${R}/tests/c.spec.ts`],
  git: { changed: over.changed ?? [], deleted: over.deleted ?? [] },
  edges: new Map([
    [`${R}/tests/a.spec.ts`, [`${R}/pages/page.ts`]],
    [`${R}/tests/b.spec.ts`, [`${R}/fixtures/base.ts`]],
    [`${R}/fixtures/base.ts`, [`${R}/pages/page.ts`]],
    [`${R}/tests/c.spec.ts`, []],
  ]),
  specifiers: over.specifiers ?? new Map(),
});

describe('computeScope', () => {
  it('a changed spec is in scope alone', () => {
    const r = computeScope(input({ changed: [`${R}/tests/c.spec.ts`] }));
    assert.deepEqual(r.specs, [`${R}/tests/c.spec.ts`]);
    assert.equal(r.fallback, undefined);
  });
  it('a changed shared file fans out to every spec that reaches it, directly or through another file', () => {
    const r = computeScope(input({ changed: [`${R}/pages/page.ts`] }));
    assert.deepEqual(r.specs, [`${R}/tests/a.spec.ts`, `${R}/tests/b.spec.ts`]);
    const mid = computeScope(input({ changed: [`${R}/fixtures/base.ts`] }));
    assert.deepEqual(mid.specs, [`${R}/tests/b.spec.ts`]);
  });
  it('a changed file outside the scored paths (not in the graph) puts nothing in scope', () => {
    const r = computeScope(input({ changed: [`${R}/docs/readme.md`, `${R}/src/app.ts`] }));
    assert.deepEqual(r.specs, []);
  });
  it('a deleted spec is not scored; a deleted helper puts its importers in scope', () => {
    const gone = computeScope(input({ deleted: [`${R}/tests/old.spec.ts`] }));
    assert.deepEqual(gone.specs, []);
    const specifiers = new Map([[`${R}/tests/c.spec.ts`, ['../pages/removed.js', '@playwright/test']]]);
    const helper = computeScope(input({ deleted: [`${R}/pages/removed.ts`], specifiers }));
    assert.deepEqual(helper.specs, [`${R}/tests/c.spec.ts`]);
  });
  it('a rename arrives as delete + add: the new path is scored, the old one is not', () => {
    const r = computeScope(input({ changed: [`${R}/tests/b2.spec.ts`], deleted: [`${R}/tests/b.spec.ts`] }));
    assert.deepEqual(r.specs, []); // b2 is not among the specs found under the paths in this input
    const found = computeScope({ ...input({ changed: [`${R}/tests/b2.spec.ts`], deleted: [`${R}/tests/b.spec.ts`] }), specs: [`${R}/tests/b2.spec.ts`] });
    assert.deepEqual(found.specs, [`${R}/tests/b2.spec.ts`]);
  });
  it('a changed playwright config, tsconfig or lockfile scores every spec, wherever it is, and says why', () => {
    for (const f of ['playwright.config.ts', 'e2e/playwright.ci.config.js', 'tsconfig.json', 'tsconfig.base.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']) {
      const r = computeScope(input({ changed: [`${R}/${f}`] }));
      assert.equal(r.specs.length, 3, f);
      assert.match(r.fallback ?? '', /changed/, f);
    }
    assert.equal(computeScope(input({ deleted: [`${R}/playwright.config.ts`] })).specs.length, 3);
    assert.equal(fullRunReason('/r/package.json'), undefined);
    assert.equal(fullRunReason('/r/tests/a.spec.ts'), undefined);
  });
  it('scopeLine states SCOPED, the counts and the ref', () => {
    const line = scopeLine({ kind: 'changed-since', ref: 'origin/main', scoped: true, specFiles: 2, specFilesTotal: 10, changedFiles: 3, empty: false, files: [] });
    assert.match(line, /^SCOPED to changes since origin\/main: 2 of 10 spec files scored/);
  });
});

// ---- a real git repo in a temp dir ----------------------------------------------------------

const GOOD = (title: string, extra = ''): string =>
  `import { test, expect } from '@playwright/test';\n${extra}test('${title}', async ({ page }) => {\n  await page.goto('/');\n  await expect(page.getByRole('heading')).toBeVisible();\n});\n`;
const BAD = (title: string): string =>
  `import { test, expect } from '@playwright/test';\ntest('${title}', async ({ page }) => {\n  await page.goto('/');\n  await expect(page.locator('x')).toBeTruthy();\n});\n`;

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@example.com',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@example.com',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
};

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', ['-C', dir, ...args], { env: GIT_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function write(dir: string, rel: string, text: string): void {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
}

interface Run {
  code: number | null;
  out: string;
  err: string;
  json?: Record<string, unknown> & { scope?: Record<string, unknown>; pass?: boolean };
}
function run(dir: string, args: string[], json = true): Run {
  const r = spawnSync(process.execPath, [cli, dir, ...args, ...(json ? ['--format', 'json'] : [])], { cwd: dir, env: GIT_ENV, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  let parsed: Run['json'];
  if (json) {
    try {
      parsed = JSON.parse(r.stdout);
    } catch {
      /* an error exit has no JSON */
    }
  }
  return { code: r.status, out: r.stdout, err: r.stderr, json: parsed };
}

describe('--changed-since in a git repo (CLI spawned)', () => {
  let repo: string;
  const reset = (): void => {
    git(repo, 'checkout', '-q', '--force', 'feature');
    git(repo, 'reset', '-q', '--hard', 'base');
    git(repo, 'clean', '-qfd');
  };

  before(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-changed-'));
    git(repo, 'init', '-q', '-b', 'main');
    write(repo, 'pages/page.ts', `export class Page { heading() { return 'heading'; } }\n`);
    write(repo, 'pages/other.ts', `export const other = 1;\n`);
    write(repo, 'tests/a.spec.ts', GOOD('a', `import { Page } from '../pages/page.js';\n`));
    write(repo, 'tests/b.spec.ts', GOOD('b', `import { Page } from '../pages/page.js';\n`));
    write(repo, 'tests/c.spec.ts', GOOD('c', `import { other } from '../pages/other.js';\n`));
    write(repo, 'tests/d.spec.ts', BAD('d, bad and never touched'));
    write(repo, 'playwright.config.ts', `export default { testDir: './tests' };\n`);
    write(repo, 'package-lock.json', `{}\n`);
    write(repo, 'README.md', 'x\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'base');
    git(repo, 'branch', 'base');
    git(repo, 'checkout', '-q', '-b', 'feature');
  });
  after(() => fs.rmSync(repo, { recursive: true, force: true }));

  it('a committed change to one spec scores that spec only; the JSON says SCOPED', () => {
    reset();
    write(repo, 'tests/a.spec.ts', GOOD('a changed', `import { Page } from '../pages/page.js';\n`));
    git(repo, 'commit', '-q', '-am', 'edit a');
    const r = run(repo, ['--changed-since', 'base']);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(r.json?.scope, {
      kind: 'changed-since',
      ref: 'base',
      scoped: true,
      specFiles: 1,
      specFilesTotal: 4,
      changedFiles: 1,
      empty: false,
      files: ['tests/a.spec.ts'],
    });
    assert.equal((r.json?.summary as { files: number }).files, 1);
  });

  it('JSON contract: scope is the only new key, and a run without the flag has no scope', () => {
    reset();
    write(repo, 'tests/a.spec.ts', GOOD('a2', `import { Page } from '../pages/page.js';\n`));
    git(repo, 'commit', '-q', '-am', 'edit a');
    const scoped = run(repo, ['--changed-since', 'base']).json!;
    const full = run(repo, []).json!;
    assert.equal('scope' in full, false);
    assert.deepEqual(Object.keys(scoped).filter((k) => !(k in full)), ['scope']);
    assert.deepEqual(Object.keys(full).filter((k) => !(k in scoped)), []);
    for (const k of ['kind', 'ref', 'scoped', 'specFiles', 'specFilesTotal', 'changedFiles', 'empty', 'files']) assert.ok(k in scoped.scope!, k);
  });

  it('text and markdown output label the run SCOPED', () => {
    reset();
    write(repo, 'tests/a.spec.ts', GOOD('a3', `import { Page } from '../pages/page.js';\n`));
    git(repo, 'commit', '-q', '-am', 'edit a');
    const text = run(repo, ['--changed-since', 'base'], false);
    assert.match(text.out, /SCOPED to changes since base: 1 of 4 spec files scored/);
    const md = run(repo, ['--changed-since', 'base', '--format', 'markdown'], false);
    assert.match(md.out, /SCOPED to changes since base: 1 of 4 spec files scored/);
    assert.doesNotMatch(run(repo, [], false).out, /SCOPED/);
  });

  it('an uncommitted shared-file edit fans out to the specs that import it', () => {
    reset();
    write(repo, 'pages/page.ts', `export class Page { heading() { return 'h1'; } }\n`);
    const r = run(repo, ['--changed-since', 'base']);
    assert.deepEqual(r.json?.scope?.files, ['tests/a.spec.ts', 'tests/b.spec.ts']);
  });

  it('an untracked spec is in scope', () => {
    reset();
    write(repo, 'tests/new.spec.ts', GOOD('new'));
    const r = run(repo, ['--changed-since', 'base']);
    assert.deepEqual(r.json?.scope?.files, ['tests/new.spec.ts']);
    assert.equal(r.json?.scope?.specFilesTotal, 5);
  });

  it('a renamed spec is scored under its new name only', () => {
    reset();
    git(repo, 'mv', 'tests/b.spec.ts', 'tests/b-renamed.spec.ts');
    git(repo, 'commit', '-q', '-m', 'rename b');
    const r = run(repo, ['--changed-since', 'base']);
    assert.deepEqual(r.json?.scope?.files, ['tests/b-renamed.spec.ts']);
  });

  it('a deleted helper puts the specs that imported it in scope', () => {
    reset();
    git(repo, 'rm', '-q', 'pages/other.ts');
    git(repo, 'commit', '-q', '-m', 'drop other');
    const r = run(repo, ['--changed-since', 'base']);
    assert.deepEqual(r.json?.scope?.files, ['tests/c.spec.ts']);
  });

  it('a change that touches no spec is "nothing to score": exit 0, empty scope, no score gate', () => {
    reset();
    write(repo, 'README.md', 'changed\n');
    git(repo, 'commit', '-q', '-am', 'docs');
    const r = run(repo, ['--changed-since', 'base', '--threshold', '99']);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.json?.scope?.empty, true);
    assert.equal(r.json?.pass, true);
    const text = run(repo, ['--changed-since', 'base'], false);
    assert.equal(text.code, 0);
    assert.match(text.out, /Nothing to score/);
    assert.match(text.out, /0 of 4 spec files/);
  });

  it('a changed playwright config or lockfile falls back to a full run and says so', () => {
    for (const [file, text] of [
      ['playwright.config.ts', `export default { testDir: './tests', retries: 1 };\n`],
      ['package-lock.json', `{"a":1}\n`],
    ] as const) {
      reset();
      write(repo, file, text);
      git(repo, 'commit', '-q', '-am', 'config');
      const r = run(repo, ['--changed-since', 'base']);
      assert.equal(r.json?.scope?.scoped, false, file);
      assert.equal(r.json?.scope?.specFiles, 4, file);
      assert.match(String(r.json?.scope?.fallback), /changed/);
      const t = run(repo, ['--changed-since', 'base'], false);
      assert.match(t.out, /Full run, not scoped/);
    }
  });

  it('gate: fails only on findings in the scoped files', () => {
    reset();
    // d.spec.ts is bad but untouched: out of scope, so the gate passes.
    write(repo, 'tests/a.spec.ts', GOOD('a4', `import { Page } from '../pages/page.js';\n`));
    git(repo, 'commit', '-q', '-am', 'edit a');
    assert.equal(run(repo, ['--changed-since', 'base']).code, 0);
    assert.equal(run(repo, []).code, 1, 'the full run does fail on d.spec.ts');
    // Touch d.spec.ts and it is in scope: the gate fails.
    write(repo, 'tests/d.spec.ts', BAD('d, touched'));
    const r = run(repo, ['--changed-since', 'base']);
    assert.equal(r.code, 1);
    assert.deepEqual(r.json?.scope?.files, ['tests/a.spec.ts', 'tests/d.spec.ts']);
  });

  it('an unknown ref is a tool error (exit 2) with a clear message', () => {
    reset();
    const r = run(repo, ['--changed-since', 'no-such-branch']);
    assert.equal(r.code, 2);
    assert.match(r.err, /unknown git ref "no-such-branch"/);
  });

  it('a missing or option-like ref value is a usage error (exit 2)', () => {
    assert.equal(run(repo, ['--changed-since']).code, 2);
    assert.equal(run(repo, ['--changed-since', '--format']).code, 2);
  });

  it('a shallow clone that lacks the base ref says how to fetch it', () => {
    reset();
    write(repo, 'tests/a.spec.ts', GOOD('a5', `import { Page } from '../pages/page.js';\n`));
    git(repo, 'commit', '-q', '-am', 'edit a');
    const shallow = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-shallow-'));
    try {
      execFileSync('git', ['clone', '-q', '--depth', '1', '--branch', 'feature', `file://${repo}`, shallow], { env: GIT_ENV, stdio: 'pipe' });
      const r = run(shallow, ['--changed-since', 'origin/base']);
      assert.equal(r.code, 2);
      assert.match(r.err, /shallow clone/);
      assert.match(r.err, /fetch-depth: 0/);
    } finally {
      fs.rmSync(shallow, { recursive: true, force: true });
    }
  });

  it('outside a git repository is a tool error (exit 2)', () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-nogit-'));
    try {
      write(plain, 'a.spec.ts', GOOD('a'));
      const r = run(plain, ['--changed-since', 'main']);
      assert.equal(r.code, 2);
      assert.match(r.err, /needs a git repository/);
    } finally {
      fs.rmSync(plain, { recursive: true, force: true });
    }
  });

  it('library: scorePaths({ changedSince }) matches the CLI, and without it there is no scope', async () => {
    reset();
    write(repo, 'tests/a.spec.ts', GOOD('a6', `import { Page } from '../pages/page.js';\n`));
    git(repo, 'commit', '-q', '-am', 'edit a');
    const scoped = await scorePaths({ paths: [repo], changedSince: 'base', cwd: repo });
    assert.deepEqual(scoped.scope?.files, ['tests/a.spec.ts']);
    assert.equal(scoped.summary.files, 1);
    const full = await scorePaths({ paths: [repo], cwd: repo });
    assert.equal(full.scope, undefined);
    assert.equal(full.summary.files, 4);
  });

  it('a scoped finding reads exactly as it does in the full run (same relative path)', () => {
    reset();
    write(repo, 'tests/d.spec.ts', BAD('d, touched'));
    git(repo, 'commit', '-q', '-am', 'touch d');
    const scoped = run(repo, ['--changed-since', 'base']).json as unknown as { findings: Array<{ file: string; rule: string }> };
    const full = run(repo, []).json as unknown as { findings: Array<{ file: string; rule: string }> };
    const pick = (j: typeof scoped): string[] => j.findings.filter((f) => f.file.endsWith('d.spec.ts')).map((f) => `${f.file}|${f.rule}`).sort();
    assert.ok(pick(scoped).length > 0);
    assert.deepEqual(pick(scoped), pick(full));
  });
});
