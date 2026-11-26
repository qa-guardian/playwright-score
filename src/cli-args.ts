/**
 * Command-line options of the CLI: one table (`FLAGS`) parses every option and writes its line
 * in `--help`. A new option is one row. `--version` and `--help` are answered in cli.ts before
 * the table is read; their rows only document them.
 */
import { resolveDotSlashAbsolute } from './fs-util.js';
import { failOnProblem, splitFailOn } from './gate.js';
import { DEFAULT_MAX_HEAP_MB, MAX_MAX_HEAP_MB, MIN_MAX_HEAP_MB } from './isolate.js';
import { limitProblem } from './limits.js';
import type { FailOn, ProfileName } from './types.js';

export type Format = 'text' | 'json' | 'markdown' | 'sarif' | 'report';
const FORMATS: readonly Format[] = ['text', 'json', 'markdown', 'sarif', 'report'];

export interface CliOptions {
  paths: string[];
  profile: ProfileName;
  threshold?: number;
  format: Format;
  out?: string;
  /** Also write the markdown report of the same run to this file. */
  markdownOut?: string;
  name?: string;
  maxSeconds?: number;
  maxHeapMb?: number;
  shared: boolean;
  failOn?: FailOn[];
  allowPartial: boolean;
  advice: boolean;
  /** `--changed-since`: score only what changed since this git ref. */
  changedSince?: string;
}

interface Flag {
  names: string[];
  /** Placeholder of the value in `--help`; absent for an option that takes no value. */
  value?: string;
  help: string[];
  /** Applies the option; returns the message of a usage error (exit 2). */
  apply(o: CliOptions & { failOnRaw: string[] }, value: string | undefined): string | undefined;
}

const GUARDIAN_GONE =
  'Profile "guardian" is no longer public — it was QA Guardian\'s internal house-rules layer, never official Playwright doctrine, and doesn\'t belong in a general-purpose tool. See CHANGELOG.md. Use --profile standard.';
const STRICT_GONE =
  'Profile "strict" was removed in 2.0.0 — the four gameability checks it used to count on top of "standard" (timer-sleep sleeps, coordinate clicks, trivial assertions, soft-assertion-only tests) are now scored under "standard" directly, so a separate stricter profile has nothing left to gate. See CHANGELOG.md. Use --profile standard.';

