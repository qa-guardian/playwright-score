import fs from 'node:fs';
import path from 'node:path';
import { parseForESLint } from '@typescript-eslint/parser';
import { resolveRelativeImport } from './import-graph.js';

// Spec discovery (index.ts's SPEC_GLOBS) matches by filename suffix only —
// it never reads the scanned repo's own playwright.config.*, so it can't
// tell a real Playwright suite's *.e2e.ts apart from an unrelated *.spec.ts
// file sitting in the same directory under a *different* test runner (Ionic
// Framework's core/: 419 real *.e2e.ts Playwright specs alongside 60 Jest
// *.spec.ts unit tests, both matched by the default globs). This module
// reads testDir/testMatch/testIgnore *statically* — parsed as source, never
// executed (a scored repo's config is untrusted input) — so index.ts can
// scope discovery to what the target itself considers its test files.

const CONFIG_FILENAMES = [
  'playwright.config.ts',
  'playwright.config.js',
  'playwright.config.mjs',
  'playwright.config.cjs',
];

/** How far up from the scan root to look for a config — generous relative
 * to any real monorepo nesting depth, still a hard bound. */
const MAX_ANCESTOR_LOOKUP = 20;

/**
 * Walks upward from `startDir` to find this scan's repo boundary — the
 * first ancestor directory that contains a `.git` entry (a directory for a
 * normal clone, a file for a worktree/submodule — either counts as "this is
 * a repo root").
 *
 * When no `.git` turns up within MAX_ANCESTOR_LOOKUP hops or before
 * reaching the filesystem root, the *caller* decides what's safe to fall
 * back to via `fallbackBoundary`:
 *
 * - `findPlaywrightConfig`'s own internal use (below) omits it, keeping
 *   this function's legacy behavior of returning whatever directory the
 *   climb stopped at. That's fine there — it only ever bounds a loop of
 *   cheap `fs.statSync` existence checks for a handful of fixed filenames,
 *   never a glob or a file read, so a wide bound doesn't let an untrusted
 *   repo make this tool touch anything outside itself.
 * - Every caller that uses the return value as an actual security
 *   boundary — most importantly `resolveConfigScopedRoot`'s `repoRoot`,
 *   which clamps a config's `testDir` before it becomes a glob root (see
 *   its own doc comment) — MUST pass an explicit `fallbackBoundary`, and
 *   it must never be the filesystem root or some arbitrary ancestor 20
 *   levels up (that would make the "repo boundary" nearly unbounded and
 *   defeat the escape checks it exists to support). index.ts passes the
 *   scanned directory, or, when a config file was found above it, that
 *   config file's own directory — whichever of the two is the ancestor
 *   (the config file is always found by walking up from the scan root, so
 *   its directory is always at-or-above it).
 */
export function findRepoBoundary(startDir: string, fallbackBoundary?: string): string {
  let dir = startDir;
  let last = startDir;
  for (let i = 0; i < MAX_ANCESTOR_LOOKUP; i++) {
    last = dir;
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached the filesystem root — no .git found
    dir = parent;
  }
  return fallbackBoundary ?? last;
}

/**
 * Walks upward from `scanRootAbs` (the directory the caller pointed at, or
 * its own directory tree) looking for a playwright.config.* file "at or
 * above" it — the common real-world shape is a monorepo root config one or
 * more levels above the actual spec directory being scanned. Never searches
 * above the repo boundary (see findRepoBoundary): a config living outside
 * the scanned repo (e.g. a coincidental playwright.config.* sitting in some
 * unrelated ancestor directory on a shared CI runner) must never be picked
 * up and applied to this scan.
 */
