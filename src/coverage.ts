import path from 'node:path';
import { PARSE_ERROR_RULE } from './report-model.js';
import type { Coverage, Finding, NotScoredReason, ScoreResult, ScoreStatus, SkipReason, SkippedFile } from './types.js';

/**
 * Files found but left out of the score, collected by absolute path while a
 * run goes on and reported relative to the run's base directory.
 */
export class SkipLog {
  private readonly byFile = new Map<string, { reason: SkipReason; detail?: string }>();

  add(absFile: string, reason: SkipReason, detail?: string): void {
    if (!this.byFile.has(absFile)) this.byFile.set(absFile, detail === undefined ? { reason } : { reason, detail });
  }

  has(absFile: string): boolean {
    return this.byFile.has(absFile);
  }

  get size(): number {
    return this.byFile.size;
  }

  files(): string[] {
    return [...this.byFile.keys()].sort();
  }

  report(baseDir: string): SkippedFile[] {
    return this.files().map((abs) => ({
      file: path.relative(baseDir, abs) || path.basename(abs),
      ...this.byFile.get(abs)!,
    }));
  }
}

/** Files (as findings name them) that have a parse-error finding. */
export function parseErrorFiles(findings: Finding[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of findings) {
    if (f.rule !== PARSE_ERROR_RULE || out.has(f.file)) continue;
    out.set(f.file, f.line !== undefined ? `line ${f.line}` : 'syntax error');
  }
  return out;
}

/**
 * Findings that stay in the result when some files did not parse: everything
 * in a scored file, and for a file that did not parse only its parse-error
 * finding (so a caller scoring one file still sees why it was not scored).
 */
export function dropFindingsOfSkipped(findings: Finding[], skippedRelFiles: ReadonlySet<string>): Finding[] {
  if (skippedRelFiles.size === 0) return findings;
  return findings.filter((f) => f.rule === PARSE_ERROR_RULE || !skippedRelFiles.has(f.file));
}

/** Findings the score is computed from: a parse-error finding marks a skipped file, it is not a demerit. */
export function scoredFindings(findings: Finding[]): Finding[] {
  return findings.some((f) => f.rule === PARSE_ERROR_RULE) ? findings.filter((f) => f.rule !== PARSE_ERROR_RULE) : findings;
}

/**
 * Status, in order: `not-scored` with no files or no tests in the scored files, `partial`
 * when a file was skipped, `scored` otherwise.
 */
export function decideStatus(coverage: Coverage): { status: ScoreStatus; reason?: NotScoredReason } {
  if (coverage.filesFound === 0) return { status: 'not-scored', reason: 'no-files' };
  if (coverage.testsCounted === 0) return { status: 'not-scored', reason: 'no-counted-tests' };
  if (coverage.skipped.length > 0) return { status: 'partial' };
  return { status: 'scored' };
}

/**
 * Adds `status`, `reason` and `coverage` to a result. `result.findings` is
 * replaced by `allFindings` (the scored findings plus the parse-error ones),
 * with the summary counts kept in step. A partial or not-scored result never
 * passes.
 */
export function withCoverage(result: ScoreResult, coverage: Coverage, allFindings: Finding[] = result.findings): ScoreResult {
  const { status, reason } = decideStatus(coverage);
  const summary =
    allFindings === result.findings
      ? result.summary
      : {
          ...result.summary,
          findings: allFindings.length,
          errors: allFindings.filter((f) => f.severity === 'error').length,
          warnings: allFindings.filter((f) => f.severity === 'warning').length,
        };
  return {
    ...result,
    pass: status === 'scored' ? result.pass : false,
    summary,
    findings: allFindings,
    status,
    ...(reason ? { reason } : {}),
    coverage,
  };
}
