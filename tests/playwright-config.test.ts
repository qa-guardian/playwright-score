import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findRepoBoundary, resolveConfigScopedRoot } from '../src/playwright-config.js';
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
