/**
 * Compares two scored sides (QAG-289). Pure: no file or git access.
 *
 * A finding is the same finding in both versions when rule, file and test title path agree, so a
 * line shift never makes one new; a rule that fires twice in a test counts twice. A test is the same
 * test when file and title path agree (see METHODOLOGY.md, "Diff: matching tests across versions").
 */
import { alignPaths, matchRenames, rekey } from './align.js';
import { testId, type SideData, type SideFinding } from './side.js';

export interface FileChange {
  file: string;
  /** Null when the file has no counted test on that side (or does not exist there). */
  before: number | null;
  after: number | null;
  /** `before - after` in points; positive is a drop. Null when either side is null. */
  drop: number | null;
}
export interface NewFinding extends SideFinding {
  /** How many more of this rule in this place the head has than the base. */
  extra: number;
}
export interface TestRef {
  file: string;
  test: string[];
}
export interface TestChanges {
  /** Counted in the base, absent from the head. */
  deleted: TestRef[];
  /** Counted in the base, skipped (skip, fixme, skipped describe) in the head. */
  addedSkip: TestRef[];
  /** Matched, counted on both sides, fewer `expect()` calls in the head. */
  assertionsDropped: Array<TestRef & { before: number; after: number }>;
}
export type DiffReason = 'new-certain-findings' | 'score-drop' | 'test-changes' | 'head-not-scored' | 'head-partial' | 'base-partial';
export interface DiffGateSettings {
  /** Undefined: the score does not gate. */
  maxDrop: number | undefined;
  failOnChanges: boolean;
  allowPartial: boolean;
}
export interface DiffResult {
  scoreBefore: number | null;
  scoreAfter: number | null;
  /** `before - after`; null when either side is not scored. */
  scoreDrop: number | null;
  files: FileChange[];
  newFindings: NewFinding[];
  resolvedFindings: SideFinding[];
  /** Certain findings in head files the base did not score (skipped, unreadable): unknown, so not new and not gated with `allowPartial` (without it a partial or skip-holding base fails the diff). */
  unscoredInBase: SideFinding[];
  /** Files matched as moved: the same tests under another path. */
  renamedFiles: Array<{ from: string; to: string }>;
  warnings: string[];
  testChanges: TestChanges;
  pass: boolean;
  reasons: DiffReason[];
}

const findingId = (f: SideFinding): string => `${f.rule}\u0000${f.file}\u0000${f.where}`;
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function surplus(a: SideFinding[], b: SideFinding[]): Array<{ finding: SideFinding; extra: number }> {
  const have = new Map<string, number>();
  for (const f of b) have.set(findingId(f), (have.get(findingId(f)) ?? 0) + 1);
  const total = new Map<string, { first: SideFinding; n: number }>();
  for (const f of a) {
    const t = total.get(findingId(f));
    if (t) t.n++;
    else total.set(findingId(f), { first: f, n: 1 });
  }
  const out: Array<{ finding: SideFinding; extra: number }> = [];
  for (const [id, { first, n }] of total) {
    const extra = n - (have.get(id) ?? 0);
    if (extra > 0) out.push({ finding: first, extra });
  }
  return out.sort((x, y) => cmp(x.finding.file, y.finding.file) || cmp(x.finding.where, y.finding.where) || cmp(x.finding.rule, y.finding.rule));
}