export const FLAGS: readonly Flag[] = [
  {
    names: ['--profile'],
    value: '<standard>',
    help: ['Scoring profile (default, and only', 'supported value, as of 2.0.0: standard).'],
    apply(o, v) {
      if (v === 'guardian') return GUARDIAN_GONE;
      if (v === 'strict') return STRICT_GONE;
      if (v !== 'standard') return `Invalid profile: ${v}`;
      o.profile = v;
      return undefined;
    },
  },
  {
    names: ['--fail-on'],
    value: '<list>',
    help: [
      'What fails the gate, comma-separated:',
      '  passes-regardless  (default) a certain',
      '    finding that lets a test pass whatever',
      '    the app does',
      '  flake-risk  a certain flake-risk finding,',
      '    or a suite finding (page.pause(), a',
      '    focused test)',
      '  unasserted  a test with no assertion',
      '    found (unasserted or unverified)',
      '  shared  a certain finding in a shared file',
      '    that a spec with a counted test imports',
      '  none  no finding fails the gate',
      'A finding counts when it is in a counted',
      'test, in a hook that runs for one, or',
      'outside every test in a spec file with a',
      'counted test. "none" combines with nothing.',
    ],
    apply(o, v) {
      if (v === undefined) return '--fail-on requires a value';
      o.failOnRaw.push(...splitFailOn(v));
      return undefined;
    },
  },
  {
    names: ['--threshold'],
    value: '<n>',
    help: ['Also fail when the score is below n', '(0-100). Without it the score does not', 'fail the gate.'],
    apply(o, v) {
      const n = Number(v);
      if (Number.isNaN(n) || n < 0 || n > 100) return 'threshold must be 0-100';
      o.threshold = n;
      return undefined;
    },
  },
  {
    names: ['--allow-partial'],
    help: [
      'Let a partial result (a file was skipped)',
      'pass the gate, also one where a limit left',
      'nothing scored (score 0; status says',
      'partial). A not-scored result never passes.',
    ],
    apply(o) {
      o.allowPartial = true;
      return undefined;
    },
  },
  {
    names: ['--advice'],
    help: ['Also show advisory findings, and the reasons for findings not decided', 'automatically, in text, markdown and report output. JSON always has every finding.'],
    apply(o) {
      o.advice = true;
      return undefined;
    },
  },
  {
    names: ['--changed-since'],
    value: '<git-ref>',
    help: [
      'Score only the spec files changed since the',
      'ref (merge base with HEAD, plus uncommitted',
      'and untracked files) and the specs that',
      'import a changed shared file. The result is',
      'labelled SCOPED and its score is that of',
      'those files. A changed playwright config,',
      'tsconfig or lockfile scores every spec.',
      'No changed spec: nothing to score, exit 0.',
    ],
    apply(o, v) {
      if (!v || v.startsWith('-')) return '--changed-since requires a git ref';
      o.changedSince = v;
      return undefined;
    },
  },
  {
    names: ['--format'],
    value: '<text|json|markdown|sarif|report>',
    help: ['Output format (default: text). report is a', 'self-contained one-page HTML suite report.'],
    apply(o, v) {
      if (!(FORMATS as readonly (string | undefined)[]).includes(v)) return `Invalid format: ${v}`;
      o.format = v as Format;
      return undefined;
    },
  },
  {
    names: ['--out', '--output'],
    value: '<file>',
    help: ['Write report to file'],
    apply(o, v) {
      o.out = v;
      return undefined;
    },
  },
  {
    names: ['--markdown-out'],
    value: '<file>',
    help: ['Also write the markdown report to file,', 'from the same run (for example with', '--format json --out <file>).'],
    apply(o, v) {
      if (!v) return '--markdown-out requires a value';
      o.markdownOut = v;
      return undefined;
    },
  },
  {
    names: ['--name'],
    value: '<suite name>',
    help: ['Suite name for the report headline', '(default: the directory basename)'],
    apply(o, v) {
      if (!v) return '--name requires a value';
      o.name = v;
      return undefined;
    },
  },
  {
    names: ['--max-seconds'],
    value: '<n>',
    help: [
      'Time limit for the run. No default: without',
      'it a run is never cut short. Finding the',
      'files always finishes; files not analysed',
      'when the limit passes are skipped.',
    ],
    apply(o, v) {
      o.maxSeconds = Number(v);
      const problem = limitProblem('maxSeconds', o.maxSeconds);
      return problem === undefined ? undefined : `--max-seconds ${problem}`;
    },
  },
  {
    names: ['--max-heap-mb'],
    value: '<n>',
    help: [
      'Heap limit of the analysis worker',
      `(default: ${DEFAULT_MAX_HEAP_MB}, the same on every machine;`,
      `${MIN_MAX_HEAP_MB} to ${MAX_MAX_HEAP_MB}).`,
      'The batch that hits it and every later one',
      'are skipped.',
    ],
    apply(o, v) {
      o.maxHeapMb = Number(v);
      const problem = limitProblem('maxHeapMb', o.maxHeapMb);
      return problem === undefined ? undefined : `--max-heap-mb ${problem}`;
    },
  },
  {
    names: ['--no-shared'],
    help: [
      'Do not check the shared files the specs',
      'import. By default the shared files (page',
      'objects, fixtures, helpers) are checked too;',
      'their findings are listed and never change',
      'the score. --shared restates the default.',
    ],
    apply(o) {
      o.shared = false;
      return undefined;
    },
  },
  {
    names: ['--shared'],
    help: ['Check the shared files (the default).'],
    apply(o) {
      o.shared = true;
      return undefined;
    },
  },
  { names: ['--version', '-v'], help: ['Print version'], apply: () => undefined },
  { names: ['--help', '-h'], help: ['Show help'], apply: () => undefined },
];

const COLUMN = 32;

/** The Options block of `--help`, built from `FLAGS`. */
export function optionsHelp(): string {
  const lines: string[] = [];
  for (const f of FLAGS) {
    const head = `  ${f.names.join(', ')}${f.value ? ` ${f.value}` : ''}`;
    const [first, ...rest] = f.help;
    if (head.length < COLUMN) lines.push(`${head.padEnd(COLUMN)}${first}`);
    else lines.push(head, `${''.padEnd(COLUMN)}${first}`);
    for (const r of rest) lines.push(`${''.padEnd(COLUMN)}${r}`);
  }
  return lines.join('\n');
}

/** Parses the arguments after the command name. An error is a usage error (exit 2). */
export function parseArgs(args: readonly string[]): { options: CliOptions } | { error: string } {
  const o: CliOptions & { failOnRaw: string[] } = {
    paths: [],
    profile: 'standard',
    format: 'text',
    shared: true,
    allowPartial: false,
    advice: false,
    failOnRaw: [],
  };
  let failOnGiven = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    const flag = FLAGS.find((f) => f.names.includes(a));
    if (flag) {
      if (a === '--fail-on') failOnGiven = true;
      const error = flag.apply(o, flag.value !== undefined ? args[++i] : undefined);
      if (error !== undefined) return { error };
    } else if (a.startsWith('-')) {
      return { error: `Unknown option: ${a}` };
    } else {
      o.paths.push(resolveDotSlashAbsolute(a));
    }
  }
  if (failOnGiven) {
    const problem = failOnProblem(o.failOnRaw);
    if (problem !== undefined) return { error: `--fail-on ${problem}` };
  }
  if (o.paths.length === 0) return { error: 'At least one path is required' };
  const { failOnRaw, ...options } = o;
  return { options: failOnGiven ? { ...options, failOn: failOnRaw as FailOn[] } : options };
}
