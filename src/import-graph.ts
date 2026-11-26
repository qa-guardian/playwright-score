import fs from 'node:fs';
import path from 'node:path';
import { parseAst } from './parse-cache.js';
import { walk } from './test-syntax.js';
import { createModuleResolver, firstExistingFile, type ImportResolver } from './module-resolution.js';

export { createModuleResolver, type ImportResolver } from './module-resolution.js';

// Bounds on the traversal so a large, deep, or circular import graph can't
// blow up cost. Chosen generously relative to real page-object directory
// sizes (verified against n8n's own packages/testing/playwright/pages,
// ~90 files, deepest chain 3) while still being a hard ceiling.
const MAX_DEPTH = 6;
const MAX_FILES = 300;


type Loose = { type?: string; [k: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** `require('x')` through `await`, a type-only wrapper, or a member read (`require('x').y`): the specifier, when it is a plain string. */
function requireSpecifier(expr: Loose | null | undefined): string | undefined {
  let e = expr;
  while (e && (e.type === 'AwaitExpression' || e.type === 'TSNonNullExpression' || e.type === 'TSAsExpression' || e.type === 'MemberExpression')) {
    e = (e.type === 'AwaitExpression' ? e.argument : e.type === 'MemberExpression' ? e.object : e.expression) as Loose | undefined;
  }
  if (e?.type !== 'CallExpression' || e.callee?.type !== 'Identifier' || e.callee.name !== 'require') return undefined;
  const arg = e.arguments?.[0] as Loose | undefined;
  return arg?.type === 'Literal' && typeof arg.value === 'string' ? arg.value : undefined;
}

/**
 * CommonJS imports, read like ES ones: a top-level `const x = require('./a')`, `const { y } = require('./a')`,
 * `const z = require('./a').z` or a bare `require('./a')` statement. A `require` inside a function body is not followed
 * (it is not an import of the module), and neither is a computed or templated specifier.
 */
function requiredAtTopLevel(node: Loose): string[] {
  const out: string[] = [];
  if (node.type === 'VariableDeclaration') {
    for (const d of (node.declarations as Loose[] | undefined) ?? []) {
      const spec = requireSpecifier(d.init as Loose | undefined);
      if (spec !== undefined) out.push(spec);
    }
  } else if (node.type === 'ExpressionStatement') {
    const spec = requireSpecifier(node.expression as Loose | undefined);
    if (spec !== undefined) out.push(spec);
  }
  return out;
}

/**
 * Every module load in a file, for the `--changed-since` graph, where a missed edge fails open: the static imports
 * and top-level requires of `parseImportSpecifiers`, plus a literal `require('x')` or `import('x')` anywhere (a
 * function body included; over-following is safe here). `dynamic` is true when a load has a non-literal specifier:
 * it can reach any file, so the caller cannot prove that a changed file is unreachable. Undefined when unparsable.
 */
function parseScopeLoads(source: string, file: string): { specs: string[]; dynamic: boolean } | undefined {
  const base = parseImportSpecifiers(source, file);
  if (base === undefined) return undefined;
  const specs = new Set(base);
  let dynamic = false;
  let ast: Loose;
  try {
    ast = parseAst(source, file) as unknown as Loose;
  } catch {
    return undefined;
  }
  walk(ast as never, (n: Loose) => {
    let arg: Loose | undefined;
    if (n.type === 'ImportExpression') arg = n.source as Loose;
    else if (n.type === 'CallExpression' && n.callee?.type === 'Identifier' && n.callee.name === 'require') arg = n.arguments?.[0] as Loose | undefined;
    else return;
    if (arg?.type === 'Literal' && typeof arg.value === 'string') specs.add(arg.value);
    else if (arg?.type === 'TemplateLiteral' && arg.expressions?.length === 0 && arg.quasis?.length === 1) specs.add(String(arg.quasis[0].value?.cooked ?? ''));
    else dynamic = true;
  });
  return { specs: [...specs], dynamic };
}

/** Specifiers of a specifier list that only a CommonJS `require()` reaches (never an ES import/re-export of the same file). */
const requireOnly = new WeakMap<readonly string[], Set<string>>();

function extractImportSpecifiers(source: string, file: string): string[] {
  return parseImportSpecifiers(source, file) ?? [];
}

/** The import/re-export specifiers of a file, or undefined when it does not parse. */
function parseImportSpecifiers(source: string, file: string): string[] | undefined {
  let ast: { body?: Array<Record<string, unknown>> } | undefined;
  try {
    ast = parseAst(source, file) as unknown as { body?: Array<Record<string, unknown>> };
  } catch {
    return undefined;
  }
  const specifiers: string[] = [];
  const viaRequire = new Set<string>();
  const viaEs = new Set<string>();
  requireOnly.set(specifiers, viaRequire);
  for (const node of ast.body ?? []) {
    for (const spec of requiredAtTopLevel(node)) {
      specifiers.push(spec);
      viaRequire.add(spec);
    }
    if (
      node.type !== 'ImportDeclaration' &&
      node.type !== 'ExportNamedDeclaration' &&
      node.type !== 'ExportAllDeclaration'
    ) {
      continue;
    }
    const source_ = node.source as { value?: unknown } | undefined;
    if (typeof source_?.value === 'string') {
      specifiers.push(source_.value);
      viaEs.add(source_.value);
    }
  }
  for (const spec of viaEs) viaRequire.delete(spec);
  return specifiers;
}

export function resolveRelativeImport(
  fromFile: string,
  specifier: string,
  boundaryDir: string
): string | undefined {
  // Never resolve outside the scanned suite's own directory tree — keeps
  // the traversal bounded to the code actually being scored, and refuses
  // to follow a relative import that climbs out to a sibling package or
  // node_modules via a longer `../../..` chain.
  return firstExistingFile(path.resolve(path.dirname(fromFile), specifier), boundaryDir);
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
 * This follows relative import specifiers (`./`, `../`, including the
 * TypeScript ESM `./x.js` -> `x.ts` convention) plus the bare specifiers
 * module-resolution.ts can map to a file inside the boundary: tsconfig
 * `paths`/`baseUrl` aliases and workspace packages. Other bare specifiers
 * (npm packages) are left alone. Under-counting is a safe failure mode;
 * guessing wrong isn't. Traversal is also confined to `boundaryDir` (the scored
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
/**
 * Relative specifiers always; bare ones only when `moduleResolver` maps them
 * to a file inside the boundary (tsconfig paths/baseUrl alias, workspace
 * package). Anything else stays unresolved, as before.
 */
export function resolveImportSpecifier(
  fromFile: string,
  specifier: string,
  boundaryDir: string,
  moduleResolver?: ImportResolver
): string | undefined {
  if (specifier.startsWith('.')) return resolveRelativeImport(fromFile, specifier, boundaryDir);
  return moduleResolver?.(fromFile, specifier);
}

export function collectLocallyImportedFiles(
  specSources: Map<string, string>,
  boundaryDir: string,
  moduleResolver: ImportResolver = createModuleResolver(boundaryDir),
  /** Optional out-param: file -> files it imports/re-exports (resolved), for scoping helper names. */
  edges?: Map<string, string[]>,
  /** Optional: file -> its import specifiers, filled and reused so a second traversal of the same sources parses nothing twice. */
  specifierCache?: Map<string, string[]>,
  /** Optional out-param: like `edges` without the edges only a CommonJS `require()` creates (expect-expect evidence follows these only). */
  esEdges?: Map<string, string[]>
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
    let specifiers = specifierCache?.get(file);
    if (!specifiers) {
      specifiers = extractImportSpecifiers(source, file);
      specifierCache?.set(file, specifiers);
    }
    for (const specifier of specifiers) {
      if (collected.size >= MAX_FILES) break;
      const resolved = resolveImportSpecifier(file, specifier, boundaryDir, moduleResolver);
      if (resolved && edges) {
        const list = edges.get(file);
        if (list) list.push(resolved);
        else edges.set(file, [resolved]);
      }
      if (resolved && esEdges && !requireOnly.get(specifiers)?.has(specifier)) {
        const list = esEdges.get(file);
        if (list) list.push(resolved);
        else esEdges.set(file, [resolved]);
      }
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

/** A hard ceiling on the scoping traversal, so a runaway graph ends in "incomplete" and not in an endless walk. */
const SCOPE_MAX_FILES = 50_000;

/**
 * The import graph for `--changed-since`. Unlike the scoring traversal it has no depth limit and no
 * 300-file cap, and it is bounded by `boundaryDir` (the repository top), because here a missed edge
 * drops a spec out of scope and can turn a real change into "nothing to score". `complete` is false
 * when a file did not parse, could not be read, or the traversal hit its ceiling: the caller then
 * cannot prove that a changed file is unreachable.
 */
export function collectScopeGraph(
  roots: Iterable<readonly [string, string]>,
  boundaryDir: string,
  moduleResolver: ImportResolver,
  edges: Map<string, string[]>,
  specifiers: Map<string, string[]>
): { complete: boolean; dynamicLoad?: string } {
  let complete = true;
  let dynamicLoad: string | undefined;
  const visited = new Set<string>();
  const queue: Array<{ file: string; source: string }> = [];
  for (const [file, source] of roots) {
    visited.add(file);
    queue.push({ file, source });
  }
  while (queue.length > 0) {
    if (visited.size > SCOPE_MAX_FILES) return { complete: false, ...(dynamicLoad ? { dynamicLoad } : {}) };
    const { file, source } = queue.shift()!;
    const loads = parseScopeLoads(source, file);
    if (loads === undefined) {
      complete = false;
      specifiers.set(file, []);
      continue;
    }
    if (loads.dynamic && dynamicLoad === undefined) dynamicLoad = file;
    const specs = loads.specs;
    specifiers.set(file, specs);
    for (const specifier of specs) {
      const resolved = resolveImportSpecifier(file, specifier, boundaryDir, moduleResolver);
      if (!resolved) continue;
      const list = edges.get(file);
      if (list) list.push(resolved);
      else edges.set(file, [resolved]);
      if (visited.has(resolved)) continue;
      visited.add(resolved);
      try {
        queue.push({ file: resolved, source: fs.readFileSync(resolved, 'utf8') });
      } catch {
        complete = false;
      }
    }
  }
  return { complete, ...(dynamicLoad ? { dynamicLoad } : {}) };
}
