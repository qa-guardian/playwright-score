import type { Finding, FindingRef, ScoreResult } from './types.js';
import type { Tier } from './catalogue/types.js';
import { compareFindings, severityRank } from './confidence.js';
import { copyFor } from './rule-copy.js';
import { notScoredState, PARSE_ERROR_RULE, plural, tierRank, viewTier } from './report-model.js';

export { tierRank, viewTier } from './report-model.js';

/**
 * QAG-287 S10a: what the text, markdown and HTML outputs show, by tier, inside
 * the noise budget. Formatters only render this; the JSON output never goes
 * through it and always carries every finding.
 *
 * - certain: the first section; likely: "worth a look" after it.
 * - needs-check: one count line; the reasons with `--advice`.
 * - advisory: hidden behind one count line; shown with `--advice`.
 * Findings are hidden by tier, never by form name.
 */

/** AC-8. A finding past a limit is counted in an "and N more", never dropped from JSON. */
export const NOISE_BUDGET = {
  /** Locations shown per file, across every group. */
  perFile: 5,
  /** Locations shown per rule group. */
  perGroup: 3,
  /** Rule groups shown per run (text and HTML report). */
  groups: 15,
  /** Rule groups shown in the markdown PR comment. */
  markdownGroups: 10,
} as const;

/** Build-state findings: always visible, through the status lines, never in a group. */
export const BUILD_STATE_RULES: readonly string[] = ['playwright-score/no-files', PARSE_ERROR_RULE];

export const isBuildState = (f: Pick<Finding, 'rule'>): boolean => BUILD_STATE_RULES.includes(f.rule);

/** Findings that share a tier, a rule and a form: one catalogue row, so one title, what, why and fix. */
export interface ViewGroup {
  tier: Tier;
  rule: string;
  form?: string;
  title: string;
  what?: string;
  why: string;
  fix: string;
  docs?: string;
  /** Every finding of the group, by file, line and column. */
  findings: Finding[];
  /** The locations shown, inside the per-group and per-file limits. */
  shown: Finding[];
  /** findings.length - shown.length. */
  more: number;
  /** Distinct tests for test-scoped findings, plus one per file for the others. */
  testsAffected: number;
}

export interface TierView {
  /** Shown groups: certain, then likely, then (with --advice) advisory. */
  groups: ViewGroup[];
  /** Groups past the group limit, and their findings. */
  moreGroups: number;
  moreGroupFindings: number;
  needsCheck: Finding[];
  advisory: Finding[];
  advice: boolean;
  buildState: Finding[];
}

const byPlace = (a: Finding, b: Finding): number =>
  a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0) || (a.column ?? 0) - (b.column ?? 0) || a.rule.localeCompare(b.rule);

function groupOf(list: Finding[]): ViewGroup {
  const findings = [...list].sort(byPlace);
  const head = findings[0]!;
  const legacy = copyFor(head.rule);
  const tests = new Set(findings.map((f) => (f.scope === 'test' && f.testKey ? f.testKey : `file:${f.file}`)));
  return {
    tier: viewTier(head),
    rule: head.rule,
    ...(head.form !== undefined ? { form: head.form } : {}),
    title: head.title ?? legacy.title,
    ...(head.what !== undefined ? { what: head.what } : {}),
    why: head.why ?? legacy.why,
    fix: head.fix ?? legacy.fix,
    ...(head.docs !== undefined ? { docs: head.docs } : {}),
    findings,
    shown: [],
    more: 0,
    testsAffected: tests.size,
  };
}

const worstSeverity = (g: ViewGroup): number => Math.min(...g.findings.map((f) => severityRank(f.severity)));

/** Tier, then severity, then tests affected and size (desc), then rule and form. Total and stable. */
export function compareViewGroups(a: ViewGroup, b: ViewGroup): number {
  return (
    tierRank(a.tier) - tierRank(b.tier) ||
    worstSeverity(a) - worstSeverity(b) ||
    b.testsAffected - a.testsAffected ||
    b.findings.length - a.findings.length ||
    a.rule.localeCompare(b.rule) ||
    (a.form ?? '').localeCompare(b.form ?? '')
  );
}

