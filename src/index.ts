import fs from 'node:fs';
import path from 'node:path';
import { globSync } from 'glob';
import { runEslint } from './eslint-runner.js';
import { commonAncestorDir } from './fs-util.js';
import { collectLocallyImportedFiles } from './import-graph.js';
import {
  analyzeSource,
  attributeFindingScopes,
  countLocators,
  findLocalAssertionHelperNames,
  getTestSpans,
  looksLikeNonPlaywrightTest,
} from './metrics.js';
import { detectExtendedTestAliases } from './test-aliases.js';
import {
  findPlaywrightConfig,
  findRepoBoundary,
  importsPlaywrightTestTransitively,
  isAncestorOrSame,
  parsePlaywrightConfig,
  resolveConfigScopedRoot,
  safeRealpath,
  testDirEscapesRepo,
} from './playwright-config.js';
import { DEFAULT_THRESHOLDS } from './profiles.js';
import { computeScore } from './score-engine.js';
import type { Finding, ProfileName, ScoreOptions, ScoreResult } from './types.js';

export type { ScoreResult, ScoreOptions, Finding, ProfileName } from './types.js';
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
const SPEC_GLOBS = [
  '**/*.{spec,test,e2e,e2e-spec,e2e-test,pw}.{ts,tsx,js,jsx}',
  '**/*.spec.ts',
  '**/*.test.ts',
];

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
 * `explicit`: paths the caller named directly (a literal existing file) —
 * always scored, regardless of whether they look like a Playwright spec.
 * `expanded`: everything else (matched via a directory scan or a glob
 * pattern) — subject to the looksLikePlaywrightSpec filter in scorePaths,
 * since a broad `**\/*.test.ts`-style match can just as easily sweep in
 * unrelated Jest/Vitest/RTL/Cypress unit tests sitting in the same repo.
 */
