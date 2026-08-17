import fs from 'node:fs';
import path from 'node:path';
import { parseForESLint } from '@typescript-eslint/parser';

const RESOLVE_EXTENSIONS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const INDEX_FILES = ['index.ts', 'index.tsx', 'index.js', 'index.jsx'];

// Bounds on the traversal so a large, deep, or circular import graph can't
// blow up cost. Chosen generously relative to real page-object directory
// sizes (verified against n8n's own packages/testing/playwright/pages,
// ~90 files, deepest chain 3) while still being a hard ceiling.
const MAX_DEPTH = 6;
const MAX_FILES = 300;

function extractRelativeImportSpecifiers(source: string, file: string): string[] {
  let ast: { body?: Array<Record<string, unknown>> } | undefined;
  try {
    ast = parseForESLint(source, {
      ecmaVersion: 2022,
      sourceType: 'module',
      ecmaFeatures: { jsx: /\.(tsx|jsx)$/.test(file) },
    }).ast as unknown as { body?: Array<Record<string, unknown>> };
  } catch {
    return [];
  }
  const specifiers: string[] = [];
  for (const node of ast.body ?? []) {
    if (
      node.type !== 'ImportDeclaration' &&
      node.type !== 'ExportNamedDeclaration' &&
      node.type !== 'ExportAllDeclaration'
    ) {
      continue;
    }
    const source_ = node.source as { value?: unknown } | undefined;
    if (typeof source_?.value === 'string' && source_.value.startsWith('.')) {
      specifiers.push(source_.value);
    }
  }
  return specifiers;
}

function resolveRelativeImport(
  fromFile: string,
  specifier: string,
  boundaryDir: string
): string | undefined {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates: string[] = [];
  for (const ext of RESOLVE_EXTENSIONS) candidates.push(base + ext);
  for (const idx of INDEX_FILES) candidates.push(path.join(base, idx));

  for (const candidate of candidates) {
    // Never resolve outside the scanned suite's own directory tree — keeps
    // the traversal bounded to the code actually being scored, and refuses
    // to follow a relative import that climbs out to a sibling package or
    // node_modules via a longer `../../..` chain.
    const rel = path.relative(boundaryDir, candidate);
    if (rel.startsWith('..') || path.isAbsolute(rel)) continue;
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // Candidate doesn't exist — try the next extension/index form.
    }
  }
  return undefined;
}

/**
 * A Page Object Model is common in real Playwright suites: spec files
 * interact with the page entirely through methods on an imported class
 * (`n8n.canvas.clickZoomToFitButton()`), and the actual `getByRole()` /
 * `.locator()` calls live in a separate file the spec never touches
 * directly. Verified against a real, large suite (n8n's own e2e tests,
 * 256 spec files, 0 direct locator calls across all of them) where every
 * interaction routes through exactly this pattern — the locator-ratio
 * metric read a flat zero for a suite that, underneath, uses native
 * locators almost exclusively (confirmed by hand in its page-object
 * files).
 *
 * This follows only *relative* import specifiers (`./`, `../`) — bare
 * specifiers (npm packages, workspace packages, tsconfig path aliases)
 * are always left alone, since resolving them correctly needs a real
 * module resolver and getting it wrong risks pulling in unrelated code.
 * Under-counting by skipping an alias is a safe failure mode; guessing
 * wrong isn't. Traversal is also confined to `boundaryDir` (the scored
 * files' own common ancestor) and depth/file-count capped — see MAX_DEPTH
 * / MAX_FILES above — so a large or adversarial import graph can't blow
 * up cost.
 *
 * Returns dependency files only (never a file already present in
 * `specSources`), keyed by absolute path, so callers can fold their
 * locator counts (and, optionally, assertion-helper names) into the
 * suite-level totals without treating them as scored test files —
 * they contribute no SLOC/tests/findings of their own.
 */
export function collectLocallyImportedFiles(
  specSources: Map<string, string>,
  boundaryDir: string
): Map<string, string> {
  const collected = new Map<string, string>();
  const visited = new Set<string>(specSources.keys());
  const queue: Array<{ file: string; source: string; depth: number }> = [];
  for (const [file, source] of specSources) {
    queue.push({ file, source, depth: 0 });
  }

  while (queue.length > 0 && collected.size < MAX_FILES) {
    const next = queue.shift();
    if (!next) break;
    const { file, source, depth } = next;
    if (depth >= MAX_DEPTH) continue;
    for (const specifier of extractRelativeImportSpecifiers(source, file)) {
      if (collected.size >= MAX_FILES) break;
      const resolved = resolveRelativeImport(file, specifier, boundaryDir);
      if (!resolved || visited.has(resolved)) continue;
      visited.add(resolved);
      let depSource: string;
      try {
        depSource = fs.readFileSync(resolved, 'utf8');
      } catch {
        continue;
      }
      collected.set(resolved, depSource);
      queue.push({ file: resolved, source: depSource, depth: depth + 1 });
    }
  }
  return collected;
}
