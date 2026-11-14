/**
 * Assertions that cannot fail, or assert almost nothing. Exact shapes:
 *
 *  1. `expect(<count>).toBeGreaterThanOrEqual(0)` / `.toBeGreaterThan(-1)`
 *     (no `.not`), where <count> is `.length`, `[await] x.count()`, a const
 *     initialised from one of those, or `expect.poll(() => x.count())`.
 *  2. `expect(<Locator>).toBeTruthy()` / `.toBeDefined()` / `.not.toBeNull()`
 *     / `.not.toBeUndefined()`; <Locator> is syntactic only: `page.locator()`,
 *     `x.getBy*()`, those chained with first/last/nth/filter/locator, or a
 *     const initialised from one. A Locator object is always truthy.
 *  3. `expect(await x.isVisible()).toBeDefined()` (also isHidden, isEnabled,
 *     isDisabled, isChecked, isEditable, count, innerText, innerHTML,
 *     inputValue, title; textContent/getAttribute only for toBeDefined):
 *     these always return a value, so "defined" proves nothing.
 *
 * `toBeTruthy()` on any other value is NOT flagged.
 */
import type { Rule } from 'eslint';
import { FN_TYPES, isLocatorExpr, memberName, parseMatcherCall, resolveConstInit, unwrap, type N } from './ast-util.js';

const ALWAYS_VALUE = new Set([
  'isVisible', 'isHidden', 'isEnabled', 'isDisabled', 'isChecked', 'isEditable',
  'count', 'innerText', 'innerHTML', 'inputValue', 'title',
]);
const MAYBE_NULL = new Set(['textContent', 'getAttribute']); // null is "defined"

function isCountish(context: Rule.RuleContext, node: N | undefined, depth = 0): boolean {
  const n = unwrap(node);
  if (!n || depth > 2) return false;
  if (n.type === 'MemberExpression' && !n.computed && n.property?.name === 'length') return true;
  if (n.type === 'CallExpression' && memberName(n.callee) === 'count') return true;
  if (n.type === 'Identifier') {
    const init = resolveConstInit(context, n);
    return init ? isCountish(context, init, depth + 1) : false;
  }
  return false;
}

function negativeLiteral(arg: N | undefined, want: number): boolean {
  if (!arg) return false;
  if (arg.type === 'Literal') return arg.value === want;
  return arg.type === 'UnaryExpression' && arg.operator === '-' && arg.argument?.type === 'Literal' && -(arg.argument.value as number) === want;
}

export const noWeakAssertion: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow assertions that cannot fail or assert almost nothing' },
    messages: {
      count: 'A count is never negative, so this assertion cannot fail. Assert the expected count, or use expect(locator).toHaveCount(n).',
      locator: 'A Locator object is always truthy/defined, so this assertion cannot fail. Use a web-first assertion such as expect(locator).toBeVisible().',
      defined: 'This call always returns a value, so asserting it is defined cannot fail. Assert the value itself, or use a web-first assertion.',
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(raw) {
        const node = raw as unknown as N;
        const m = parseMatcherCall(node);
        if (!m || m.modifiers.some((x) => x === 'resolves' || x === 'rejects')) return;
        const not = m.modifiers.includes('not');
        const arg0 = (m.expectCall.arguments ?? [])[0];
        const isPoll = m.expectCall.callee?.type === 'MemberExpression' && m.expectCall.callee.property?.name === 'poll';

        // 1. count >= 0
        if (!not && ((m.matcher === 'toBeGreaterThanOrEqual' && negativeLiteral((node.arguments ?? [])[0], 0)) ||
            (m.matcher === 'toBeGreaterThan' && negativeLiteral((node.arguments ?? [])[0], -1)))) {
          let subject = arg0;
          if (isPoll && subject && FN_TYPES.has(subject.type) && subject.type === 'ArrowFunctionExpression' && (subject.body as N).type !== 'BlockStatement') {
            subject = subject.body as N;
          }
          if (isCountish(context, subject)) context.report({ node: raw, messageId: 'count' });
          return;
        }

        // 2. Locator truthy
        const truthy = (!not && (m.matcher === 'toBeTruthy' || m.matcher === 'toBeDefined')) ||
          (not && (m.matcher === 'toBeNull' || m.matcher === 'toBeUndefined'));
        if (truthy && !isPoll) {
          if (isLocatorExpr(context, arg0)) {
            context.report({ node: raw, messageId: 'locator' });
            return;
          }
          // 3. value-returning call asserted "defined"
          const subj = unwrap(arg0);
          const name = subj?.type === 'CallExpression' ? memberName(subj.callee) : undefined;
          if (name) {
            const definedCheck = (!not && m.matcher === 'toBeDefined') || (not && m.matcher === 'toBeUndefined');
            const nullCheck = not && m.matcher === 'toBeNull';
            if ((definedCheck && (ALWAYS_VALUE.has(name) || MAYBE_NULL.has(name))) || (nullCheck && ALWAYS_VALUE.has(name))) {
              context.report({ node: raw, messageId: 'defined' });
            }
          }
        }
      },
    };
  },
};