export function buildView(result: ScoreResult, opts: { advice?: boolean; maxGroups?: number } = {}): TierView {
  const advice = opts.advice === true;
  const buildState = result.findings.filter(isBuildState).sort(byPlace);
  // A not-scored run without tests has no groups: its findings may carry the working directory as their file.
  const rest = notScoredState(result) === 'no-tests' ? [] : result.findings.filter((f) => !isBuildState(f));
  const needsCheck = rest.filter((f) => viewTier(f) === 'needs-check').sort(compareFindings);
  const advisory = rest.filter((f) => viewTier(f) === 'advisory');
  const byKey = new Map<string, Finding[]>();
  for (const f of rest) {
    const t = viewTier(f);
    if (t === 'needs-check' || (t === 'advisory' && !advice)) continue;
    const key = `${t}\u0000${f.rule}\u0000${f.form ?? ''}`;
    const list = byKey.get(key);
    if (list) list.push(f);
    else byKey.set(key, [f]);
  }
  const all = [...byKey.values()].map(groupOf).sort(compareViewGroups);
  const groups = all.slice(0, opts.maxGroups ?? NOISE_BUDGET.groups);
  const perFile = new Map<string, number>();
  for (const g of groups) {
    for (const f of g.findings) {
      if (g.shown.length >= NOISE_BUDGET.perGroup) break;
      const n = perFile.get(f.file) ?? 0;
      if (n >= NOISE_BUDGET.perFile) continue;
      perFile.set(f.file, n + 1);
      g.shown.push(f);
    }
    g.more = g.findings.length - g.shown.length;
  }
  const hidden = all.slice(groups.length);
  return {
    groups,
    moreGroups: hidden.length,
    moreGroupFindings: hidden.reduce((n, g) => n + g.findings.length, 0),
    needsCheck,
    advisory,
    advice,
    buildState,
  };
}

const refKey = (r: FindingRef): string => `${r.rule}\u0000${r.form ?? ''}\u0000${r.file}\u0000${r.line ?? ''}\u0000${r.column ?? ''}`;

/** Measured-certain shared findings (ADR D2): certain, in a shared file, and quotable. */
export function measuredSharedFindings(result: ScoreResult): Finding[] {
  return result.findings.filter((f) => f.scope === 'shared' && f.tier === 'certain' && f.quotable === true);
}

/**
 * Line 1 of the text and markdown output (ADR S10a):
 * "86 tests. 79 have no certain issue. 2 would pass whatever the app does. 5 have flake risk.
 * 3 have no assertion. 2 certain issues in shared code (used by 4 spec files)."
 *
 * - "no certain issue": tests whose state is not `issue`.
 * - "would pass whatever the app does" / "flake risk": `issue` tests charged by a certain finding
 *   of that family (a test charged by both counts in both).
 * - "no assertion": tests in state `unasserted`, whether or not the score charges them.
 * - shared: measured-certain shared findings only, and the spec files that use them.
 * A clause whose count is 0 is left out; the test count always stays. Without test states
 * (a result not built by scorePaths) only the test count and the shared clause are given.
 */
