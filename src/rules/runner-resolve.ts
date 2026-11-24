import fs from 'node:fs';
import path from 'node:path';
import { isBuiltin } from 'node:module';
import { parseLenientJson, type ImportResolver } from '../module-resolution.js';
import { resolveImportSpecifier } from '../import-graph.js';

/**
 * Rule R: which file does the Playwright test runner load for an import?
 *
 * Written from the runner's own code (Playwright 1.57.0: transform/transform.js,
 * util.js, third_party/tsconfig-loader.js). At every step it considers every
 * file and every config the runner could use, and answers "this file" only
 * when exactly one candidate exists: it counts candidates and never ranks
 * them. Every shape it does not model is `unknown`. It never throws.
 */

export type RunnerUnknownReason = 'module-unresolved' | 'ambiguous-module' | 'runner-config' | 'internal-error';

export type RunnerResolution =
  | { kind: 'file'; path: string }
  | { kind: 'package'; spec: string }
  | { kind: 'builtin'; spec: string }
  | { kind: 'unknown'; reason: RunnerUnknownReason };

export interface RunnerEnv {
  /** The scanned directory; nothing above it is read. */
  boundaryDir: string;
  /** Each check follows symbolic links, as the runner's checks do. */
  isFile(p: string): boolean;
  isDir(p: string): boolean;
  readText(p: string): string | undefined;
  /** The path with every symbolic link resolved; undefined when it cannot be resolved. */
  realPath(p: string): string | undefined;
  /** The lookup the earlier code followed; a file is never followed unless this returns it too. */
  legacyResolve(fromFile: string, spec: string): string | undefined;
}

const EXT8 = ['.js', '.ts', '.jsx', '.tsx', '.cjs', '.mjs', '.cts', '.mts'];

/** The runner's lookup lists (util.js `kExtLookups`), with Node's fall-back extensions in EXT. */
export const RUNNER_LOOKUP: {
  readonly EXT8: readonly string[];
  readonly EXT: readonly string[];
  readonly SWAP: Readonly<Record<string, readonly string[]>>;
} = {
  EXT8,
  EXT: [...EXT8, '.json', '.node'],
  SWAP: { '.js': ['.jsx', '.ts', '.tsx'], '.jsx': ['.tsx'], '.cjs': ['.cts'], '.mjs': ['.mts'] },
};

class Unknown extends Error {
  constructor(readonly reason: RunnerUnknownReason) {
    super(reason);
  }
}

interface RunnerConfig {
  allowJs?: unknown;
  paths?: { mapping: Record<string, unknown>; dir: string };
  baseUrl?: string;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const hasNodeModules = (p: string): boolean => p.split(/[\\/]/).includes('node_modules');
const exists = (env: RunnerEnv, p: string): boolean => env.isFile(p) || env.isDir(p);

function swapped(base: string): string[] {
  const key = Object.keys(RUNNER_LOOKUP.SWAP).find((k) => base.endsWith(k));
  return key ? RUNNER_LOOKUP.SWAP[key].map((o) => base.slice(0, -key.length) + o) : [];
}

/** C(base): every path the runner's lookup or Node's fall-back could load for a base. Used to COUNT. */
export function runnerCandidates(base: string): string[] {
  const index = path.join(base, 'index');
  return [base, ...RUNNER_LOOKUP.EXT.map((e) => base + e), ...swapped(base), index, ...RUNNER_LOOKUP.EXT.map((e) => index + e)];
}

/** RL(base): the runner's own list after a `paths` mapping. Used to decide that the runner MAPS. */
export function runnerMappedList(base: string): string[] {
  const swaps = swapped(base);
  const index = path.join(base, 'index');
  return [base, ...(swaps.length > 0 ? swaps : EXT8.map((e) => base + e)), index, ...EXT8.map((e) => index + e)];
}

// Step R7: Node names every module by its real path, so a path that a link
// moves is not modelled. Relative to the boundary's real path, so a checkout
// below a linked directory still proves.
function sameRealPath(env: RunnerEnv, p: string): boolean {
  const r = env.realPath(p);
  const rb = env.realPath(env.boundaryDir);
  if (r === undefined || rb === undefined) return false;
  return path.relative(rb, r) === path.relative(env.boundaryDir, p);
}

// Steps R2 and R2d: every existing candidate; a directory with a manifest is not modelled.
function fileSet(env: RunnerEnv, base: string): string[] {
  if (env.isDir(base) && env.isFile(path.join(base, 'package.json'))) throw new Unknown('ambiguous-module');
  return [...new Set(runnerCandidates(base))].filter((p) => env.isFile(p));
}

// Step R3a: the first directory, up to the boundary, that has either config file; both count.
function runnerConfigFiles(env: RunnerEnv, startDir: string): string[] {
  let dir = startDir;
  for (;;) {
    const found = ['tsconfig.json', 'jsconfig.json'].map((n) => path.join(dir, n)).filter((f) => env.isFile(f));
    if (found.length > 0) return found;
    const rel = path.relative(env.boundaryDir, dir);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return [];
    const parent = path.dirname(dir);
    if (parent === dir) return [];
    dir = parent;
  }
}

function configPath(env: RunnerEnv, from: string, name: string): string {
  const file = name.endsWith('.json') ? name : name + '.json';
  const dir = path.dirname(from);
  const p = path.resolve(dir, file);
  if (file.includes('/') && file.includes('.') && !exists(env, p)) return path.join(dir, 'node_modules', file);
  return p;
}

// The lenient reader drops a comma before `]` or `}` inside string literals too, where the runner's
// reader keeps it; and it ends a `//` comment only at a line feed, where the runner's also ends it at
// a lone carriage return, U+2028 or U+2029. Such a config is read differently, so it is not modelled.
function commaInsideString(text: string): boolean {
  let i = 0;
  while (i < text.length) {
    if (text[i] === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      if (/,\s*[}\]]/.test(text.slice(i, j + 1))) return true;
      i = j + 1;
    } else if (text[i] === '/' && text[i + 1] === '/') {
      for (; i < text.length && text[i] !== '\n'; i++) {
        if (text[i] === '\u2028' || text[i] === '\u2029' || (text[i] === '\r' && text[i + 1] !== '\n')) return true;
      }
    } else if (text[i] === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
    } else i++;
  }
  return false;
}

