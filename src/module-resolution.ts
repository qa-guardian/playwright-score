import fs from 'node:fs';
import path from 'node:path';
import { findRepoBoundary } from './playwright-config.js';

/**
 * Resolution of NON-relative import specifiers to a file inside the scored
 * repository: tsconfig `paths` / `baseUrl` aliases and workspace packages
 * (package.json `workspaces`, pnpm-workspace.yaml). Everything is read from
 * inside the repository (nearest `.git` ancestor of the importing file, or
 * `boundaryDir` when none), while every FILE an import resolves to must
 * lie inside both that repository and `boundaryDir`, the same boundary the
 * relative resolver enforces. Config is parsed leniently, cached per resolver, and a failure to read or
 * parse anything just means "not resolved" (the caller then behaves as it
 * always did for an unreadable import).
 */

export const RESOLVE_EXTENSIONS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];
export const INDEX_FILES = ['index.ts', 'index.tsx', 'index.js', 'index.jsx', 'index.mts'];

// TypeScript ESM convention: `import './helper.js'` names the emitted file, the
// source on disk is helper.ts / helper.tsx (`.mjs` -> `.mts`, `.cjs` -> `.cts`).
const JS_TO_TS_SOURCE: Record<string, string[]> = {
  '.js': ['.ts', '.tsx'],
  '.jsx': ['.tsx'],
  '.mjs': ['.mts'],
  '.cjs': ['.cts'],
};

/** Candidate files for an absolute base path (no boundary check). */
export function fileCandidates(base: string): string[] {
  const out: string[] = [];
  for (const ext of RESOLVE_EXTENSIONS) out.push(base + ext);
  const jsExt = path.extname(base);
  const tsExts = JS_TO_TS_SOURCE[jsExt];
  if (tsExts) {
    const stem = base.slice(0, -jsExt.length);
    for (const e of tsExts) out.push(stem + e);
  }
  for (const idx of INDEX_FILES) out.push(path.join(base, idx));
  return out;
}

function isInside(boundaryDir: string, candidate: string): boolean {
  const rel = path.relative(boundaryDir, candidate);
  return !(rel.startsWith('..') || path.isAbsolute(rel));
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

export function firstExistingFile(base: string, boundaryDir: string): string | undefined {
  for (const candidate of fileCandidates(base)) {
    if (!isInside(boundaryDir, candidate)) continue;
    if (isFile(candidate)) return candidate;
  }
  return undefined;
}

/** JSON with comments and trailing commas (tsconfig style); undefined when unparseable. */
export function parseLenientJson(text: string): unknown {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
    } else {
      out += ch;
      i++;
    }
  }
  try {
    return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
  } catch {
    return undefined;
  }
}

