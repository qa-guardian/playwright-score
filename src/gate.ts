/**
 * The gate (QAG-287 S9c): `pass` from the states, tiers, families and scopes already in a
 * result. It never re-runs analysis and never changes a finding, a state or the score.
 *
 *   pass = status `scored`, or `partial` with `allowPartial` (`not-scored` never passes)
 *          and no finding or test named by a `failOn` value
 *          and, only when a threshold was given, score >= threshold
 *
 * `passes-regardless` (the default) and `flake-risk` name certain spec-file findings of their
 * families (`flake-risk` also takes the `suite` family: `page.pause()`, a focused test). Such a
 * finding counts when it sits in a counted test (scope `test` on a counted test's key), in a hook
 * in scope for a counted test (named by that test's `chargedBy`), or outside every test
 * (`outsideTests`) in a spec file with at least one counted test. `unasserted` names counted
 * tests in state `unasserted` or `unverified`, whether or not the score charges them. `shared`
 * names certain shared-file findings (scope `shared`) whose `usedBy` lists a spec file with at
 * least one counted test; a shared finding of any other tier never counts. `none` names nothing.
 */
import { compareRefs } from './finding-ref.js';
import { isCounted } from './state-score.js';
import type { Family } from './catalogue/types.js';
import type { FailOn, Finding, FindingRef, GateReason, ScoreOptions, ScoreResult } from './types.js';

/** Every `failOn` value, in the order the result lists them. */
export const FAIL_ON_VALUES: readonly FailOn[] = ['passes-regardless', 'flake-risk', 'unasserted', 'shared', 'none'];
export const DEFAULT_FAIL_ON: readonly FailOn[] = ['passes-regardless'];

const REASON_ORDER: readonly GateReason[] = ['not-scored', 'partial', 'threshold', 'passes-regardless', 'flake-risk', 'unasserted', 'shared'];

/** The finding families each family value names. */
const FAMILIES: Readonly<Record<'passes-regardless' | 'flake-risk', readonly Family[]>> = {
  'passes-regardless': ['passes-regardless'],
  'flake-risk': ['flake-risk', 'suite'],
};

export interface GateSettings {
  failOn: FailOn[];
  allowPartial: boolean;
  /** Undefined when no threshold was given. */
  threshold: number | undefined;
}

/** Why a `failOn` list cannot be used, or undefined when it can. */
export function failOnProblem(values: readonly unknown[]): string | undefined {
  if (values.length === 0) return 'needs at least one value';
  for (const v of values) {
    if (typeof v !== 'string' || !(FAIL_ON_VALUES as readonly string[]).includes(v)) {
      return `has an unknown value ${JSON.stringify(v)} (use ${FAIL_ON_VALUES.join(', ')})`;
    }
  }
  if (values.includes('none') && values.some((v) => v !== 'none')) return 'cannot combine "none" with another value';
  return undefined;
}

/** The items of a comma-separated `--fail-on` value. An empty item is kept, so it is refused. */
export const splitFailOn = (text: string): string[] => text.split(',').map((s) => s.trim());

/**
 * The gate settings of a call, with their defaults. Throws a `RangeError` for an unusable
 * `failOn` or `allowPartial`, so `scorePaths` refuses it before any file is looked at.
 */
export function gateSettings(options: Pick<ScoreOptions, 'failOn' | 'allowPartial' | 'threshold'>): GateSettings {
  const failOn: readonly unknown[] = options.failOn ?? DEFAULT_FAIL_ON;
  if (!Array.isArray(failOn)) throw new RangeError('failOn must be an array of values');
  const problem = failOnProblem(failOn);
  if (problem !== undefined) throw new RangeError(`failOn ${problem}`);
  if (options.allowPartial !== undefined && typeof options.allowPartial !== 'boolean') {
    throw new RangeError('allowPartial must be true or false');
  }
  return {
    failOn: FAIL_ON_VALUES.filter((v) => failOn.includes(v)),
    allowPartial: options.allowPartial === true,
    threshold: options.threshold,
  };
}

const refKey = (r: FindingRef): string => `${r.rule}\u0000${r.form ?? ''}\u0000${r.file}\u0000${r.line ?? ''}\u0000${r.column ?? ''}`;

/**
 * The certain spec-file findings that belong to a counted test: in it, in a hook in scope for it,
 * or outside every test in a spec file with at least one counted test.
 */
function attributedFindings(result: ScoreResult): Finding[] {
  const counted = (result.testStates ?? []).filter(isCounted);
  const keys = new Set(counted.map((e) => e.testKey));
  const files = new Set(counted.map((e) => e.file));
  const byRef = new Map<string, Finding[]>();
  for (const f of result.findings) {
    const k = refKey(f);
    byRef.set(k, [...(byRef.get(k) ?? []), f]);
  }
  const certain = (f: Finding): boolean => f.tier === 'certain' && f.scope !== 'shared';
  const out = new Set<Finding>();
  for (const f of result.findings) if (certain(f) && f.scope === 'test' && f.testKey !== undefined && keys.has(f.testKey)) out.add(f);
  for (const e of counted) {
    for (const r of e.chargedBy ?? []) for (const f of byRef.get(refKey(r)) ?? []) if (certain(f) && f.scope === 'hook') out.add(f);
  }
  for (const r of result.outsideTests ?? []) {
    for (const f of byRef.get(refKey(r)) ?? []) if (certain(f) && files.has(f.file)) out.add(f);
  }
  return [...out].sort(compareRefs);
}

/** The reasons one result does not pass under the given settings; empty when it passes. */
export function gateReasons(result: ScoreResult, settings: GateSettings): GateReason[] {
  const reasons = new Set<GateReason>();
  if (result.status === 'not-scored') reasons.add('not-scored');
  if (result.status === 'partial' && !settings.allowPartial) reasons.add('partial');
  if (settings.threshold !== undefined && !(result.score >= settings.threshold)) reasons.add('threshold');
  const counted = (result.testStates ?? []).filter(isCounted);
  const countedFiles = new Set(counted.map((e) => e.file));
  const attributed = settings.failOn.some((v) => v === 'passes-regardless' || v === 'flake-risk') ? attributedFindings(result) : [];
  for (const value of settings.failOn) {
    if (value === 'passes-regardless' || value === 'flake-risk') {
      const families = FAMILIES[value];
      if (attributed.some((f) => f.family !== undefined && families.includes(f.family))) reasons.add(value);
    } else if (value === 'unasserted') {
      if (counted.some((e) => e.state === 'unasserted' || e.state === 'unverified')) reasons.add(value);
    } else if (value === 'shared') {
      const hit = result.findings.some(
        (f) => f.scope === 'shared' && f.tier === 'certain' && (f.usedBy ?? []).some((spec) => countedFiles.has(spec))
      );
      if (hit) reasons.add(value);
    }
  }
  return REASON_ORDER.filter((r) => reasons.has(r));
}

/** Sets `pass`, `threshold` and `gate` on a result whose states and score are settled. */
export function applyGate(result: ScoreResult, settings: GateSettings): ScoreResult {
  const reasons = gateReasons(result, settings);
  result.pass = reasons.length === 0;
  result.threshold = settings.threshold ?? 0;
  result.gate = {
    failOn: [...settings.failOn],
    allowPartial: settings.allowPartial,
    thresholdApplied: settings.threshold !== undefined,
    reasons,
  };
  return result;
}