export function compareSides(rawBase: SideData, rawHead: SideData, gate: DiffGateSettings): DiffResult {
  const aligned = alignPaths(rawBase, rawHead);
  const warnings = aligned.warnings;
  const renamedFiles = matchRenames(aligned.base, aligned.head);
  const renameTo = new Map(renamedFiles.map((r) => [r.from, r.to]));
  const base = renameTo.size > 0 ? rekey(aligned.base, (f) => renameTo.get(f) ?? f) : aligned.base;
  const head = aligned.head;
  const scored = (s: SideData): boolean => s.status !== 'not-scored';
  const scoreBefore = scored(base) ? base.score : null;
  const scoreAfter = scored(head) ? head.score : null;
  const scoreDrop = scoreBefore !== null && scoreAfter !== null ? scoreBefore - scoreAfter : null;

  const files: FileChange[] = [];
  for (const file of [...new Set([...base.files.keys(), ...head.files.keys()])].sort()) {
    const before = base.files.get(file)?.score ?? null;
    const after = head.files.get(file)?.score ?? null;
    if (before === after) continue;
    files.push({ file, before, after, drop: before !== null && after !== null ? before - after : null });
  }
  // Largest drop first; a file that lost all its counted tests, or is new, follows by name.
  files.sort((a, b) => (b.drop ?? -Infinity) - (a.drop ?? -Infinity) || cmp(a.file, b.file));

  // Findings in a file the base skipped say nothing about what changed. A file only one side has is
  // an added or deleted file: its findings are new (head side) or resolved (base side). A move is
  // recognised only by matchRenames (the same test keys in both files, then the file is re-keyed
  // above); a hook, shared, module or line-keyed finding has no per-test identity, so it never
  // matches across two different files.
  const baseSkipped = base.skippedFiles ?? new Set<string>();
  const headSkipped = head.skippedFiles ?? new Set<string>();
  const unscoredInBase = head.findings.filter((f) => baseSkipped.has(f.file) && !base.files.has(f.file));
  const unscored = new Set(unscoredInBase);
  const headOnly = (f: SideFinding): boolean => !base.files.has(f.file) && !baseSkipped.has(f.file);
  const baseOnly = (f: SideFinding): boolean => !head.files.has(f.file) && !headSkipped.has(f.file);
  const headSame = head.findings.filter((f) => !headOnly(f) && !unscored.has(f));
  const headAdded = head.findings.filter(headOnly);
  const baseSame = base.findings.filter((f) => !baseOnly(f) && !headSkipped.has(f.file));
  const baseGone = base.findings.filter(baseOnly);
  const newFindings = [...surplus(headSame, baseSame), ...surplus(headAdded, [])]
    .map(({ finding, extra }) => ({ ...finding, extra }))
    .sort((x, y) => cmp(x.file, y.file) || cmp(x.where, y.where) || cmp(x.rule, y.rule));
  const resolvedFindings = [...surplus(baseSame, headSame), ...surplus(baseGone, [])]
    .map(({ finding }) => finding)
    .sort((x, y) => cmp(x.file, y.file) || cmp(x.where, y.where) || cmp(x.rule, y.rule));

  const testChanges: TestChanges = { deleted: [], addedSkip: [], assertionsDropped: [] };
  for (const b of [...base.tests.values()].sort((x, y) => cmp(testId(x.file, x.titlePath), testId(y.file, y.titlePath)))) {
    if (!b.counted) continue;
    const ref: TestRef = { file: b.file, test: b.titlePath };
    const h = head.tests.get(testId(b.file, b.titlePath));
    if (!h) testChanges.deleted.push(ref);
    else if (!h.counted && h.state === 'excluded-skipped') testChanges.addedSkip.push(ref);
    else if (h.counted && b.expects !== undefined && h.expects !== undefined && h.expects < b.expects) {
      testChanges.assertionsDropped.push({ ...ref, before: b.expects, after: h.expects });
    }
  }

  const reasons: DiffReason[] = [];
  if (head.status === 'not-scored') reasons.push('head-not-scored');
  if (head.status === 'partial' && !gate.allowPartial) reasons.push('head-partial');
  if (!gate.allowPartial && (base.status === 'partial' || baseSkipped.size > 0)) reasons.push('base-partial');
  if (newFindings.length > 0) reasons.push('new-certain-findings');
  if (gate.maxDrop !== undefined && scoreDrop !== null && scoreDrop > gate.maxDrop) reasons.push('score-drop');
  if (gate.failOnChanges && (testChanges.deleted.length > 0 || testChanges.addedSkip.length > 0 || testChanges.assertionsDropped.length > 0)) {
    reasons.push('test-changes');
  }
  return { scoreBefore, scoreAfter, scoreDrop, files, newFindings, resolvedFindings, unscoredInBase, renamedFiles, warnings, testChanges, pass: reasons.length === 0, reasons };
}
