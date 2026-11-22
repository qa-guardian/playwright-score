import fs from 'node:fs';
import path from 'node:path';
import { globSync, hasMagic, Ignore, type IgnoreLike, type Path as GlobPath } from 'glob';
import { createHelperScope } from './helper-scope.js';
import { commonAncestorDir } from './fs-util.js';
import { Admission, type Route } from './admission.js';
import {
  scoredFindings,
  SkipLog,
  withCoverage,
} from './coverage.js';
import { collectLocallyImportedFiles, createModuleResolver } from './import-graph.js';
import {
  attributeFindingScopes,
  countLocators,
  extractHelperFacts,
  type HelperFacts,
  type TestSpans,
} from './metrics.js';
import { detectTestAliasNamesWithFactories } from './test-aliases.js';
import {
  findPlaywrightConfig,
  findRepoBoundary,
  isAncestorOrSame,
  parsePlaywrightConfig,
  resolveConfigScopedRoot,
  safeRealpath,
  testDirEscapesRepo,
  withTestDirSuffixPatterns,
} from './playwright-config.js';
import { SPEC_EXTENSION_RE } from './source-type.js';
import { DEFAULT_THRESHOLDS } from './profiles.js';
import { decorateFindings } from './catalogue/decorate.js';
import { computeScore } from './score-engine.js';
import { getEngineVersions } from './engine-versions.js';
import { resetRuleCrashes, ruleCrashes, summarizeRuleCrashes } from './rules/base-plugin.js';
import {
  DEFAULT_MAX_HEAP_MB,
  analyzeIsolated,
  createAnalyzer,
  deadlineSkip,
  startTimeLimit,
  type AnalysisInput,
} from './isolate.js';
import type { Coverage, Finding, ProfileName, ScoreOptions, ScoreResult } from './types.js';

export type {
  ScoreResult,
  ScoreOptions,
  Finding,
  ProfileName,
  ScoreStatus,
  NotScoredReason,
  Coverage,
  SkippedFile,
  SkipReason,
} from './types.js';
export {
  computeScore,
  MODEL,
  locatorsScore,
  gradeFromScore,
  ratioDimensionScore,
} from './score-engine.js';
export { countSloc } from './sloc.js';
export {
  countLocators,
  analyzeSource,
  attributeFindingScopes,
  getTestSpans,
} from './metrics.js';
export { DEFAULT_MAX_HEAP_MB } from './isolate.js';
export { formatJson } from './formatters/json.js';
export { formatText } from './formatters/text.js';
export { formatMarkdown } from './formatters/markdown.js';
export { formatSarif } from './formatters/sarif.js';

// `.e2e.`/`.e2e-spec.`/`.e2e-test.` are real, common conventions for
// disambiguating end-to-end specs from unit tests living in the same tree
// — verified against two well-known, large real-world repos where a
// directory scan previously hard-failed with "no files matched" despite a
// fully healthy, populated suite: cal.com (53 specs, all *.e2e.ts) and
// Immich (52 specs, all *.e2e-spec.ts). looksLikeNonPlaywrightTest (see
// metrics.ts) is the safety net for a repo that uses `.e2e.` for a
// *different* framework — Cypress specifically was common enough here to
// get its own explicit check alongside the existing Jest/Vitest/RTL ones.
// `.pw.` joined the list from the 50-repo corpus expansion (QAG-196,
// 2026-09-21) — Flagsmith's entire 20-spec frontend/e2e suite
// (billing-test.pw.ts, flag-tests.pw.ts, ...) hard-failed with "no files
// matched" without it, the same failure mode cal.com/Immich already fixed
// for their own suffixes.
//
// Extensions follow Playwright's own default testMatch
// (`**/*.@(spec|test).?(c|m)[jt]s?(x)`): .mjs/.cjs/.mts/.cts specs are as
// real as .ts ones (QAG-287: neomjs/neo's 1,007 *.spec.mjs files scored
// "0 tests / F").
const SPEC_GLOBS = [
  '**/*.{spec,test,e2e,e2e-spec,e2e-test,pw}.{ts,tsx,js,jsx,mjs,cjs,mts,cts}',
  '**/*.spec.ts',
  '**/*.test.ts',
];

// A config-matched file already named like a spec (`*.spec.*`, `*.test.*`,
// `*.e2e.*`, ...) is a spec by convention: the transitive-import safety net
// below exists for a generic testMatch sweeping in *non*-test sources, and
// would wrongly drop real specs that import their `test` from a wrapper
// package or a tsconfig path alias (`@lib/BaseTest`, `@microsoft/fast-test-
// harness`) — no relative import, no direct `@playwright/test`.
const SPEC_NAME_RE = /\.(spec|test|e2e|e2e-spec|e2e-test|pw)\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;

