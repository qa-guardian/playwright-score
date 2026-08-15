import fs from 'node:fs';
import path from 'node:path';
import { globSync } from 'glob';
import { runEslint } from './eslint-runner.js';
import { commonAncestorDir } from './fs-util.js';
import {
  analyzeSource,
  findLocalAssertionHelperNames,
  looksLikeNonPlaywrightTest,
} from './metrics.js';
import { DEFAULT_THRESHOLDS } from './profiles.js';
import { computeScore } from './score-engine.js';
import type { Finding, ProfileName, ScoreOptions, ScoreResult } from './types.js';

export type { ScoreResult, ScoreOptions, Finding, ProfileName } from './types.js';
export { computeScore, SQS_V1, locatorsScore, gradeFromScore } from './score-engine.js';
export { countSloc } from './sloc.js';
export { countLocators, analyzeSource } from './metrics.js';
export { formatJson } from './formatters/json.js';
export { formatText } from './formatters/text.js';
export { formatMarkdown } from './formatters/markdown.js';
export { formatSarif } from './formatters/sarif.js';

const SPEC_GLOBS = ['**/*.{spec,test}.{ts,tsx,js,jsx}', '**/*.spec.ts', '**/*.test.ts'];

/**
 * `explicit`: paths the caller named directly (a literal existing file) —
 * always scored, regardless of whether they look like a Playwright spec.
 * `expanded`: everything else (matched via a directory scan or a glob
 * pattern) — subject to the looksLikePlaywrightSpec filter in scorePaths,
 * since a broad `**\/*.test.ts`-style match can just as easily sweep in
 * unrelated Jest/Vitest/RTL unit tests sitting in the same repo.
 */
function expandPaths(
  inputs: string[],
  cwd: string
): { explicit: string[]; expanded: string[] } {
  const explicit = new Set<string>();
  const expanded = new Set<string>();
  for (const input of inputs) {
    const abs = path.isAbsolute(input) ? input : path.resolve(cwd, input);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      explicit.add(abs);
      continue;
    }
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
      for (const g of SPEC_GLOBS) {
        for (const f of globSync(g, { cwd: abs, absolute: true, nodir: true })) {
          expanded.add(path.resolve(f));
        }
      }
      continue;
    }
    // treat as glob
    for (const f of globSync(input, { cwd, absolute: true, nodir: true })) {
      expanded.add(path.resolve(f));
    }
  }
  // A file can be reached both explicitly and via expansion (e.g. an
  // explicit path plus an overlapping glob); explicit intent wins.
  for (const f of explicit) expanded.delete(f);
  return { explicit: [...explicit].sort(), expanded: [...expanded].sort() };
}

function hardFail(
  profile: ProfileName,
  threshold: number,
  findings: Finding[],
  extra: Partial<ScoreResult['summary']> = {},
  skippedFiles?: string[]
): ScoreResult {
  return {
    scoreVersion: 'sqs-v1',
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
      ...extra,
    },
    dimensions: {
      playwrightHygiene: 0,
      assertions: 0,
      locators: 0,
      structure: 0,
      ...(profile === 'guardian' ? { guardianConventions: 0 } : {}),
    },
    findings,
    ...(skippedFiles && skippedFiles.length > 0 ? { skippedFiles } : {}),
  };
}

/**
 * Score Playwright spec files. Deterministic and AI-free (sqs-v1).
 */
export async function scorePaths(options: ScoreOptions): Promise<ScoreResult> {
  const cwd = options.cwd ?? process.cwd();
  const profile: ProfileName = options.profile ?? 'standard';
  const threshold =
    options.threshold ?? DEFAULT_THRESHOLDS[profile] ?? 80;

  const { explicit, expanded } = expandPaths(options.paths, cwd);

  if (explicit.length === 0 && expanded.length === 0) {
    // Hard-fail: empty match must never look like a healthy suite (was ~99 PASS).
    return hardFail(profile, threshold, [
      {
        rule: 'playwright-score/no-files',
        severity: 'error',
        message: `No Playwright spec files matched: ${options.paths.join(', ') || '(no paths)'}`,
        file: cwd,
        dimension: 'structure',
      },
    ]);
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
          message: `${expanded.length} file(s) matched but all look like non-Playwright tests (Jest/Vitest/RTL) — nothing to score.`,
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

  const eslintFindings = await runEslint({
    files,
    profile,
    cwd,
    assertFunctionNames: [...assertFunctionNames],
  });

  let totalSloc = 0;
  let totalTests = 0;
  let native = 0;
  let raw = 0;
  const metricFindings: Finding[] = [];

  for (const file of files) {
    const source = sources.get(file) ?? '';
    const relFile = path.relative(filesBase, file) || path.basename(file);
    const m = analyzeSource(source, relFile);
    totalSloc += m.sloc;
    totalTests += m.tests;
    native += m.locators.native;
    raw += m.locators.raw;
    // metrics/no-empty-test duplicates guardian/require-expect under guardian — keep both mild
    metricFindings.push(...m.findings);
  }

  // Dedupe empty-test style: if guardian require-expect already fired, still ok
  const findings = [...eslintFindings, ...metricFindings];

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
    nativeLocators: native,
    rawLocators: raw,
  });

  return skippedFiles.length > 0 ? { ...result, skippedFiles } : result;
}