function expandPaths(
  inputs: string[],
  cwd: string
): { explicit: string[]; expanded: string[]; scanRootDirs: string[]; configWarnings: string[] } {
  const explicit = new Set<string>();
  const expanded = new Set<string>();
  const scanRootDirs = new Set<string>();
  const configWarnings: string[] = [];
  for (const input of inputs) {
    const abs = path.isAbsolute(input) ? input : path.resolve(cwd, input);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      explicit.add(abs);
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
      // Realpath'd once per scan root, reused for every match below — see
      // the realpath containment check in the glob loop for why this
      // exists alongside (not instead of) testDirEscapesRepo's own
      // realpath check on testDir itself.
      const realAbs = safeRealpath(abs);

      // A playwright.config.* at or above this directory, when it can be
      // read statically, is authoritative about what this target itself
      // considers a spec — see playwright-config.ts. Falls back to the
      // filename-suffix SPEC_GLOBS (today's behavior) whenever a config
      // isn't found, doesn't overlap this scan, or can't be parsed
      // statically (a dynamic/unsupported shape) — the last case surfaces
      // a warning rather than silently guessing.
      let globCwd = abs;
      let specGlobs: string[] = SPEC_GLOBS;
      let ignoreGlobs: string[] = DEFAULT_IGNORE_GLOBS;
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
          if (testDirEscapesRepo(parsedConfig.testDirAbs, repoRoot)) {
            // The config's testDir resolves outside the repo boundary
            // (directly, or via a symlink — see testDirEscapesRepo). Its
            // testMatch/testIgnore were written for that escaped testDir,
            // so applying them to the clamped repoRoot instead would be a
            // silent mismatch; fall back to filename-based discovery.
            configWarnings.push(
              `Found ${path.relative(cwd, configFile) || configFile} but its testDir (${path.relative(cwd, parsedConfig.testDirAbs) || parsedConfig.testDirAbs}) resolves outside the repository (${path.relative(cwd, repoRoot) || repoRoot}) — falling back to filename-based spec discovery for ${path.relative(cwd, abs) || abs}.`
            );
          } else {
            const scopedRoot = resolveConfigScopedRoot(abs, parsedConfig.testDirAbs, repoRoot);
            if (scopedRoot) {
              globCwd = scopedRoot;
              if (parsedConfig.testMatch) specGlobs = parsedConfig.testMatch;
              if (parsedConfig.testIgnore) {
                ignoreGlobs = [...DEFAULT_IGNORE_GLOBS, ...parsedConfig.testIgnore];
              }
              configApplied = true;
              importSafetyNetBoundary = path.dirname(configFile);
            }
          }
        }
      }

      for (const g of specGlobs) {
        for (const f of globSync(g, {
          cwd: globCwd,
          absolute: true,
          nodir: true,
          ignore: ignoreGlobs,
          // glob's own default for `follow` is already false (don't
          // descend into a symlinked directory while expanding `**`), but
          // this is untrusted-repo territory (see testDirEscapesRepo
          // above), so pin it explicitly rather than relying on a default
          // that could change upstream.
          follow: false,
        })) {
          const resolved = path.resolve(f);
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
          // this compares realpaths on both sides (QAG-230).
          if (!isAncestorOrSame(realAbs, safeRealpath(resolved))) continue;
          // resolveConfigScopedRoot always globs from testDir (Playwright's
          // own testMatch/testIgnore semantics — see its doc comment), which
          // can be wider than the directory the caller actually pointed
          // `scorePaths` at (a narrower `abs`, e.g. one subproject's specs
          // inside a monorepo testDir that also covers others). Filter back
          // down to what the caller asked for so scoping to testDir for
          // correct path matching never silently widens the scored set.
          if (configApplied && globCwd !== abs) {
            const rel = path.relative(abs, resolved);
            if (rel.startsWith('..') || path.isAbsolute(rel)) continue;
          }
          // Extra safety net, only once config-based discovery is actually
          // driving this scan: testMatch can still be broader than intended
          // (e.g. a generic '**/*.ts'); a file that imports neither
          // '@playwright/test' directly nor (transitively, through a local
          // module) re-exports it isn't a Playwright spec regardless of
          // what the config's glob matched.
          if (configApplied) {
            let source: string;
            try {
              source = fs.readFileSync(resolved, 'utf8');
            } catch {
              continue;
            }
            if (!importsPlaywrightTestTransitively(resolved, source, importSafetyNetBoundary)) continue;
          }
          expanded.add(resolved);
        }
      }
      continue;
    }
    // treat as glob
    for (const f of globSync(input, {
      cwd,
      absolute: true,
      nodir: true,
      ignore: DEFAULT_IGNORE_GLOBS,
    })) {
      expanded.add(path.resolve(f));
    }
  }
  // A file can be reached both explicitly and via expansion (e.g. an
  // explicit path plus an overlapping glob); explicit intent wins.
  for (const f of explicit) expanded.delete(f);
  return {
    explicit: [...explicit].sort(),
    expanded: [...expanded].sort(),
    scanRootDirs: [...scanRootDirs].sort(),
    configWarnings,
  };
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
  const cwd = options.cwd ?? process.cwd();
  const profile: ProfileName = options.profile ?? 'standard';
  const threshold =
    options.threshold ?? DEFAULT_THRESHOLDS[profile] ?? 80;

  const { explicit, expanded, scanRootDirs, configWarnings } = expandPaths(options.paths, cwd);

  if (explicit.length === 0 && expanded.length === 0) {
    // Hard-fail: empty match must never look like a healthy suite (was ~99 PASS).
    return hardFail(
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
    );
  }

  // Directory/glob matches are excluded only on positive evidence of a
  // non-Playwright test framework — see looksLikeNonPlaywrightTest. Paths
  // the caller named explicitly are always scored regardless.
  const skippedFiles: string[] = [];
  const acceptedExpanded: string[] = [];
  const skipBase = commonAncestorDir([...explicit, ...expanded]);
  for (const f of expanded) {
    const source = fs.readFileSync(f, 'utf8');
    if (looksLikeNonPlaywrightTest(source)) {
      skippedFiles.push(path.relative(skipBase, f) || path.basename(f));
    } else {
      acceptedExpanded.push(f);
    }
  }

  const files = [...explicit, ...acceptedExpanded].sort();

  if (files.length === 0) {
    return hardFail(
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
    );
  }

  // Relative to the files' own common ancestor (not the caller's cwd, which
  // may be unrelated) so findings stay portable across machines/CI and
  // formatters/sarif.ts can emit repo-relative artifactLocation URIs.
  const filesBase = commonAncestorDir(files);

  // Wider than filesBase on purpose: a Page Object Model's classes
  // typically live in a directory *sibling* to the specs themselves
  // (tests/ next to pages/, fixtures/), so bounding import-graph.ts's
  // traversal to just the matched spec files' own common ancestor would
  // reject every import that climbs back out of tests/ — verified against
  // a real suite (n8n) where this was the exact reason locator counts from
  // its page objects were being discarded. Falls back to filesBase itself
  // when every input was an explicit file (no directory to widen to).
  const importBoundary = commonAncestorDir([...files, ...scanRootDirs]);

  // Read every file once, up front, so (a) we can feed ESLint's
  // expect-expect a per-run list of local assertion-helper names before
  // linting (see findLocalAssertionHelperNames) and (b) the metrics loop
  // below doesn't re-read the same files ESLint already read internally.
  const sources = new Map<string, string>();
  const assertFunctionNames = new Set<string>();
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    sources.set(file, source);
    for (const name of findLocalAssertionHelperNames(source, file)) {
      assertFunctionNames.add(name);
    }
  }

  // Page Object Model suites route locator calls through imported classes
  // (`n8n.canvas.click(...)`) rather than calling `page.locator()`/
  // `getByRole()` directly in the spec file — see import-graph.ts. These
  // dependency files are never linted or counted toward sloc/tests/
  // findings; they only contribute locator counts (and, the same way,
  // any assertion-helper names) to the suite-level totals below.
  const importedFiles = collectLocallyImportedFiles(sources, importBoundary);
  for (const [file, source] of importedFiles) {
    for (const name of findLocalAssertionHelperNames(source, file)) {
      assertFunctionNames.add(name);
    }
  }

  // Identifiers bound to a `test.extend(...)`-derived fixture under a
  // custom name (same-file, or imported from a local fixtures module —
  // see test-aliases.ts), so a suite that always declares its tests via
  // `loggedTest(...)` instead of `test(...)` is recognized correctly by
  // both eslint-plugin-playwright's rules (fed via runEslint's settings
  // below) and this package's own AST checks (getTestSpans/countTests,
  // base-plugin.ts).
  const testAliasNames = detectExtendedTestAliases(sources, importedFiles, importBoundary);

  const eslintFindings = await runEslint({
    files,
    profile,
    cwd,
    assertFunctionNames: [...assertFunctionNames],
    testAliasNames,
  });

  let totalSloc = 0;
  let totalTests = 0;
  let native = 0;
  let raw = 0;
  const metricFindings: Finding[] = [];

  const fileTests: Record<string, number> = {};
  const fileSpans = new Map<string, ReturnType<typeof getTestSpans>>();
  for (const file of files) {
    const source = sources.get(file) ?? '';
    const relFile = path.relative(filesBase, file) || path.basename(file);
    const m = analyzeSource(source, relFile, testAliasNames);
    totalSloc += m.sloc;
    native += m.locators.native;
    raw += m.locators.raw;
    metricFindings.push(...m.findings);
    const spans = getTestSpans(source, relFile, testAliasNames);
    fileSpans.set(relFile, spans);
    // AST spans are the authoritative test count (they are also the
    // attribution targets); the regex count is the fallback for a file
    // the parser can't read — which hard-fails below anyway.
    const testCount = spans.tests.length > 0 ? spans.tests.length : m.tests;
    fileTests[relFile] = testCount;
    totalTests += testCount;
  }

  for (const [file, source] of importedFiles) {
    const counts = countLocators(source, file);
    native += counts.native;
    raw += counts.raw;
  }

  const findings = [...eslintFindings, ...metricFindings];

  // Attribute each finding to the test it sits in (model v3) — see
  // attributeFindingScopes in metrics.ts.
  attributeFindingScopes(findings, fileSpans);

  const parseErrors = findings.filter((f) => f.rule === 'playwright-score/parse-error');
  if (parseErrors.length > 0) {
    // A file that isn't valid JS/TS can't be executed, let alone scored on
    // its merits. Diluting this into the normal per-dimension penalty math
    // (a handful of exp-decay points on an otherwise large, clean batch)
    // would let a broken file hide inside a passing score. Hard-fail
    // instead, same as the no-matching-files case.
    return hardFail(
      profile,
      threshold,
      findings,
      {
        files: files.length,
        sloc: Math.max(totalSloc, 1),
        nativeLocators: native,
        rawLocators: raw,
      },
      skippedFiles
    );
  }

  const result = computeScore({
    profile,
    threshold,
    findings,
    sloc: Math.max(totalSloc, 1),
    files: files.length,
    tests: totalTests,
    fileTests,
    nativeLocators: native,
    rawLocators: raw,
  });

  return {
    ...result,
    ...(skippedFiles.length > 0 ? { skippedFiles } : {}),
    ...(configWarnings.length > 0 ? { configWarnings } : {}),
  };
}
