import { isFunction } from './eslint-postfilter.js';
import type { N, Tree } from './eslint-postfilter.js';
import { memberName } from './rules/ast-util.js';
import { MAX_ALIAS_DEPTH, isExpectSubjectCall, isPageLike, isReference, resolve, unwrap } from './read-ast.js';

// QAG-287 B3 (C8): the `capture-window` form of `playwright/no-networkidle`.
//
// In the same test or hook, a `request`, `response`, `requestfinished` or `console` listener is registered
// on the page before the networkidle wait, and a later assertion uses what that listener collected. The
// settle then closes a measurement window; it is not a readiness wait. The finding stays, with its own copy.

export const CAPTURE_WINDOW_FORM = 'capture-window';

/** Switch for the unit test that compares findings with the form on and off. */
export const captureWindow = { enabled: true };

const CAPTURE_EVENTS = new Set(['request', 'response', 'requestfinished', 'console']);
const LISTEN_METHODS = new Set(['on', 'once', 'addListener', 'prependListener']);
/** Methods that add to a collection. */
const FILL_METHODS = new Set(['push', 'unshift', 'add', 'set']);

const start = (n: N): number => (n.range as [number, number])[0];

/** The test or hook body around `n`: the nearest function, going out through `test.step` callbacks. */
function testBody(t: Tree, n: N): N | undefined {
  let fn = t.enclosingFunction(n);
  for (;;) {
    const call = fn ? t.parent(fn) : undefined;
    const callee = call?.type === 'CallExpression' ? (call.callee as N) : undefined;
    if (!fn || callee?.type !== 'MemberExpression' || memberName(callee) !== 'step') return fn;
    const outer = t.enclosingFunction(fn);
    if (!outer) return fn;
    fn = outer;
  }
}

/** `page.on('response', handler)`: the handler when the call registers one of the capture events on a page. */
function captureHandler(t: Tree, n: N): N | undefined {
  if (n.type !== 'CallExpression' || n.callee?.type !== 'MemberExpression' || !LISTEN_METHODS.has(memberName(n.callee) ?? '')) return undefined;
  const [event, handler] = (n.arguments ?? []) as N[];
  if (event?.type !== 'Literal' || !CAPTURE_EVENTS.has(String(event.value)) || !isPageLike(t, n.callee.object as N)) return undefined;
  const h = unwrap(handler);
  if (isFunction(h)) return h;
  if (h?.type !== 'Identifier') return undefined;
  // A named handler: `const onResponse = (r) => ...` or `function onResponse(r) { ... }`.
  const b = resolve(t, h, h.name);
  if (!b) return undefined;
  if (b.hasInit) return isFunction(unwrap(b.decl.init as N)) ? unwrap(b.decl.init as N) : undefined;
  return b.decl.type === 'FunctionDeclaration' ? b.decl : undefined;
}

/** The variable written at `n`, when `n` adds to or sets one: `list.push(x)`, `seen[k] = x`, `count++`, `failed = true`. */
function writtenName(n: N): N | undefined {
  let target: N | undefined;
  if (n.type === 'CallExpression' && n.callee?.type === 'MemberExpression' && FILL_METHODS.has(memberName(n.callee) ?? '')) target = n.callee.object as N;
  else if (n.type === 'AssignmentExpression') target = n.left as N;
  else if (n.type === 'UpdateExpression') target = n.argument as N;
  while (target?.type === 'MemberExpression') target = target.object as N;
  return target?.type === 'Identifier' ? target : undefined;
}

/** Declarations of the variables the handler fills that live outside it. */
function filledByHandler(t: Tree, handler: N): Set<N> {
  const out = new Set<N>();
  t.some(handler, (n) => {
    const id = writtenName(n);
    const b = id ? resolve(t, id, id.name) : undefined;
    if (b && !t.some(handler, (inner) => inner === b.decl)) out.add(b.decl);
    return false;
  });
  return out;
}

/** Does `expr` use one of the collections, directly or through a variable derived from one (`const failed = statuses.filter(...)`)? */
function usesCollection(t: Tree, expr: N, collections: Set<N>, depth = 0): boolean {
  return t.some(expr, (n) => {
    if (n.type !== 'Identifier' || !isReference(t, n)) return false;
    const b = resolve(t, n, n.name);
    if (!b) return false;
    if (collections.has(b.decl)) return true;
    return b.hasInit && depth < MAX_ALIAS_DEPTH && usesCollection(t, b.decl.init as N, collections, depth + 1);
  });
}

/** An `expect(...)` chain or an `assert` call: the whole statement expression. */
function assertionAt(t: Tree, n: N): N | undefined {
  if (isExpectSubjectCall(n)) return t.chainTop(n);
  if (n.type !== 'CallExpression') return undefined;
  const callee = n.callee as N;
  const root = callee.type === 'MemberExpression' ? (callee.object as N) : callee;
  return root.type === 'Identifier' && root.name === 'assert' ? n : undefined;
}

/** The form of every other finding of the rule: the plain wait. */
export const PLAIN_WAIT_FORM = '-';

/**
 * Form of the no-networkidle finding reported at (line, column): `capture-window`, or `-` for the plain wait.
 * Always one of the two: with two rows in the catalogue, a finding without a form would have no cell.
 */
export function captureWindowForm(t: Tree | undefined, line: number, column: number): string {
  return (captureWindow.enabled && t && isCaptureWindow(t, line, column)) ? CAPTURE_WINDOW_FORM : PLAIN_WAIT_FORM;
}

function isCaptureWindow(t: Tree, line: number, column: number): boolean {
  const node = t.nodeAt(line, column);
  if (!node) return false;
  const body = testBody(t, node);
  if (!body) return false;
  const at = start(node);
  const collections = new Set<N>();
  t.some(body, (n) => {
    if (start(n) >= at) return false;
    const handler = captureHandler(t, n);
    if (handler) for (const d of filledByHandler(t, handler)) collections.add(d);
    return false;
  });
  if (collections.size === 0) return false;
  return t.some(body, (n) => {
    if (start(n) <= at) return false;
    const assertion = assertionAt(t, n);
    return !!assertion && usesCollection(t, assertion, collections);
  });
}