// Step R3b: the runner's `innerLoadTsConfig`, line for line. A file that does
// not parse to an object, or a field of the wrong type, is `runner-config`.
function load(env: RunnerEnv, file: string, refs: RunnerConfig[], visited: Map<string, RunnerConfig>): RunnerConfig {
  const seen = visited.get(file);
  if (seen) return seen;
  const result: RunnerConfig = {};
  visited.set(file, result);
  if (!exists(env, file)) return result;
  const text = env.readText(file);
  const json = text === undefined || commaInsideString(text) ? undefined : parseLenientJson(text);
  if (!isPlainObject(json)) throw new Unknown('runner-config');
  const ext = json.extends;
  for (const e of Array.isArray(ext) ? ext : ext ? [ext] : []) {
    if (typeof e !== 'string') throw new Unknown('runner-config');
    const b = load(env, configPath(env, file, e), refs, visited);
    if (b.allowJs !== undefined) result.allowJs = b.allowJs;
    if (b.paths !== undefined) result.paths = b.paths;
    if (b.baseUrl !== undefined) result.baseUrl = b.baseUrl;
  }
  const co = json.compilerOptions;
  if (co !== undefined) {
    if (!isPlainObject(co)) throw new Unknown('runner-config');
    if (co.allowJs !== undefined) result.allowJs = co.allowJs;
    if (co.paths !== undefined) {
      if (!isPlainObject(co.paths)) throw new Unknown('runner-config');
      result.paths = { mapping: co.paths, dir: path.dirname(file) };
    }
    if (co.baseUrl !== undefined) {
      if (typeof co.baseUrl !== 'string') throw new Unknown('runner-config');
      result.baseUrl = path.resolve(path.dirname(file), co.baseUrl);
    }
  }
  const references = json.references;
  if (references) {
    if (!Array.isArray(references)) throw new Unknown('runner-config');
    for (const ref of references) {
      if (!isPlainObject(ref) || typeof ref.path !== 'string') throw new Unknown('runner-config');
      refs.push(load(env, configPath(env, file, ref.path), refs, visited));
    }
  }
  if (path.basename(file) === 'jsconfig.json' && result.allowJs === undefined) result.allowJs = true;
  return result;
}

function loadRunnerConfig(env: RunnerEnv, file: string): RunnerConfig[] {
  const refs: RunnerConfig[] = [];
  const main = load(env, file, refs, new Map());
  return [main, ...refs];
}

// Step R3c: `all` is every existing file of C over every matching key and
// value (the superset); `run` is the part the runner's own list holds.
function hits(env: RunnerEnv, c: RunnerConfig, spec: string, all: Set<string>, run: Set<string>): void {
  const entries: Array<[string, unknown]> = c.paths ? Object.entries(c.paths.mapping) : [];
  if (c.baseUrl !== undefined) entries.push(['*', ['*']]);
  const base = c.baseUrl ?? c.paths?.dir;
  if (base === undefined) return;
  for (const [key, values] of entries) {
    const parts = key.split('*');
    if (parts.length > 2) throw new Unknown('runner-config');
    let m = spec;
    if (parts.length === 1) {
      if (key !== spec) continue;
    } else {
      // As the runner does it (transform.js 139-150); no length check.
      const [pre, suf] = parts;
      if (pre) {
        if (!spec.startsWith(pre)) continue;
        m = m.substring(pre.length, m.length);
      }
      if (suf) {
        if (!spec.endsWith(suf)) continue;
        m = m.substring(0, m.length - suf.length);
      }
    }
    if (!Array.isArray(values) || !values.every((v) => typeof v === 'string')) throw new Unknown('runner-config');
    for (const v of values as string[]) {
      // String.replace with a string pattern, exactly as the runner calls it.
      const b = path.resolve(base, v.replace('*', m));
      const s = fileSet(env, b);
      const list = new Set(runnerMappedList(b));
      for (const f of s) {
        all.add(f);
        if (list.has(f)) run.add(f);
      }
    }
  }
}

