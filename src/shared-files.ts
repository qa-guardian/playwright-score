import path from 'node:path';
import { collectLocallyImportedFiles } from './import-graph.js';
import type { ImportResolver } from './module-resolution.js';
import { createNestedPackageResolver } from './nested-packages.js';
import { PLAYWRIGHT_API_METHODS } from './playwright-api-names.js';
import { walk, FN_TYPES, type N } from './rules/ast-util.js';
import { parseAst } from './parse-cache.js';
import type { SharedSkippedFile } from './types.js';

/**
 * The shared files of a run: the files the specs reach through imports (page
 * objects, fixtures, helpers), minus specs, split into the ones that are
 * Playwright code and the ones that are not. This module only computes and
 * reports the two sets. No rule runs on a shared file here, and nothing in a
 * result other than `coverage.shared*` depends on them.
 *
 * A shared file is Playwright-bound when one of these holds:
 * - it imports `@playwright/test`, `playwright` or `playwright-core` (or a
 *   path inside one of them), or imports a shared file that does;
 * - a parameter or a field is annotated `Page`, `Locator`, `Frame`,
 *   `BrowserContext` or `APIRequestContext` (a TypeScript annotation, or a
 *   JSDoc `@param` / `@type` / `@property` type);
 * - it calls `test.extend(...)`;
 * - a function has a parameter named `page` and calls a Playwright method
 *   directly on it (`page.goto(...)`).
 * A declaration file (`.d.ts`) holds no code to check and is never bound.
 */

const PLAYWRIGHT_PACKAGES = ['@playwright/test', 'playwright', 'playwright-core'];
const PLAYWRIGHT_TYPES = new Set(['Page', 'Locator', 'Frame', 'BrowserContext', 'APIRequestContext']);
const DECLARATION_FILE = /\.d\.[cm]?ts$/;
// A file with none of these words cannot meet any condition on its own: it is not parsed.
const MAY_BE_BOUND = /playwright|\bpage\b|\.extend\b|Page|Locator|Frame|BrowserContext|APIRequestContext/;
const JSDOC_TYPE = /@(?:param|arg|argument|type|property|prop|member)\s*\{([^}]*)\}/g;
const JSDOC_PLAYWRIGHT_TYPE = /(?:^|[^\w$])(?:Page|Locator|Frame|BrowserContext|APIRequestContext)(?![\w$])/;

// Declarations with parameters and no body: an overload, an interface method, a function type, an abstract method.
const SIGNATURE_TYPES = new Set(['TSDeclareFunction', 'TSMethodSignature', 'TSFunctionType', 'TSEmptyBodyFunctionExpression']);

type Node = N & Record<string, unknown>;

function isPlaywrightPackage(specifier: unknown): boolean {
  return typeof specifier === 'string' && PLAYWRIGHT_PACKAGES.some((p) => specifier === p || specifier.startsWith(p + '/'));
}

/** `Page`, `pw.Page`, `Page | null`: true when the annotation names one of the Playwright types. */
function namesPlaywrightType(annotation: unknown): boolean {
  let t = annotation as Node | undefined;
  if (t?.type === 'TSTypeAnnotation') t = t.typeAnnotation as Node | undefined;
  if (!t) return false;
  if (t.type === 'TSUnionType') return ((t.types as Node[] | undefined) ?? []).some(namesPlaywrightType);
  if (t.type !== 'TSTypeReference') return false;
  let name = t.typeName as Node | undefined;
  if (name?.type === 'TSQualifiedName') name = name.right;
  return name?.type === 'Identifier' && PLAYWRIGHT_TYPES.has(name.name ?? '');
}

/** The identifiers a parameter binds, one level deep: `page`, `page = x`, `{ page }`, `private page: Page`. */
function parameterNames(param: Node | undefined): Node[] {
  if (!param) return [];
  if (param.type === 'Identifier') return [param];
  if (param.type === 'AssignmentPattern') return parameterNames(param.left as Node);
  if (param.type === 'TSParameterProperty') return parameterNames(param.parameter as Node);
  if (param.type === 'ObjectPattern') {
    return ((param.properties as Node[] | undefined) ?? []).flatMap((p) => (p.type === 'Property' ? parameterNames(p.value as Node) : []));
  }
  return [];
}

function callsPlaywrightMethodOnPage(fn: Node): boolean {
  let found = false;
  walk(
    fn.body,
    (n) => {
      if (found) return false;
      const callee = n.type === 'CallExpression' ? n.callee : undefined;
      if (
        callee?.type === 'MemberExpression' &&
        !callee.computed &&
        callee.object?.type === 'Identifier' &&
        callee.object.name === 'page' &&
        callee.property?.type === 'Identifier' &&
        PLAYWRIGHT_API_METHODS.has(callee.property.name ?? '')
      ) {
        found = true;
      }
      return !found;
    },
    true
  );
  return found;
}

export interface PlaywrightTies {
  /** The file imports one of the Playwright packages itself. */
  importsPlaywright: boolean;
  /** One of the conditions that need no other file holds (the import included). */
  bound: boolean;
}

