/**
 * Binding resolver (QAG-287 B2): what a name in a file is bound to.
 *
 * It answers three questions, each from scope analysis and never from the
 * spelling of a name:
 *  - does an expression denote Playwright's `test` (isPlaywrightTest);
 *  - is a type annotation Playwright's `Page` or `Frame` (playwrightType);
 *  - which export of which package does an expression denote (origin), used
 *    for the browser launchers.
 * A name is followed through imports, `require`, single-assignment `const`
 * bindings and, for `test` only, local modules that re-export it. Anything
 * the resolver cannot follow is "not proven": it never guesses.
 */
import { parseForESLint } from '@typescript-eslint/parser';
import type { Rule } from 'eslint';
import { resolveConstInit, type N as AstNode } from './ast-util.js';
import { sourceTypeFor } from '../source-type.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type N = { type: string; [k: string]: any };

/** One parsed file with its scope analysis. `context` is the part of an ESLint rule context that `resolveConstInit` reads. */
export interface ScopeFile {
  file: string;
  ast: N;
  context: Rule.RuleContext;
  parents: Map<N, N | undefined>;
}

/** Where other files come from. `load` returns undefined for a file that cannot be read or parsed. */
export interface ResolveEnv {
  load(file: string): ScopeFile | undefined;
  resolve(fromFile: string, specifier: string): string | undefined;
}

/** Local modules followed from the spec file when looking for the source of `test`. */
export const MAX_FILE_DEPTH = 4;
const MAX_STEPS = 12;

/** Packages that export Playwright's `test`. */
const TEST_PACKAGE = /^(@playwright\/test|playwright\/test|@playwright\/experimental-ct-[a-z0-9-]+)$/;
/** Packages that export Playwright's `Page` and `Frame` types and its browser launchers. */
const PLAYWRIGHT_PACKAGE = /^(@playwright\/test|playwright\/test|@playwright\/experimental-ct-[a-z0-9-]+|playwright|playwright-core|playwright-chromium|playwright-firefox|playwright-webkit)$/;

export const isPlaywrightPackage = (pkg: string): boolean => PLAYWRIGHT_PACKAGE.test(pkg);

const SKIP_KEYS = new Set(['parent', 'loc', 'range', 'tokens', 'comments']);

export function parseScopeFile(source: string, file: string): ScopeFile | undefined {
  try {
    const parsed = parseForESLint(source, {
      ecmaVersion: 2022,
      sourceType: sourceTypeFor(file),
      ecmaFeatures: { jsx: /\.(tsx|jsx)$/.test(file) },
      loc: true,
      range: true,
    });
    const ast = parsed.ast as unknown as N;
    const manager = parsed.scopeManager as unknown as { acquire(n: N, inner?: boolean): N | null; scopes: N[] };
    const parents = new Map<N, N | undefined>();
    const stack: Array<[N, N | undefined]> = [[ast, undefined]];
    while (stack.length > 0) {
      const [node, parent] = stack.pop()!;
      parents.set(node, parent);
      for (const key of Object.keys(node)) {
        if (SKIP_KEYS.has(key)) continue;
        const value = node[key];
        if (Array.isArray(value)) {
          for (const item of value) if (item && typeof item.type === 'string') stack.push([item, node]);
        } else if (value && typeof value === 'object' && typeof value.type === 'string') stack.push([value, node]);
      }
    }
    // The same walk ESLint's SourceCode.getScope does.
    const getScope = (start: N): N => {
      for (let n: N | undefined = start; n; n = parents.get(n)) {
        const scope = manager.acquire(n, true);
        if (scope) return scope.type === 'function-expression-name' ? scope.childScopes[0] : scope;
      }
      return manager.scopes[0];
    };
    return { file, ast, parents, context: { sourceCode: { getScope } } as unknown as Rule.RuleContext };
  } catch {
    return undefined;
  }
}

