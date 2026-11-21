/**
 * Receiver forms (QAG-287 B2).
 *
 * The rules in RECEIVER_TIERED_RULES report a method by name on something
 * called `page` or `frame`. This step never adds, removes or rewrites a
 * finding. It only decides the form: `-` when the receiver is proven to be a
 * Playwright Page or Frame, `unresolved` otherwise. The proof list is closed,
 * positive evidence only:
 *
 *  E1 fixture  a destructured `page`, `context` or `browser` parameter of a
 *              callback passed to a call on Playwright's `test` (a test, a
 *              hook or a step); a single-assignment `const` alias of a proven
 *              receiver is proven too.
 *  E2 type     the binding, class field or constructor parameter property is
 *              annotated `Page` or `Frame` from a Playwright package.
 *  E3 factory  every assignment is a Playwright factory call on a proven
 *              receiver, or on a launcher imported from a Playwright package.
 *
 * Untyped parameters, helper return values, members of other objects,
 * bindings with other writes, redeclared `var`s and loop or catch bindings are
 * `unresolved` by design. Any internal error also yields `unresolved`.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Finding } from './types.js';
import { RECEIVER_TIERED_RULES } from './catalogue/receiver-unresolved.js';
import { resolveImportSpecifier, type ImportResolver } from './import-graph.js';
import { resolveConstInit, type N as AstNode } from './rules/ast-util.js';
import { isPlaywrightPackage, isPlaywrightTest, lookup, origin, parseScopeFile, playwrightType, strip } from './rules/scope-resolve.js';
import type { N, ResolveEnv, ScopeFile } from './rules/scope-resolve.js';

export { RECEIVER_TIERED_RULES };

/** Switch for the unit test that compares the findings with the step on and off. */
export const receiverForms = { enabled: true };

export interface ReceiverContext {
  /** Directory the findings' `file` paths are relative to. */
  filesBase: string;
  /** Scored spec files, absolute path -> source. */
  sources: ReadonlyMap<string, string>;
  /** Locally imported files already read, absolute path -> source. */
  importedFiles?: ReadonlyMap<string, string>;
  /** Directory imports may not climb out of (defaults to filesBase). */
  importBoundary?: string;
  moduleResolver?: ImportResolver;
}

type Kind = 'page' | 'frame' | 'context' | 'browser' | 'app' | 'launcher' | 'electron';

/** Method names each rule reports, and the receivers that prove the finding. */
const REPORTED: ReadonlyMap<string, { methods: readonly string[]; on: readonly Kind[] }> = new Map([
  ['playwright/no-wait-for-selector', { methods: ['waitForSelector'], on: ['page', 'frame'] }],
  ['playwright/no-wait-for-navigation', { methods: ['waitForNavigation'], on: ['page', 'frame'] }],
  ['playwright/no-element-handle', { methods: ['$', '$$'], on: ['page', 'frame'] }],
  ['playwright/no-page-pause', { methods: ['pause'], on: ['page'] }],
]);

const table = (rows: Array<[Kind, Array<[string, Kind]>]>): ReadonlyMap<Kind, ReadonlyMap<string, Kind>> =>
  new Map(rows.map(([k, v]) => [k, new Map(v)]));

