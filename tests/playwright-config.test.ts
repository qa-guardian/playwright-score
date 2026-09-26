import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findRepoBoundary, resolveConfigScopedRoot, testDirEscapesRepo } from '../src/playwright-config.js';
import { scorePaths } from '../src/index.js';

// review-round fixes: findRepoBoundary must not fall back to the
// filesystem root or an arbitrary "20 levels up" ancestor when no `.git`
// is found, and a symlinked testDir must not let a scored repo's config
// walk this tool outside its own boundary — see src/playwright-config.ts.

describe('findRepoBoundary: no-.git fallback must stay bounded', () => {
  it('falls back to the given fallbackBoundary, not the filesystem root or 20 levels up, when no .git exists anywhere in the ancestor chain', () => {
    // Nest well below the tmp root so an unbounded fallback (the old
    // "wherever the 20-hop climb stopped" behavior) would visibly differ
    // from the tmp root itself, catching a regression either way.
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-boundary-nogit-'));
    try {
      const deep = path.join(tmpRoot, 'a', 'b', 'c', 'd');
      fs.mkdirSync(deep, { recursive: true });

      const boundary = findRepoBoundary(deep, tmpRoot);
      assert.equal(
        boundary,
        tmpRoot,
        `expected the explicit fallbackBoundary (${tmpRoot}) to win when no .git exists, got ${boundary}`
      );
      assert.notEqual(boundary, '/', 'must never fall back to the filesystem root');
      assert.notEqual(boundary, path.dirname(deep), 'must not silently use some other ancestor instead of the given fallback');
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('a `.git` FILE (worktree or submodule checkout) counts as a repo boundary, same as a `.git` directory', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-boundary-gitfile-'));
    try {
      // A real git worktree/submodule has a `.git` *file* containing
      // `gitdir: <path>`, not a `.git` directory.
      fs.writeFileSync(path.join(dir, '.git'), 'gitdir: /some/other/path/.git/worktrees/x\n');
      const nested = path.join(dir, 'tests', 'e2e');
      fs.mkdirSync(nested, { recursive: true });

      const boundary = findRepoBoundary(nested);
      assert.equal(boundary, dir, `expected the directory containing the .git file to be recognized as the boundary, got ${boundary}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('no .git anywhere at all: with no explicit fallback, still resolves to a real ancestor directory (never throws, never returns something outside the ancestor chain)', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-boundary-nogit-nofallback-'));
    try {
      const deep = path.join(tmpRoot, 'x', 'y');
      fs.mkdirSync(deep, { recursive: true });
      const boundary = findRepoBoundary(deep);
      // No .git exists, so this must be some ancestor of `deep` (its
      // legacy internal-search-bound behavior, used by
      // findPlaywrightConfig) — never an unrelated path.
      const rel = path.relative(boundary, deep);
      assert.ok(
        rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)),
        `expected ${boundary} to be an ancestor of ${deep}`
      );
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});

describe('resolveConfigScopedRoot: an escaping testDir clamps to repoRoot', () => {
  it('an absolute "/" testDir clamps to repoRoot', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-clamp-root-'));
    try {
      const abs = path.join(repo, 'tests');
      fs.mkdirSync(abs, { recursive: true });
      assert.equal(resolveConfigScopedRoot(abs, '/', repo), repo);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('a relative "../../.." testDir that climbs past the repo root clamps to repoRoot', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-clamp-relative-'));
    try {
      const abs = path.join(repo, 'tests');
      fs.mkdirSync(abs, { recursive: true });
      const escapingTestDir = path.resolve(repo, '../../..');
      assert.equal(resolveConfigScopedRoot(abs, escapingTestDir, repo), repo);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe('symlinked testDir cannot escape the repo boundary', () => {
  it('a testDir symlink pointing outside the repo is not scored, and the real in-repo spec still is', async () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-symlink-repo-'));
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-symlink-outside-'));
    try {
      fs.mkdirSync(path.join(repoDir, '.git'), { recursive: true });

      // A real Playwright spec living OUTSIDE the repo, reachable only
      // through a symlinked testDir.
      fs.writeFileSync(
        path.join(outsideDir, 'evil.spec.ts'),
        `import { test, expect } from '@playwright/test';\n` +
          `test('should never be scored', async ({ page }) => {\n` +
          `  await expect(page).toHaveTitle('evil');\n` +
          `});\n`
      );

      // A real spec inside the repo itself, so the scan still has
      // something legitimate to find.
      fs.writeFileSync(
        path.join(repoDir, 'real.spec.ts'),
        `import { test, expect } from '@playwright/test';\n` +
          `test('real', async ({ page }) => {\n` +
          `  await expect(page).toHaveTitle('real');\n` +
          `});\n`
      );

      fs.symlinkSync(outsideDir, path.join(repoDir, 'tests'), 'dir');
      fs.writeFileSync(
        path.join(repoDir, 'playwright.config.ts'),
        `import { defineConfig } from '@playwright/test';\n` +
          `export default defineConfig({\n` +
          `  testDir: './tests',\n` +
          `});\n`
      );

      const result = await scorePaths({ paths: [repoDir], profile: 'standard', cwd: repoDir });

      assert.ok(
        !result.findings.some((f) => f.file.includes('evil')),
        `evil.spec.ts (reached only via the symlinked testDir) must never be scored: ${JSON.stringify(result.findings)}`
      );
      assert.ok(
        result.configWarnings && result.configWarnings.length > 0,
        `expected a configWarnings entry explaining the escaped testDir fallback: ${JSON.stringify(result.configWarnings)}`
      );
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});

// QAG-230: testDirEscapesRepo only clamps testDir itself before it becomes
// a glob root — it can't see a symlinked directory the glob then walks
// *through* on the way to a match (a literal path segment in testMatch is
// still followed even with glob's `follow: false`, which only stops `**`
// from expanding into a symlinked directory), and it can't catch an
// individually symlinked spec file sitting directly in the repo either.
// Both are index.ts's own realpath containment check on every match, not
// testDirEscapesRepo's job — see expandPaths in src/index.ts.
describe('QAG-230: a match escaping the scanned root through a symlink is dropped', () => {
  it('a symlinked directory named by testMatch (not walked via `**`) is not scored, even though the config\'s own testDir never escapes the repo', async () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-qag230-dirlink-repo-'));
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-qag230-dirlink-outside-'));
    try {
      fs.mkdirSync(path.join(repoDir, '.git'), { recursive: true });
      fs.mkdirSync(path.join(repoDir, 'tests'), { recursive: true });

      const specBody = (title: string) =>
        `import { test, expect } from '@playwright/test';\n` +
        `test('${title}', async ({ page }) => {\n` +
        `  await expect(page).toHaveTitle('${title}');\n` +
        `});\n`;

      // A real Playwright spec OUTSIDE the repo, reachable only by
      // walking into `tests/evil`, a symlinked directory named explicitly
      // (not via a `**` wildcard) in testMatch.
      fs.writeFileSync(path.join(outsideDir, 'evil.spec.ts'), specBody('should never be scored'));
      fs.symlinkSync(outsideDir, path.join(repoDir, 'tests', 'evil'), 'dir');

      // A real spec inside the repo, also reachable through testMatch, so
      // the fix must not zero out legitimate discovery.
      fs.writeFileSync(path.join(repoDir, 'tests', 'real.spec.ts'), specBody('real'));

      fs.writeFileSync(
        path.join(repoDir, 'playwright.config.ts'),
        `import { defineConfig } from '@playwright/test';\n` +
          `export default defineConfig({\n` +
          `  testDir: './tests',\n` +
          `  testMatch: ['evil/**/*.ts', 'real.spec.ts'],\n` +
          `});\n`
      );

      const result = await scorePaths({ paths: [repoDir], profile: 'standard', cwd: repoDir });

      assert.ok(
        !result.findings.some((f) => f.file.includes('evil')),
        `evil.spec.ts (reached only via the symlinked testMatch directory) must never be scored: ${JSON.stringify(result.findings)}`
      );
      assert.equal(result.summary.files, 1, `expected only the real in-repo spec to be scored: ${JSON.stringify(result.summary)}`);
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it('an individually symlinked spec file sitting directly in the repo (no testMatch trickery) is not scored', async () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-qag230-filelink-repo-'));
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-qag230-filelink-outside-'));
    try {
      fs.mkdirSync(path.join(repoDir, '.git'), { recursive: true });

      const specBody = (title: string) =>
        `import { test, expect } from '@playwright/test';\n` +
        `test('${title}', async ({ page }) => {\n` +
        `  await expect(page).toHaveTitle('${title}');\n` +
        `});\n`;

      // The real file lives outside the repo; only a symlink to it sits
      // inside — plain filename-based discovery (no playwright.config.*
      // at all here), the same default path every scan without a config
      // goes through.
      fs.writeFileSync(path.join(outsideDir, 'evil.spec.ts'), specBody('should never be scored'));
      fs.symlinkSync(path.join(outsideDir, 'evil.spec.ts'), path.join(repoDir, 'evil.spec.ts'), 'file');

      fs.writeFileSync(path.join(repoDir, 'real.spec.ts'), specBody('real'));

      const result = await scorePaths({ paths: [repoDir], profile: 'standard', cwd: repoDir });

      assert.ok(
        !result.findings.some((f) => f.file.includes('evil')),
        `the symlinked evil.spec.ts must never be scored: ${JSON.stringify(result.findings)}`
      );
      assert.equal(result.summary.files, 1, `expected only the real in-repo spec to be scored: ${JSON.stringify(result.summary)}`);
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});

// QAG-230: a nonexistent testDir must never be reported as "escaping the
// repository" just because the repo itself happens to sit under a
// symlinked path prefix (macOS: /tmp -> /private/tmp) — safeRealpath only
// resolves the portion of a path that exists on disk, so an unresolved,
// nonexistent testDirAbs compared against a fully-resolved repoRoot used
// to disagree even when nothing actually escaped anything.
describe('QAG-230: testDirEscapesRepo does not false-positive on a nonexistent testDir under a symlinked repo path', () => {
  it('returns false when testDir does not exist, even though the repo root is reached through a symlink', () => {
    const realBase = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-qag230-realbase-'));
    const linkedRepoRoot = path.join(os.tmpdir(), `pw-score-qag230-link-${process.pid}-${Date.now()}`);
    try {
      fs.mkdirSync(path.join(realBase, '.git'), { recursive: true });
      fs.symlinkSync(realBase, linkedRepoRoot, 'dir');

      const nonexistentTestDir = path.join(linkedRepoRoot, 'tests');
      assert.equal(fs.existsSync(nonexistentTestDir), false, 'test setup: testDir must not exist');

      assert.equal(
        testDirEscapesRepo(nonexistentTestDir, linkedRepoRoot),
        false,
        'a nonexistent testDir must not be reported as escaping the repo'
      );
    } finally {
      fs.rmSync(linkedRepoRoot, { force: true });
      fs.rmSync(realBase, { recursive: true, force: true });
    }
  });

  it('still detects a real escape once testDir exists and resolves outside the repo', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-qag230-realescape-repo-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-qag230-realescape-outside-'));
    try {
      fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
      const testDir = path.join(repo, 'tests');
      fs.symlinkSync(outside, testDir, 'dir');

      assert.equal(testDirEscapesRepo(testDir, repo), true, 'an existing testDir symlinked outside the repo must still be flagged');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

const specBody = (title: string) =>
  `import { test, expect } from '@playwright/test';\n` +
  `test('${title}', async ({ page }) => {\n` +
  `  await expect(page).toHaveTitle('${title}');\n` +
  `});\n`;

// QAG-230 review round: the 2026-09-26 fix for a match escaping the
// scanned root (see the two "QAG-230" describes above) narrowed the
// containment check enough that it also dropped a match resolving
// in-repo, but outside the caller's narrower scanned subdirectory — a
// real, common monorepo shape (a spec shared between packages via a
// symlink) regressed from being scored to being silently dropped. The
// fix compares every match's realpath against the *repo root*
// (safeRealpath(findRepoBoundary(abs))), not the narrower scanned `abs`
// itself, so only a true escape of the repo is ever dropped.
describe('QAG-230 review round: an in-repo symlink outside the scanned subpath is kept', () => {
  it('a match resolving to a sibling directory inside the same repo, but outside the scanned subdirectory, is still scored', async () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-qag230-sibling-repo-'));
    try {
      fs.mkdirSync(path.join(repoDir, '.git'), { recursive: true });
      fs.mkdirSync(path.join(repoDir, 'packages', 'app', 'e2e'), { recursive: true });
      fs.mkdirSync(path.join(repoDir, 'shared', 'tests'), { recursive: true });

      fs.writeFileSync(path.join(repoDir, 'packages', 'app', 'e2e', 'a.spec.ts'), specBody('a'));
      fs.writeFileSync(path.join(repoDir, 'shared', 'tests', 's.spec.ts'), specBody('s'));
      // A symlink inside the scanned subdirectory whose real target lives
      // elsewhere in the same repo — must be kept, not dropped as if it
      // were an escape.
      fs.symlinkSync(
        path.join(repoDir, 'shared', 'tests', 's.spec.ts'),
        path.join(repoDir, 'packages', 'app', 'e2e', 's.spec.ts'),
        'file'
      );

      const scanDir = path.join(repoDir, 'packages', 'app', 'e2e');
      const result = await scorePaths({ paths: [scanDir], profile: 'standard', cwd: repoDir });

      assert.equal(
        result.summary.files,
        2,
        `expected both a.spec.ts and the in-repo symlinked s.spec.ts to be scored: ${JSON.stringify(result.summary)}`
      );
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });
});

// QAG-230 review round: index.ts's final "treat as glob" branch (a bare
// pattern like `tests/*.spec.ts` passed straight to `scorePaths`, not a
// directory it walks itself) had no realpath containment check at all —
// only the directory-scan branch did. Switching an otherwise-identical
// call from a directory argument to an equivalent glob argument silently
// bypassed the escape guard entirely.
describe('QAG-230 review round: a glob-pattern input is realpath-contained too', () => {
  it('a glob input naming a symlinked spec that escapes the repo drops that match, keeps the real one', async () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-qag230-globinput-repo-'));
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-qag230-globinput-outside-'));
    try {
      fs.mkdirSync(path.join(repoDir, '.git'), { recursive: true });
      fs.mkdirSync(path.join(repoDir, 'tests'), { recursive: true });

      fs.writeFileSync(path.join(repoDir, 'tests', 'ok.spec.ts'), specBody('ok'));
      fs.writeFileSync(path.join(outsideDir, 'evil.spec.ts'), specBody('should never be scored'));
      fs.symlinkSync(path.join(outsideDir, 'evil.spec.ts'), path.join(repoDir, 'tests', 'evil.spec.ts'), 'file');

      const result = await scorePaths({ paths: ['tests/*.spec.ts'], profile: 'standard', cwd: repoDir });

      assert.ok(
        !result.findings.some((f) => f.file.includes('evil')),
        `evil.spec.ts (named only through a glob-pattern input, not a directory scan) must never be scored: ${JSON.stringify(result.findings)}`
      );
      assert.equal(result.summary.files, 1, `expected only ok.spec.ts to be scored: ${JSON.stringify(result.summary)}`);
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});

// Pre-existing gap, not new to the 2026-09-26 escape fixes above: a
// symlinked spec and its own real target can both independently match
// discovery under the same scan and get scored twice, as if they were
// two different files.
describe('QAG-230 review round: an in-repo symlinked spec is not double-counted against its own target', () => {
  it('a symlink and its real target both matching discovery under the same scan are deduped by realpath', async () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-qag230-dedupe-repo-'));
    try {
      fs.mkdirSync(path.join(repoDir, '.git'), { recursive: true });
      fs.writeFileSync(path.join(repoDir, 'real.spec.ts'), specBody('real'));
      fs.symlinkSync(path.join(repoDir, 'real.spec.ts'), path.join(repoDir, 'alias.spec.ts'), 'file');

      const result = await scorePaths({ paths: [repoDir], profile: 'standard', cwd: repoDir });

      assert.equal(
        result.summary.files,
        1,
        `expected the symlink and its target to be scored once, not twice: ${JSON.stringify(result.summary)}`
      );
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });
});

// QAG-230 review round: the per-match realpath containment check alone
// still lets the walk pay to descend all the way through a huge symlinked
// directory before every match inside it gets dropped one by one. Pruning
// with glob's own `ignore.childrenIgnored` (RepoBoundaryIgnore in
// src/index.ts) stops the walk from ever entering it.
describe('QAG-230 review round: a symlinked directory outside the repo is pruned during the walk, not just filtered after', () => {
  it('does not walk into a large symlinked directory whose realpath escapes the repo (bounded time)', async () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-qag230-prune-repo-'));
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-qag230-prune-outside-'));
    try {
      fs.mkdirSync(path.join(repoDir, '.git'), { recursive: true });
      fs.mkdirSync(path.join(repoDir, 'tests'), { recursive: true });
      fs.writeFileSync(path.join(repoDir, 'tests', 'ok.spec.ts'), specBody('ok'));
      fs.writeFileSync(
        path.join(repoDir, 'playwright.config.ts'),
        `import { defineConfig } from '@playwright/test';\n` +
          `export default defineConfig({\n` +
          `  testDir: './tests',\n` +
          `  testMatch: ['evil/**/*.ts', '**/*.spec.ts'],\n` +
          `});\n`
      );
      // A large, real, nested directory tree the symlink points at — big
      // enough that actually walking it (the pre-fix behavior) would be
      // clearly slow, not just theoretically wasteful.
      for (let i = 0; i < 300; i++) {
        const d = path.join(outsideDir, `d${i % 20}`, 'sub');
        fs.mkdirSync(d, { recursive: true });
        fs.writeFileSync(path.join(d, `f${i}.ts`), '');
      }
      fs.symlinkSync(outsideDir, path.join(repoDir, 'tests', 'evil'), 'dir');

      const start = Date.now();
      const result = await scorePaths({ paths: [repoDir], profile: 'standard', cwd: repoDir });
      const elapsed = Date.now() - start;

      assert.ok(
        !result.findings.some((f) => f.file.includes('evil')),
        `must never score anything from the escaped directory: ${JSON.stringify(result.findings)}`
      );
      assert.equal(result.summary.files, 1, `expected only ok.spec.ts to be scored: ${JSON.stringify(result.summary)}`);
      assert.ok(
        elapsed < 3000,
        `expected the walk to be pruned at the symlink, not descend into ~300 nested files (took ${elapsed}ms)`
      );
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});

// QAG-230 review round: verifies the "escape warning now prints
// cwd-relative paths" fix with `cwd` actually different from the scanned
// directory (every other test above passes `cwd: repoDir`, which can't
// tell a cwd-relative path apart from an absolute one when they're
// numerically the same string).
describe('QAG-230 review round: escape-warning paths are cwd-relative even when cwd is not the scanned directory', () => {
  it('reports the escaped testDir relative to cwd, not as an absolute filesystem path', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-qag230-cwdrel-'));
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-qag230-cwdrel-outside-'));
    try {
      const repoDir = path.join(tmpRoot, 'myrepo');
      fs.mkdirSync(path.join(repoDir, '.git'), { recursive: true });
      fs.writeFileSync(path.join(repoDir, 'real.spec.ts'), specBody('real'));
      fs.symlinkSync(outsideDir, path.join(repoDir, 'tests'), 'dir');
      fs.writeFileSync(
        path.join(repoDir, 'playwright.config.ts'),
        `import { defineConfig } from '@playwright/test';\n` +
          `export default defineConfig({ testDir: './tests' });\n`
      );

      const result = await scorePaths({ paths: [repoDir], profile: 'standard', cwd: tmpRoot });

      const warning = (result.configWarnings ?? []).find((w) => w.includes('resolves outside the repository'));
      assert.ok(warning, `expected an escape configWarning: ${JSON.stringify(result.configWarnings)}`);

      const relRepoDir = path.relative(tmpRoot, repoDir);
      assert.ok(
        warning!.includes(relRepoDir),
        `expected the warning to use the cwd-relative repo path (${relRepoDir}), got: ${warning}`
      );
      assert.ok(
        !warning!.includes(tmpRoot),
        `expected the warning not to contain the absolute cwd prefix (${tmpRoot}): ${warning}`
      );
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});