/** What to glob (and what to ignore) for one config scope, or for the no-config default. */
interface DiscoveryJob {
  globCwd: string;
  globs: string[];
  regexes: RegExp[];
  ignoreGlobs: string[];
  ignoreRegexes: RegExp[];
}

// Directory/glob expansion must never sweep in vendored or generated code —
// verified as a real bug: scanning a project root with a plain node_modules
// dependency that ships its own *.spec.ts files silently included them
// alongside real specs. Every other JS tool in this space (ESLint,
// Prettier, Jest) default-excludes these directories for the same reason;
// an explicit file path always bypasses this (see `explicit` in
// expandPaths), so this only affects auto-discovery.
const DEFAULT_IGNORE_GLOBS = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/coverage/**',
  '**/.next/**',
  '**/.nuxt/**',
  '**/.turbo/**',
  '**/.cache/**',
  '**/.svelte-kit/**',
  '**/playwright-report/**',
  '**/test-results/**',
];

/**
 * Wraps glob's own default `Ignore` (the string-pattern matcher behind
 * DEFAULT_IGNORE_GLOBS/testIgnore) so this package can *also* prune the
 * walk at a symlinked directory whose realpath escapes `realRoot`,
 * without giving up the string-pattern ignores glob's `ignore` option
 * only accepts one or the other of (a plain string[] XOR an IgnoreLike
 * object — see glob's own types).
 *
 * Only `childrenIgnored` does the extra realpath work, and only for an
 * actual symlink: a plain (non-symlinked) directory can't walk outside a
 * root its own parent is already inside, so resolving its realpath would
 * just be wasted syscalls on every directory in a large tree. This is
 * what stops discovery from following a `testDir -> /` (or any other
 * huge, real) symlinked directory arbitrarily far (QAG-230) — the
 * per-match realpath containment check in expandPaths below still
 * catches an escaping *match*, but only after the walk already paid to
 * get there; this stops the walk itself from ever descending.
 */
class RepoBoundaryIgnore implements IgnoreLike {
  private readonly inner: Ignore;
  constructor(
    patterns: string[],
    private readonly realRoot: string
  ) {
    this.inner = new Ignore(patterns, {});
  }
  ignored(p: GlobPath): boolean {
    return this.inner.ignored(p);
  }
  // Forwarded, not required by any globSync call this package makes today
  // (includeChildMatches defaults to true, which never checks for this) —
  // present anyway so relying on that default doesn't quietly become a
  // hard requirement if it's ever overridden.
  add(pattern: string): void {
    this.inner.add(pattern);
  }
  childrenIgnored(p: GlobPath): boolean {
    if (this.inner.childrenIgnored(p)) return true;
    if (!p.isSymbolicLink()) return false;
    return !isAncestorOrSame(this.realRoot, safeRealpath(p.fullpath()));
  }
}

/**
 * The literal (non-magic) leading-directory prefix of a raw glob pattern
 * string, resolved against `cwd` — e.g. `/abs/repoB/e2e/*.spec.ts` ->
 * `/abs/repoB/e2e`; `../repoB/e2e/*.spec.ts` -> `<cwd>/../repoB/e2e`
 * (collapsed by path.resolve). Used to find *that pattern's own* repo
 * boundary (QAG-230 round 3): a bare glob-pattern input isn't necessarily
 * anywhere near `cwd`'s own repo — it can be an absolute path, or a
 * relative one that climbs out via `../` — into a completely different
 * repo, and computing containment from cwd's repo root regardless made
 * every match there look like an escape (hard-failing a perfectly legit
 * `['/abs/repoB/e2e/*.spec.ts']` down to 0 files, where the equivalent
 * directory input `../repoB/e2e` already scored fine).
 *
 * Segments are checked with glob's own `hasMagic` — with `magicalBraces`
 * on, since an unexpanded `{a,b}` segment isn't a real, literal directory
 * name any more than a `*` is — so this only ever returns a directory
 * that's guaranteed to be a plain path segment, never a piece the glob
 * engine itself still has to interpret.
 */
function literalPrefixDir(pattern: string, cwd: string): string {
  const segments = pattern.split('/');
  const prefix: string[] = [];
  let sawMagic = false;
  for (const segment of segments) {
    if (hasMagic(segment, { magicalBraces: true })) {
      sawMagic = true;
      break;
    }
    prefix.push(segment);
  }
  // No magic anywhere in the pattern: it's a literal path (only reachable
  // here because it didn't exist on disk — an existing path is handled by
  // the file/directory branches above) — its directory is the parent of
  // the last (literal) segment, not the whole joined string.
  const dirSegments = sawMagic ? prefix : prefix.slice(0, -1);
  return path.resolve(cwd, dirSegments.join('/') || '.');
}