function readJsonFile(file: string): Record<string, unknown> | undefined {
  try {
    const v = parseLenientJson(fs.readFileSync(file, 'utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

interface PathAlias {
  pattern: string;
  targets: string[];
  base: string;
}
interface TsConfigInfo {
  baseUrl?: string;
  aliases: PathAlias[];
}

const MAX_EXTENDS_DEPTH = 2;

function loadTsConfig(file: string, ceilingDir: string, depth = 0): TsConfigInfo {
  const json = readJsonFile(file);
  const dir = path.dirname(file);
  let info: TsConfigInfo = { aliases: [] };
  if (!json) return info;
  const ext = json.extends;
  if (depth < MAX_EXTENDS_DEPTH) {
    for (const e of Array.isArray(ext) ? ext : ext ? [ext] : []) {
      if (typeof e !== 'string' || !e.startsWith('.')) continue; // package presets live in node_modules
      let target = path.resolve(dir, e);
      if (!target.endsWith('.json')) target += '.json';
      if (!isInside(ceilingDir, target)) continue;
      info = loadTsConfig(target, ceilingDir, depth + 1);
    }
  }
  const co = json.compilerOptions as Record<string, unknown> | undefined;
  if (typeof co?.baseUrl === 'string') info = { ...info, baseUrl: path.resolve(dir, co.baseUrl) };
  if (co?.paths && typeof co.paths === 'object') {
    const base = typeof co.baseUrl === 'string' ? path.resolve(dir, co.baseUrl) : info.baseUrl ?? dir;
    const aliases: PathAlias[] = [];
    for (const [pattern, targets] of Object.entries(co.paths as Record<string, unknown>)) {
      if (Array.isArray(targets)) {
        aliases.push({ pattern, targets: targets.filter((t): t is string => typeof t === 'string'), base });
      }
    }
    info = { ...info, aliases }; // `paths` replaces, never merges, an extended one
  }
  return info;
}

function matchAlias(pattern: string, spec: string): string | undefined {
  const star = pattern.indexOf('*');
  if (star === -1) return pattern === spec ? '' : undefined;
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  if (spec.length >= prefix.length + suffix.length && spec.startsWith(prefix) && spec.endsWith(suffix)) {
    return spec.slice(prefix.length, spec.length - suffix.length);
  }
  return undefined;
}

interface WorkspacePackage {
  dir: string;
  manifest: Record<string, unknown>;
}

function listWorkspaceDirs(root: string, pattern: string): string[] {
  const clean = pattern.replace(/^\.\//, '').replace(/\/+$/, '');
  if (clean.startsWith('!')) return [];
  const segs = clean.split('/');
  let dirs = [root];
  for (const seg of segs) {
    const next: string[] = [];
    for (const d of dirs) {
      if (seg === '*' || seg === '**') {
        try {
          for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            if (e.isDirectory() && e.name !== 'node_modules' && !e.name.startsWith('.')) next.push(path.join(d, e.name));
          }
        } catch {
          // unreadable directory: nothing to add
        }
      } else if (!seg.includes('*')) {
        next.push(path.join(d, seg));
      }
    }
    dirs = next;
  }
  return dirs;
}

function readWorkspacePatterns(root: string): string[] {
  const patterns: string[] = [];
  const pkg = readJsonFile(path.join(root, 'package.json'));
  const ws = pkg?.workspaces;
  const list = Array.isArray(ws) ? ws : Array.isArray((ws as { packages?: unknown })?.packages) ? (ws as { packages: unknown[] }).packages : [];
  for (const p of list) if (typeof p === 'string') patterns.push(p);
  try {
    const yaml = fs.readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8');
    let inPackages = false;
    for (const line of yaml.split(/\r?\n/)) {
      if (/^packages\s*:/.test(line)) inPackages = true;
      else if (/^\S/.test(line)) inPackages = false;
      else if (inPackages) {
        const m = /^\s*-\s*['"]?([^'"#]+?)['"]?\s*(#.*)?$/.exec(line);
        if (m) patterns.push(m[1]);
      }
    }
  } catch {
    // no pnpm workspace file
  }
  return patterns;
}

function packageEntryCandidates(pkg: WorkspacePackage): string[] {
  const m = pkg.manifest;
  const out: string[] = [];
  const fromExport = (v: unknown): void => {
    if (typeof v === 'string') out.push(v);
    else if (v && typeof v === 'object') for (const k of ['types', 'import', 'default', 'require']) fromExport((v as Record<string, unknown>)[k]);
  };
  const exp = m.exports;
  fromExport(exp && typeof exp === 'object' && '.' in (exp as object) ? (exp as Record<string, unknown>)['.'] : exp);
  for (const k of ['source', 'types', 'module', 'main']) if (typeof m[k] === 'string') out.push(m[k] as string);
  out.push('src/index', 'index');
  return out;
}

export type ImportResolver = (fromFile: string, specifier: string) => string | undefined;

/** Resolver for non-relative specifiers (aliases + workspace packages), bounded to `boundaryDir`. */
export function createModuleResolver(boundaryDir: string): ImportResolver {
  const tsconfigByDir = new Map<string, TsConfigInfo | null>();
  const workspacesByRoot = new Map<string, Map<string, WorkspacePackage>>();
  const repoRootByDir = new Map<string, string>();

  // Nearest `.git` ancestor of the importing file (config is read up to
  // there); falls back to the boundary when there is none.
  const repoRootFor = (dir: string): string => {
    let hit = repoRootByDir.get(dir);
    if (hit === undefined) {
      hit = findRepoBoundary(dir, boundaryDir);
      repoRootByDir.set(dir, hit);
    }
    return hit;
  };
  // Resolved files must lie inside both the boundary and the repo.
  const limitFor = (repoRoot: string): string => (isInside(boundaryDir, repoRoot) ? repoRoot : boundaryDir);

  const tsconfigFor = (dir: string, root: string): TsConfigInfo | null => {
    if (tsconfigByDir.has(dir)) return tsconfigByDir.get(dir)!;
    let info: TsConfigInfo | null = null;
    const file = path.join(dir, 'tsconfig.json');
    if (isFile(file)) {
      info = loadTsConfig(file, root);
    } else if (dir !== root && isInside(root, path.dirname(dir))) {
      info = tsconfigFor(path.dirname(dir), root);
    }
    tsconfigByDir.set(dir, info);
    return info;
  };

  const workspaceMap = (root: string): Map<string, WorkspacePackage> => {
    let ws = workspacesByRoot.get(root);
    if (ws) return ws;
    ws = new Map();
    workspacesByRoot.set(root, ws);
    for (const pattern of readWorkspacePatterns(root)) {
      for (const dir of listWorkspaceDirs(root, pattern)) {
        if (!isInside(root, dir)) continue;
        const manifest = readJsonFile(path.join(dir, 'package.json'));
        if (manifest && typeof manifest.name === 'string') ws.set(manifest.name, { dir, manifest });
      }
    }
    return ws;
  };

  const viaWorkspace = (spec: string, root: string, limit: string): string | undefined => {
    const ws = workspaceMap(root);
    if (ws.size === 0) return undefined;
    const parts = spec.split('/');
    const nameLen = spec.startsWith('@') ? 2 : 1;
    const pkg = ws.get(parts.slice(0, nameLen).join('/'));
    if (!pkg) return undefined;
    const sub = parts.slice(nameLen).join('/');
    const bases: string[] = [];
    if (sub) bases.push(path.join(pkg.dir, sub), path.join(pkg.dir, 'src', sub));
    else {
      for (const e of packageEntryCandidates(pkg)) {
        bases.push(path.join(pkg.dir, e));
        // dist/foo.js -> src/foo.ts (built output is rarely checked in)
        const m = /^\.?\/?(?:dist|build|lib)\/(.*)$/.exec(e);
        if (m) bases.push(path.join(pkg.dir, 'src', m[1]));
      }
    }
    for (const b of bases) {
      const hit = firstExistingFile(b, limit);
      if (hit) return hit;
    }
    return undefined;
  };

  return (fromFile, specifier) => {
    if (specifier.startsWith('.') || specifier.startsWith('/') || /^(node:|data:|https?:)/.test(specifier)) return undefined;
    const dir = path.dirname(fromFile);
    const root = repoRootFor(dir);
    const limit = limitFor(root);
    const ts = tsconfigFor(dir, root);
    if (ts) {
      let best: { prefixLen: number; alias: PathAlias; star: string } | undefined;
      for (const alias of ts.aliases) {
        const star = matchAlias(alias.pattern, specifier);
        if (star === undefined) continue;
        const prefixLen = alias.pattern.indexOf('*') === -1 ? alias.pattern.length : alias.pattern.indexOf('*');
        if (!best || prefixLen > best.prefixLen) best = { prefixLen, alias, star };
      }
      if (best) {
        for (const t of best.alias.targets) {
          const hit = firstExistingFile(path.resolve(best.alias.base, t.replace('*', best.star)), limit);
          if (hit) return hit;
        }
      }
      if (ts.baseUrl) {
        const hit = firstExistingFile(path.resolve(ts.baseUrl, specifier), limit);
        if (hit) return hit;
      }
    }
    return viaWorkspace(specifier, root, limit);
  };
}