/** The variable `name` that `from` sees, as the scope manager recorded it. */
export function lookup(sf: ScopeFile, from: N, name: string): N | undefined {
  let scope = (sf.context.sourceCode as unknown as { getScope(n: N): N | undefined }).getScope(from);
  while (scope) {
    const v = scope.set.get(name) as N | undefined;
    if (v) return v;
    scope = scope.upper as N | undefined;
  }
  return undefined;
}

/** Type-only wrappers: they change the static type, never the value. */
export function strip(node: N | null | undefined): N | undefined {
  let n = node ?? undefined;
  while (n && (n.type === 'TSAsExpression' || n.type === 'TSNonNullExpression' || n.type === 'TSSatisfiesExpression' || n.type === 'TSTypeAssertion' || n.type === 'ChainExpression')) {
    n = n.expression as N | undefined;
  }
  return n;
}

/** An export `name` of package (or module specifier) `pkg`; `*` is the whole module, `default` its default export. Otherwise the expression the name leads to. */
export type Origin = { pkg: string; name: string; expr?: undefined } | { expr: N; pkg?: undefined; name?: undefined };

/** `import ns from 'playwright'` and `import * as ns` / `require(...)` all give the module object of a launcher package. */
const isModuleObject = (o: Origin | undefined): o is { pkg: string; name: string } =>
  !!o && o.pkg !== undefined && (o.name === '*' || (o.name === 'default' && PLAYWRIGHT_PACKAGE.test(o.pkg) && !TEST_PACKAGE.test(o.pkg)));

/**
 * Follows an expression to the import it stands for. An identifier is followed through its import, or through a
 * single-assignment `const` (the existing `resolveConstInit`, identifier declarator only) and a `const { a } = <module>`
 * pattern; `<module>.a` and `require('pkg')` are read directly. Undefined when the name has no single, constant binding.
 */
export function origin(sf: ScopeFile, node: N | undefined, steps = 0): Origin | undefined {
  const e = strip(node);
  if (!e || steps > MAX_STEPS) return undefined;
  if (e.type === 'Identifier') {
    const v = lookup(sf, e, e.name);
    if (!v || v.defs.length !== 1) return undefined;
    const def = v.defs[0] as N;
    if (def.type === 'ImportBinding') {
      const spec = def.node as N;
      const source = def.parent?.type === 'ImportDeclaration' ? def.parent.source?.value : undefined;
      if (typeof source !== 'string') return undefined;
      if (spec.type === 'ImportSpecifier') return { pkg: source, name: String(spec.imported?.name ?? spec.imported?.value) };
      return { pkg: source, name: spec.type === 'ImportDefaultSpecifier' ? 'default' : '*' };
    }
    if (def.type !== 'Variable' || def.parent?.kind !== 'const') return undefined;
    const declarator = def.node as N;
    if (declarator.id?.type === 'Identifier') {
      const init = resolveConstInit(sf.context, e as unknown as AstNode) as N | undefined;
      return init ? origin(sf, init, steps + 1) : undefined;
    }
    if (declarator.id?.type !== 'ObjectPattern' || !declarator.init) return undefined;
    const prop = (declarator.id.properties as N[]).find((p) => p.type === 'Property' && !p.computed && p.value === def.name);
    const from = origin(sf, declarator.init, steps + 1);
    return prop?.key?.type === 'Identifier' && isModuleObject(from) ? { pkg: from.pkg, name: prop.key.name } : undefined;
  }
  if (e.type === 'CallExpression' && e.callee?.type === 'Identifier' && e.callee.name === 'require' && e.arguments?.length === 1) {
    const arg = e.arguments[0] as N;
    const local = lookup(sf, e.callee, 'require');
    if (arg.type === 'Literal' && typeof arg.value === 'string' && !(local && local.defs.length > 0)) return { pkg: arg.value, name: '*' };
    return { expr: e };
  }
  if (e.type === 'MemberExpression' && !e.computed && e.property?.type === 'Identifier') {
    const from = origin(sf, e.object, steps + 1);
    if (isModuleObject(from)) return { pkg: from.pkg, name: e.property.name };
  }
  return { expr: e };
}

