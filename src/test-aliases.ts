import { resolveRelativeImport } from './import-graph.js';
import { parseAst } from './parse-cache.js';

// A `test.extend()` fixture bound to a custom name is a first-class,
// Playwright-documented pattern (playwright.dev/docs/test-fixtures), not a
// style choice. Several of `eslint-plugin-playwright`'s own rules key off
// the literal identifier `test` — the
// vendored version here (2.11.0) already dereferences a *same-file*
// `const loggedTest = test.extend(...)` chain internally (see
// `isTestExtendCall`/`dereference` in the plugin), but its `dereference`
// only walks the current file's own scope; it cannot follow an import
// across files. Verified against two real corpus repos (argos-ci/argos,
// apache/superset): both declare the extended test in one file and import
// it (sometimes two hops deep, sometimes through a re-export barrel) into
// every spec file, which the plugin's own dereference can't see — hence
// the real-world false positives this module exists to fix. This module
// detects those cross-file (and same-file, for our own AST checks below,
// which have no built-in extend-awareness at all) aliases so both
// `eslint-plugin-playwright`'s rules (via `settings.playwright.
// globalAliases.test`, fed in eslint-runner.ts) and this package's own
// test-span/countTests logic (metrics.ts) and base-plugin.ts rules
// recognize `loggedTest(...)`/`testWithAssets(...)` as a real test
// declaration, not an arbitrary function call.

interface ParsedFileInfo {
  /** Local names bound to `test` imported from '@playwright/test' in this file (handles rename). */
  playwrightTestLocalNames: Set<string>;
  /** declaredName -> baseName, for `const declaredName = baseName.extend(...)` (any scope). */
  extendDeclarations: Array<{ declaredName: string; baseName: string }>;
  /** Names this file exports under their own declared name via `export const X = ...`. */
  directExportNames: Set<string>;
  /** Relative ImportDeclarations: creates a LOCAL usable binding in this file. */
  imports: Array<{ localName: string; importedName: string; source: string }>;
  /** `export { local as exported } from './x'` (source present) or
   * `export { local as exported }` (no source, re-exporting a name already
   * bound in this file) — either way, does NOT create a local binding
   * usable within this file, only something importers of this file see. */
  reExports: Array<{ exportedName: string; localName: string; source?: string }>;
  /** Functions with the shapes their `return` statements can take (QAG-287 factories). */
  functions: Array<{ name: string; returns: FactoryReturn[]; exported: boolean }>;
  /** `const declaredName = calleeName(...)` (any scope, plain identifier callee). */
  callDeclarations: Array<{ declaredName: string; calleeName: string }>;
}

/**
 * What a function returns, as far as alias detection cares: `X.extend(...)`
 * (`base`), a bare identifier (`ident`, an alias or a function's own const),
 * or a call to another function (`call`, e.g. a factory delegating to a
 * factory).
 */
type FactoryReturn =
  | { kind: 'extend'; baseName: string }
  | { kind: 'ident'; name: string }
  | { kind: 'call'; calleeName: string };

function classifyReturn(expr: Record<string, unknown> | null | undefined): FactoryReturn | undefined {
  if (!expr) return undefined;
  if (expr.type === 'Identifier' && typeof expr.name === 'string') {
    return { kind: 'ident', name: expr.name };
  }
  if (expr.type !== 'CallExpression') return undefined;
  const callee = expr.callee as Record<string, unknown> | undefined;
  if (callee?.type === 'Identifier' && typeof callee.name === 'string') {
    return { kind: 'call', calleeName: callee.name };
  }
  if (callee?.type === 'MemberExpression' && !callee.computed) {
    const prop = callee.property as { type?: string; name?: string } | undefined;
    const obj = callee.object as { type?: string; name?: string } | undefined;
    if (prop?.type === 'Identifier' && prop.name === 'extend' && obj?.type === 'Identifier' && obj.name) {
      return { kind: 'extend', baseName: obj.name };
    }
  }
  return undefined;
}

/** `return <expr>` statements of one function body, not descending into nested functions. */
function collectFunctionReturns(fn: Record<string, unknown>): FactoryReturn[] {
  const out: FactoryReturn[] = [];
  const body = fn.body as Record<string, unknown> | undefined;
  if (!body) return out;
  if (body.type !== 'BlockStatement') {
    const r = classifyReturn(body);
    if (r) out.push(r);
    return out;
  }
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const n of node) visit(n);
      return;
    }
    const obj = node as Record<string, unknown>;
    if (
      obj.type === 'FunctionDeclaration' ||
      obj.type === 'FunctionExpression' ||
      obj.type === 'ArrowFunctionExpression'
    ) {
      return;
    }
    if (obj.type === 'ReturnStatement') {
      const r = classifyReturn(obj.argument as Record<string, unknown> | null);
      if (r) out.push(r);
      return;
    }
    for (const key in obj) {
      if (key === 'parent') continue;
      const v = obj[key];
      if (v && typeof v === 'object') visit(v);
    }
  };
  visit(body.body);
  return out;
}

