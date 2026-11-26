/**
 * The three test-weakening signals of `pwscore diff` (QAG-289 S2b), for ONE test present on both
 * sides. Pure. Precision first: a signal needs a certain reading of both versions, and an assertion
 * that cannot be paired with certainty is left alone.
 */
import type { AssertionFact, TimeoutFact, TimeoutKind } from './assertions.js';

/**
 * Matcher strength, strongest first. A swap is "weaker" only when both matchers are listed and the
 * head's level is lower. A matcher that is not listed (toBeChecked, toBeNull, custom matchers, ...)
 * is never compared, and two matchers on one level are never a weakening.
 *   4  pins the whole value
 *   3  pins part of the value
 *   2  bounds the value
 *   1  only that something exists
 */
export const MATCHER_STRENGTH: Readonly<Record<string, number>> = {
  toBe: 4, toEqual: 4, toStrictEqual: 4, toHaveText: 4, toHaveValue: 4, toHaveValues: 4, toHaveURL: 4, toHaveTitle: 4,
  toHaveCount: 4, toHaveAttribute: 4, toHaveCSS: 4, toHaveId: 4, toHaveClass: 4, toHaveJSProperty: 4, toHaveLength: 4,
  toContain: 3, toContainText: 3, toContainEqual: 3, toMatch: 3, toMatchObject: 3,
  toBeGreaterThan: 2, toBeGreaterThanOrEqual: 2, toBeLessThan: 2, toBeLessThanOrEqual: 2, toBeCloseTo: 2,
  toBeVisible: 1, toBeAttached: 1, toBeTruthy: 1, toBeDefined: 1,
};

/** Raised when the head's timeout is at least this many times the base's. */
export const TIMEOUT_RAISE_FACTOR = 2;

export interface WeakerMatcher {
  subject: string;
  before: string;
  after: string;
}
export interface ChangedLiteral {
  subject: string;
  matcher: string;
  before: string;
  after: string;
}
export interface RaisedTimeout {
  kind: TimeoutKind;
  target: string;
  before: number;
  after: number;
}
export interface TestSignals {
  weakerMatcher: WeakerMatcher[];
  changedExpectedLiteral: ChangedLiteral[];
  raisedTimeout: RaisedTimeout[];
}

/** A plain literal compares by value (so 'a', "a" and `a` are one), anything else by its normalized text. */
const argKey = (a: AssertionFact, i: number): string => (a.literals[i] !== undefined ? `L${typeof a.literals[i]}:${String(a.literals[i])}` : `T:${a.args[i]}`);
const key = (a: AssertionFact): string => `${a.matcher}(${a.args.map((_, i) => argKey(a, i)).join(', ')})`;
const clip = (s: string): string => (s.length > 120 ? `${s.slice(0, 117)}...` : s);

function bySubject(list: AssertionFact[]): Map<string, AssertionFact[]> {
  const m = new Map<string, AssertionFact[]>();
  for (const a of list) m.set(a.subject, [...(m.get(a.subject) ?? []), a]);
  return m;
}

/** What is left of each side's assertions on a subject after identical ones cancel (so a reorder cancels fully). */
function leftovers(b: AssertionFact[], h: AssertionFact[]): [AssertionFact[], AssertionFact[]] {
  const rest = [...h];
  const onlyBase: AssertionFact[] = [];
  for (const a of b) {
    const i = rest.findIndex((x) => key(x) === key(a));
    if (i >= 0) rest.splice(i, 1);
    else onlyBase.push(a);
  }
  return [onlyBase, rest];
}

export function compareSignals(
  base: { assertions: AssertionFact[]; timeouts: TimeoutFact[] },
  head: { assertions: AssertionFact[]; timeouts: TimeoutFact[] }
): TestSignals {
  const out: TestSignals = { weakerMatcher: [], changedExpectedLiteral: [], raisedTimeout: [] };
  const bs = bySubject(base.assertions);
  const hs = bySubject(head.assertions);
  for (const [subject, bList] of bs) {
    const hList = hs.get(subject);
    if (!hList) continue;
    const [ob, oh] = leftovers(bList, hList);
    // Exactly one changed assertion on each side: the only case where the pairing is not a guess.
    if (ob.length !== 1 || oh.length !== 1) continue;
    const [a, b] = [ob[0]!, oh[0]!];
    if (a.matcher !== b.matcher) {
      const [sa, sb] = [MATCHER_STRENGTH[a.matcher], MATCHER_STRENGTH[b.matcher]];
      if (sa !== undefined && sb !== undefined && sb < sa) out.weakerMatcher.push({ subject: clip(subject), before: a.matcher, after: b.matcher });
      continue;
    }
    if (a.args.length !== b.args.length) continue;
    const before: string[] = [];
    const after: string[] = [];
    let ok = true;
    for (let i = 0; i < a.args.length && ok; i++) {
      if (argKey(a, i) === argKey(b, i)) continue;
      const [la, lb] = [a.literals[i], b.literals[i]];
      if (la === undefined || lb === undefined) ok = false;
      else {
        before.push(String(la));
        after.push(String(lb));
      }
    }
    if (ok && before.length > 0) out.changedExpectedLiteral.push({ subject: clip(subject), matcher: a.matcher, before: clip(before.join(', ')), after: clip(after.join(', ')) });
  }

  // Timeouts pair by what carries them, in source order, and only when both sides have the same number of them.
  const group = (l: TimeoutFact[]): Map<string, TimeoutFact[]> => {
    const m = new Map<string, TimeoutFact[]>();
    for (const t of l) m.set(`${t.kind}\u0000${t.target}`, [...(m.get(`${t.kind}\u0000${t.target}`) ?? []), t]);
    return m;
  };
  const hg = group(head.timeouts);
  for (const [k, bl] of group(base.timeouts)) {
    const hl = hg.get(k);
    if (!hl || hl.length !== bl.length) continue;
    bl.forEach((t, i) => {
      const h = hl[i]!;
      if (t.ms > 0 && h.ms >= TIMEOUT_RAISE_FACTOR * t.ms) out.raisedTimeout.push({ kind: t.kind, target: clip(t.target), before: t.ms, after: h.ms });
    });
  }
  return out;
}