/** Launchers a Playwright package exports. */
const LAUNCHERS: ReadonlyMap<string, Kind> = new Map([['chromium', 'launcher'], ['firefox', 'launcher'], ['webkit', 'launcher'], ['_electron', 'electron']]);
/** `receiver.method(...)`: what a Playwright factory call returns. */
const CALLS = table([
  ['launcher', [['launch', 'browser'], ['connect', 'browser'], ['connectOverCDP', 'browser'], ['launchPersistentContext', 'context']]],
  ['electron', [['launch', 'app']]],
  ['browser', [['newPage', 'page'], ['newContext', 'context']]],
  ['context', [['newPage', 'page']]],
  ['page', [['mainFrame', 'frame'], ['frame', 'frame']]],
  ['app', [['firstWindow', 'page']]],
]);
/** `receiver.method()[i]`: one item of a list a Playwright object returns. */
const LISTS = table([['context', [['pages', 'page']]], ['page', [['frames', 'frame']]], ['app', [['windows', 'page']]]]);
/** `receiver.waitForEvent('<name>')` resolves to a Page for these events. */
const PAGE_EVENTS: ReadonlyMap<Kind, string> = new Map([['context', 'page'], ['page', 'popup'], ['app', 'window']]);
/** Members of `test` whose callback takes the fixtures object (or sits in a test, for `step`). */
const TEST_MEMBERS = new Set(['only', 'skip', 'fixme', 'fail', 'slow', 'step', 'beforeEach', 'afterEach', 'beforeAll', 'afterAll']);
const FIXTURES: ReadonlyMap<string, Kind> = new Map([['page', 'page'], ['context', 'context'], ['browser', 'browser']]);
const MAX_STEPS = 12;

const unwrap = (node: N | null | undefined): N | undefined => {
  let n = strip(node);
  while (n?.type === 'AwaitExpression') n = strip(n.argument as N | undefined);
  return n;
};
const typeKind = (t: 'Page' | 'Frame' | undefined): Kind | undefined => (t === 'Page' ? 'page' : t === 'Frame' ? 'frame' : undefined);

function launcherOf(sf: ScopeFile, e: N): Kind | undefined {
  const o = origin(sf, e);
  return o?.pkg !== undefined && isPlaywrightPackage(o.pkg) ? LAUNCHERS.get(o.name) : undefined;
}

/** E1: `name` is `{ page }`, `{ page: name }`, `{ context }` or `{ browser }` in the first parameter of a callback passed to a call on Playwright's `test`. */
function fixtureParam(env: ResolveEnv, sf: ScopeFile, fn: N, name: N, variable: N): Kind | undefined {
  if ((variable.references as N[]).some((r) => r.isWrite())) return undefined;
  const first = (fn.params as N[] | undefined)?.[0];
  if (first?.type !== 'ObjectPattern') return undefined;
  const prop = (first.properties as N[]).find((p) => p.type === 'Property' && !p.computed && p.value === name);
  const kind = prop?.key?.type === 'Identifier' ? FIXTURES.get(prop.key.name) : undefined;
  const call = sf.parents.get(fn);
  if (!kind || call?.type !== 'CallExpression' || !(call.arguments as N[]).includes(fn)) return undefined;
  let callee = strip(call.callee);
  while (callee?.type === 'MemberExpression' && !callee.computed && callee.property?.type === 'Identifier' && TEST_MEMBERS.has(callee.property.name)) {
    callee = strip(callee.object);
  }
  return callee && isPlaywrightTest(env, sf, callee) ? kind : undefined;
}

/** E2 for `this.x`: the class of the enclosing instance member declares `x` once, as a typed field or constructor parameter property. */
function thisField(sf: ScopeFile, member: N, name: string): Kind | undefined {
  let child = member;
  let n = sf.parents.get(child);
  for (; n; child = n, n = sf.parents.get(n)) {
    if ((n.type === 'MethodDefinition' || n.type === 'PropertyDefinition') && n.value === child) break;
    if (n.type === 'FunctionDeclaration' || n.type === 'StaticBlock' || (n.type === 'FunctionExpression' && sf.parents.get(n)?.type !== 'MethodDefinition')) return undefined;
  }
  const body = n && !n.static ? sf.parents.get(n) : undefined;
  if (body?.type !== 'ClassBody') return undefined;
  const declared: Array<N | undefined> = [];
  const keyIs = (m: N): boolean => !m.computed && m.key?.type === 'Identifier' && m.key.name === name;
  for (const m of body.body as N[]) {
    if (m.type === 'MethodDefinition' && m.kind === 'constructor') {
      for (const p of (m.value?.params ?? []) as N[]) {
        const id = p.type === 'TSParameterProperty' ? (p.parameter?.type === 'AssignmentPattern' ? p.parameter.left : p.parameter) : undefined;
        if (id?.type === 'Identifier' && id.name === name) declared.push(id.typeAnnotation);
      }
    } else if (keyIs(m) && !m.static) declared.push(m.type === 'PropertyDefinition' ? m.typeAnnotation : undefined);
  }
  return declared.length === 1 ? typeKind(playwrightType(sf, declared[0])) : undefined;
}