/**
 * Does `node` denote Playwright's `test`? True for `test` imported or required from a Playwright test package, for a
 * local module that re-exports it (followed up to MAX_FILE_DEPTH files, through tsconfig and workspace resolution),
 * for `.extend(...)` of one, and for `mergeTests(...)` whose arguments are all such objects.
 */
export function isPlaywrightTest(env: ResolveEnv, sf: ScopeFile, node: N | undefined, fileDepth = 0, steps = 0): boolean {
  if (steps > MAX_STEPS) return false;
  const o = origin(sf, node);
  if (!o) return false;
  if (o.pkg !== undefined) return exportIsTest(env, sf.file, o.pkg, o.name, fileDepth);
  const e = o.expr;
  if (e.type !== 'CallExpression') return false;
  const callee = strip(e.callee);
  if (callee?.type === 'MemberExpression' && !callee.computed && callee.property?.type === 'Identifier' && callee.property.name === 'extend') {
    return isPlaywrightTest(env, sf, callee.object, fileDepth, steps + 1);
  }
  const fn = origin(sf, callee);
  if (!fn || fn.pkg === undefined || !TEST_PACKAGE.test(fn.pkg) || fn.name !== 'mergeTests') return false;
  const args = (e.arguments ?? []) as N[];
  return args.length > 0 && args.every((a) => a.type !== 'SpreadElement' && isPlaywrightTest(env, sf, a, fileDepth, steps + 1));
}

function exportIsTest(env: ResolveEnv, fromFile: string, pkg: string, name: string, fileDepth: number): boolean {
  if (PLAYWRIGHT_PACKAGE.test(pkg)) return TEST_PACKAGE.test(pkg) && (name === 'test' || name === 'default');
  if (name === '*' || fileDepth >= MAX_FILE_DEPTH) return false;
  const target = env.resolve(fromFile, pkg);
  const sf = target === undefined ? undefined : env.load(target);
  return sf ? moduleExportIsTest(env, sf, name, fileDepth + 1) : false;
}

const isModuleExports = (n: N | undefined): boolean =>
  n?.type === 'MemberExpression' && !n.computed && n.object?.type === 'Identifier' && n.object.name === 'module' && n.property?.name === 'exports';

/** `exports` or `module`, the CommonJS globals: an identifier that is not a property name and not a local binding. */
const isCommonJsGlobal = (sf: ScopeFile, n: N, parent: N | undefined): boolean => {
  if (n.type !== 'Identifier' || (n.name !== 'exports' && n.name !== 'module') || !parent) return false;
  if ((parent.type === 'MemberExpression' && parent.property === n && !parent.computed) || (parent.type === 'Property' && parent.key === n && !parent.computed)) return false;
  return !((lookup(sf, n, n.name)?.defs.length ?? 0) > 0);
};

/**
 * Does the file touch its CommonJS exports anywhere but in the top-level assignments in `read`? Any other mention
 * (`Object.assign(module.exports, ...)`, an assignment inside an `if`, `exports[key] = ...`, `module` passed on)
 * can replace an export, so nothing the file exports is proven.
 */
function writesExportsElsewhere(sf: ScopeFile, read: ReadonlySet<N>): boolean {
  for (const [n, parent] of sf.parents) {
    if (read.has(n)) continue;
    if (isModuleExports(n) && isCommonJsGlobal(sf, n.object, n)) return true;
    if (isCommonJsGlobal(sf, n, parent) && !(n.name === 'module' && isModuleExports(parent))) return true;
  }
  return false;
}

