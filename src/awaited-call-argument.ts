import type { N, Tree } from './eslint-postfilter.js';

/**
 * QAG-287 B3c: form `awaited-call-argument` of playwright/missing-playwright-await.
 *
 * An assertion (an `expect` chain, `expect.poll` or `test.step`) whose promise is passed straight into another
 * call, where that call's own chain is awaited, returned or the body of an arrow function:
 *
 *   await inStep('pricing heading', expect(heading).toBeVisible());
 *
 * The assertion is not awaited where it is written. Whether it can still fail the test depends on whether the
 * receiving function awaits it, which the call site cannot show, so the finding is likely, never certain.
 * Narrowing only: the finding is reported exactly as before; only its form (and so its copy) changes.
 */

/** Switch for the unit test that compares the findings with the step on and off (in-process scoring only). */
export const awaitedCallArgument = { enabled: true };

export const AWAITED_CALL_ARGUMENT_FORM = 'awaited-call-argument';

/** Wrappers that change only the static type of an expression, not its value. */
const TYPE_ONLY_WRAPPERS = new Set(['TSAsExpression', 'TSSatisfiesExpression', 'TSTypeAssertion', 'TSNonNullExpression']);

/** Is `n` awaited, returned, or the expression body of an arrow function? */
export function isAwaitedPosition(t: Tree, n: N): boolean {
  const p = t.parent(n);
  return !!p && (p.type === 'AwaitExpression' || p.type === 'ReturnStatement' || (p.type === 'ArrowFunctionExpression' && p.body === n));
}

/**
 * Is the reported chain passed straight into a call whose chain is in an awaited position? The chain, through
 * type-only wrappers and nothing else, must be one of the call's arguments (not its callee). An argument inside an
 * object, array, conditional or spread, a promise stored in a variable, an outer call that is not awaited and a
 * callback body all keep their form.
 */
export function isAwaitedCallArgument(t: Tree, node: N): boolean {
  let arg = t.chainTop(node);
  for (let p = t.parent(arg); p && TYPE_ONLY_WRAPPERS.has(p.type) && p.expression === arg; p = t.parent(arg)) arg = p;
  const call = t.parent(arg);
  if (!call || call.type !== 'CallExpression' || call.callee === arg) return false;
  return (call.arguments as N[]).includes(arg) && isAwaitedPosition(t, t.chainTop(call));
}

/**
 * The form of a missing-playwright-await finding, given the form the post-filter decided from the chain itself
 * (`assertion` or `action`). Only an `assertion` can move; an `action` is never touched.
 */
export function callArgumentForm(t: Tree, node: N, form: 'assertion' | 'action'): string {
  if (form !== 'assertion' || !awaitedCallArgument.enabled) return form;
  return isAwaitedCallArgument(t, node) ? AWAITED_CALL_ARGUMENT_FORM : form;
}