function proveIdentifier(env: ResolveEnv, sf: ScopeFile, id: N, steps: number): Kind | undefined {
  const v = lookup(sf, id, id.name);
  if (!v || v.defs.length !== 1) return undefined;
  const def = v.defs[0] as N;
  const name = def.name as N;
  if (def.type === 'Parameter') {
    const fn = def.node as N;
    const direct = ((fn.params ?? []) as N[]).some((p) => {
      const q = p.type === 'TSParameterProperty' ? p.parameter : p;
      return q === name || (q?.type === 'AssignmentPattern' && q.left === name);
    });
    return direct ? typeKind(playwrightType(sf, name.typeAnnotation)) : fixtureParam(env, sf, fn, name, v);
  }
  if (def.type !== 'Variable' || def.node?.type !== 'VariableDeclarator' || def.node.id !== name) return undefined;
  const typed = typeKind(playwrightType(sf, name.typeAnnotation));
  if (typed) return typed;
  if (def.parent?.kind === 'const') {
    // A single-assignment const: an alias of a proven receiver, or a factory call (the existing resolver, identifier declarator only).
    const init = resolveConstInit(sf.context, id as unknown as AstNode) as N | undefined;
    return init ? prove(env, sf, init, steps + 1) : undefined;
  }
  // let / var: every assignment must be a plain `=` of a Playwright factory call, all of one kind.
  let kind: Kind | undefined;
  for (const r of (v.references as N[]).filter((x) => x.isWrite())) {
    const value = r.writeExpr as N | undefined;
    const p = sf.parents.get(r.identifier as N);
    const plain = (p?.type === 'VariableDeclarator' && p.id === r.identifier && p.init === value) || (p?.type === 'AssignmentExpression' && p.operator === '=' && p.left === r.identifier && p.right === value);
    const shape = unwrap(value);
    if (!plain || !shape || (shape.type !== 'CallExpression' && !(shape.type === 'MemberExpression' && shape.computed))) return undefined;
    const k = prove(env, sf, shape, steps + 1);
    if (!k || (kind && k !== kind)) return undefined;
    kind = k;
  }
  return kind;
}

/** What `expr` is proven to be, or undefined. */
function prove(env: ResolveEnv, sf: ScopeFile, expr: N | undefined, steps = 0): Kind | undefined {
  const e = unwrap(expr);
  if (!e || steps > MAX_STEPS) return undefined;
  if (e.type === 'Identifier') return launcherOf(sf, e) ?? proveIdentifier(env, sf, e, steps);
  if (e.type === 'MemberExpression') {
    if (e.object?.type === 'ThisExpression') return !e.computed && e.property?.type === 'Identifier' ? thisField(sf, e, e.property.name) : undefined;
    if (!e.computed) return launcherOf(sf, e);
    const list = unwrap(e.object);
    const callee = list?.type === 'CallExpression' && list.arguments?.length === 0 ? strip(list.callee) : undefined;
    if (callee?.type !== 'MemberExpression' || callee.computed || callee.property?.type !== 'Identifier') return undefined;
    const receiver = prove(env, sf, callee.object, steps + 1);
    return receiver ? LISTS.get(receiver)?.get(callee.property.name) : undefined;
  }
  if (e.type !== 'CallExpression') return undefined;
  const callee = strip(e.callee);
  if (callee?.type !== 'MemberExpression' || callee.computed || callee.property?.type !== 'Identifier') return undefined;
  const receiver = prove(env, sf, callee.object, steps + 1);
  if (!receiver) return undefined;
  if (callee.property.name === 'waitForEvent') {
    const arg = e.arguments?.[0] as N | undefined;
    return arg?.type === 'Literal' && arg.value === PAGE_EVENTS.get(receiver) ? 'page' : undefined;
  }
  return CALLS.get(receiver)?.get(callee.property.name);
}

