/**
 * Binding resolver (QAG-287 B2.2): what a name in a file denotes.
 *
 * One question, for any name: "which export of which package does this
 * expression denote?" The answer comes from scope analysis and never from the
 * spelling of a name. The shapes that count are closed:
 *  V1  an identifier bound by one value import;
 *  V2  an identifier bound by one single-assignment `const` (the existing `resolveConstInit`);
 *  V3  `const { a } = <module object>`;
 *  V4  `require('<literal>')`;
 *  V5  `<module object>.a`;
 *  T   a type name bound by an import (type position only);
 *  B1  the export `test` of a Playwright test package; B2 `.extend(...)` of one; B3 `mergeTests(...)` of such objects;
 *  B4  `.extend(...)` or `.configure(...)` of Playwright's `expect`; B5 `mergeExpects(...)` of such objects.
 * Every other shape is "not proven", with a reason. Nothing here guesses.
 */
import { parseForESLint } from '@typescript-eslint/parser';
import { resolveConstInit, type N as AstNode } from './ast-util.js';
import { sourceTypeFor } from '../source-type.js';
import { specifier } from './module-exports.js';
import { MAX_FILE_DEPTH, MAX_STEPS, isExpectExport, isMergeExpects, isPlaywrightPackage, isTestExport, isTestPackage, notProven, proven } from './proof.js';
import type { N, NotProven, PackageExport, ProofRule, Proven, ResolveEnv, Result, ScopeFile, Walk } from './proof.js';

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
    return { file, ast, parents, context: { sourceCode: { getScope } } };
  } catch {
    return undefined;
  }
}

