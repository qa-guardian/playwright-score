/**
 * QAG-287 S7a (class C5): an awaited assertion inside an async callback that nobody awaits.
 *
 * Flags `items.forEach(async (x) => { await expect(...)... })`, and the same with `.map(...)`, when the call's
 * result is discarded (the call is an expression statement). `forEach` and `map` do not wait for the promises
 * their callback returns, so the test can finish before the assertion runs, and a failing assertion never
 * fails the test. Reported at the `forEach` / `map` name.
 *
 * "Assertion" is an `expect(...)` matcher chain, `expect.soft(...)`, `expect.poll(...)` or `expect(fn).toPass()`
 * whose `expect` is read as `expect` the way the expect binding reads it (src/expect-binding.ts). The binding then
 * decides, after the lint run: a proven Playwright `expect` keeps the finding, a proven foreign one drops it, and an
 * unresolved one makes it `needs-check` with the reason.
 *
 * Not flagged: `for...of` with `await`; `await Promise.all(items.map(async ...))`; a `map` or `forEach` whose result
 * is awaited, assigned, returned or passed on (a custom `forEach` that awaits its callbacks returns a promise, and
 * awaiting it is how it is used); a callback that is not async; an assertion that is not awaited; an assertion inside
 * a function nested in the callback (it belongs to that function).
 */
import type { Rule } from 'eslint';
import { memberName, type N } from './ast-util.js';

export const FLOATING_CALLBACK_RULE = 'pwscore/no-floating-callback-assertion';

/** The array methods whose callback promises are never awaited. */
const METHODS = new Set(['forEach', 'map']);
const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
/** Wrappers that pass a value through unchanged. */
const PASS_THROUGH = new Set(['ChainExpression', 'TSNonNullExpression', 'TSAsExpression', 'TSSatisfiesExpression', 'TSTypeAssertion', 'ParenthesizedExpression']);
/** Keys that point back up or carry no child nodes. */
const NOT_CHILDREN = new Set(['parent', 'loc', 'range', 'tokens', 'comments', 'typeAnnotation', 'returnType', 'typeParameters', 'typeArguments']);

/** Names the expect binding reads as `expect`: `expect`, any name that ends in `Expect` (src/expect-binding.ts). */
export const EXPECT_NAME = /(^expect|Expect)$/;

const unwrap = (n: N | null | undefined): N | undefined => {
  let x = n ?? undefined;
  for (let i = 0; x && PASS_THROUGH.has(x.type) && i < 16; i++) x = (x as N & { expression?: N }).expression;
  return x;
};

/**
 * The `expect` identifier of an assertion chain: `expect(a).not.toBe(b)`, `expect.soft(a).toBe(b)`,
 * `expect.poll(fn).toBe(b)`, `expect(fn).toPass()`, also another library's `expect(a).to.equal(b)`.
 * The node must be the matcher call itself; `isExpect` says whether an identifier is read as `expect`.
 */
export function assertionRoot(node: N | null | undefined, isExpect: (id: N) => boolean): N | undefined {
  const call = unwrap(node);
  if (call?.type !== 'CallExpression' || call.callee?.type !== 'MemberExpression') return undefined;
  let n: N | undefined = call.callee;
  for (let i = 0; n?.type === 'MemberExpression' && !n.computed && i < 16; i++) n = unwrap(n.object);
  if (n?.type !== 'CallExpression') return undefined;
  const c = n.callee;
  if (!c) return undefined;
  if (c.type === 'Identifier') return isExpect(c) ? c : undefined;
  if (c.type !== 'MemberExpression' || c.computed || (c.property?.name !== 'soft' && c.property?.name !== 'poll')) return undefined;
  const head = c.object;
  return head && head.type === 'Identifier' && isExpect(head) ? head : undefined;
}

/** The `expect` identifiers of the awaited assertions in a function's own body (not in functions nested in it). */
export function awaitedAssertionRoots(fn: N, isExpect: (id: N) => boolean): N[] {
  const out: N[] = [];
  const visit = (v: unknown, depth: number): void => {
    if (!v || typeof v !== 'object' || depth > 500) return;
    if (Array.isArray(v)) {
      for (const x of v) visit(x, depth + 1);
      return;
    }
    const n = v as N;
    if (typeof n.type !== 'string' || FUNCTIONS.has(n.type)) return;
    if (n.type === 'AwaitExpression') {
      const root = assertionRoot(n.argument, isExpect);
      if (root) out.push(root);
    }
    for (const k of Object.keys(n)) if (!NOT_CHILDREN.has(k)) visit((n as Record<string, unknown>)[k], depth + 1);
  };
  visit(fn.body, 0);
  return out;
}

/** The async callback of a `forEach` / `map` call, or undefined when the call is not of that shape. */
export function asyncCallback(call: N): N | undefined {
  if (call.type !== 'CallExpression' || !METHODS.has(memberName(call.callee) ?? '')) return undefined;
  const cb = call.arguments?.[0];
  return (cb?.type === 'ArrowFunctionExpression' || cb?.type === 'FunctionExpression') && (cb as N & { async?: boolean }).async ? cb : undefined;
}

/** Is the call's result thrown away (the call, through pass-through wrappers, is an expression statement)? */
function discarded(call: N): boolean {
  let child = call;
  let p = call.parent;
  for (let i = 0; p && PASS_THROUGH.has(p.type) && i < 16; i++) {
    child = p;
    p = p.parent;
  }
  return p?.type === 'ExpressionStatement' && (p as N & { expression?: N }).expression === child;
}

type Scope = { set: Map<string, { defs: Array<{ type: string; node: N }> }>; upper: Scope | null };

export const noFloatingCallbackAssertion: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow awaited assertions inside an async forEach/map callback whose promises are never awaited' },
    messages: {
      floating:
        '{{method}}() does not wait for its async callback, so the assertion inside can run after the test has finished and never fail it. Use for...of with await, or await Promise.all(items.map(...)).',
    },
    schema: [],
  },
  create(context) {
    const sourceCode = context.sourceCode as unknown as { getScope(n: unknown): Scope };
    // The binding's reading of `expect`: the name, or a named import of `expect` under another local name.
    const isExpect = (id: N): boolean => {
      const name = id.name ?? '';
      if (EXPECT_NAME.test(name)) return true;
      for (let s: Scope | null = sourceCode.getScope(id); s; s = s.upper) {
        const v = s.set.get(name);
        if (!v) continue;
        return v.defs.some((d) => {
          const spec = d.node as N & { imported?: N };
          return d.type === 'ImportBinding' && spec.type === 'ImportSpecifier' && (spec.imported?.name ?? spec.imported?.value) === 'expect';
        });
      }
      return false;
    };
    return {
      CallExpression(raw) {
        const call = raw as unknown as N;
        const cb = asyncCallback(call);
        if (!cb || !discarded(call)) return;
        if (awaitedAssertionRoots(cb, isExpect).length === 0) return;
        const name = call.callee!.property!;
        context.report({ node: name as unknown as Rule.Node, messageId: 'floating', data: { method: name.name ?? '' } });
      },
    };
  },
};