function propertyName(callee: N): string | undefined {
  const p = callee.property as N | undefined;
  if (!callee.computed) return p?.type === 'Identifier' ? p.name : undefined;
  if (p?.type === 'Literal' && typeof p.value === 'string') return p.value;
  return p?.type === 'TemplateLiteral' && p.expressions?.length === 0 ? p.quasis?.[0]?.value?.cooked : undefined;
}

const callIndex = new WeakMap<ScopeFile, Map<string, N[]>>();

/** Calls of one of `methods` that start at the reported position. The rules report the call, or its callee, which starts where the receiver starts. */
function reportedCalls(sf: ScopeFile, line: number, column: number, methods: readonly string[]): N[] {
  let index = callIndex.get(sf);
  if (!index) {
    index = new Map();
    for (const n of sf.parents.keys()) {
      const start = n.type === 'CallExpression' && n.callee?.type === 'MemberExpression' ? (n.loc?.start as { line: number; column: number } | undefined) : undefined;
      if (!start) continue;
      const key = `${start.line}:${start.column + 1}`;
      const list = index.get(key);
      if (list) list.push(n);
      else index.set(key, [n]);
    }
    callIndex.set(sf, index);
  }
  return (index.get(`${line}:${column}`) ?? []).filter((n) => {
    const name = propertyName(n.callee);
    return name !== undefined && methods.includes(name);
  });
}

function createEnv(ctx: ReceiverContext): ResolveEnv {
  const cache = new Map<string, ScopeFile | undefined>();
  const boundary = ctx.importBoundary ?? ctx.filesBase;
  return {
    load(file) {
      if (cache.has(file)) return cache.get(file);
      let sf: ScopeFile | undefined;
      try {
        const source = ctx.sources.get(file) ?? ctx.importedFiles?.get(file) ?? fs.readFileSync(file, 'utf8');
        sf = typeof source === 'string' ? parseScopeFile(source, file) : undefined;
      } catch {
        sf = undefined;
      }
      cache.set(file, sf);
      return sf;
    },
    resolve(fromFile, specifier) {
      try {
        return resolveImportSpecifier(fromFile, specifier, boundary, ctx.moduleResolver);
      } catch {
        return undefined;
      }
    },
  };
}

/** Is the receiver of the finding's call proven to be a Playwright Page or Frame? Every call the finding may point at must be. */
export function receiverIsProven(env: ResolveEnv, ctx: ReceiverContext, f: Pick<Finding, 'rule' | 'file' | 'line' | 'column'>): boolean {
  const reported = REPORTED.get(f.rule);
  if (!reported || typeof f.line !== 'number' || typeof f.column !== 'number' || typeof f.file !== 'string') return false;
  const sf = env.load(path.resolve(ctx.filesBase, f.file));
  if (!sf) return false;
  const calls = reportedCalls(sf, f.line, f.column, reported.methods);
  return calls.length > 0 && calls.every((c) => {
    const kind = prove(env, sf, c.callee.object as N);
    return kind !== undefined && reported.on.includes(kind);
  });
}

/**
 * Sets `form` on every finding of a receiver-tiered rule that has none yet: `-` when the receiver is proven,
 * `unresolved` otherwise. In place; no finding is added, removed or otherwise changed, and nothing here throws.
 */
export function applyReceiverForms(findings: Finding[], ctx: ReceiverContext): void {
  if (!receiverForms.enabled) return;
  let env: ResolveEnv | undefined;
  for (const f of findings) {
    if (f.form !== undefined || !RECEIVER_TIERED_RULES.includes(f.rule)) continue;
    let proven = false;
    try {
      env ??= createEnv(ctx);
      proven = receiverIsProven(env, ctx, f);
    } catch {
      proven = false;
    }
    f.form = proven ? '-' : 'unresolved';
  }
}
