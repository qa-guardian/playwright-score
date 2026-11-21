import type { DimensionName, Finding, ScoreResult } from './types.js';
import {
  compareFindings,
  confidenceOf,
  confidenceRank,
  isNeedsCheck,
  severityRank,
  type Confidence,
} from './confidence.js';
import { GRADE_BANDS } from './score-engine.js';

/** Shared by the HTML report and the terminal output. */

export const INCOMPLETE_NOTE = 'Some checks could not run on this suite; results may be incomplete.';

export const PARSE_ERROR_RULE = 'playwright-score/parse-error';

export const DIMENSIONS: ReadonlyArray<{ key: DimensionName; label: string; meaning: string }> = [
  {
    key: 'playwrightHygiene',
    label: 'Reliability',
    meaning: 'Waits, forced clicks and missing awaits: the habits that make tests fail at random.',
  },
  {
    key: 'assertions',
    label: 'Checks',
    meaning: 'Whether each test actually verifies something, with checks that retry.',
  },
  {
    key: 'locators',
    label: 'Resilience to UI changes',
    meaning: 'How many elements are found the way a user sees them (role, label, test id) rather than by CSS or XPath.',
  },
  {
    key: 'structure',
    label: 'Maintainability',
    meaning: 'Switched-off tests, nesting and file size.',
  },
];

export interface RuleGroup {
  rule: string;
  /** Worst severity among the group's findings. */
  severity: Finding['severity'];
  confidence: Confidence;
  /** Tests affected: distinct tests for test-scoped findings, plus one per file for hook/module-scoped ones. */
  testsAffected: number;
  findings: Finding[];
  /** The occurrence shown as the example (first by severity, file, line). */
  example: Finding;
  dimension: DimensionName;
}

export function groupByRule(findings: readonly Finding[]): RuleGroup[] {
  const byRule = new Map<string, Finding[]>();
  for (const f of findings) {
    const list = byRule.get(f.rule);
    if (list) list.push(f);
    else byRule.set(f.rule, [f]);
  }
  const groups: RuleGroup[] = [];
  for (const [rule, list] of byRule) {
    const sorted = [...list].sort(compareFindings);
    const tests = new Set<string>();
    for (const f of sorted) {
      tests.add(f.scope === 'test' && f.testKey ? f.testKey : `file:${f.file}`);
    }
    groups.push({
      rule,
      severity: sorted[0]!.severity,
      confidence: confidenceOf(sorted[0]!),
      testsAffected: tests.size,
      findings: sorted,
      example: sorted[0]!,
      dimension: sorted[0]!.dimension,
    });
  }
  return groups;
}

/** Severity, then confidence, then tests affected (desc), then rule id. */
export function compareGroups(a: RuleGroup, b: RuleGroup): number {
  return (
    severityRank(a.severity) - severityRank(b.severity) ||
    confidenceRank(a.confidence) - confidenceRank(b.confidence) ||
    b.testsAffected - a.testsAffected ||
    a.rule.localeCompare(b.rule)
  );
}

/** Every rule group, worst first. Never includes needs-check findings. A file that does not parse always leads. */
export function rankGroups(findings: readonly Finding[]): RuleGroup[] {
  const parseFirst = (g: RuleGroup): number => (g.rule === PARSE_ERROR_RULE ? 0 : 1);
  return groupByRule(findings.filter((f) => !isNeedsCheck(f))).sort(
    (a, b) => parseFirst(a) - parseFirst(b) || compareGroups(a, b)
  );
}

/** Up to `max` rule groups. Never includes needs-check findings. */
export function rankTopFindings(findings: readonly Finding[], max = 5): RuleGroup[] {
  return rankGroups(findings).slice(0, max);
}

/**
 * The summary's top three. When the weakest area scores under 75 and none of
 * the three belongs to it, the third slot goes to that area's best-ranked group.
 */
export function summaryTop(all: readonly RuleGroup[], dimensions: ScoreResult['dimensions'], n = 3): RuleGroup[] {
  const top = all.slice(0, n);
  let weakest: DimensionName | undefined;
  let low = 75;
  for (const d of DIMENSIONS) {
    const v = dimensions[d.key];
    if (v !== undefined && v < low) {
      low = v;
      weakest = d.key;
    }
  }
  if (!weakest || top.length < n || top.some((g) => g.dimension === weakest)) return top;
  const swap = all.slice(n).find((g) => g.dimension === weakest);
  if (swap) top[n - 1] = swap;
  return top;
}

/** The file with the most occurrences in the group, with the line of its first one. */
export function mostAffectedFile(g: RuleGroup): { file: string; line?: number; count: number } {
  const counts = new Map<string, { n: number; line?: number }>();
  for (const f of g.findings) {
    const c = counts.get(f.file);
    if (c) c.n++;
    else counts.set(f.file, { n: 1, line: f.line });
  }
  let best: { file: string; line?: number; count: number } | undefined;
  for (const [file, c] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!best || c.n > best.count) best = { file, line: c.line, count: c.n };
  }
  return best!;
}

export function plural(n: number, one: string, many = one + 's'): string {
  return `${n} ${n === 1 ? one : many}`;
}

export type NotScored = 'parse-error' | 'no-tests' | undefined;

export function parseErrorFileCount(result: ScoreResult): number {
  return new Set(result.findings.filter((f) => f.rule === PARSE_ERROR_RULE).map((f) => f.file)).size;
}

export function notScoredState(result: ScoreResult): NotScored {
  if (parseErrorFileCount(result) > 0) return 'parse-error';
  if (result.summary.tests === 0) return 'no-tests';
  return undefined;
}

/** "B means 80-89; A is 90 and up." Built from the engine's own grade bands. */
export function gradeBandText(grade: string, pass: boolean): string {
  const i = GRADE_BANDS.findIndex((b) => b.grade === grade);
  if (i < 0) return '';
  const band = GRADE_BANDS[i]!;
  const range =
    i === 0
      ? `${band.min}-100`
      : band.min === 0
        ? `below ${GRADE_BANDS[i - 1]!.min}`
        : `${band.min}-${GRADE_BANDS[i - 1]!.min - 1}`;
  const first = `${grade} means ${range}`;
  if (i === 0) return `${first}.`;
  const up = GRADE_BANDS[i - 1]!;
  return `${first}; ${up.grade} ${pass ? `is ${up.min} and up` : `starts at ${up.min}`}.`;
}

export function barText(threshold: number, custom: boolean, pass: boolean): string {
  return `${pass ? 'Passes' : 'Below'} ${custom ? 'your' : 'the default'} bar of ${threshold}.`;
}

export function notScoredHeadline(result: ScoreResult): { headline: string; line: string } {
  if (notScoredState(result) === 'parse-error') {
    const n = parseErrorFileCount(result);
    return {
      headline:
        n === 1
          ? '1 file has a syntax error, so this suite could not be scored.'
          : `${n} files have syntax errors, so this suite could not be scored.`,
      line: 'Fix the file below and run the score again. The other findings are shown as a preview.',
    };
  }
  return {
    headline: 'No Playwright tests were found.',
    line: 'Check the path you scored. Files that look like Jest, Vitest or Cypress tests are skipped.',
  };
}

export function cleanCheckCalls(m: string): string | undefined {
  const calls = /it calls (.+?) on an object defined elsewhere/.exec(m);
  return calls?.[1];
}