function accept(env: RunnerEnv, fromFile: string, spec: string, file: string): RunnerResolution {
  const rel = path.relative(env.boundaryDir, file);
  if (rel.startsWith('..') || path.isAbsolute(rel) || hasNodeModules(file)) throw new Unknown('module-unresolved');
  if (!sameRealPath(env, file)) throw new Unknown('ambiguous-module');
  // No new proof: never follow a file the earlier lookup did not follow.
  if (env.legacyResolve(fromFile, spec) !== file) throw new Unknown('ambiguous-module');
  return { kind: 'file', path: file };
}

function resolve(fromFile: string, spec: string, env: RunnerEnv): RunnerResolution {
  // Step R5: the runner installs no hook for an importer in node_modules.
  if (hasNodeModules(fromFile)) throw new Unknown('module-unresolved');
  if (!sameRealPath(env, fromFile)) throw new Unknown('ambiguous-module');
  // Step R1: specifier class.
  if (spec.startsWith('node:') || isBuiltin(spec)) return { kind: 'builtin', spec };
  if (spec === '.' || spec === '..' || spec.startsWith('./') || spec.startsWith('../')) {
    // Step R2: file lookup.
    const s = fileSet(env, path.resolve(path.dirname(fromFile), spec));
    if (s.length === 0) throw new Unknown('module-unresolved');
    if (s.length > 1) throw new Unknown('ambiguous-module');
    return accept(env, fromFile, spec, s[0]);
  }
  if (path.isAbsolute(spec) || spec.startsWith('#') || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(spec)) throw new Unknown('module-unresolved');
  // Step R3: a bare name goes through the tsconfig mapping.
  const lists = runnerConfigFiles(env, path.dirname(fromFile)).map((m) => loadRunnerConfig(env, m));
  const all = new Set<string>();
  const runOf = new Map<RunnerConfig, Set<string>>();
  for (const list of lists) {
    for (const c of list) {
      const run = runOf.get(c) ?? new Set<string>();
      runOf.set(c, run);
      hits(env, c, spec, all, run);
    }
  }
  if (all.size === 0) {
    // Step R3e: the hook returns nothing and Node resolves the name.
    if (env.legacyResolve(fromFile, spec) !== undefined) throw new Unknown('ambiguous-module');
    return { kind: 'package', spec };
  }
  if (all.size > 1) throw new Unknown('ambiguous-module');
  const [file] = all;
  // Step R3d: the runner skips a config unless the importer is TypeScript or the config allows JS.
  const isTypeScript = fromFile.endsWith('.ts') || fromFile.endsWith('.tsx');
  for (const list of lists) {
    if (!list.some((c) => runOf.get(c)?.has(file) && (isTypeScript || c.allowJs === true))) throw new Unknown('runner-config');
  }
  return accept(env, fromFile, spec, file);
}

export function resolveForRunner(fromFile: string, spec: string, env: RunnerEnv): RunnerResolution {
  try {
    return resolve(fromFile, spec, env);
  } catch (e) {
    return { kind: 'unknown', reason: e instanceof Unknown ? e.reason : 'internal-error' };
  }
}

/** The env over the real file system. Existence checks follow links, as the runner's `fileExists` and `dirExists` do. */
export function realRunnerEnv(boundaryDir: string, moduleResolver?: ImportResolver): RunnerEnv {
  const stat = (p: string): fs.Stats | undefined => {
    try {
      return fs.statSync(p, { throwIfNoEntry: false });
    } catch {
      return undefined;
    }
  };
  const attempt = <T>(f: () => T): T | undefined => {
    try {
      return f();
    } catch {
      return undefined;
    }
  };
  return {
    boundaryDir,
    isFile: (p) => stat(p)?.isFile() === true,
    isDir: (p) => stat(p)?.isDirectory() === true,
    readText: (p) => attempt(() => fs.readFileSync(p, 'utf8')),
    realPath: (p) => attempt(() => fs.realpathSync(p)),
    legacyResolve: (fromFile, spec) => attempt(() => resolveImportSpecifier(fromFile, spec, boundaryDir, moduleResolver)),
  };
}
