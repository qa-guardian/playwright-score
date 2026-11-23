import fs from 'node:fs';
import path from 'node:path';
import { findRepoBoundary } from './playwright-config.js';
import {
  isInside,
  listWorkspaceDirs,
  readJsonFile,
  readWorkspacePatterns,
  resolveInPackage,
  type ImportResolver,
  type WorkspacePackage,
} from './module-resolution.js';

/**
 * Resolution of a bare import to a package that lives inside the scored
 * repository but is not a workspace package of the repository root: a suite
 * that keeps its own library next to its specs (`e2e/lib/package.json` named
 * `@acme/e2e-lib`, imported by that name from `e2e/specs/`).
 *
 * The package is found by its `package.json` name. For the importing file's
 * directory and each directory above it, up to the repository root, the
 * packages looked at are, in this order: the directory itself, the workspace
 * packages its own `package.json` or `pnpm-workspace.yaml` declares, and its
 * direct sub-directories (sorted by name). The nearest directory wins. A
 * symlinked directory is never followed, `node_modules` and dot-directories
 * are never read, and the file an import resolves to must lie inside both the
 * repository and `boundaryDir`, as in module-resolution.ts.
 *
 * Used only for the shared-file set (shared-files.ts). The import closure
 * that feeds locator counts, helper names and test aliases is not resolved
 * through this module.
 */
export function createNestedPackageResolver(boundaryDir: string): ImportResolver {
  const rootByDir = new Map<string, string>();
  const packagesByDir = new Map<string, Map<string, WorkspacePackage>>();

  const rootFor = (dir: string): string => {
    let hit = rootByDir.get(dir);
    if (hit === undefined) {
      hit = findRepoBoundary(dir, boundaryDir);
      rootByDir.set(dir, hit);
    }
    return hit;
  };

  const packagesAt = (dir: string): Map<string, WorkspacePackage> => {
    let out = packagesByDir.get(dir);
    if (out) return out;
    out = new Map();
    packagesByDir.set(dir, out);
    const candidates = [dir];
    for (const pattern of readWorkspacePatterns(dir)) candidates.push(...listWorkspaceDirs(dir, pattern).sort());
    try {
      const children = fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && e.name !== 'node_modules' && !e.name.startsWith('.'))
        .map((e) => path.join(dir, e.name));
      candidates.push(...children.sort());
    } catch {
      // unreadable directory: nothing below it is looked at
    }
    for (const candidate of candidates) {
      if (!isInside(dir, candidate)) continue;
      const manifest = readJsonFile(path.join(candidate, 'package.json'));
      if (manifest && typeof manifest.name === 'string' && !out.has(manifest.name)) {
        out.set(manifest.name, { dir: candidate, manifest });
      }
    }
    return out;
  };

  return (fromFile, specifier) => {
    if (specifier.startsWith('.') || specifier.startsWith('/') || /^(node:|data:|https?:)/.test(specifier)) return undefined;
    const parts = specifier.split('/');
    const nameLen = specifier.startsWith('@') ? 2 : 1;
    if (parts.length < nameLen) return undefined;
    const name = parts.slice(0, nameLen).join('/');
    const sub = parts.slice(nameLen).join('/');
    const start = path.dirname(fromFile);
    const root = rootFor(start);
    const limit = isInside(boundaryDir, root) ? root : boundaryDir;
    for (let dir = start; isInside(root, dir); dir = path.dirname(dir)) {
      const pkg = packagesAt(dir).get(name);
      if (pkg) {
        const hit = resolveInPackage(pkg, sub, limit);
        if (hit) return hit;
      }
      if (dir === root || path.dirname(dir) === dir) break;
    }
    return undefined;
  };
}