function isRelativeSpecifier(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('.');
}

function parseFileInfo(source: string, file: string): ParsedFileInfo | undefined {
  let ast: { body?: Array<Record<string, unknown>> } | undefined;
  try {
    ast = parseAst(source, file) as unknown as { body?: Array<Record<string, unknown>> };
  } catch {
    return undefined;
  }

  const playwrightTestLocalNames = new Set<string>();
  const extendDeclarations: Array<{ declaredName: string; baseName: string }> = [];
  const directExportNames = new Set<string>();
  const imports: Array<{ localName: string; importedName: string; source: string }> = [];
  const reExports: Array<{ exportedName: string; localName: string; source?: string }> = [];
  const functions: ParsedFileInfo['functions'] = [];
  const callDeclarations: ParsedFileInfo['callDeclarations'] = [];

  function collectFunction(node: Record<string, unknown>, exported: boolean): void {
    if (node.type === 'FunctionDeclaration') {
      const name = (node.id as { name?: string } | null)?.name;
      if (name) functions.push({ name, returns: collectFunctionReturns(node), exported });
    } else if (node.type === 'VariableDeclaration') {
      for (const d of (node.declarations ?? []) as Array<{
        id?: { type?: string; name?: string };
        init?: Record<string, unknown> | null;
      }>) {
        const init = d.init;
        if (
          d.id?.type === 'Identifier' &&
          d.id.name &&
          init &&
          (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression')
        ) {
          functions.push({ name: d.id.name, returns: collectFunctionReturns(init), exported });
        }
      }
    }
  }

  function collectExtendFromVariableDeclaration(decl: Record<string, unknown>): void {
    const declarations = (decl.declarations ?? []) as Array<{
      id?: { type?: string; name?: string };
      init?: Record<string, unknown> | null;
    }>;
    for (const d of declarations) {
      if (d.id?.type !== 'Identifier' || !d.id.name || !d.init) continue;
      const init = d.init;
      if (
        init.type === 'CallExpression' &&
        (init as { callee?: Record<string, unknown> }).callee?.type === 'Identifier'
      ) {
        const calleeName = ((init as { callee: { name?: string } }).callee).name;
        if (calleeName) callDeclarations.push({ declaredName: d.id.name, calleeName });
      }
      if (
        init.type === 'CallExpression' &&
        (init as { callee?: Record<string, unknown> }).callee?.type === 'MemberExpression'
      ) {
        const callee = (init as { callee: Record<string, unknown> }).callee;
        const property = callee.property as { type?: string; name?: string } | undefined;
        const object = callee.object as { type?: string; name?: string } | undefined;
        if (
          !callee.computed &&
          property?.type === 'Identifier' &&
          property.name === 'extend' &&
          object?.type === 'Identifier' &&
          object.name
        ) {
          extendDeclarations.push({ declaredName: d.id.name, baseName: object.name });
        }
      }
    }
  }

  // Generic subtree walk to find `const X = Y.extend(...)` anywhere (not
  // just top-level) — a fixture module may nest these inside a helper.
  function walk(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    const obj = node as Record<string, unknown>;
    if (obj.type === 'VariableDeclaration') collectExtendFromVariableDeclaration(obj);
    for (const key in obj) {
      if (key === 'parent') continue;
      const value = obj[key];
      if (value && typeof value === 'object') walk(value);
    }
  }

  for (const node of ast.body ?? []) {
    if (node.type === 'FunctionDeclaration' || node.type === 'VariableDeclaration') {
      collectFunction(node, false);
    }
    if (node.type === 'ImportDeclaration') {
      const src = (node.source as { value?: unknown } | undefined)?.value;
      if (!isRelativeSpecifier(src)) {
        if (src === '@playwright/test') {
          for (const spec of (node.specifiers ?? []) as Array<{
            type: string;
            imported?: { name?: string; type?: string; value?: string };
            local?: { name?: string };
          }>) {
            if (spec.type !== 'ImportSpecifier') continue;
            const importedName = spec.imported?.name ?? spec.imported?.value;
            if (importedName === 'test' && spec.local?.name) {
              playwrightTestLocalNames.add(spec.local.name);
            }
          }
        }
        continue;
      }
      for (const spec of (node.specifiers ?? []) as Array<{
        type: string;
        imported?: { name?: string; value?: string };
        local?: { name?: string };
      }>) {
        if (spec.type !== 'ImportSpecifier') continue;
        const importedName = spec.imported?.name ?? spec.imported?.value;
        if (importedName && spec.local?.name) {
          imports.push({ localName: spec.local.name, importedName, source: src });
        }
      }
    } else if (node.type === 'ExportNamedDeclaration') {
      const declaration = node.declaration as Record<string, unknown> | undefined;
      const src = (node.source as { value?: unknown } | undefined)?.value;
      if (declaration) collectFunction(declaration, true);
      if (declaration?.type === 'VariableDeclaration') {
        collectExtendFromVariableDeclaration(declaration);
        for (const d of (declaration.declarations ?? []) as Array<{
          id?: { type?: string; name?: string };
        }>) {
          if (d.id?.type === 'Identifier' && d.id.name) directExportNames.add(d.id.name);
        }
      } else {
        for (const spec of (node.specifiers ?? []) as Array<{
          local?: { name?: string; value?: string };
          exported?: { name?: string; value?: string };
        }>) {
          const localName = spec.local?.name ?? spec.local?.value;
          const exportedName = spec.exported?.name ?? spec.exported?.value;
          if (!localName || !exportedName) continue;
          reExports.push({
            exportedName,
            localName,
            source: isRelativeSpecifier(src) ? src : undefined,
          });
        }
      }
    }
  }

  // Fixtures modules commonly declare the extend() call inside a nested
  // scope too (e.g. wrapped in a `(() => {...})()` IIFE is rare, but
  // multiple top-level `const`s are common) — the top-level pass above
  // already covers the overwhelming majority; this catches the rest
  // without a second parse.
  walk(ast.body ?? []);

  return {
    playwrightTestLocalNames,
    extendDeclarations,
    directExportNames,
    imports,
    reExports,
    functions,
    callDeclarations,
  };
}

/**
 * Detects identifiers bound (directly, or via a local import/re-export
 * chain of any depth) to `<base>.extend(...)` where `<base>` is `test`
 * imported from `@playwright/test`, or is itself such an extended test.
 * Returns the flat set of alias name strings (e.g. `loggedTest`,
 * `testWithAssets`) usable anywhere they're called across the scored
 * files — callers feed this into `eslint-runner.ts`'s
 * `settings.playwright.globalAliases.test` and into `metrics.ts`'s
 * `getTestSpans`/`countTests` and `base-plugin.ts`'s test-name checks.
 *
 * `sources`/`importedFiles` are the same maps `index.ts` already builds
 * (scored spec files, and their transitively-collected local relative
 * imports — see `collectLocallyImportedFiles`); this function does not
 * walk the filesystem itself beyond resolving relative specifiers already
 * present in those files' own import/export statements, and never
 * escapes `boundaryDir` (same safety rule as `import-graph.ts`).
 */
export function detectExtendedTestAliases(
  sources: Map<string, string>,
  importedFiles: Map<string, string>,
  boundaryDir: string
): string[] {
  return detectTestAliasesAndFactories(sources, importedFiles, boundaryDir).aliases;
}

/**
 * Suffix marking a test-FACTORY name inside the `testAliasNames` list that
 * rules and metrics receive: `testWithConfig()` means a curried call
 * `testWithConfig({...})("title", fn)` is a test declaration (QAG-287).
 * Plain alias names never contain parentheses, so the two kinds share one
 * list without any option-schema change. eslint-plugin-playwright (which
 * matches callee NAMES only and cannot see a call used as a callee) never
 * receives the marked entries: see `plainAliasNames`.
 */
export const FACTORY_MARK = '()';

export function plainAliasNames(names: readonly string[]): string[] {
  return names.filter((n) => !n.endsWith(FACTORY_MARK));
}

/** Names of the test factories in a mixed alias list (without the marker). */
export function factoryNamesOf(names: readonly string[]): Set<string> {
  return new Set(names.filter((n) => n.endsWith(FACTORY_MARK)).map((n) => n.slice(0, -FACTORY_MARK.length)));
}

/**
 * Aliases plus test factories (functions whose call returns a test), the
 * latter as `name()` entries so that a curried
 * `factory({...})("title", fn)` is recognised wherever aliases are.
 */
export function detectTestAliasNamesWithFactories(
  sources: Map<string, string>,
  importedFiles: Map<string, string>,
  boundaryDir: string
): string[] {
  const { aliases, factories } = detectTestAliasesAndFactories(sources, importedFiles, boundaryDir);
  return [...aliases, ...factories.map((n) => n + FACTORY_MARK)];
}

function detectTestAliasesAndFactories(
  sources: Map<string, string>,
  importedFiles: Map<string, string>,
  boundaryDir: string
): { aliases: string[]; factories: string[] } {
  const allFiles = new Map<string, string>([...sources, ...importedFiles]);
  const parsed = new Map<string, ParsedFileInfo>();
  for (const [file, source] of allFiles) {
    const info = parseFileInfo(source, file);
    if (info) parsed.set(file, info);
  }

  const localAlias = new Map<string, Set<string>>();
  const exportedAlias = new Map<string, Set<string>>();
  // Test-factory functions (QAG-287): `function make(cfg) { return test.extend(...) }`.
  // `const t = make(cfg)` then makes `t` a test alias.
  const localFactory = new Map<string, Set<string>>();
  const exportedFactory = new Map<string, Set<string>>();
  for (const file of parsed.keys()) {
    localAlias.set(file, new Set());
    exportedAlias.set(file, new Set());
    localFactory.set(file, new Set());
    exportedFactory.set(file, new Set());
  }

  const resolve = (fromFile: string, specifier: string): string | undefined =>
    resolveRelativeImport(fromFile, specifier, boundaryDir);

  // Bounded fixed point: each round can only add names (monotonic), and
  // there are at most parsed.size * (max names per file) additions total —
  // capping rounds at file count + a small constant is generous relative
  // to any real import-chain depth (mirrors import-graph.ts's own
  // MAX_DEPTH-style bound).
  const maxRounds = parsed.size + 5;
  for (let round = 0; round < maxRounds; round++) {
    let changed = false;
    for (const [file, info] of parsed) {
      const known = localAlias.get(file)!;
      const exported = exportedAlias.get(file)!;

      for (const { declaredName, baseName } of info.extendDeclarations) {
        if (known.has(declaredName)) continue;
        if (info.playwrightTestLocalNames.has(baseName) || known.has(baseName)) {
          known.add(declaredName);
          changed = true;
        }
      }

      const factories = localFactory.get(file)!;
      const exportedFactories = exportedFactory.get(file)!;

      for (const { localName, importedName, source } of info.imports) {
        const resolved = resolve(file, source);
        if (!resolved) continue;
        if (!known.has(localName) && exportedAlias.get(resolved)?.has(importedName)) {
          known.add(localName);
          changed = true;
        }
        if (!factories.has(localName) && exportedFactory.get(resolved)?.has(importedName)) {
          factories.add(localName);
          changed = true;
        }
      }

      for (const fn of info.functions) {
        if (!factories.has(fn.name)) {
          const returnsAlias = fn.returns.some((r) =>
            r.kind === 'extend'
              ? info.playwrightTestLocalNames.has(r.baseName) || known.has(r.baseName)
              : r.kind === 'ident'
                ? known.has(r.name)
                : factories.has(r.calleeName)
          );
          if (returnsAlias) {
            factories.add(fn.name);
            changed = true;
          }
        }
        if (fn.exported && factories.has(fn.name) && !exportedFactories.has(fn.name)) {
          exportedFactories.add(fn.name);
          changed = true;
        }
      }

      for (const { declaredName, calleeName } of info.callDeclarations) {
        if (known.has(declaredName) || !factories.has(calleeName)) continue;
        known.add(declaredName);
        changed = true;
      }

      for (const { exportedName, localName, source } of info.reExports) {
        if (exportedFactories.has(exportedName)) continue;
        const isFactory = source
          ? !!resolve(file, source) && exportedFactory.get(resolve(file, source)!)?.has(localName)
          : factories.has(localName);
        if (isFactory) {
          exportedFactories.add(exportedName);
          changed = true;
        }
      }

      for (const name of known) {
        if (info.directExportNames.has(name) && !exported.has(name)) {
          exported.add(name);
          changed = true;
        }
      }

      for (const { exportedName, localName, source } of info.reExports) {
        if (exported.has(exportedName)) continue;
        const isAlias = source
          ? !!resolve(file, source) && exportedAlias.get(resolve(file, source)!)?.has(localName)
          : known.has(localName);
        if (isAlias) {
          exported.add(exportedName);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  const result = new Set<string>();
  for (const names of localAlias.values()) {
    for (const name of names) result.add(name);
  }
  const factoryResult = new Set<string>();
  for (const names of localFactory.values()) {
    for (const name of names) factoryResult.add(name);
  }
  return { aliases: [...result].sort(), factories: [...factoryResult].sort() };
}
