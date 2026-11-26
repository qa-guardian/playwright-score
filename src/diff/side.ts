/**
 * One side of a diff (QAG-289): a directory or a git ref. A ref is exported with `git archive` into a
 * temporary directory, so the working tree is never touched. Then the side is scored and reduced to
 * what a comparison needs, keyed by paths relative to the side's root so two sides line up.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { scorePaths } from '../index.js';
import { isCharged, isCounted } from '../state-score.js';
import { suiteLabel } from '../suite-name.js';
import { indexTests } from './test-index.js';
import type { AssertionFact, TimeoutFact } from './assertions.js';
import type { ScoreOptions, ScoreResult, TestState } from '../types.js';

export interface ResolvedSide {
  /** Never an absolute local path: the ref as typed, or the directory's short label. */
  label: string;
  kind: 'directory' | 'git-ref';
  /** The directory every relative file name is measured from. */
  root: string;
  /** What is scored: `root` plus the sub path. */
  scoreDir: string;
  cleanup(): void;
}

export class DiffUsageError extends Error {}

const git = (cwd: string, args: string[]): string =>
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** A directory is used in place; anything else must be a git ref of the repository holding `cwd`. */
export function resolveSide(spec: string, cwd: string, subPath: string | undefined): ResolvedSide {
  const abs = path.resolve(cwd, spec);
  let isDir = false;
  try {
    isDir = fs.statSync(abs).isDirectory();
  } catch {
    /* not a path: try it as a ref */
  }
  const sub = (root: string, fallback: string): string => {
    const dir = path.resolve(root, subPath ?? fallback);
    if (path.relative(root, dir).startsWith('..') || path.isAbsolute(subPath ?? '')) {
      throw new DiffUsageError(`--path ${subPath} must be inside the compared directory`);
    }
    return dir;
  };
  if (isDir) {
    return { label: suiteLabel(abs, true), kind: 'directory', root: abs, scoreDir: sub(abs, ''), cleanup: () => undefined };
  }
  if (spec.startsWith('-')) throw new DiffUsageError(`"${spec}" is not a directory or a git ref`);
  let top: string;
  let sha: string;
  let prefix: string;
  try {
    top = git(cwd, ['rev-parse', '--show-toplevel']);
    prefix = git(cwd, ['rev-parse', '--show-prefix']);
    sha = git(cwd, ['rev-parse', '--verify', '--quiet', `${spec}^{commit}`]);
  } catch {
    throw new DiffUsageError(`"${spec}" is not a directory, and not a git ref of the repository in ${path.basename(cwd) || cwd}`);
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pwscore-diff-'));
  const cleanup = (): void => fs.rmSync(tmp, { recursive: true, force: true });
  try {
    const tar = path.join(tmp, '.export.tar');
    const root = path.join(tmp, 'tree');
    fs.mkdirSync(root);
    execFileSync('git', ['-C', top, 'archive', '--format=tar', '-o', tar, sha], { stdio: ['ignore', 'ignore', 'pipe'] });
    execFileSync('tar', ['-xf', tar, '-C', root], { stdio: ['ignore', 'ignore', 'pipe'] });
    fs.rmSync(tar);
    // Without --path, a ref is scored from the same folder of the repository the command runs in.
    return { label: spec, kind: 'git-ref', root, scoreDir: sub(root, prefix), cleanup };
  } catch (err) {
    cleanup();
    if (err instanceof DiffUsageError) throw err;
    throw new Error(`could not export git ref "${spec}": ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
  }
}

export interface SideTest {
  file: string;
  titlePath: string[];
  state: TestState;
  counted: boolean;
  /** `expect()` calls in the test's own body; undefined when the file could not be read. */
  expects?: number;
  /** Read from the test body; undefined when the file could not be read. */
  assertions?: AssertionFact[];
  timeouts?: TimeoutFact[];
}

export interface SideFinding {
  rule: string;
  file: string;
  /** Title path of the test, or `(hook)`, `(module)`, `(shared)`. */
  where: string;
  testPath?: string[];
  line?: number;
  message: string;
}

export interface SideFile {
  counted: number;
  charged: number;
  /** Null when no test of the file counts. */
  score: number | null;
}

export interface SideData {
  status: ScoreResult['status'];
  score: number;
  grade: string;
  countedTests: number;
  chargedTests: number;
  files: Map<string, SideFile>;
  tests: Map<string, SideTest>;
  /** Certain findings only. */
  findings: SideFinding[];
}

const slash = (p: string): string => p.split(path.sep).join('/');
export const testId = (file: string, titlePath: readonly string[]): string => `${file}\u0000${titlePath.join('\u0000')}`;

export async function scoreSide(side: ResolvedSide, options: Omit<ScoreOptions, 'paths'>): Promise<SideData> {
  const result = await scorePaths({ ...options, paths: [side.scoreDir] });
  const base = result.baseDir ?? side.scoreDir;
  const rel = (file: string): string => slash(path.relative(side.root, path.resolve(base, file)));
  const chargeUnasserted = result.summary.unassertedCharged === true;

  const states = result.testStates ?? [];
  const linesByFile = new Map<string, Set<number>>();
  for (const e of states) {
    const set = linesByFile.get(rel(e.file)) ?? new Set<number>();
    set.add(e.line);
    linesByFile.set(rel(e.file), set);
  }
  const tests = new Map<string, SideTest>();
  const byKey = new Map<string, SideTest>();
  const files = new Map<string, SideFile>();
  for (const [file, lines] of linesByFile) {
    let source: string | undefined;
    try {
      source = fs.readFileSync(path.join(side.root, file), 'utf8');
    } catch {
      source = undefined;
    }
    const index = source === undefined ? new Map() : indexTests(source, file, lines);
    let counted = 0;
    let charged = 0;
    for (const e of states.filter((s) => rel(s.file) === file)) {
      const idx = index.get(e.line);
      const test: SideTest = {
        file,
        titlePath: idx?.titlePath ?? [`(test at line ${e.line})`],
        state: e.state,
        counted: isCounted(e),
        ...(idx ? { expects: idx.expects, assertions: idx.assertions, timeouts: idx.timeouts } : {}),
      };
      tests.set(testId(file, test.titlePath), test);
      byKey.set(e.testKey, test);
      if (test.counted) counted++;
      if (test.counted && isCharged(e, chargeUnasserted)) charged++;
    }
    files.set(file, { counted, charged, score: counted === 0 ? null : Math.round((100 * (counted - charged)) / counted) });
  }

  const findings: SideFinding[] = [];
  for (const f of result.findings) {
    if (f.tier !== 'certain') continue;
    const test = f.scope === 'test' && f.testKey !== undefined ? byKey.get(f.testKey) : undefined;
    const where = f.scope === 'shared' ? '(shared)' : f.scope === 'hook' ? '(hook)' : test ? test.titlePath.join(' > ') : '(module)';
    findings.push({
      rule: f.rule,
      file: rel(f.file),
      where,
      ...(test ? { testPath: test.titlePath } : {}),
      ...(f.line !== undefined ? { line: f.line } : {}),
      message: f.title ?? f.message,
    });
  }
  return {
    status: result.status,
    score: result.score,
    grade: result.grade,
    countedTests: result.summary.countedTests ?? 0,
    chargedTests: result.summary.chargedTests ?? 0,
    files,
    tests,
    findings,
  };
}
