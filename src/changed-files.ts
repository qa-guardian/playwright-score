/**
 * `--changed-since <ref>`: which spec files a run covers when only the changed part of a repo is
 * scored. Two halves: `gitChanges` asks git what changed (committed since the merge base with the
 * ref, uncommitted, untracked); `computeScope` is pure and turns that list plus the import graph
 * into the spec files in scope. A spec is in scope when it changed or when anything it imports,
 * directly or through other files, changed. A change to the playwright config, a tsconfig or a lockfile
 * can change how every spec runs or resolves, so it puts every spec in scope (a full run).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { ScopeInfo } from './types.js';

export interface GitChanges {
  /** Real absolute paths of every changed file that still exists (added, modified, untracked). */
  changed: string[];
  /** Real-path-style absolute paths of files deleted (a rename counts as delete + add). */
  deleted: string[];
}

function git(dir: string, args: string[]): string {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 });
}

function tryGit(dir: string, args: string[]): string | undefined {
  try {
    return git(dir, args).trim();
  } catch {
    return undefined;
  }
}

/** The directory git runs in: the first path given (its directory when it is a file), else cwd. */
function repoDirFor(paths: readonly string[], cwd: string): string {
  const first = paths[0];
  if (first === undefined) return cwd;
  const abs = path.resolve(cwd, first);
  try {
    return fs.statSync(abs).isDirectory() ? abs : path.dirname(abs);
  } catch {
    // A glob or a missing path: use its literal leading directory when it exists.
    const lead = abs.split(/[*?{[]/)[0] ?? abs;
    let dir = path.dirname(lead + 'x');
    while (!fs.existsSync(dir) && dir !== path.dirname(dir)) dir = path.dirname(dir);
    return dir;
  }
}

/** What changed since `ref`, or an Error whose message tells the user what to fix. */
export function gitChanges(ref: string, paths: readonly string[], cwd: string): GitChanges {
  if (ref.length === 0 || ref.startsWith('-')) throw new Error(`--changed-since needs a git ref (a branch, a tag or a commit), got "${ref}"`);
  const dir = repoDirFor(paths, cwd);
  const top = tryGit(dir, ['rev-parse', '--show-toplevel']);
  if (!top) throw new Error(`--changed-since needs a git repository: ${path.basename(dir) || dir} is not inside one`);
  const shallow = tryGit(dir, ['rev-parse', '--is-shallow-repository']) === 'true';
  const shallowHint = shallow
    ? ' This is a shallow clone: fetch the history first (git fetch --unshallow, or actions/checkout with fetch-depth: 0).'
    : '';
  if (tryGit(dir, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]) === undefined) {
    throw new Error(`--changed-since: unknown git ref "${ref}".${shallowHint || ' Check the name, or fetch it first (git fetch origin <branch>).'}`);
  }
  const base = tryGit(dir, ['merge-base', ref, 'HEAD']);
  if (!base) {
    throw new Error(`--changed-since: "${ref}" and HEAD share no commit in this clone, so the changes cannot be listed.${shallowHint}`);
  }
  // Working tree against the merge base: committed, staged and unstaged changes in one list.
  // --no-renames: a rename is a delete plus an add, so the new path is scored and the old one is gone.
  const tracked = git(top, ['-c', 'core.quotepath=off', 'diff', '--name-only', '--no-renames', '-z', base]).split('\0');
  const untracked = git(top, ['-c', 'core.quotepath=off', 'ls-files', '--others', '--exclude-standard', '-z']).split('\0');
  const realTop = safeReal(top);
  const changed = new Set<string>();
  const deleted = new Set<string>();
  for (const rel of [...tracked, ...untracked]) {
    if (!rel) continue;
    const abs = path.join(realTop, rel);
    if (fs.existsSync(abs)) changed.add(abs);
    else deleted.add(abs);
  }
  return { changed: [...changed].sort(), deleted: [...deleted].sort() };
}

function safeReal(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

const LOCKFILES = new Set(['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb']);

/** Why this changed file puts every spec in scope, or undefined when it does not. */
export function fullRunReason(file: string): string | undefined {
  const base = path.basename(file);
  if (/^playwright[^/]*\.config\.[cm]?[jt]s$/.test(base)) return `the Playwright config changed (${base})`;
  if (/^[jt]sconfig([.-][^/]*)?\.json$/.test(base)) return `a TypeScript config changed (${base}), which can change how imports resolve`;
  if (LOCKFILES.has(base)) return `a lockfile changed (${base})`;
  return undefined;
}

export interface ScopeInput {
  /** Every spec file found under the scored paths (absolute). */
  specs: readonly string[];
  git: GitChanges;
  /** file -> files it imports (resolved), for every file the traversal visited. */
  edges: ReadonlyMap<string, string[]>;
  /** file -> its import specifiers as written (relative ones are matched against deleted files). */
  specifiers: ReadonlyMap<string, string[]>;
}

export interface ScopeOutcome {
  /** Specs in scope (a subset of `input.specs`, same path spelling). */
  specs: string[];
  /** Set when every spec is in scope because of a config or lockfile change. */
  fallback?: string;
}

/** Specs in scope: changed, or importing (at any depth) a changed or deleted file. Pure. */
export function computeScope(input: ScopeInput): ScopeOutcome {
  const all = [...input.specs].sort();
  // A change outside the scored paths can still be a config: it counts wherever it is.
  for (const f of [...input.git.changed, ...input.git.deleted]) {
    const reason = fullRunReason(f);
    if (reason) return { specs: all, fallback: reason };
  }
  const real = new Map<string, string>();
  const realOf = (f: string): string => {
    let r = real.get(f);
    if (r === undefined) {
      r = safeReal(f);
      real.set(f, r);
    }
    return r;
  };
  const changed = new Set(input.git.changed);
  const noExt = (p: string): string => p.replace(/\.[cm]?[jt]sx?$/, '');
  const deletedBases = new Set(input.git.deleted.flatMap((d) => [d, noExt(d)]));

  // Reverse edges, keyed by real path; a file that imports a deleted path is itself "changed".
  const importers = new Map<string, Set<string>>();
  const touched = new Set<string>();
  const link = (from: string, to: string): void => {
    const set = importers.get(realOf(to)) ?? new Set<string>();
    set.add(from);
    importers.set(realOf(to), set);
  };
  for (const [from, tos] of input.edges) for (const to of tos) link(from, to);
  if (deletedBases.size > 0) {
    for (const [from, specs] of input.specifiers) {
      for (const s of specs) {
        if (!s.startsWith('.')) continue;
        const target = path.resolve(path.dirname(realOf(from)), s);
        if (deletedBases.has(target) || deletedBases.has(noExt(target))) touched.add(from);
      }
    }
  }
  const queue: string[] = [];
  const seen = new Set<string>();
  const push = (f: string): void => {
    const r = realOf(f);
    if (!seen.has(r)) {
      seen.add(r);
      queue.push(r);
    }
  };
  for (const c of changed) push(c);
  for (const t of touched) push(t);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const from of importers.get(cur) ?? []) push(from);
  }
  return { specs: all.filter((s) => seen.has(realOf(s))) };
}