/**
 * `explicit`: paths the caller named directly (a literal existing file) —
 * always scored, regardless of whether they look like a Playwright spec.
 * `expanded`: everything else (matched via a directory scan or a glob
 * pattern) — subject to the looksLikePlaywrightSpec filter in scorePaths,
 * since a broad `**\/*.test.ts`-style match can just as easily sweep in
 * unrelated Jest/Vitest/RTL/Cypress unit tests sitting in the same repo.
 */
function expandPaths(
  inputs: string[],
  cwd: string,
  admission: Admission
): {
  explicit: string[];
  expanded: string[];
  /** How each `expanded` file became a candidate (see admission.ts). */
  routes: Map<string, Route>;
  scanRootDirs: string[];
  inputDirs: string[];
  configWarnings: string[];
} {
  const explicit = new Set<string>();
  // Directory each input names (file -> its dirname, directory -> itself,
  // glob -> literal prefix). Finding paths are reported relative to the
  // common ancestor of these, i.e. the place the user pointed at (QAG-287).
  const inputDirs = new Set<string>();
  const expanded = new Set<string>();
  const routes = new Map<string, Route>();
  const addExpanded = (file: string, route: Route): void => {
    expanded.add(file);
    if (!routes.has(file)) routes.set(file, route);
  };
  const scanRootDirs = new Set<string>();
  const configWarnings: string[] = [];
  for (const input of inputs) {
    const abs = path.isAbsolute(input) ? input : path.resolve(cwd, input);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      explicit.add(abs);
      inputDirs.add(path.dirname(abs));
      continue;
    }
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
      // The directory the caller actually pointed at — not just wherever a
      // spec glob happened to match inside it. A Page Object Model's
      // classes typically live in a sibling directory to the specs
      // themselves (tests/ next to pages/, fixtures/), so import-graph.ts
      // needs this wider boundary, not the narrower common ancestor of
      // only the matched spec files.
      scanRootDirs.add(abs);
      inputDirs.add(abs);
      // Repo boundary for this scan's per-match realpath containment check
      // and glob-walk pruning below (see the containment check itself, and
      // RepoBoundaryIgnore, for why this must be the *repo root*, not the
      // narrower `abs`): a scan pointed at one monorepo package's specs
      // must still keep an in-repo symlink that resolves to a sibling
      // directory outside that subpath, while still rejecting anything
      // that resolves outside the repo entirely (QAG-230). Starts with the
      // same conservative fallback-to-`abs` findRepoBoundary uses
      // elsewhere in this file; replaced below with the wider boundary a
      // successfully parsed config already computes for testDirEscapesRepo,
      // so both checks share one repo boundary instead of computing it
      // twice.
      let repoRootForContainment = findRepoBoundary(abs, abs);

      // A playwright.config.* at or above this directory, when it can be
      // read statically, is authoritative about what this target itself
      // considers a spec — see playwright-config.ts. Falls back to the
      // filename-suffix SPEC_GLOBS (today's behavior) whenever a config
      // isn't found, doesn't overlap this scan, or can't be parsed
      // statically (a dynamic/unsupported shape) — the last case surfaces
      // a warning rather than silently guessing.
      let jobs: DiscoveryJob[] = [
        { globCwd: abs, globs: SPEC_GLOBS, regexes: [], ignoreGlobs: DEFAULT_IGNORE_GLOBS, ignoreRegexes: [] },
      ];
      let configApplied = false;
      // Boundary for the transitive-import safety net below — widened to
      // the config's own directory (not `abs`), for the same reason
      // import-graph.ts already widens its own POM boundary past the
      // matched spec files' common ancestor: a fixtures module a spec
      // imports test/expect from commonly lives in a directory *sibling*
      // to testDir (`playwright/fixtures` next to `playwright/tests`), not
      // inside it. Verified against a real config (appsmithorg/appsmith)
      // where every real spec imports `test`/`expect` from `../../fixtures`
      // — bounding resolution to `abs` (testDir itself) made every file
      // fail the check and silently zeroed the whole suite, the same
      // false-negative failure mode this safety net exists to prevent.
      let importSafetyNetBoundary = abs;

      const configFile = findPlaywrightConfig(abs);
      if (configFile) {
        const parsedConfig = parsePlaywrightConfig(configFile);
        if (!parsedConfig) {
          configWarnings.push(
            `Found ${path.relative(cwd, configFile) || configFile} but could not statically parse testDir/testMatch/testIgnore (a dynamic value or unsupported shape) — falling back to filename-based spec discovery for ${path.relative(cwd, abs) || abs}.`
          );
        } else {
          // Fallback boundary for findRepoBoundary when no .git turns up:
          // the config file's own directory when it sits above `abs`
          // (found by walking up from abs, so it's always an ancestor-or-
          // same of it), else `abs` itself. Never the filesystem root or
          // 20 levels up — see findRepoBoundary's doc comment.
          const repoRoot = findRepoBoundary(abs, path.dirname(configFile));
          repoRootForContainment = repoRoot;
          const escaped = parsedConfig.scopes.find((sc) => testDirEscapesRepo(sc.testDirAbs, repoRoot));
          if (escaped) {
            // A testDir resolves outside the repo boundary
            // (directly, or via a symlink — see testDirEscapesRepo). Its
            // testMatch/testIgnore were written for that escaped testDir,
            // so applying them to the clamped repoRoot instead would be a
            // silent mismatch; fall back to filename-based discovery.
            configWarnings.push(
              `Found ${path.relative(cwd, configFile) || configFile} but its testDir (${path.relative(cwd, escaped.testDirAbs) || escaped.testDirAbs}) resolves outside the repository (${path.relative(cwd, repoRoot) || repoRoot}) — falling back to filename-based spec discovery for ${path.relative(cwd, abs) || abs}.`
            );
          } else {
            // One job per distinct project scope (Playwright resolves
            // testDir/testMatch/testIgnore per project; a file is a test if
            // any project picks it up).
            const scopeJobs: DiscoveryJob[] = [];
            for (const scope of parsedConfig.scopes) {
              const scopedRoot = resolveConfigScopedRoot(abs, scope.testDirAbs, repoRoot);
              if (!scopedRoot) continue;
              scopeJobs.push({
                globCwd: scopedRoot,
                // Only regex entries: the regex walk below is the whole
                // match; no glob entries and no regex: the default names.
                globs: scope.testMatch
                  ? withTestDirSuffixPatterns(scope.testMatch, scopedRoot)
                  : scope.testMatchRegex
                    ? []
                    : SPEC_GLOBS,
                regexes: scope.testMatchRegex ?? [],
                ignoreGlobs: scope.testIgnore ? [...DEFAULT_IGNORE_GLOBS, ...scope.testIgnore] : DEFAULT_IGNORE_GLOBS,
                ignoreRegexes: scope.testIgnoreRegex ?? [],
              });
            }
            if (scopeJobs.length > 0) {
              jobs = scopeJobs;
              configApplied = true;
              importSafetyNetBoundary = path.dirname(configFile);
            }
          }
        }
      }

      const realRepoRoot = safeRealpath(repoRootForContainment);
      for (const job of jobs) {
        const globOptions = {
          cwd: job.globCwd,
          absolute: true,
          nodir: true,
          // RepoBoundaryIgnore keeps ignoreGlobs' own string-pattern
          // matching (node_modules/, testIgnore, ...) and *additionally*
          // stops the walk from ever descending into a symlinked directory
          // whose realpath escapes realRepoRoot — see its own doc comment.
          // Pruning during the walk (not just filtering matches after the
          // fact, below) is what keeps a `testDir/evil -> /` (or any
          // other huge, real symlinked target) from making discovery
          // actually walk arbitrary parts of the filesystem (QAG-230).
          ignore: new RepoBoundaryIgnore(job.ignoreGlobs, realRepoRoot),
          // glob's own default for `follow` is already false (don't
          // descend into a symlinked directory while expanding `**`), but
          // this is untrusted-repo territory (see testDirEscapesRepo
          // above), so pin it explicitly rather than relying on a default
          // that could change upstream.
          follow: false,
        };
        const candidates: string[] = [];
        for (const g of job.globs) candidates.push(...globSync(g, globOptions));
        if (job.regexes.length > 0) {
          // A regex `testMatch` is tested against the absolute path (as
          // Playwright does); it needs the full walk. Only code-like
          // extensions are candidates, so a loose regex never drags an
          // image or a fixture into the parser.
          for (const f of globSync('**/*', globOptions)) {
            const r = path.resolve(f);
            if (SPEC_EXTENSION_RE.test(r) && job.regexes.some((re) => re.test(r))) candidates.push(f);
          }
        }
        for (const f of candidates) {
          const resolved = path.resolve(f);
          if (job.ignoreRegexes.some((re) => re.test(resolved))) continue;
          // testDirEscapesRepo (above) only clamps testDir itself before
          // it becomes a glob root — it can't see what the glob then
          // actually walks *through* on the way to a match. A testMatch
          // entry that names a symlinked directory by a literal path
          // segment (not a `**` wildcard) still gets followed even with
          // `follow: false` on the globSync call above, since that option
          // only stops `**` from *expanding into* a symlinked directory —
          // it doesn't stop a pattern from naming one explicitly (e.g.
          // `tests/evil -> /` with `testMatch: ['evil/**/*.ts']` walks
          // `/`, and every match still lexically looks like it's under
          // `abs`). The same gap lets an individually symlinked spec file
          // sitting directly in the repo (no testMatch trickery needed)
          // resolve to a file outside it. A lexical containment check
          // can't catch either case — both matches still "look" like they
          // live under `abs` right up until the symlink is resolved — so
          // this compares realpaths on both sides. Checked against the
          // *repo root* (realRepoRoot), not `abs` itself: a scan pointed
          // at one monorepo package's specs must still keep a match that
          // resolves, in-repo, to a sibling directory outside that
          // subpath — only a true escape of the repo itself is dropped
          // here (QAG-230; the config-scoped re-narrowing to `abs` right
          // below handles the "don't silently widen past what the caller
          // asked for" half of this separately).
          if (!isAncestorOrSame(realRepoRoot, safeRealpath(resolved))) continue;
          // resolveConfigScopedRoot always globs from testDir (Playwright's
          // own testMatch/testIgnore semantics — see its doc comment), which
          // can be wider than the directory the caller actually pointed
          // `scorePaths` at (a narrower `abs`, e.g. one subproject's specs
          // inside a monorepo testDir that also covers others). Filter back
          // down to what the caller asked for so scoping to testDir for
          // correct path matching never silently widens the scored set.
          if (configApplied && job.globCwd !== abs) {
            const rel = path.relative(abs, resolved);
            if (rel.startsWith('..') || path.isAbsolute(rel)) continue;
          }
          // Extra safety net, only once config-based discovery is actually
          // driving this scan: testMatch can still be broader than intended
          // (e.g. a generic '**/*.ts'); a file that imports neither
          // '@playwright/test' directly nor (transitively, through a local
          // module) re-exports it isn't a Playwright spec regardless of
          // what the config's glob matched.
          if (configApplied && !SPEC_NAME_RE.test(resolved)) {
            if (!admission.keepsConfigMatch(resolved, importSafetyNetBoundary)) continue;
          }
          addExpanded(resolved, !configApplied ? 'D' : SPEC_NAME_RE.test(resolved) ? 'CS' : 'CN');
        }
      }
      continue;
    }
    // treat as glob — a raw pattern the caller passed directly (e.g.
    // `tests/*.spec.ts`), resolved relative to `cwd` rather than a
    // directory this function itself walked. Same realpath containment
    // and walk-pruning as the directory branch above applies here too
    // (QAG-230): a bare glob input is just as capable of naming a
    // symlinked path segment explicitly, and skipping this check here
    // would have made switching from a directory argument to an
    // equivalent glob argument silently bypass it.
    //
    // The boundary itself comes from *this pattern's own* literal prefix
    // directory (literalPrefixDir), not from `cwd` (QAG-230 round 3) — see
    // that function's doc comment for why cwd's repo root is the wrong
    // boundary for a pattern that points somewhere else entirely.
    const prefixDir = literalPrefixDir(input, cwd);
    inputDirs.add(prefixDir);
    const repoRootForPattern = safeRealpath(findRepoBoundary(prefixDir, prefixDir));
    for (const f of globSync(input, {
      cwd,
      absolute: true,
      nodir: true,
      ignore: new RepoBoundaryIgnore(DEFAULT_IGNORE_GLOBS, repoRootForPattern),
      follow: false,
    })) {
      const resolved = path.resolve(f);
      if (!isAncestorOrSame(repoRootForPattern, safeRealpath(resolved))) continue;
      addExpanded(resolved, 'G');
    }
  }
  // De-dupe by realpath: an in-repo symlinked spec and its real target can
  // both independently match discovery (the symlink itself sitting under
  // one scanned root, its target sitting somewhere else under the same
  // repo) and would otherwise be scored twice, as if they were two
  // different files. Keeps the first lexical path per realpath, in sorted
  // order, so which one "wins" is deterministic rather than depending on
  // Set insertion order. Pre-existing gap, not new to the escape fixes
  // above — those only ever drop a true escape, never a legitimate
  // in-repo duplicate (see CHANGELOG: this can change file counts for a
  // repo that happens to have such a link).
  const firstPathByRealpath = new Map<string, string>();
  // Seeded with `explicit`'s own realpaths first: an explicit target and a
  // directory scan containing a symlink to that same file are two
  // different literal paths for the same file, so the plain "explicit
  // wins" delete below (which only matches identical literal paths) can't
  // catch that pairing — without this seeding, the symlinked match survives
  // dedup (its realpath hadn't been seen yet) and gets scored a second
  // time alongside the explicit path.
  for (const f of [...explicit].sort()) {
    const real = safeRealpath(f);
    if (!firstPathByRealpath.has(real)) firstPathByRealpath.set(real, f);
  }
  for (const f of [...expanded].sort()) {
    const real = safeRealpath(f);
    if (!firstPathByRealpath.has(real)) firstPathByRealpath.set(real, f);
  }
  expanded.clear();
  for (const f of firstPathByRealpath.values()) expanded.add(f);
  // A file can be reached both explicitly and via expansion (e.g. an
  // explicit path plus an overlapping glob); explicit intent wins.
  for (const f of explicit) expanded.delete(f);
  return {
    explicit: [...explicit].sort(),
    expanded: [...expanded].sort(),
    routes,
    scanRootDirs: [...scanRootDirs].sort(),
    inputDirs: [...inputDirs].sort(),
    configWarnings,
  };
}