export function findPlaywrightConfig(scanRootAbs: string): string | undefined {
  const boundary = findRepoBoundary(scanRootAbs);
  let dir = scanRootAbs;
  for (let i = 0; i < MAX_ANCESTOR_LOOKUP; i++) {
    for (const name of CONFIG_FILENAMES) {
      const candidate = path.join(dir, name);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        // doesn't exist — try the next filename/directory
      }
    }
    if (dir === boundary) break; // never search above the repo root
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

export interface ParsedPlaywrightConfig {
  /** Resolved absolute path (config's `testDir`, default: the config's own directory). */
  testDirAbs: string;
  /** Glob patterns, relative to testDirAbs — undefined when the config didn't set testMatch (index.ts's own default SPEC_GLOBS still apply). */
  testMatch?: string[];
  /** Glob patterns, relative to testDirAbs — undefined when the config didn't set testIgnore. */
  testIgnore?: string[];
}

function isStringLiteral(node: Record<string, unknown> | undefined): node is { value: string } {
  return !!node && node.type === 'Literal' && typeof (node as { value?: unknown }).value === 'string';
}

/**
 * A string literal, or an array of only string literals — Playwright's own
 * `testMatch`/`testIgnore` also accept a `RegExp`, which this deliberately
 * does not support (a regex can embed arbitrary logic no static reader
 * should try to evaluate): a config using one is treated as unparseable as
 * a whole (see parsePlaywrightConfig) rather than silently ignoring just
 * that field, so the fallback is obvious rather than a partial, confusing
 * hybrid.
 */
/**
 * Playwright's own `createFileMatcher` (packages/playwright/src/util.ts)
 * prepends `**\/` to any string pattern that doesn't already start with
 * it, before handing it to minimatch — i.e. a pattern with no leading
 * `**\/` still matches at any depth, not just files directly under
 * testDir. A plain glob library (this package uses `glob`) does NOT do
 * this on its own: `*e2e.spec.ts` only matches a file sitting directly in
 * the glob's cwd, since a single `*` never crosses a `/`. Verified against
 * a real config (payloadcms/payload's `test/playwright.config.ts`:
 * `testMatch: ['*e2e.spec.ts', '*perf.spec.ts']`, every real spec several
 * directories below testDir) that silently matched zero files without
 * this — the exact same failure mode this feature exists to fix, caused
 * by the feature itself. Applied to testIgnore too, since Playwright
 * matches both through the same `createFileMatcher`.
 */
function toRecursiveGlob(pattern: string): string {
  return pattern.startsWith('**/') ? pattern : `**/${pattern}`;
}

function extractStringOrStringArray(node: Record<string, unknown> | undefined): string[] | undefined {
  if (!node) return undefined;
  if (isStringLiteral(node)) return [toRecursiveGlob(node.value)];
  if (node.type === 'ArrayExpression') {
    const elements = (node as { elements?: Array<Record<string, unknown> | null> }).elements ?? [];
    const values: string[] = [];
    for (const el of elements) {
      const candidate = el ?? undefined;
      if (!isStringLiteral(candidate)) return undefined;
      values.push(toRecursiveGlob(candidate.value));
    }
    return values;
  }
  return undefined;
}

/** Finds the plain object literal passed to defineConfig(...), or used
 * directly as `export default {...}` / `module.exports = {...}`. Returns
 * undefined for anything else (a spread, a conditional, a function call
 * result other than defineConfig, a variable reference, ...) — deliberately
 * conservative: a config shape we can't confidently read statically must
 * fall back, never guess. */
function findConfigObjectLiteral(body: Array<Record<string, unknown>>): Record<string, unknown> | undefined {
  const unwrapToObjectLiteral = (node: Record<string, unknown> | undefined): Record<string, unknown> | undefined => {
    if (!node) return undefined;
    if (node.type === 'ObjectExpression') return node;
    if (node.type === 'CallExpression') {
      // defineConfig({...}) (any callee shape — named import, namespace
      // access, etc.) — only the single object-literal argument shape is
      // supported; anything else (spread args, no args, a non-object arg)
      // is unparseable.
      const args = (node as { arguments?: Array<Record<string, unknown>> }).arguments ?? [];
      if (args.length === 1 && args[0]?.type === 'ObjectExpression') return args[0];
      return undefined;
    }
    return undefined;
  };

  for (const node of body) {
    if (node.type === 'ExportDefaultDeclaration') {
      const decl = (node as { declaration?: Record<string, unknown> }).declaration;
      const obj = unwrapToObjectLiteral(decl);
      if (obj) return obj;
    }
    if (node.type === 'ExpressionStatement') {
      const expr = (node as { expression?: Record<string, unknown> }).expression;
      if (
        expr?.type === 'AssignmentExpression' &&
        (expr as { left?: Record<string, unknown> }).left?.type === 'MemberExpression'
      ) {
        const left = (expr as { left: Record<string, unknown> }).left;
        const obj = left.object as { type?: string; name?: string } | undefined;
        const prop = left.property as { type?: string; name?: string } | undefined;
        // module.exports = {...} / module.exports = defineConfig({...})
        if (obj?.type === 'Identifier' && obj.name === 'module' && prop?.type === 'Identifier' && prop.name === 'exports') {
          const right = (expr as { right?: Record<string, unknown> }).right;
          const resolved = unwrapToObjectLiteral(right);
          if (resolved) return resolved;
        }
      }
    }
  }
  return undefined;
}

/**
 * Parses `testDir`/`testMatch`/`testIgnore` out of a playwright.config.*
 * file's source, statically (AST-based, never executed — a scored repo's
 * config is untrusted input, same reasoning as never running its tests).
 * Returns undefined when the shape can't be read with confidence (a
 * dynamic value from `process.env`, a spread, an unsupported top-level
 * export shape, ...) — callers fall back to today's filename-suffix
 * discovery for the whole scan, with a warning, rather than acting on a
 * partial or guessed reading.
 */
export function parsePlaywrightConfig(configFile: string): ParsedPlaywrightConfig | undefined {
  let source: string;
  try {
    source = fs.readFileSync(configFile, 'utf8');
  } catch {
    return undefined;
  }
  let ast: { body?: Array<Record<string, unknown>> } | undefined;
  try {
    ast = parseForESLint(source, {
      ecmaVersion: 2022,
      sourceType: 'module',
    }).ast as unknown as { body?: Array<Record<string, unknown>> };
  } catch {
    return undefined;
  }

  const configObject = findConfigObjectLiteral(ast.body ?? []);
  if (!configObject) return undefined;

  const properties = (configObject as { properties?: Array<Record<string, unknown>> }).properties ?? [];
  let testDir: string | undefined;
  let testMatch: string[] | undefined;
  let testIgnore: string[] | undefined;
  let sawTestMatchKey = false;
  let sawTestIgnoreKey = false;

  for (const prop of properties) {
    // A spread (`...shared`) or computed key makes the object's real shape
    // impossible to read statically — bail on the whole config rather than
    // silently ignoring part of it.
    if (prop.type === 'SpreadElement') return undefined;
    if (prop.type !== 'Property') continue;
    const computed = (prop as { computed?: boolean }).computed;
    const key = (prop as { key?: Record<string, unknown> }).key;
    if (computed) return undefined;
    const keyName =
      key?.type === 'Identifier'
        ? (key as { name?: string }).name
        : isStringLiteral(key)
          ? key.value
          : undefined;
    if (!keyName) continue;
    const value = (prop as { value?: Record<string, unknown> }).value;
    if (keyName === 'testDir') {
      if (!isStringLiteral(value)) return undefined;
      testDir = value.value;
    } else if (keyName === 'testMatch') {
      sawTestMatchKey = true;
      testMatch = extractStringOrStringArray(value);
      if (testMatch === undefined) return undefined;
    } else if (keyName === 'testIgnore') {
      sawTestIgnoreKey = true;
      testIgnore = extractStringOrStringArray(value);
      if (testIgnore === undefined) return undefined;
    }
  }

  const configDir = path.dirname(configFile);
  const testDirAbs = testDir ? path.resolve(configDir, testDir) : configDir;
  return {
    testDirAbs,
    testMatch: sawTestMatchKey ? testMatch : undefined,
    testIgnore: sawTestIgnoreKey ? testIgnore : undefined,
  };
}

/** Exported for index.ts's own realpath containment check on matched spec
 * files (see expandPaths) — a config-scoped `testDir`/`testMatch` can be
 * clamped to the repo boundary here, but the glob it drives can still walk
 * through a symlinked directory *inside* that boundary whose real target
 * is outside it (see testDirEscapesRepo's doc comment for why a lexical
 * check alone isn't enough); index.ts needs the same primitive to catch
 * that per-match, not just per-testDir. */
export function isAncestorOrSame(ancestor: string, descendant: string): boolean {
  const rel = path.relative(ancestor, descendant);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Resolves symlinks; falls back to the input path unchanged when it
 * doesn't exist on disk (matches the existing "testDir doesn't exist"
 * behavior elsewhere in this file rather than throwing). Exported for the
 * same reason as isAncestorOrSame above. */
export function safeRealpath(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * True when `testDirAbs`, resolved through any symlinks, is NOT inside
 * (or equal to) `repoRoot`, also resolved through symlinks. A scored
 * repo's config is untrusted input, and a lexical ancestor check alone
 * isn't enough — a `testDir` that lexically sits inside the repo can still
 * be a symlink whose real target is elsewhere on disk (e.g. `tests/` ->
 * `/tmp/somewhere-else`), which would otherwise let a crafted repo make
 * this public tool glob outside its own boundary. Both sides are
 * realpath'd (never just testDirAbs) because `repoRoot` itself could in
 * principle be reached through a symlinked path.
 *
 * A nonexistent `testDirAbs` (nothing to score there — resolveConfigScopedRoot's
 * own existence check downstream already handles that) short-circuits to
 * "doesn't escape" *before* either side is realpath'd: `safeRealpath` only
 * resolves symlinks up to the point where a path stops existing on disk,
 * so a testDir that doesn't exist keeps its literal (unresolved) form
 * while `repoRoot` — which does exist — gets fully resolved. On a host
 * where the repo itself sits under a symlinked prefix (macOS: `/tmp` ->
 * `/private/tmp`), that asymmetry alone made the two sides disagree and
 * fired a false "escapes the repository" warning for a perfectly ordinary
 * missing testDir (QAG-230). Checked with a plain `fs.existsSync`, not
 * `safeRealpath`'s own try/catch, so this stays a pure existence check
 * with no symlink resolution of its own to get wrong.
 */
export function testDirEscapesRepo(testDirAbs: string, repoRoot: string): boolean {
  if (!fs.existsSync(testDirAbs)) return false;
  const realRepoRoot = safeRealpath(repoRoot);
  const realTestDirAbs = safeRealpath(testDirAbs);
  return !isAncestorOrSame(realRepoRoot, realTestDirAbs);
}

/**
 * Chooses which directory to actually glob from, given the directory the
 * caller pointed `scorePaths` at (`scanRootAbs`) and the config's resolved
 * `testDir`. Always testDirAbs, never the caller's narrower `scanRootAbs`
 * — Playwright itself unconditionally resolves testMatch/testIgnore
 * relative to testDir, and a testMatch entry is not always a bare
 * basename pattern; it can embed real path segments anchored at testDir
 * (verified against a real config, PostHog/posthog's `playwright/
 * playwright.config.ts`: `testDir: '..'` — the repo root — with
 * `testMatch: ['playwright/e2e/**\/*.spec.ts', 'products/*\/frontend/e2e/
 * **\/*.spec.ts']`; globbing from the caller's narrower `scanRootAbs`
 * instead of testDirAbs made the `playwright/e2e/` segment never match
 * anything, silently zeroing a real, correctly-discovered config). The
 * caller (index.ts) is responsible for filtering the resulting absolute
 * paths back down to its own requested subtree when `scanRootAbs` is
 * narrower than `testDirAbs`, so scoping to testDir here never widens
 * what actually gets scored beyond what the caller asked for.
 *
 * Returns undefined when testDir doesn't exist on disk, or doesn't
 * overlap the requested scan root at all in either direction — the
 * config doesn't describe this scan, so the caller should ignore it
 * entirely rather than force a mismatch.
 *
 * `repoRoot` (see findRepoBoundary) clamps `testDirAbs` before any of the
 * above, via `testDirEscapesRepo` (realpath'd on both sides, so a
 * symlinked `testDir` can't launder an escape either): a scored repo's own
 * config is untrusted input, and a `testDir` that resolves outside the
 * repo (an absolute `'/'`, a relative `'../../..'` that climbs past the
 * repo root, a symlink pointing elsewhere, ...) must never turn into a
 * glob root — that would let a crafted config make this public tool read
 * or scan arbitrary parts of the filesystem it's running on. When
 * testDirAbs falls outside repoRoot, repoRoot itself is used as the
 * effective testDir instead of rejecting the config outright, so a
 * merely-overshooting `testDir` still gets *some* config-scoped result
 * (bounded to the repo) rather than silently falling all the way back to
 * unscoped filename discovery. index.ts additionally treats this
 * escaped-and-clamped case as "the config doesn't cleanly describe this
 * scan" and falls back to filename-based discovery with a configWarning,
 * rather than applying the config's testMatch/testIgnore (written for the
 * escaped testDir) to the clamped repoRoot instead.
 */
export function resolveConfigScopedRoot(
  scanRootAbs: string,
  testDirAbs: string,
  repoRoot: string
): string | undefined {
  const clampedTestDirAbs = testDirEscapesRepo(testDirAbs, repoRoot) ? repoRoot : testDirAbs;
  if (!isAncestorOrSame(clampedTestDirAbs, scanRootAbs) && !isAncestorOrSame(scanRootAbs, clampedTestDirAbs)) {
    return undefined;
  }
  try {
    if (fs.statSync(clampedTestDirAbs).isDirectory()) return clampedTestDirAbs;
  } catch {
    // testDir doesn't exist on disk — nothing to scope to.
  }
  return undefined;
}

const RESOLVE_DEPTH = 4;
const RESOLVE_FILE_CAP = 100;

/**
 * True unless `file` has *definitive negative evidence* of not being a
 * Playwright spec: no direct `@playwright/test` import, no relative
 * import at all, or every relative import resolves (on disk) to a file
 * that itself, transitively, doesn't import `@playwright/test` either.
 * Used only as an extra safety net once config-based discovery is already
 * active (see index.ts) — testMatch/testIgnore can still be broader than
 * intended (e.g. a generic `**\/*.ts`), and this catches a plain non-test
 * source file that pattern would otherwise sweep in.
 *
 * Deliberately fails OPEN (keeps the file) whenever a relative import
 * can't be resolved on disk, rather than treating that as negative
 * evidence — same "denylist, not allowlist" philosophy metrics.ts's
 * `looksLikeNonPlaywrightTest` already documents ("a missed rare/unusual
 * file just scores harmlessly, where a falsely-skipped real spec silently
 * stops being scored at all"). This matters in practice, not just in
 * theory: verified against a real config (appsmithorg/appsmith) whose
 * every spec imports `test`/`expect` from a sibling `../../fixtures`
 * module — under `scripts/validate-corpus.sh`'s sparse checkout (only the
 * declared subpath is fetched), that fixtures file genuinely doesn't
 * exist on disk, so resolution legitimately fails even though the import
 * is completely real; a full (non-sparse) checkout, which is what a real
 * customer's CI actually has, would resolve it fine. Treating an
 * unresolvable import as "not a test" turned a correctly-configured real
 * suite into a hard 0-files fail.
 */
/**
 * Pulls the string-literal specifier out of a CommonJS `require('x')` call
 * expression (any position — a bare `require(...)`, not just a call whose
 * result is assigned to something).
 */
function requireCallSpecifier(node: Record<string, unknown> | undefined | null): string | undefined {
  if (!node || node.type !== 'CallExpression') return undefined;
  const callee = (node as { callee?: Record<string, unknown> }).callee;
  if (callee?.type !== 'Identifier' || (callee as { name?: string }).name !== 'require') return undefined;
  const args = (node as { arguments?: Array<Record<string, unknown>> }).arguments ?? [];
  const arg = args[0];
  if (arg?.type === 'Literal' && typeof (arg as { value?: unknown }).value === 'string') {
    return (arg as { value: string }).value;
  }
  return undefined;
}

/**
 * Top-level-only `require(...)` specifiers in a CommonJS file — mirrors the
 * ES `import`/`export ... from` sources this function already walks at the
 * same (non-nested) depth. Covers the two shapes real fixtures/spec files
 * actually use: `const { test } = require('./x')` and a bare
 * `require('./x')` statement. Verified against a real repo
 * (wekan/wekan's `tests/playwright/`, plain CommonJS `.js` specs/fixtures,
 * no `import` anywhere) that this function silently zeroed to "not a
 * Playwright spec" for every file before this fix — `hasAnyRelativeImport`
 * never became true (no ES import syntax present at all), so the "no
 * @playwright/test found + nothing to resolve" fallback read as definitive
 * negative evidence instead of the true reason: this loop just wasn't
 * looking at CommonJS's own import syntax.
 */
function requireSpecifiersInBody(body: Array<Record<string, unknown>>): string[] {
  const specifiers: string[] = [];
  for (const node of body) {
    if (node.type === 'ExpressionStatement') {
      const spec = requireCallSpecifier((node as { expression?: Record<string, unknown> }).expression);
      if (spec) specifiers.push(spec);
      continue;
    }
    if (node.type === 'VariableDeclaration') {
      for (const decl of (node as { declarations?: Array<{ init?: Record<string, unknown> | null }> }).declarations ?? []) {
        const spec = requireCallSpecifier(decl.init);
        if (spec) specifiers.push(spec);
      }
    }
  }
  return specifiers;
}

export function importsPlaywrightTestTransitively(
  file: string,
  source: string,
  boundaryDir: string
): boolean {
  const visited = new Set<string>([file]);
  const queue: Array<{ file: string; source: string; depth: number }> = [{ file, source, depth: 0 }];
  let checked = 0;
  let hasAnyRelativeImport = false;
  let everyRelativeImportResolved = true;
  while (queue.length > 0 && checked < RESOLVE_FILE_CAP) {
    const next = queue.shift();
    if (!next) break;
    checked++;
    let ast: { body?: Array<Record<string, unknown>> } | undefined;
    try {
      ast = parseForESLint(next.source, {
        ecmaVersion: 2022,
        sourceType: 'module',
        ecmaFeatures: { jsx: /\.(tsx|jsx)$/.test(next.file) },
      }).ast as unknown as { body?: Array<Record<string, unknown>> };
    } catch {
      // Can't parse this hop — inconclusive, not negative evidence.
      everyRelativeImportResolved = false;
      continue;
    }
    const body = ast.body ?? [];
    const requireSrcs = requireSpecifiersInBody(body);
    for (const node of body) {
      if (node.type !== 'ImportDeclaration' && node.type !== 'ExportNamedDeclaration' && node.type !== 'ExportAllDeclaration') {
        continue;
      }
      const src = (node as { source?: { value?: unknown } }).source?.value;
      if (typeof src !== 'string') continue;
      requireSrcs.push(src);
    }
    for (const src of requireSrcs) {
      if (src === '@playwright/test') return true;
      if (!src.startsWith('.')) continue;
      hasAnyRelativeImport = true;
      if (next.depth >= RESOLVE_DEPTH) {
        everyRelativeImportResolved = false;
        continue;
      }
      const resolved = resolveRelativeImport(next.file, src, boundaryDir);
      if (!resolved) {
        // Doesn't exist on disk (or climbs outside boundaryDir) — could be
        // a real fixtures module missing only because of how this scan was
        // set up (sparse checkout, a narrower boundary than the real
        // project root, ...). Inconclusive, not negative evidence.
        everyRelativeImportResolved = false;
        continue;
      }
      if (visited.has(resolved)) continue;
      visited.add(resolved);
      let depSource: string;
      try {
        depSource = fs.readFileSync(resolved, 'utf8');
      } catch {
        everyRelativeImportResolved = false;
        continue;
      }
      queue.push({ file: resolved, source: depSource, depth: next.depth + 1 });
    }
  }
  if (checked >= RESOLVE_FILE_CAP && queue.length > 0) everyRelativeImportResolved = false;
  // No @playwright/test found anywhere reachable: keep the file unless
  // every relative import chain fully resolved and still came up empty
  // (definitive negative evidence) — a file with no relative imports at
  // all and no @playwright/test import is also definitive negative
  // evidence (nothing left to resolve).
  return hasAnyRelativeImport && !everyRelativeImportResolved;
}
