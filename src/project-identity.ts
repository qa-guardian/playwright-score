/**
 * QAG-287 S3c: is the scanned project the Playwright implementation?
 *
 * The check reads exactly three manifests, starting from P, the nearest
 * `package.json` at or above the scanned root (never above the repository
 * root, the directory that holds `.git`):
 *
 *   1. the `name` of P;
 *   2. the `name` of each `package.json` that P's `workspaces` globs match on disk;
 *   3. the `package-lock.json` beside P: a `packages["node_modules/<name>"]`
 *      entry with `link: true`, npm's marker for a workspace package.
 *
 * It matches when any of them gives `playwright`, `playwright-core` or
 * `@playwright/test`. A project that depends on these packages has registry
 * entries in its lockfile, not `link: true` entries, so it never matches. Other
 * lockfile formats are not read. Nothing here throws: a manifest that is
 * missing, too large or malformed is a manifest that does not match.
 *
 * On a match, the findings of the discouraged-API rules move to form
 * `api-under-test`. No finding is added, removed or otherwise changed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { globSync } from 'glob';
import type { Finding } from './types.js';
import { rowsOf } from './catalogue/table.js';
import { isInside } from './module-resolution.js';
import { findRepoBoundary } from './playwright-config.js';
import { API_UNDER_TEST_FORM, API_UNDER_TEST_RULES, PLAYWRIGHT_PACKAGE_NAMES } from './catalogue/api-under-test.js';

/** Test switch: off, every finding keeps the form it had. */
export const apiUnderTest = { enabled: true };

const MAX_PACKAGE_JSON_BYTES = 1024 * 1024;
const MAX_LOCKFILE_BYTES = 64 * 1024 * 1024;
const MAX_WORKSPACE_MANIFESTS = 5000;

export type IdentityManifest = 'name' | 'workspace' | 'lockfile';
export interface ProjectIdentity {
  /** The nearest package.json at or above the scanned root, when there is one. */
  packageJson?: string;
  /** Which manifest gave a Playwright package name; undefined when none did. */
  matchedBy?: IdentityManifest;
}

const isPlaywrightName = (name: unknown): boolean => typeof name === 'string' && PLAYWRIGHT_PACKAGE_NAMES.includes(name);

function readJson(file: string, maxBytes: number): unknown {
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > maxBytes) return undefined;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The nearest package.json at or above `root`. The walk stops at the repository root (see findRepoBoundary). */
export function nearestPackageJson(root: string): string | undefined {
  const start = path.resolve(root);
  const boundary = findRepoBoundary(start);
  for (let dir = start; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'package.json');
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      /* not here */
    }
    if (dir === boundary || path.dirname(dir) === dir) return undefined;
  }
}

/** The workspace globs of a package.json: an array, or an object with a `packages` array. */
function workspaceGlobs(pkg: Record<string, unknown>): string[] {
  const w = pkg.workspaces;
  const list = Array.isArray(w) ? w : isRecord(w) && Array.isArray(w.packages) ? w.packages : [];
  return list.filter((g): g is string => typeof g === 'string' && g.trim() !== '');
}

/** A glob that stays inside the project: relative, with no `..` segment. */
const staysInside = (g: string): boolean => !path.isAbsolute(g) && !/^[a-zA-Z]:/.test(g) && !g.split(/[\\/]/).includes('..');
const manifestGlob = (g: string): string => `${g.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')}/package.json`;

