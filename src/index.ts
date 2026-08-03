import fs from 'node:fs';
import path from 'node:path';
import { globSync } from 'glob';
import { runEslint } from './eslint-runner.js';
import { analyzeSource } from './metrics.js';
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

function expandPaths(inputs: string[], cwd: string): string[] {
  const files = new Set<string>();
  for (const input of inputs) {
    const abs = path.isAbsolute(input) ? input : path.resolve(cwd, input);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      files.add(abs);
      continue;
    }
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
      for (const g of SPEC_GLOBS) {
        for (const f of globSync(g, { cwd: abs, absolute: true, nodir: true })) {
          files.add(path.resolve(f));
        }
      }
      continue;
    }
    // treat as glob
    for (const f of globSync(input, { cwd, absolute: true, nodir: true })) {
      files.add(path.resolve(f));
    }
  }
  return [...files].sort();
}

/**
 * Score Playwright spec files. Deterministic and AI-free (sqs-v1).
 */
export async function scorePaths(options: ScoreOptions): Promise<ScoreResult> {
  const cwd = options.cwd ?? process.cwd();
  const profile: ProfileName = options.profile ?? 'standard';
  const threshold =
    options.threshold ?? DEFAULT_THRESHOLDS[profile] ?? 80;

  const files = expandPaths(options.paths, cwd);
  if (files.length === 0) {
    // Hard-fail: empty match must never look like a healthy suite (was ~99 PASS).
    const findings: Finding[] = [
      {
        rule: 'playwright-score/no-files',
        severity: 'error',
        message: `No Playwright spec files matched: ${options.paths.join(', ') || '(no paths)'}`,
        file: cwd,
        dimension: 'structure',
      },
    ];
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
        findings: 1,
        errors: 1,
        warnings: 0,
        nativeLocators: 0,
        rawLocators: 0,
      },
      dimensions: {
        playwrightHygiene: 0,
        assertions: 0,
        locators: 0,
        structure: 0,
        ...(profile === 'guardian' ? { guardianConventions: 0 } : {}),
      },
      findings,
    };
  }

  const eslintFindings = await runEslint({ files, profile, cwd });

  let totalSloc = 0;
  let totalTests = 0;
  let native = 0;
  let raw = 0;
  const metricFindings: Finding[] = [];

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const m = analyzeSource(source, file);
    totalSloc += m.sloc;
    totalTests += m.tests;
    native += m.locators.native;
    raw += m.locators.raw;
    // metrics/no-empty-test duplicates guardian/require-expect under guardian — keep both mild
    metricFindings.push(...m.findings);
  }

  // Dedupe empty-test style: if guardian require-expect already fired, still ok
  const findings = [...eslintFindings, ...metricFindings];

  return computeScore({
    profile,
    threshold,
    findings,
    sloc: Math.max(totalSloc, 1),
    files: files.length,
    tests: totalTests,
    nativeLocators: native,
    rawLocators: raw,
  });
}