export function headlineText(result: ScoreResult): string {
  const tests = result.summary.tests;
  const parts = [`${plural(tests, 'test')}.`];
  const states = result.testStates;
  if (states) {
    const family = new Map<string, string | undefined>();
    for (const f of result.findings) {
      if (f.tier === 'certain') family.set(refKey({ rule: f.rule, form: f.form, file: f.file, line: f.line, column: f.column }), f.family);
    }
    const issue = states.filter((s) => s.state === 'issue');
    const charged = (fam: string): number =>
      issue.filter((s) => (s.chargedBy ?? []).some((r) => family.get(refKey(r)) === fam)).length;
    const clean = tests - issue.length;
    const regardless = charged('passes-regardless');
    const flake = charged('flake-risk');
    const unasserted = states.filter((s) => s.state === 'unasserted').length;
    if (clean > 0) parts.push(`${clean} ${clean === 1 ? 'has' : 'have'} no certain issue.`);
    if (regardless > 0) parts.push(`${regardless} would pass whatever the app does.`);
    if (flake > 0) parts.push(`${flake} ${flake === 1 ? 'has' : 'have'} flake risk.`);
    if (unasserted > 0) parts.push(`${unasserted} ${unasserted === 1 ? 'has' : 'have'} no assertion.`);
  }
  const shared = measuredSharedFindings(result);
  if (shared.length > 0) {
    const specs = new Set(shared.flatMap((f) => f.usedBy ?? []));
    parts.push(`${plural(shared.length, 'certain issue')} in shared code (used by ${plural(specs.size, 'spec file')}).`);
  }
  return parts.join(' ');
}

/** "not-scored names its reason": the reason in plain words. */
export const NOT_SCORED_REASON_TEXT: Record<string, string> = {
  'no-files': 'no Playwright files were found',
  'no-counted-tests': 'no test could be counted',
  'limit-reached': 'a time or memory limit was reached first',
};

/** First `max` items as text, then "and N more". */
export function listWithMore(items: readonly string[], max = NOISE_BUDGET.perFile): string {
  const shown = items.slice(0, max).join(', ');
  return items.length > max ? `${shown} and ${items.length - max} more` : shown;
}

export const loc = (f: { file: string; line?: number }): string => (f.line ? `${f.file}:${f.line}` : f.file);

/** Build-state lines: every syntax error, whatever the budget left (no-files: see below). */
export function buildStateLines(view: TierView): string[] {
  const lines: string[] = [];
  const parse = view.buildState.filter((f) => f.rule === PARSE_ERROR_RULE);
  if (parse.length) {
    lines.push(`Syntax error${parse.length === 1 ? '' : 's'} (${plural(parse.length, 'file')}, not scored): ${listWithMore(parse.map(loc))}.`);
  }
  // A no-files finding is always a not-scored run: its not-scored lines say so. Its message is not
  // repeated, because it echoes the paths given, which may be absolute.
  return lines;
}

/** The outside-any-test line: certain spec findings that charge no test. */
export function outsideTestsLine(result: ScoreResult): string | undefined {
  const refs = result.outsideTests ?? [];
  if (!refs.length) return undefined;
  return `Outside any test (they charge no test): ${plural(refs.length, 'certain finding')}: ${listWithMore(refs.map(loc))}.`;
}

export function needsCheckLine(view: TierView): string | undefined {
  const n = view.needsCheck.length;
  if (!n) return undefined;
  const files = new Set(view.needsCheck.map((f) => f.file)).size;
  return `Not decided automatically: ${plural(n, 'finding')} in ${plural(files, 'file')}, ${view.advice ? 'reasons below' : 'run with --advice for the reasons'}.`;
}

export function advisoryLine(view: TierView): string | undefined {
  const n = view.advisory.length;
  if (!n) return undefined;
  return view.advice
    ? `Advisory: ${plural(n, 'finding')}, listed with the groups above.`
    : `Advisory: ${plural(n, 'finding')} hidden. Run with --advice to show them.`;
}

/** Needs-check reasons for --advice: at most the group budget of lines, inside the per-file limit. */
export function needsCheckReasons(view: TierView, max: number = NOISE_BUDGET.groups): { lines: string[]; more: number } {
  const perFile = new Map<string, number>();
  const lines: string[] = [];
  for (const f of view.needsCheck) {
    if (lines.length >= max) break;
    const n = perFile.get(f.file) ?? 0;
    if (n >= NOISE_BUDGET.perFile) continue;
    perFile.set(f.file, n + 1);
    lines.push(`${loc(f)}: ${f.message}`);
  }
  return { lines, more: view.needsCheck.length - lines.length };
}
