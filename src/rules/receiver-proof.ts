/**
 * Receiver proof (QAG-287 B2.2): is an expression proven to be a Playwright
 * Page or Frame (or the Context, Browser, app or launcher that leads to one)?
 *
 * The proof list is closed, positive evidence only:
 *  E1 fixture  a destructured `page`, `context` or `browser` parameter of a
 *              callback passed to a call on Playwright's `test` (a test, a
 *              hook or a step); a single-assignment `const` alias of a proven
 *              receiver is proven too.
 *  E2 type     the binding, class field or constructor parameter property is
 *              annotated `Page` or `Frame` from a Playwright package.
 *  E3 factory  every assignment is a Playwright factory call on a proven
 *              receiver, or on a launcher imported from a Playwright package.
 * Everything else is "not proven", with a reason.
 */
import { resolveConstInit, type N as AstNode } from './ast-util.js';
import { denotes, lookup, playwrightTest, playwrightType, strip } from './scope-resolve.js';
import { MAX_STEPS, notProven, proven } from './proof.js';
import type { N, ProofRule, Reason, ResolveEnv, Result, ScopeFile } from './proof.js';

export type Kind = 'page' | 'frame' | 'context' | 'browser' | 'app' | 'launcher' | 'electron';

/** Method names each rule reports, and the receivers that prove the finding. */
export const REPORTED: ReadonlyMap<string, { methods: readonly string[]; on: readonly Kind[] }> = new Map([
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

type Proof = Result<Kind>;

const unwrap = (node: N | null | undefined): N | undefined => {
  let n = strip(node);
  while (n?.type === 'AwaitExpression') n = strip(n.argument as N | undefined);
  return n;
};

/** E3, the one place a factory result is made: `kind` is what the closed tables give for a call on proven receivers. */
const factory = (sf: ScopeFile, e: N, kind: Kind | undefined, from: readonly ProofRule[], reason: Reason = 'receiver-shape'): Proof =>
  kind ? proven('E3', kind, from) : notProven(reason, sf.file, e);

/** A launcher exported by a Playwright package (`chromium`, `_electron`, ...), imported or required; no local module is followed. */
function launcherOf(env: ResolveEnv, sf: ScopeFile, e: N): Proof {
  const o = denotes(env, sf, e);
  if (!o.ok) return o;
  return factory(sf, e, o.value.playwright ? LAUNCHERS.get(o.value.name) : undefined, o.rules, 'not-a-playwright-export');
}

/** E2: the annotation names Playwright's `Page` or `Frame`. */
function typed(env: ResolveEnv, sf: ScopeFile, annotation: N | null | undefined): Proof {
  const t = playwrightType(env, sf, annotation);
  return t.ok ? proven('E2', t.value === 'Page' ? 'page' : 'frame', t.rules) : t;
}

/** E1: `name` is `{ page }`, `{ page: name }`, `{ context }` or `{ browser }` in the first parameter of a callback passed to a call on Playwright's `test`. */
function fixtureParam(env: ResolveEnv, sf: ScopeFile, fn: N, name: N, variable: N): Proof {
  if ((variable.references as N[]).some((r) => r.isWrite())) return notProven('binding-written', sf.file, name);
  const first = (fn.params as N[] | undefined)?.[0];
  if (first?.type !== 'ObjectPattern') return notProven('receiver-shape', sf.file, name);
  const prop = (first.properties as N[]).find((p) => p.type === 'Property' && !p.computed && p.value === name);
  const kind = prop?.key?.type === 'Identifier' ? FIXTURES.get(prop.key.name) : undefined;
  const call = sf.parents.get(fn);
  if (!kind || call?.type !== 'CallExpression' || !(call.arguments as N[]).includes(fn)) return notProven('receiver-shape', sf.file, name);
  let callee = strip(call.callee);
  while (callee?.type === 'MemberExpression' && !callee.computed && callee.property?.type === 'Identifier' && TEST_MEMBERS.has(callee.property.name)) {
    callee = strip(callee.object);
  }
  const test = playwrightTest(env, sf, callee);
  return test.ok ? proven('E1', kind, test.rules) : test;
}

/** E2 for `this.x`: the class of the enclosing instance member declares `x` once, as a typed field or constructor parameter property. */
function thisField(env: ResolveEnv, sf: ScopeFile, member: N, name: string): Proof {
  const no = notProven('class-member', sf.file, member);
  let child = member;
  let n = sf.parents.get(child);
  for (; n; child = n, n = sf.parents.get(n)) {
    if ((n.type === 'MethodDefinition' || n.type === 'PropertyDefinition') && n.value === child) break;
    if (n.type === 'FunctionDeclaration' || n.type === 'StaticBlock' || (n.type === 'FunctionExpression' && sf.parents.get(n)?.type !== 'MethodDefinition')) return no;
  }
  const body = n && !n.static ? sf.parents.get(n) : undefined;
  if (body?.type !== 'ClassBody') return no;
  const declared: Array<N | undefined> = [];
  const keyIs = (m: N): boolean => !m.computed && m.key?.type === 'Identifier' && m.key.name === name;
  for (const m of body.body as N[]) {
    // A computed key on an instance member can name the same field: nothing is proven for `this.x`.
    if (m.computed && !m.static) return no;
    if (m.type === 'MethodDefinition' && m.kind === 'constructor') {
      for (const p of (m.value?.params ?? []) as N[]) {
        const id = p.type === 'TSParameterProperty' ? (p.parameter?.type === 'AssignmentPattern' ? p.parameter.left : p.parameter) : undefined;
        if (id?.type === 'Identifier' && id.name === name) declared.push(id.typeAnnotation);
      }
    } else if (keyIs(m) && !m.static) declared.push(m.type === 'PropertyDefinition' ? m.typeAnnotation : undefined);
  }
  return declared.length === 1 && declared[0] ? typed(env, sf, declared[0]) : no;
}

function proveIdentifier(env: ResolveEnv, sf: ScopeFile, id: N, steps: number): Proof {
  const v = lookup(sf, id, id.name);
  if (!v || v.defs.length === 0) return notProven('global-or-undeclared', sf.file, id);
  if (v.defs.length !== 1) return notProven('multiple-definitions', sf.file, id);
  const def = v.defs[0] as N;
  const name = def.name as N;
  if (def.type === 'Parameter') {
    const fn = def.node as N;
    const direct = ((fn.params ?? []) as N[]).some((p) => {
      const q = p.type === 'TSParameterProperty' ? p.parameter : p;
      return q === name || (q?.type === 'AssignmentPattern' && q.left === name);
    });
    return direct ? typed(env, sf, name.typeAnnotation) : fixtureParam(env, sf, fn, name, v);
  }
  if (def.type !== 'Variable' || def.node?.type !== 'VariableDeclarator' || def.node.id !== name) return notProven('receiver-shape', sf.file, id);
  const byType = typed(env, sf, name.typeAnnotation);
  if (byType.ok) return byType;
  if (def.parent?.kind === 'const') {
    // A single-assignment const: an alias of a proven receiver, or a factory call (the existing resolver, identifier declarator only).
    const init = resolveConstInit(sf.context, id as unknown as AstNode) as N | undefined;
    return init ? prove(env, sf, init, steps + 1) : notProven('receiver-shape', sf.file, id);
  }
  // let / var: every assignment must be a plain `=` of a Playwright factory call, all of one kind.
  let found: Proof = name.typeAnnotation ? byType : notProven('binding-written', sf.file, id);
  let kind: Kind | undefined;
  for (const r of (v.references as N[]).filter((x) => x.isWrite())) {
    const value = r.writeExpr as N | undefined;
    const p = sf.parents.get(r.identifier as N);
    const plain = (p?.type === 'VariableDeclarator' && p.id === r.identifier && p.init === value) || (p?.type === 'AssignmentExpression' && p.operator === '=' && p.left === r.identifier && p.right === value);
    const shape = unwrap(value);
    if (!plain || !shape || (shape.type !== 'CallExpression' && !(shape.type === 'MemberExpression' && shape.computed))) return notProven('binding-written', sf.file, r.identifier as N);
    const k = prove(env, sf, shape, steps + 1);
    if (!k.ok) return k;
    if (kind && k.value !== kind) return notProven('binding-written', sf.file, r.identifier as N);
    kind = k.value;
    found = k;
  }
  return found;
}

/** What `expr` is proven to be, or why it is not. The last branch of every dispatch is "not proven". */
export function prove(env: ResolveEnv, sf: ScopeFile, expr: N | null | undefined, steps = 0): Proof {
  const e = unwrap(expr);
  if (!e) return notProven('receiver-shape', sf.file, expr);
  if (steps > MAX_STEPS) return notProven('steps', sf.file, e);
  if (e.type === 'Identifier') {
    const launcher = launcherOf(env, sf, e);
    return launcher.ok ? launcher : proveIdentifier(env, sf, e, steps);
  }
  if (e.type === 'MemberExpression') {
    if (e.object?.type === 'ThisExpression') return !e.computed && e.property?.type === 'Identifier' ? thisField(env, sf, e, e.property.name) : notProven('class-member', sf.file, e);
    if (!e.computed) return launcherOf(env, sf, e);
    const list = unwrap(e.object);
    const callee = list?.type === 'CallExpression' && list.arguments?.length === 0 ? strip(list.callee) : undefined;
    if (callee?.type !== 'MemberExpression' || callee.computed || callee.property?.type !== 'Identifier') return notProven('receiver-shape', sf.file, e);
    const receiver = prove(env, sf, callee.object, steps + 1);
    return receiver.ok ? factory(sf, e, LISTS.get(receiver.value)?.get(callee.property.name), receiver.rules) : receiver;
  }
  if (e.type === 'CallExpression') {
    const callee = strip(e.callee);
    if (callee?.type !== 'MemberExpression' || callee.computed || callee.property?.type !== 'Identifier') return notProven('receiver-shape', sf.file, e);
    const receiver = prove(env, sf, callee.object, steps + 1);
    if (!receiver.ok) return receiver;
    const arg = e.arguments?.[0] as N | undefined;
    const kind: Kind | undefined = callee.property.name === 'waitForEvent'
      ? (arg?.type === 'Literal' && arg.value === PAGE_EVENTS.get(receiver.value) ? 'page' : undefined)
      : CALLS.get(receiver.value)?.get(callee.property.name);
    return factory(sf, e, kind, receiver.rules);
  }
  return notProven('receiver-shape', sf.file, e);
}