/** The variable `name` that `from` sees, as the scope manager recorded it. */
export function lookup(sf: ScopeFile, from: N, name: string): N | undefined {
  let scope = (sf.context.sourceCode as { getScope(n: N): N | undefined }).getScope(from);
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

/** An export `name` of the module a specifier names, not yet resolved; `*` is the whole module, `default` its default export. */
export interface Ref {
  spec: string;
  name: string;
  at: N;
}
/** Not a result: the name leads to this expression (a call, for example), which the caller reads. */
export interface Leads {
  ok: 'expr';
  expr: N;
  via: readonly ProofRule[];
}

/** `import * as ns`, `require(...)` and, for a launcher package, `import ns from` all give a module object. */
const isModuleObject = (r: Ref): boolean => r.name === '*' || (r.name === 'default' && isPlaywrightPackage(r.spec) && !isTestPackage(r.spec));

/** Value position, rules V1 to V5. The default of every branch is "not proven". */
export function origin(sf: ScopeFile, node: N | null | undefined, steps = 0): Result<Ref> | Leads {
  const e = strip(node);
  if (!e) return notProven('not-a-binding-shape', sf.file, node);
  if (steps > MAX_STEPS) return notProven('steps', sf.file, e);
  if (e.type === 'Identifier') return identifier(sf, e, steps);
  if (e.type === 'CallExpression' && e.callee?.type === 'Identifier' && e.callee.name === 'require') {
    const arg = e.arguments?.length === 1 ? (e.arguments[0] as N) : undefined;
    const local = lookup(sf, e.callee, 'require');
    if (arg?.type === 'Literal' && typeof arg.value === 'string' && !(local && local.defs.length > 0)) return proven('V4', { spec: arg.value, name: '*', at: e });
    return notProven('not-a-binding-shape', sf.file, e);
  }
  if (e.type === 'MemberExpression') {
    if (e.computed || e.property?.type !== 'Identifier') return notProven('not-a-binding-shape', sf.file, e);
    const from = origin(sf, e.object, steps + 1);
    if (from.ok === true && isModuleObject(from.value)) return proven('V5', { spec: from.value.spec, name: e.property.name as string, at: e }, from.rules);
    return from.ok === false ? from : notProven('not-a-binding-shape', sf.file, e);
  }
  return { ok: 'expr', expr: e, via: [] };
}

function identifier(sf: ScopeFile, e: N, steps: number): Result<Ref> | Leads {
  const v = lookup(sf, e, e.name);
  if (!v || v.defs.length === 0) return notProven('global-or-undeclared', sf.file, e);
  if (v.defs.length !== 1) return notProven('multiple-definitions', sf.file, e);
  const def = v.defs[0] as N;
  if (def.type === 'ImportBinding') {
    const spec = def.node as N;
    const decl = def.parent as N | undefined;
    const name = spec.type === 'ImportSpecifier' ? String(spec.imported?.name ?? spec.imported?.value) : spec.type === 'ImportDefaultSpecifier' ? 'default' : spec.type === 'ImportNamespaceSpecifier' ? '*' : undefined;
    const valueImport = decl?.type === 'ImportDeclaration' && typeof decl.source?.value === 'string' && decl.importKind !== 'type' && spec.importKind !== 'type';
    return valueImport && name !== undefined ? proven('V1', { spec: decl!.source.value as string, name, at: spec }) : notProven('not-a-binding-shape', sf.file, spec);
  }
  if (def.type !== 'Variable' || def.parent?.kind !== 'const') return notProven('not-a-binding-shape', sf.file, def.name);
  const declarator = def.node as N;
  if (declarator.id?.type === 'Identifier') {
    const init = resolveConstInit(sf.context, e as unknown as AstNode) as N | undefined;
    if (!init) return notProven('not-a-binding-shape', sf.file, declarator);
    const inner = origin(sf, init, steps + 1);
    if (inner.ok === true) return proven('V2', inner.value, inner.rules);
    return inner.ok === 'expr' ? { ok: 'expr', expr: inner.expr, via: [...inner.via, 'V2'] } : inner;
  }
  if (declarator.id?.type !== 'ObjectPattern' || !declarator.init) return notProven('not-a-binding-shape', sf.file, declarator);
  const prop = (declarator.id.properties as N[]).find((p) => p.type === 'Property' && !p.computed && p.value === def.name);
  if (prop?.key?.type !== 'Identifier') return notProven('not-a-binding-shape', sf.file, declarator);
  const from = origin(sf, declarator.init, steps + 1);
  if (from.ok === true && isModuleObject(from.value)) return proven('V3', { spec: from.value.spec, name: prop.key.name as string, at: declarator }, from.rules);
  return from.ok === false ? from : notProven('not-a-binding-shape', sf.file, declarator);
}

/** A walk that follows no further local module than `depth`: the question a launcher, a type or `mergeTests` asks. */
const shallow = (env: ResolveEnv, depth: number): Walk => {
  const walk: Walk = { maxDepth: depth, stack: [], value: (sf, node, d, via) => denotes(env, sf, node, d, walk, via) };
  return walk;
};
const testWalk = (env: ResolveEnv): Walk => {
  const walk: Walk = { maxDepth: MAX_FILE_DEPTH, stack: [], value: (sf, node, d, via) => playwrightTest(env, sf, node, d, walk, via) };
  return walk;
};

/** Which export of which package does `node` denote? Outcome 1 or 2, or "not proven". Follows imports and `require`, never a call. */
export function denotes(env: ResolveEnv, sf: ScopeFile, node: N | null | undefined, depth = 0, walk: Walk = shallow(env, depth), via: readonly ProofRule[] = []): Result<PackageExport> {
  const o = origin(sf, node);
  if (o.ok === true) return specifier(env, sf, o.value.spec, o.value.name, o.value.at, depth, walk, [...via, ...o.rules]);
  return o.ok === false ? o : notProven('not-a-playwright-export', sf.file, o.expr);
}

/** The methods of Playwright's `expect` that return an `expect` (playwright.dev/docs/test-assertions: `expect.extend`, `expect.configure`). */
const EXPECT_MAKERS = new Set(['extend', 'configure']);

/**
 * Which export of which package does an `expect` denote, also through local modules that re-export it (up to
 * MAX_FILE_DEPTH files, each chosen by rule R)? The question an `expect` binding asks (S4b). The only calls it
 * reads: B4 `.extend(...)` or `.configure(...)` of an expect proven to be Playwright's, and B5 `mergeExpects(...)`
 * of a Playwright test package whose arguments are all such objects. Both denote Playwright's `expect`. The same
 * call on any other expect is "not proven", as every other call is.
 */
export function playwrightExpect(env: ResolveEnv, sf: ScopeFile, node: N | null | undefined, depth = 0, walk?: Walk, via: readonly ProofRule[] = [], steps = 0): Result<PackageExport> {
  const w: Walk = walk ?? { maxDepth: MAX_FILE_DEPTH, stack: [], value: (file, expr, d, trail) => playwrightExpect(env, file, expr, d, w, trail) };
  const o = origin(sf, node);
  if (o.ok === false) return o;
  if (o.ok === true) return specifier(env, sf, o.value.spec, o.value.name, o.value.at, depth, w, [...via, ...o.rules]);
  const e = o.expr;
  const trail = [...via, ...o.via];
  const callee = e.type === 'CallExpression' && steps <= MAX_STEPS ? strip(e.callee) : undefined;
  if (callee?.type === 'MemberExpression' && !callee.computed && callee.property?.type === 'Identifier' && EXPECT_MAKERS.has(callee.property.name)) {
    const base = playwrightExpect(env, sf, callee.object, depth, w, trail, steps + 1);
    if (base.ok && isExpectExport(base.value)) return proven('B4', base.value, base.rules);
  } else if (callee) {
    // `mergeExpects` itself must be the export of a test package: no local module is followed for it.
    const fn = denotes(env, sf, callee, depth, shallow(env, depth), trail);
    const args = (e.arguments ?? []) as N[];
    if (fn.ok && isMergeExpects(fn.value) && args.length > 0 && !args.some((a) => a.type === 'SpreadElement')) {
      const merged = args.map((a) => playwrightExpect(env, sf, a, depth, w, trail, steps + 1));
      const first = merged[0];
      if (first.ok && merged.every((m) => m.ok && isExpectExport(m.value))) return proven('B5', first.value, fn.rules, ...merged.map((m) => (m.ok ? m.rules : [])));
    }
  }
  return notProven('not-a-playwright-export', sf.file, e);
}

/**
 * Does `node` denote Playwright's `test`? B1: the export `test` of a test package, also through local modules that
 * re-export it (up to MAX_FILE_DEPTH files, each chosen by rule R). B2: `.extend(...)` of one. B3: `mergeTests(...)`
 * whose arguments are all such objects. A fixture override inside `.extend` is not examined (axiom A2).
 */
export function playwrightTest(env: ResolveEnv, sf: ScopeFile, node: N | null | undefined, depth = 0, walk: Walk = testWalk(env), via: readonly ProofRule[] = [], steps = 0): Result<PackageExport> {
  if (steps > MAX_STEPS) return notProven('steps', sf.file, node);
  const o = origin(sf, node);
  if (o.ok === false) return o;
  if (o.ok === true) {
    const d = specifier(env, sf, o.value.spec, o.value.name, o.value.at, depth, walk, [...via, ...o.rules]);
    if (!d.ok) return d;
    return isTestExport(d.value) ? proven('B1', d.value, d.rules) : notProven('not-a-playwright-export', sf.file, o.value.at);
  }
  const e = o.expr;
  const trail = [...via, ...o.via];
  if (e.type !== 'CallExpression') return notProven('not-a-playwright-export', sf.file, e);
  const callee = strip(e.callee);
  if (callee?.type === 'MemberExpression' && !callee.computed && callee.property?.type === 'Identifier' && callee.property.name === 'extend') {
    const base = playwrightTest(env, sf, callee.object, depth, walk, trail, steps + 1);
    return base.ok ? proven('B2', base.value, base.rules) : base;
  }
  // `mergeTests` itself must be the export of a test package: no local module is followed for it.
  const fn = denotes(env, sf, callee, depth, shallow(env, depth), trail);
  const args = (e.arguments ?? []) as N[];
  if (!fn.ok || !fn.value.playwright || !isTestPackage(fn.value.package) || fn.value.name !== 'mergeTests' || args.length === 0 || args.some((a) => a.type === 'SpreadElement')) {
    return notProven('not-a-playwright-export', sf.file, e);
  }
  const merged: Array<Proven<PackageExport>> = [];
  for (const a of args) {
    const r = playwrightTest(env, sf, a, depth, walk, trail, steps + 1);
    if (!r.ok) return r;
    merged.push(r);
  }
  return proven('B3', merged[0].value, fn.rules, ...merged.map((m) => m.rules));
}

/** Rule T: the declaration of a type name must be one import (of either `importKind`). V2 and V3 never apply to a type. */
function typeImport(sf: ScopeFile, id: N): Ref | NotProven {
  const v = lookup(sf, id, id.name);
  if (!v || v.defs.length === 0) return notProven('type-needs-import', sf.file, id);
  if (v.defs.length !== 1) return notProven('multiple-definitions', sf.file, id);
  const def = v.defs[0] as N;
  const spec = def.node as N;
  const source = def.type === 'ImportBinding' && def.parent?.type === 'ImportDeclaration' ? def.parent.source?.value : undefined;
  if (typeof source !== 'string') return notProven('type-needs-import', sf.file, id);
  if (spec.type === 'ImportSpecifier') return { spec: source, name: String(spec.imported?.name ?? spec.imported?.value), at: spec };
  return { spec: source, name: spec.type === 'ImportDefaultSpecifier' ? 'default' : '*', at: spec };
}

function typeRef(sf: ScopeFile, t: N): Ref | NotProven {
  if (t.typeArguments || t.typeParameters) return notProven('not-a-playwright-export', sf.file, t);
  if (t.type === 'TSTypeReference') {
    const tn = t.typeName as N | undefined;
    if (tn?.type === 'Identifier') return typeImport(sf, tn);
    if (tn?.type === 'TSQualifiedName' && tn.left?.type === 'Identifier' && tn.right?.type === 'Identifier') {
      const ns = typeImport(sf, tn.left);
      if ('ok' in ns) return ns;
      return ns.name === '*' || ns.name === 'default' ? { spec: ns.spec, name: tn.right.name as string, at: ns.at } : notProven('type-needs-import', sf.file, tn);
    }
    return notProven('type-needs-import', sf.file, t);
  }
  if (t.type === 'TSImportType') {
    const source = (t.argument?.literal ?? t.source ?? t.argument) as N | undefined;
    if (source?.type === 'Literal' && typeof source.value === 'string' && t.qualifier?.type === 'Identifier') return { spec: source.value, name: t.qualifier.name as string, at: t };
  }
  return notProven('type-needs-import', sf.file, t);
}

/**
 * `Page` or `Frame` when the annotation names that type from a Playwright package: `Page` imported by name (also
 * renamed), `ns.Page` through a namespace or default import, or `import('<package>').Page`.
 */
export function playwrightType(env: ResolveEnv, sf: ScopeFile, annotation: N | null | undefined): Result<'Page' | 'Frame'> {
  const t = annotation?.type === 'TSTypeAnnotation' ? (annotation.typeAnnotation as N | undefined) : (annotation ?? undefined);
  if (!t) return notProven('receiver-shape', sf.file, annotation);
  const ref = typeRef(sf, t);
  if ('ok' in ref) return ref;
  const d = specifier(env, sf, ref.spec, ref.name, ref.at, 0, shallow(env, 0), []);
  if (!d.ok) return d;
  const name = d.value.name;
  return d.value.playwright && (name === 'Page' || name === 'Frame') ? proven('T', name, d.rules) : notProven('not-a-playwright-export', sf.file, t);
}