/** The package.json files that the `workspaces` globs of P match on disk, inside P's directory. */
function workspaceManifests(projectDir: string, globs: string[]): string[] {
  const include = globs.filter((g) => !g.startsWith('!') && staysInside(g)).map(manifestGlob);
  const exclude = globs.filter((g) => g.startsWith('!') && staysInside(g.slice(1))).map((g) => manifestGlob(g.slice(1)));
  if (include.length === 0) return [];
  let realProject: string;
  let found: string[];
  try {
    realProject = fs.realpathSync(projectDir);
    found = globSync(include, { cwd: projectDir, absolute: true, nodir: true, follow: false, ignore: ['**/node_modules/**', ...exclude] });
  } catch {
    return [];
  }
  const inside: string[] = [];
  for (const file of found.sort().slice(0, MAX_WORKSPACE_MANIFESTS)) {
    try {
      const real = fs.realpathSync(file);
      if (real.startsWith(realProject + path.sep)) inside.push(real);
    } catch {
      /* unreadable: not a manifest */
    }
  }
  return inside;
}

function lockfileLinksPlaywright(lockfile: string): boolean {
  const lock = readJson(lockfile, MAX_LOCKFILE_BYTES);
  if (!isRecord(lock) || !isRecord(lock.packages)) return false;
  const packages = lock.packages;
  return PLAYWRIGHT_PACKAGE_NAMES.some((name) => {
    const entry = Object.prototype.hasOwnProperty.call(packages, `node_modules/${name}`) ? packages[`node_modules/${name}`] : undefined;
    return isRecord(entry) && entry.link === true;
  });
}

/** The three-manifest check for one scanned root. */
export function projectIdentity(scanRoot: string): ProjectIdentity {
  try {
    const packageJson = nearestPackageJson(scanRoot);
    if (!packageJson) return {};
    const pkg = readJson(packageJson, MAX_PACKAGE_JSON_BYTES);
    const projectDir = path.dirname(packageJson);
    if (isRecord(pkg)) {
      if (isPlaywrightName(pkg.name)) return { packageJson, matchedBy: 'name' };
      for (const manifest of workspaceManifests(projectDir, workspaceGlobs(pkg))) {
        const member = readJson(manifest, MAX_PACKAGE_JSON_BYTES);
        if (isRecord(member) && isPlaywrightName(member.name)) return { packageJson, matchedBy: 'workspace' };
      }
    }
    if (lockfileLinksPlaywright(path.join(projectDir, 'package-lock.json'))) return { packageJson, matchedBy: 'lockfile' };
    return { packageJson };
  } catch {
    return {};
  }
}

export interface ProjectIdentityContext {
  /** The directory the findings' `file` paths are relative to. */
  filesBase: string;
  /** One directory per input: a scanned directory, or the directory of a scanned file. */
  scanRoots: readonly string[];
}

/**
 * Moves the findings of the discouraged-API rules to form `api-under-test` when the scanned root they sit under is
 * a Playwright package. This form wins over every other form. A finding of a rule with one shape gets that form
 * here, so the new cell never leaves it without one. In place; nothing here throws.
 */
export function applyApiUnderTest(findings: Finding[], ctx: ProjectIdentityContext): void {
  const roots = [...new Set(ctx.scanRoots.map((r) => path.resolve(r)))].sort((a, b) => b.length - a.length);
  const cache = new Map<string, boolean>();
  const matches = (root: string): boolean => {
    let hit = cache.get(root);
    if (hit === undefined) {
      hit = projectIdentity(root).matchedBy !== undefined;
      cache.set(root, hit);
    }
    return hit;
  };
  for (const f of findings) {
    if (!API_UNDER_TEST_RULES.includes(f.rule)) continue;
    if (f.form === undefined) {
      const shapes = rowsOf(f.rule).filter((r) => r.form !== API_UNDER_TEST_FORM);
      if (shapes.length === 1) f.form = shapes[0].form;
    }
    if (!apiUnderTest.enabled || roots.length === 0) continue;
    let under = false;
    try {
      const abs = path.resolve(ctx.filesBase, f.file);
      const root = roots.find((r) => isInside(r, abs));
      // A file outside every scanned root (an imported shared file) follows the scan as a whole.
      under = root !== undefined ? matches(root) : roots.every(matches);
    } catch {
      under = false;
    }
    if (under) f.form = API_UNDER_TEST_FORM;
  }
}
