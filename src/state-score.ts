/**
 * Score model v5 (QAG-287 S9a): the share of counted tests that are clean, read from the test
 * states (src/test-states.ts), which are never re-derived here.
 *
 *   counted = every test except `excluded-empty` and `excluded-skipped`
 *   charged = the `issue` tests, plus the `unasserted` tests when that cell is certain
 *   score   = round(100 x (counted - charged) / counted)
 *
 * `issue` means a certain spec-file finding in the test or in a hook in scope for it; the entry
 * names those findings (`chargedBy`). `unverified` counts as clean and is always listed. An
 * `unasserted` test is charged only when the `pwscore/unasserted` cell's tier in the committed
 * precision file is `certain`; until then it is listed and clean for the score, and the result
 * says so (`summary.unassertedCharged: false`). A shared-file finding (scope `shared`) never
 * charges a test. A certain spec-file finding outside every test and hook changes no state and
 * not the score; it is listed in `outsideTests`.
 *
 * Status: `not-scored` when no file was found or no test counts and no limit skipped a file
 * (`no-files`, `no-counted-tests`): score 0, grade F, no pass. No test counted and a limit
 * skipped a file: `partial` with reason `limit-reached`, score 0. `partial` and `scored`
 * otherwise as before. `pass` is `score >= threshold` on a `scored` result here; `scorePaths` then
 * replaces it with the gate (src/gate.ts). The `dimensions` are
 * computed as before (src/score-engine.ts) and are informational.
 */
import { defaultRow } from './catalogue/table.js';
import { tierOf } from './catalogue/tiers.js';
import { decideStatus } from './coverage.js';
import { compareRefs, findingRef } from './finding-ref.js';
import { gradeFromScore } from './score-engine.js';
import { UNASSERTED_RULE } from './test-states.js';
import type { Finding, ScoreResult, TestStateEntry } from './types.js';

export const SCORE_VERSION = 'v5' as const;

const EXCLUDED = new Set(['excluded-empty', 'excluded-skipped']);

/** Is an `unasserted` test charged? Only when the catalogue gives its cell the tier `certain`. */
export function unassertedCharged(): boolean {
  const row = defaultRow(UNASSERTED_RULE);
  return row !== undefined && tierOf(row) === 'certain';
}

export const isCounted = (e: TestStateEntry): boolean => !EXCLUDED.has(e.state);

/** Is this counted test charged (not clean for the score)? */
export const isCharged = (e: TestStateEntry, chargeUnasserted: boolean): boolean =>
  e.state === 'issue' || (chargeUnasserted && e.state === 'unasserted');

/** A certain spec-file finding that sits in no test and no hook. */
const outside = (f: Finding): boolean => f.tier === 'certain' && f.scope !== 'test' && f.scope !== 'hook' && f.scope !== 'shared';

/**
 * Sets the v5 score fields on a result whose test states are settled. Without `testStates` (the
 * step's unit-test switch is off) the result is returned unchanged.
 */
export function applyStateScore(result: ScoreResult): ScoreResult {
  const states = result.testStates;
  if (!states) return result;
  const chargeUnasserted = unassertedCharged();
  const counted = states.filter(isCounted);
  const charged = counted.filter((e) => isCharged(e, chargeUnasserted)).length;
  const coverage = result.coverage;
  const { status, reason } = coverage
    ? decideStatus({ ...coverage, testsCounted: counted.length })
    : counted.length === 0
      ? { status: 'not-scored' as const, reason: 'no-counted-tests' as const }
      : { status: 'scored' as const, reason: undefined };
  const score = status === 'not-scored' || counted.length === 0 ? 0 : Math.round((100 * (counted.length - charged)) / counted.length);

  result.scoreVersion = SCORE_VERSION;
  result.score = score;
  result.grade = gradeFromScore(score);
  result.pass = status === 'scored' && score >= result.threshold;
  if (coverage) {
    result.status = status;
    if (reason) result.reason = reason;
    else delete result.reason;
  }
  result.summary.countedTests = counted.length;
  result.summary.chargedTests = charged;
  result.summary.unassertedCharged = chargeUnasserted;
  result.outsideTests = result.findings.filter(outside).map(findingRef).sort(compareRefs);
  result.locators = { native: result.summary.nativeLocators, raw: result.summary.rawLocators, scored: false };
  return result;
}
