/**
 * `playwright-score diff <base> <head>` (QAG-289): argument parsing, the run and the two output forms.
 * cli.ts calls `runDiff` and returns its exit code.
 */
import fs from 'node:fs';
import path from 'node:path';
import { FLAGS, optionsHelp, parseArgs, type CliOptions } from '../cli-args.js';
import { compareSides, type DiffResult, type DiffReason } from './compare.js';
import { DiffUsageError, resolveSide, scoreSide, type ResolvedSide, type SideData } from './side.js';

/** The options only `diff` has; the README names them next to the scoring flags. */
export const DIFF_FLAGS: readonly string[] = ['--json', '--max-drop', '--path', '--fail-on-changes'];
/** Scoring options that have no meaning for a diff. */
const REFUSED = new Set(['--threshold', '--fail-on', '--markdown-out', '--name', '--advice']);

export const DIFF_HELP = `playwright-score diff — what a change did to the spec quality score

Usage:
  npx pwscore diff <base> <head> [options]

<base> and <head> are each a directory or a git ref of the repository you run
this in (a branch, tag or commit: it is exported with git archive; the working
tree is never touched). Both are scored with the same options. Reports the
score before and after, certain findings the head introduces, the score drop
per file and tests that were deleted, skipped, lost assertions, got a weaker
matcher or a raised timeout (changed expected values are listed for review).

Options:
  --json                      JSON output (same as --format json)
  --max-drop <n>              Also fail when the score drops by more than n points
  --path <dir>                Score this folder of each side (default: the folder
                              you run in, for a git ref; the directory itself)
  --fail-on-changes           Also fail on a deleted test, an added skip or fixme,
                              fewer assertions, a weaker matcher or a timeout
                              raised 2x or more in a test
${optionsHelp()
  .split('\n')
  .filter((l) => !/^ {2}--(threshold|fail-on|markdown-out|name|advice)\b/.test(l))
  .join('\n')}

Exit codes:
  0  no certain finding is new in <head>, the score did not drop past
     --max-drop (when given), and <head> was scored
  1  a gate above failed, or <head> is not scored (or partial without
     --allow-partial)
  2  tool or usage error (unknown option or ref, a side that cannot be read)
`;

interface DiffArgs {
  base: string;
  head: string;
  json: boolean;
  out?: string;
  maxDrop?: number;
  path?: string;
  failOnChanges: boolean;
  scoring: CliOptions;
}

export function parseDiffArgs(args: readonly string[]): DiffArgs | { error: string } {
  const positional: string[] = [];
  const rest: string[] = [];
  let json = false;
  let maxDrop: number | undefined;
  let subPath: string | undefined;
  let failOnChanges = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--json') json = true;
    else if (a === '--fail-on-changes') failOnChanges = true;
    else if (a === '--max-drop' || a === '--path') {
      const v = args[++i];
      if (v === undefined) return { error: `${a} needs a value` };
      if (a === '--path') subPath = v;
      else {
        const n = Number(v);
        if (v.trim() === '' || !Number.isFinite(n) || n < 0 || n > 100) return { error: `--max-drop must be a number from 0 to 100, got "${v}"` };
        maxDrop = n;
      }
    } else if (REFUSED.has(a)) return { error: `${a} does not apply to diff` };
    else if (a.startsWith('-') && a !== '-') {
      rest.push(a);
      const flag = FLAGS.find((f) => f.names.includes(a));
      if (flag?.value !== undefined && i + 1 < args.length) rest.push(args[++i]!);
    } else positional.push(a);
  }
  if (positional.length !== 2) return { error: 'diff needs exactly two arguments: <base> <head> (a directory or a git ref each)' };
  const parsed = parseArgs([...rest, '.']);
  if ('error' in parsed) return parsed;
  const scoring = parsed.options;
  if (scoring.format !== 'text' && scoring.format !== 'json') return { error: `--format ${scoring.format} is not available for diff (use text or json)` };
  return {
    base: positional[0]!,
    head: positional[1]!,
    json: json || scoring.format === 'json',
    ...(scoring.out !== undefined ? { out: scoring.out } : {}),
    ...(maxDrop !== undefined ? { maxDrop } : {}),
    ...(subPath !== undefined ? { path: subPath } : {}),
    failOnChanges,
    scoring,
  };
}

const sideSummary = (label: string, kind: string, s: SideData) => ({
  label,
  kind,
  status: s.status ?? 'scored',
  score: s.status === 'not-scored' ? null : s.score,
  grade: s.status === 'not-scored' ? null : s.grade,
  countedTests: s.countedTests,
  chargedTests: s.chargedTests,
});

/** The JSON document. Additive changes only: `diffVersion` moves on a break. */
export function diffJson(base: ResolvedSide, head: ResolvedSide, b: SideData, h: SideData, d: DiffResult, a: DiffArgs): unknown {
  return {
    diffVersion: 1,
    base: sideSummary(base.label, base.kind, b),
    head: sideSummary(head.label, head.kind, h),
    scoreBefore: d.scoreBefore,
    scoreAfter: d.scoreAfter,
    scoreDrop: d.scoreDrop,
    files: d.files,
    newFindings: d.newFindings,
    resolvedFindings: d.resolvedFindings,
    testChanges: d.testChanges,
    gate: { pass: d.pass, reasons: d.reasons, maxDrop: a.maxDrop ?? null, failOnChanges: a.failOnChanges },
  };
}