/** The `ScopeInfo` of a run: `files` are made relative to `base` (the scored directory). */
export function scopeInfo(
  ref: string,
  total: number,
  outcome: ScopeOutcome,
  changedFiles: number,
  base: string
): ScopeInfo {
  const files = outcome.specs.map((f) => path.relative(base, f).split(path.sep).join('/')).sort();
  return {
    kind: 'changed-since',
    ref,
    scoped: outcome.fallback === undefined,
    ...(outcome.fallback !== undefined ? { fallback: outcome.fallback } : {}),
    specFiles: outcome.specs.length,
    specFilesTotal: total,
    changedFiles,
    empty: outcome.specs.length === 0,
    files,
  };
}

/** One line for text and markdown output. */
export function scopeLine(scope: ScopeInfo): string {
  const n = (c: number): string => `${c} spec file${c === 1 ? '' : 's'}`;
  if (!scope.scoped) {
    return `Full run, not scoped: ${scope.fallback}, so all ${n(scope.specFilesTotal)} were scored (changed since ${scope.ref}).`;
  }
  if (scope.empty) {
    return `SCOPED to changes since ${scope.ref}: no spec file was changed or affected (0 of ${n(scope.specFilesTotal)}). Nothing to score.`;
  }
  return `SCOPED to changes since ${scope.ref}: ${scope.specFiles} of ${n(scope.specFilesTotal)} scored. This is the score of those files, not of the whole suite.`;
}