/** Is the export `name` of this local module Playwright's `test`? Every declaration of the export must be one. */
function moduleExportIsTest(env: ResolveEnv, sf: ScopeFile, name: string, fileDepth: number): boolean {
  const verdicts: boolean[] = [];
  const stars: string[] = [];
  const read = new Set<N>();
  let wholeAssignments = 0;
  const here = (n: N | undefined): boolean => isPlaywrightTest(env, sf, n, fileDepth);
  for (const st of (sf.ast.body ?? []) as N[]) {
    if (st.type === 'ExportNamedDeclaration') {
      if (st.declaration?.type === 'VariableDeclaration') {
        for (const d of st.declaration.declarations as N[]) {
          if (d.id?.type === 'Identifier' && d.id.name === name) verdicts.push(st.declaration.kind === 'const' && !!d.init && here(d.init));
        }
      }
      for (const spec of (st.specifiers ?? []) as N[]) {
        if ((spec.exported?.name ?? spec.exported?.value) !== name) continue;
        const local = String(spec.local?.name ?? spec.local?.value);
        verdicts.push(typeof st.source?.value === 'string' ? exportIsTest(env, sf.file, st.source.value, local, fileDepth) : here(spec.local));
      }
    } else if (st.type === 'ExportDefaultDeclaration') {
      if (name === 'default') verdicts.push(here(st.declaration));
    } else if (st.type === 'ExportAllDeclaration') {
      if (!st.exported && name !== 'default' && typeof st.source?.value === 'string') stars.push(st.source.value);
    } else if (st.type === 'ExpressionStatement' && st.expression?.type === 'AssignmentExpression' && st.expression.operator === '=') {
      const { left, right } = st.expression as { left: N; right: N };
      if (isModuleExports(left)) {
        // The whole export object. Only one object literal is read; anything else (a call, a class, a second assignment) proves nothing.
        wholeAssignments += 1;
        if (right.type !== 'ObjectExpression' || wholeAssignments > 1) return false;
        read.add(left);
        for (const p of right.properties as N[]) {
          const key = p.type === 'Property' && !p.computed ? (p.key?.type === 'Identifier' ? p.key.name : p.key?.value) : undefined;
          if (key === undefined) verdicts.push(false);
          else if (key === name) verdicts.push(here(p.value));
        }
      } else if (left.type === 'MemberExpression' && !left.computed && left.property?.type === 'Identifier' && (isModuleExports(left.object) || (left.object?.type === 'Identifier' && left.object.name === 'exports'))) {
        read.add(left.object);
        if (left.property.name === name) verdicts.push(here(right));
      }
    }
  }
  if (writesExportsElsewhere(sf, read)) return false;
  if (verdicts.length > 0) return verdicts.every(Boolean);
  return stars.length === 1 && exportIsTest(env, sf.file, stars[0], name, fileDepth);
}

/**
 * `Page` or `Frame` when the annotation names that type from a Playwright package: `Page` imported by name (also
 * renamed), `ns.Page` through a namespace import, or `import('<package>').Page`. Anything else is undefined.
 */
export function playwrightType(sf: ScopeFile, annotation: N | null | undefined): 'Page' | 'Frame' | undefined {
  const t = annotation?.type === 'TSTypeAnnotation' ? (annotation.typeAnnotation as N | undefined) : (annotation ?? undefined);
  if (!t) return undefined;
  let found: { pkg: string; name: string } | undefined;
  if (t.type === 'TSTypeReference' && !t.typeArguments && !t.typeParameters) {
    const tn = t.typeName as N | undefined;
    if (tn?.type === 'Identifier') {
      const o = origin(sf, tn);
      if (o?.pkg !== undefined) found = o;
    } else if (tn?.type === 'TSQualifiedName' && tn.left?.type === 'Identifier' && tn.right?.type === 'Identifier') {
      const o = origin(sf, tn.left);
      if (o?.pkg !== undefined && (o.name === '*' || o.name === 'default')) found = { pkg: o.pkg, name: tn.right.name };
    }
  } else if (t.type === 'TSImportType' && !t.typeArguments && !t.typeParameters) {
    const source = (t.argument?.literal ?? t.source ?? t.argument) as N | undefined;
    if (source?.type === 'Literal' && typeof source.value === 'string' && t.qualifier?.type === 'Identifier') found = { pkg: source.value, name: t.qualifier.name };
  }
  if (!found || !PLAYWRIGHT_PACKAGE.test(found.pkg)) return undefined;
  return found.name === 'Page' || found.name === 'Frame' ? found.name : undefined;
}