const num = (n: number | null): string => (n === null ? 'n/a' : String(n));
const where = (f: { file: string; test: string[] }): string => `${f.file} > ${f.test.join(' > ')}`;
const REASON_TEXT: Record<DiffReason, string> = {
  'new-certain-findings': 'the head introduces certain findings',
  'score-drop': 'the score dropped past --max-drop',
  'test-changes': 'tests were deleted, skipped, lost assertions, got a weaker matcher or a raised timeout (--fail-on-changes)',
  'head-not-scored': 'the head is not scored (no files, or no counted test)',
  'head-partial': 'the head is partial: a file was skipped (use --allow-partial to accept)',
};

export function diffText(base: ResolvedSide, head: ResolvedSide, b: SideData, h: SideData, d: DiffResult): string {
  const L: string[] = [];
  L.push(`Score: ${num(d.scoreBefore)} -> ${num(d.scoreAfter)}${d.scoreDrop !== null && d.scoreDrop !== 0 ? ` (${d.scoreDrop > 0 ? '-' : '+'}${Math.abs(d.scoreDrop)})` : ''}`);
  L.push(`  base ${base.label}: ${b.countedTests} counted tests, ${b.chargedTests} charged (${b.status})`);
  L.push(`  head ${head.label}: ${h.countedTests} counted tests, ${h.chargedTests} charged (${h.status})`);
  if (b.status !== 'scored') L.push('  note: the base is not fully scored, so findings it hides can show as new');
  L.push('');
  L.push(`New certain findings: ${d.newFindings.length}`);
  for (const f of d.newFindings) {
    L.push(`  ${f.file}${f.line !== undefined ? `:${f.line}` : ''}  ${f.rule}${f.extra > 1 ? ` (x${f.extra})` : ''}`);
    L.push(`    ${f.where}: ${f.message}`);
  }
  if (d.resolvedFindings.length > 0) L.push(`Resolved certain findings: ${d.resolvedFindings.length}`);
  L.push('');
  L.push(`Files with a different score: ${d.files.length}`);
  for (const f of d.files) {
    L.push(`  ${f.file}: ${num(f.before)} -> ${num(f.after)}${f.drop !== null && f.drop !== 0 ? ` (${f.drop > 0 ? '-' : '+'}${Math.abs(f.drop)})` : ''}`);
  }
  const t = d.testChanges;
  L.push('');
  L.push(`Test changes: ${t.deleted.length} deleted, ${t.addedSkip.length} newly skipped, ${t.assertionsDropped.length} with fewer assertions, ${t.weakerMatcher.length} with a weaker matcher, ${t.raisedTimeout.length} with a raised timeout`);
  for (const x of t.deleted) L.push(`  deleted: ${where(x)}`);
  for (const x of t.addedSkip) L.push(`  skipped: ${where(x)}`);
  for (const x of t.assertionsDropped) L.push(`  assertions ${x.before} -> ${x.after}: ${where(x)}`);
  for (const x of t.weakerMatcher) L.push(`  weaker matcher ${x.before} -> ${x.after} on ${x.subject}: ${where(x)}`);
  for (const x of t.raisedTimeout) L.push(`  timeout ${x.before} -> ${x.after} ms (${x.target}): ${where(x)}`);
  if (t.changedExpectedLiteral.length > 0) L.push(`Expected values changed (review, not a gate): ${t.changedExpectedLiteral.length}`);
  for (const x of t.changedExpectedLiteral) L.push(`  ${x.matcher} on ${x.subject}: '${x.before}' -> '${x.after}': ${where(x)}`);
  L.push('');
  L.push(d.pass ? 'PASS' : `FAIL: ${d.reasons.map((r) => REASON_TEXT[r]).join('; ')}`);
  return L.join('\n');
}

/** Runs the command; returns the exit code (0 pass, 1 gate failed, 2 tool or usage error). */
export async function runDiff(args: readonly string[]): Promise<number> {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(DIFF_HELP);
    return 0;
  }
  const a = parseDiffArgs(args);
  if ('error' in a) {
    console.error(a.error);
    return 2;
  }
  const sides: ResolvedSide[] = [];
  try {
    const cwd = process.cwd();
    sides.push(resolveSide(a.base, cwd, a.path));
    sides.push(resolveSide(a.head, cwd, a.path));
    const [base, head] = sides as [ResolvedSide, ResolvedSide];
    const { profile, maxSeconds, maxHeapMb, shared, allowPartial } = a.scoring;
    const opts = { profile, maxSeconds, maxHeapMb, shared, allowPartial };
    // One after the other: both are as heavy as a normal run and the scorer is not built to overlap.
    const b = await scoreSide(base, opts);
    const h = await scoreSide(head, opts);
    const d = compareSides(b, h, { maxDrop: a.maxDrop, failOnChanges: a.failOnChanges, allowPartial });
    const body = a.json ? JSON.stringify(diffJson(base, head, b, h, d, a), null, 2) : diffText(base, head, b, h, d);
    if (a.out) {
      fs.mkdirSync(path.dirname(path.resolve(a.out)), { recursive: true });
      fs.writeFileSync(a.out, body + '\n', 'utf8');
    } else console.log(body);
    return d.pass ? 0 : 1;
  } catch (err) {
    console.error(err instanceof DiffUsageError || err instanceof Error ? err.message : String(err));
    return 2;
  } finally {
    for (const s of sides) s.cleanup();
  }
}