/** What ties one file, on its own text, to Playwright. A file that does not parse has no tie. */
export function playwrightTies(source: string, file: string): PlaywrightTies {
  const none = { importsPlaywright: false, bound: false };
  if (!MAY_BE_BOUND.test(source)) return none;
  let ast: { body?: unknown; comments?: Array<{ type: string; value: string }> };
  try {
    // Comments are on every tree the parser returns (parse-cache.ts).
    ast = parseAst(source, file) as unknown as typeof ast;
  } catch {
    return none;
  }
  let importsPlaywright = false;
  let bound = (ast.comments ?? []).some((c) => {
    if (c.type !== 'Block' || !c.value.startsWith('*')) return false;
    return [...c.value.matchAll(JSDOC_TYPE)].some((m) => JSDOC_PLAYWRIGHT_TYPE.test(m[1]));
  });
  walk(
    ast.body,
    (raw) => {
      const n = raw as Node;
      const callee = n.type === 'CallExpression' ? n.callee : undefined;
      const source_ = (n.source as { value?: unknown } | undefined)?.value;
      if (
        (/^(Import|ExportNamed|ExportAll)Declaration$/.test(n.type) && isPlaywrightPackage(source_)) ||
        (n.type === 'ImportExpression' && isPlaywrightPackage(source_)) ||
        (callee?.type === 'Identifier' && callee.name === 'require' && isPlaywrightPackage(n.arguments?.[0]?.value))
      ) {
        importsPlaywright = true;
      } else if (FN_TYPES.has(n.type) || SIGNATURE_TYPES.has(n.type)) {
        const names = (n.params ?? []).flatMap((p) => parameterNames(p as Node));
        if (names.some((id) => namesPlaywrightType(id.typeAnnotation))) bound = true;
        else if (names.some((id) => id.name === 'page') && callsPlaywrightMethodOnPage(n)) bound = true;
      } else if (n.type === 'PropertyDefinition' || n.type === 'TSPropertySignature') {
        if (namesPlaywrightType(n.typeAnnotation)) bound = true;
      } else if (
        callee?.type === 'MemberExpression' &&
        !callee.computed &&
        callee.object?.type === 'Identifier' &&
        callee.object.name === 'test' &&
        callee.property?.type === 'Identifier' &&
        callee.property.name === 'extend'
      ) {
        bound = true;
      }
    },
    true
  );
  return { importsPlaywright, bound: bound || importsPlaywright };
}

export interface SharedFiles {
  /** Playwright-bound shared files, absolute, sorted. */
  linted: string[];
  /** Shared files left out, absolute, sorted. */
  skipped: Array<{ file: string; reason: SharedSkippedFile['reason'] }>;
}

/**
 * Splits an import closure (`collectLocallyImportedFiles`) into bound and not
 * bound. `edges` is the closure's own file -> imported files map; `isSpec`
 * names the files that are specs and so never shared.
 */
export function classifyShared(
  closure: ReadonlyMap<string, string>,
  edges: ReadonlyMap<string, readonly string[]>,
  isSpec: (file: string) => boolean
): SharedFiles {
  const ties = new Map<string, PlaywrightTies>();
  const declarations: string[] = [];
  for (const [file, source] of closure) {
    if (isSpec(file)) continue;
    if (DECLARATION_FILE.test(file)) declarations.push(file);
    else ties.set(file, playwrightTies(source, file));
  }
  const out: SharedFiles = { linted: [], skipped: declarations.map((file) => ({ file, reason: 'declaration-file' as const })) };
  for (const [file, tie] of ties) {
    if (tie.bound || (edges.get(file) ?? []).some((dep) => ties.get(dep)?.importsPlaywright)) out.linted.push(file);
    else out.skipped.push({ file, reason: 'not-playwright-bound' });
  }
  out.linted.sort();
  out.skipped.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  return out;
}

export interface SharedCollector {
  /**
   * The resolver for the run's own import closure. It resolves exactly as
   * `moduleResolver` does, and notes whether a package nested inside the
   * repository (nested-packages.ts) would have resolved an import that
   * `moduleResolver` left alone.
   */
  observing: ImportResolver;
  /**
   * The shared files, given the run's own closure and its edges. When no
   * nested package was seen the shared closure is that closure. Otherwise it
   * is built again, with the same traversal and the same caps, and with the
   * nested packages resolved by their `package.json` name; the run's own
   * closure is left as it is.
   */
  collect(
    sources: Map<string, string>,
    closure: ReadonlyMap<string, string>,
    edges: ReadonlyMap<string, readonly string[]>,
    isSpec: (file: string) => boolean,
    specifierCache?: Map<string, string[]>
  ): SharedFiles;
}

export function createSharedCollector(importBoundary: string, moduleResolver: ImportResolver): SharedCollector {
  const nested = createNestedPackageResolver(importBoundary);
  let nestedSeen = false;
  return {
    observing: (from, specifier) => {
      const hit = moduleResolver(from, specifier);
      if (hit === undefined && !nestedSeen && nested(from, specifier) !== undefined) nestedSeen = true;
      return hit;
    },
    collect(sources, closure, edges, isSpec, specifierCache) {
      if (!nestedSeen) return classifyShared(closure, edges, isSpec);
      const withNested: ImportResolver = (from, specifier) => moduleResolver(from, specifier) ?? nested(from, specifier);
      const ownEdges = new Map<string, string[]>();
      const own = collectLocallyImportedFiles(sources, importBoundary, withNested, ownEdges, specifierCache);
      return classifyShared(own, ownEdges, isSpec);
    },
  };
}

/** The `coverage` keys for a shared set, with paths relative to the run's base directory. */
export function sharedCoverage(shared: SharedFiles | undefined, baseDir: string): {
  sharedLinted: number;
  sharedSkipped: number;
  sharedLintedFiles: string[];
  sharedSkippedFiles: SharedSkippedFile[];
} {
  const rel = (abs: string): string => path.relative(baseDir, abs) || path.basename(abs);
  const linted = (shared?.linted ?? []).map(rel);
  const skipped = (shared?.skipped ?? []).map((s) => ({ file: rel(s.file), reason: s.reason }));
  return { sharedLinted: linted.length, sharedSkipped: skipped.length, sharedLintedFiles: linted, sharedSkippedFiles: skipped };
}