/**
 * Base directory finding paths are relative to: common ancestor of the
 * directories the caller named, widened just enough to contain every file.
 */
function reportBaseDir(inputDirs: string[], files: string[]): string {
  const placeholders = inputDirs.map((d) => path.join(d, '_'));
  return commonAncestorDir([...placeholders, ...files]);
}

function hardFail(
  profile: ProfileName,
  threshold: number,
  findings: Finding[],
  extra: Partial<ScoreResult['summary']> = {},
  skippedFiles?: string[],
  configWarnings?: string[]
): ScoreResult {
  return {
    scoreVersion: 'v4',
    profile,
    score: 0,
    grade: 'F',
    pass: false,
    threshold,
    summary: {
      files: 0,
      tests: 0,
      sloc: 0,
      findings: findings.length,
      errors: findings.filter((f) => f.severity === 'error').length,
      warnings: findings.filter((f) => f.severity === 'warning').length,
      nativeLocators: 0,
      rawLocators: 0,
      unassertedTests: 0,
      unverifiedTests: 0,
      cleanTests: 0,
      ...extra,
    },
    dimensions: {
      playwrightHygiene: 0,
      assertions: 0,
      locators: 0,
      structure: 0,
    },
    findings,
    ...(skippedFiles && skippedFiles.length > 0 ? { skippedFiles } : {}),
    ...(configWarnings && configWarnings.length > 0 ? { configWarnings } : {}),
  };
}

