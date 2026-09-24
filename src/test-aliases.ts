import { parseForESLint } from '@typescript-eslint/parser';
import { resolveRelativeImport } from './import-graph.js';

// A `test.extend()` fixture bound to a custom name is a first-class,
// Playwright-documented pattern (playwright.dev/docs/test-fixtures), not a
// style choice. `eslint-plugin-playwright`'s own `no-standalone-expect` (and
// several sibling rules) key off the literal identifier `test` — the
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
}

function isRelativeSpecifier(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('.');
}

function parseFileInfo(source: string, file: string): ParsedFileInfo | undefined {
  let ast: { body?: Array<Record<string, unknown>> } | undefined;
  try {
    ast = parseForESLint(source, {
      ecmaVersion: 2022,
      sourceType: 'module',
      ecmaFeatures: { jsx: /\.(tsx|jsx)$/.test(file) },
    }).ast as unknown as { body?: Array<Record<string, unknown>> };
  } catch {
    return undefined;
  }

  const playwrightTestLocalNames = new Set<string>();
  const extendDeclarations: Array<{ declaredName: string; baseName: string }> = [];
  const directExportNames = new Set<string>();
  const imports: Array<{ localName: string; importedName: string; source: string }> = [];
  const reExports: Array<{ exportedName: string; localName: string; source?: string }> = [];

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
  const allFiles = new Map<string, string>([...sources, ...importedFiles]);
  const parsed = new Map<string, ParsedFileInfo>();
  for (const [file, source] of allFiles) {
    const info = parseFileInfo(source, file);
    if (info) parsed.set(file, info);
  }

  const localAlias = new Map<string, Set<string>>();
  const exportedAlias = new Map<string, Set<string>>();
  for (const file of parsed.keys()) {
    localAlias.set(file, new Set());
    exportedAlias.set(file, new Set());
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

      for (const { localName, importedName, source } of info.imports) {
        if (known.has(localName)) continue;
        const resolved = resolve(file, source);
        if (!resolved) continue;
        if (exportedAlias.get(resolved)?.has(importedName)) {
          known.add(localName);
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
  return [...result].sort();
}