/**
 * Score Playwright spec files. Deterministic and AI-free.
 */
export async function scorePaths(options: ScoreOptions): Promise<ScoreResult> {
  resetRuleCrashes();
  const result = await scorePathsInner(options);
  decorateFindings(result.findings, result.baseDir);
  const crashes = summarizeRuleCrashes();
  const withCrashes = crashes.length > 0 ? { ...result, ruleCrashes: crashes } : result;
  return { ...withCrashes, engine: getEngineVersions() };
}

async function scorePathsInner(options: ScoreOptions): Promise<ScoreResult> {
  // The time limit bounds the whole call. Without one the clock is never read.
  const timeLimit = startTimeLimit(options.isolate === false ? undefined : options.maxSeconds);
  const cwd = options.cwd ?? process.cwd();
  const profile: ProfileName = options.profile ?? 'standard';
  const threshold =
    options.threshold ?? DEFAULT_THRESHOLDS[profile] ?? 80;

  // One admission object per run: it decides, for both discovery and the
  // loop below, whether a candidate is a Playwright file and whether it is
  // scored, and it reads each candidate once (see admission.ts).
  const admission = new Admission();
  const { explicit, expanded, routes, scanRootDirs, inputDirs, configWarnings } = expandPaths(options.paths, cwd, admission);

  const NO_FILES: Coverage = { filesFound: 0, filesScored: 0, testsCounted: 0, skipped: [] };
  if (explicit.length === 0 && expanded.length === 0) {
    // Hard-fail: empty match must never look like a healthy suite (was ~99 PASS).
    return withCoverage(hardFail(
      profile,
      threshold,
      [
        {
          rule: 'playwright-score/no-files',
          severity: 'error',
          message: `No Playwright spec files matched: ${options.paths.join(', ') || '(no paths)'}`,
          file: cwd,
          dimension: 'structure',
        },
      ],
      {},
      undefined,
      configWarnings
    ), NO_FILES);
  }

  // Directory/glob matches are excluded only on positive evidence of a
  // non-Playwright test framework (the other-framework signal, evaluated in
  // admission.ts on the same text for every size). Paths
  // the caller named explicitly are always scored regardless.
  const skippedFiles: string[] = [];
  const acceptedExpanded: string[] = [];
  const skipBase = reportBaseDir(inputDirs, [...explicit, ...expanded]);
  // A Playwright file that is unreadable, too large or binary is skipped and
  // listed in `coverage` instead of taking the whole run down.
  const skips = new SkipLog();
  const readSources = new Map<string, string>();
  const admit = (f: string, route: Route): boolean => {
    const a = admission.admit(f, route);
    if (a.decision.outcome === 'other-framework' || a.decision.outcome === 'not-playwright') return false;
    if (a.decision.outcome === 'skip') skips.add(f, a.decision.reason ?? 'unreadable', a.detail);
    else readSources.set(f, a.source ?? '');
    return true;
  };
  for (const f of expanded) {
    if (admit(f, routes.get(f) ?? 'G')) acceptedExpanded.push(f);
    else skippedFiles.push(path.relative(skipBase, f) || path.basename(f));
  }
  for (const f of explicit) admit(f, 'E');

  // `found`: every Playwright file discovered. `files`: the ones that go to linting.
  const found = [...explicit, ...acceptedExpanded].sort();
  const files = found.filter((f) => !skips.has(f));

  if (found.length === 0) {
    return withCoverage(hardFail(
      profile,
      threshold,
      [
        {
          rule: 'playwright-score/no-files',
          severity: 'error',
          message: `${expanded.length} file(s) matched but all look like non-Playwright tests (Jest/Vitest/RTL/Cypress) — nothing to score.`,
          file: cwd,
          dimension: 'structure',
        },
      ],
      {},
      skippedFiles
    ), NO_FILES);
  }

  // Relative to the directory the caller scored (common ancestor of the
  // path arguments; widened only if a config-discovered file lies outside
  // it), not the specs' own common ancestor, so a printed path resolves
  // from the scored directory. Not the caller's cwd, which may be
  // unrelated: findings stay portable across machines/CI and
  // formatters/sarif.ts can emit repo-relative artifactLocation URIs.
  const filesBase = reportBaseDir(inputDirs, found);

  // Wider than filesBase on purpose: a Page Object Model's classes
  // typically live in a directory *sibling* to the specs themselves
  // (tests/ next to pages/, fixtures/), so bounding import-graph.ts's
  // traversal to just the matched spec files' own common ancestor would
  // reject every import that climbs back out of tests/ — verified against
  // a real suite (n8n) where this was the exact reason locator counts from
  // its page objects were being discarded. Falls back to filesBase itself
  // when every input was an explicit file (no directory to widen to).
  const importBoundary = commonAncestorDir([...found, ...scanRootDirs]);

  // Classification is finished: `found`, `files` and `skippedFiles` are final
  // whatever the time limit. From here on the limit is checked before each
  // step of the pre-pass below and before each batch of the analysis; once it
  // has passed no new step starts, and every file not yet analysed is skipped
  // as `deadline`.
  //
  // Every source was read once, above, so (a) we can feed ESLint's
  // expect-expect a per-run list of local assertion-helper names before
  // linting (see findLocalAssertionHelperNames) and (b) the metrics loop
  // below doesn't re-read the same files ESLint already read internally.
  const sources = new Map<string, string>();
  const helperFacts: HelperFacts[] = [];
  const moduleResolver = createModuleResolver(importBoundary);
  const importEdges = new Map<string, string[]>();
  let importedFiles = new Map<string, string>();
  let analysis: AnalysisInput | undefined;
  prePass: {
    if (timeLimit.passed('helper-facts')) break prePass;
    for (const file of files) {
      const source = readSources.get(file) ?? '';
      sources.set(file, source);
      helperFacts.push(...extractHelperFacts(source, file));
    }

    // Page Object Model suites route locator calls through imported classes
    // (`n8n.canvas.click(...)`) rather than calling `page.locator()`/
    // `getByRole()` directly in the spec file — see import-graph.ts. These
    // dependency files are never linted or counted toward sloc/tests/
    // findings; they only contribute locator counts (and, the same way,
    // any assertion-helper names) to the suite-level totals below.
    if (timeLimit.passed('import-graph')) break prePass;
    importedFiles = collectLocallyImportedFiles(sources, importBoundary, moduleResolver, importEdges);
    for (const [file, source] of importedFiles) {
      helperFacts.push(...extractHelperFacts(source, file));
    }
    // One fixed point over every readable file, so delegation chains may cross
    // file boundaries (spec helper -> imported page object -> expect).
    // Names are scoped per spec file: own helpers plus helpers of files the spec
    // reaches through imports (see helper-scope.ts).
    const helperNamesFor = createHelperScope(helperFacts, importEdges);
    const assertFunctionNamesByFile = new Map(files.map((f) => [f, helperNamesFor(f)] as const));

    // Identifiers bound to a `test.extend(...)`-derived fixture under a
    // custom name (same-file, or imported from a local fixtures module —
    // see test-aliases.ts), so a suite that always declares its tests via
    // `loggedTest(...)` instead of `test(...)` is recognized correctly by
    // both eslint-plugin-playwright's rules (fed via runEslint's settings
    // below) and this package's own AST checks (getTestSpans/countTests,
    // base-plugin.ts).
    if (timeLimit.passed('aliases')) break prePass;
    const testAliasNames = detectTestAliasNamesWithFactories(sources, importedFiles, importBoundary);

    if (timeLimit.passed('analysis-input')) break prePass;
    analysis = {
      files,
      sources,
      importedFiles,
      filesBase,
      importBoundary,
      profile,
      cwd,
      assertFunctionNamesByFile,
      testAliasNames,
    };
  }

  // The analysis itself (lint, triage, per-file metrics) lives in isolate.ts.
  // By default it runs in a worker thread with a heap limit and, when the
  // caller passes one, the time limit; a file the worker gives up on is listed
  // in `coverage` and the result is `partial`. Every file was classified
  // above, so a limit can only skip a file that is already a Playwright file.
  const outcome =
    analysis === undefined
      ? { batches: [], skipped: files.map((f) => deadlineSkip(f, timeLimit)) }
      : options.isolate === false
        ? { batches: [await createAnalyzer(analysis, moduleResolver)(files)], skipped: [] }
        : await analyzeIsolated(analysis, { maxHeapMb: options.maxHeapMb ?? DEFAULT_MAX_HEAP_MB, time: timeLimit });
  for (const s of outcome.skipped) skips.add(s.file, s.reason, s.detail);

  // A file that isn't valid JS/TS can't be executed, let alone scored on its
  // merits. It is skipped: it keeps its parse-error finding, it is listed in
  // `coverage`, and the result is `partial` (never a pass) or, when nothing
  // else counts, `not-scored`. The other files are scored as usual.
  let totalSloc = 0;
  let totalTests = 0;
  let native = 0;
  let raw = 0;
  const eslintFindings: Finding[] = [];
  const metricFindings: Finding[] = [];
  const fileTests: Record<string, number> = {};
  const fileSpans = new Map<string, TestSpans>();
  for (const batch of outcome.batches) {
    for (const [file, detail] of batch.parseErrors) skips.add(file, 'parse-error', detail);
    eslintFindings.push(...batch.lintFindings);
    metricFindings.push(...batch.metricFindings);
    for (const f of batch.facts) {
      totalSloc += f.sloc;
      native += f.native;
      raw += f.raw;
      fileSpans.set(f.rel, f.spans);
      fileTests[f.rel] = f.tests;
      totalTests += f.tests;
    }
    for (const c of batch.crashes ?? []) {
      for (let i = 0; i < c.count; i++) ruleCrashes.push({ rule: c.rule, error: new Error('rule crashed in the analysis worker') });
    }
  }
  const scoredFiles = files.filter((f) => !skips.has(f));

  for (const [file, source] of importedFiles) {
    const counts = countLocators(source, file);
    native += counts.native;
    raw += counts.raw;
  }

  const findings = [...eslintFindings, ...metricFindings];

  // Attribute each finding to the test it sits in (model v3) — see
  // attributeFindingScopes in metrics.ts.
  attributeFindingScopes(findings, fileSpans);

  const coverage: Coverage = {
    filesFound: found.length,
    filesScored: scoredFiles.length,
    testsCounted: totalTests,
    skipped: skips.report(filesBase),
  };
  if (totalTests === 0) {
    // Nothing counts toward a score (every file skipped, or the scored files
    // declare no test): never a number that could read as a healthy suite.
    return withCoverage(
      {
        ...hardFail(
          profile,
          threshold,
          findings,
          {
            files: scoredFiles.length,
            tests: totalTests,
            sloc: Math.max(totalSloc, 1),
            nativeLocators: native,
            rawLocators: raw,
          },
          skippedFiles,
          configWarnings
        ),
        baseDir: filesBase,
      },
      coverage
    );
  }

  const result = computeScore({
    profile,
    threshold,
    findings: scoredFindings(findings),
    sloc: Math.max(totalSloc, 1),
    files: scoredFiles.length,
    tests: totalTests,
    fileTests,
    nativeLocators: native,
    rawLocators: raw,
  });

  return withCoverage(
    {
      ...result,
      baseDir: filesBase,
      ...(skippedFiles.length > 0 ? { skippedFiles } : {}),
      ...(configWarnings.length > 0 ? { configWarnings } : {}),
    },
    coverage,
    findings
  );
}
