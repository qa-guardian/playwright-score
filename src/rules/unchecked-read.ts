import type { Rule } from 'eslint';
import { isPlaywrightReceiver, type N } from './ast-util.js';
import { enclosingFunction, hookName, isPwReceiver, isTestDeclaration, propName, testNamesFromOptions, TEST_ALIAS_SCHEMA, unwrap, type AnyNode } from './rule-util.js';

/**
 * `pwscore/unchecked-read` (QAG-287 N2). A Playwright read whose answer nothing looks at. Two forms, each its own cell:
 *
 *  discarded       an expression statement that is only `isVisible()` or `isHidden()` on a page, frame or locator,
 *                  awaited or not: `await page.getByRole('alert').isVisible();`. The call does not wait and returns at
 *                  once, and its result is thrown away, so the line checks nothing.
 *  unused-binding  `const x = await <receiver>.<read>(...)` (or `let`) directly in a test, hook or `test.step` body,
 *                  where <read> is one of READS below and ESLint's scope manager finds no read of `x`. A name that
 *                  starts with `_` is a deliberate discard and is left alone.
 *
 * The receiver must be what `isPwReceiver` or `isPlaywrightReceiver` already recognise (the page, a `.page` property, a
 * locator chain, or a const bound to one); any other receiver gives no finding. Not matched: `void`, `return`, an `if`
 * or any other use of the call, a destructuring pattern, `var`, a read that is not awaited, and a binding in a helper
 * or a nested callback. The form comes from the reported node (its message id).
 */

const DISCARDED = new Set(['isVisible', 'isHidden']);
/** Reads whose bound value is the only thing a test can check. */
const READS = new Set([
  'isVisible',
  'isHidden',
  'isEnabled',
  'isDisabled',
  'isChecked',
  'isEditable',
  'textContent',
  'innerText',
  'innerHTML',
  'inputValue',
  'getAttribute',
  'count',
  'allTextContents',
  'allInnerTexts',
  'title',
  'url',
  'boundingBox',
]);

export type UncheckedReadForm = 'discarded' | 'unused-binding';
const MESSAGE_FORMS: Readonly<Record<string, UncheckedReadForm>> = { discarded: 'discarded', unusedBinding: 'unused-binding' };

/** Form of a finding of this rule, from the message id it was reported with. */
export const uncheckedReadForm = (messageId: string | undefined): UncheckedReadForm | undefined => (messageId ? MESSAGE_FORMS[messageId] : undefined);

/** The page, a frame or a locator, as the existing helpers recognise it. */
function knownReceiver(context: Rule.RuleContext, node: AnyNode): boolean {
  return isPwReceiver(context, node) || isPlaywrightReceiver(context, node as N);
}

/** `<receiver>.<name>(...)` with a method in `names` on a known receiver: gives the method name. */
function readCall(context: Rule.RuleContext, node: AnyNode, names: ReadonlySet<string>): string | undefined {
  const call = unwrap(node);
  if (call?.type !== 'CallExpression') return undefined;
  const callee = unwrap(call.callee);
  if (callee?.type !== 'MemberExpression') return undefined;
  const name = propName(callee);
  if (!name || !names.has(name)) return undefined;
  return knownReceiver(context, callee.object) ? name : undefined;
}

/** `test.step(title, fn)` on a test name. */
function isStepCall(call: AnyNode, testNames: ReadonlySet<string>): boolean {
  const c = call?.callee;
  return c?.type === 'MemberExpression' && c.object?.type === 'Identifier' && testNames.has(c.object.name) && propName(c) === 'step';
}

/** The function is the body of a test, a hook or a step: a direct argument of that call. */
function isTestBody(fn: AnyNode, testNames: ReadonlySet<string>): boolean {
  const call = fn?.parent;
  if (call?.type !== 'CallExpression' || !call.arguments.includes(fn)) return false;
  return isTestDeclaration(call, testNames) || !!hookName(call, testNames) || isStepCall(call, testNames);
}

export const uncheckedRead: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow Playwright reads whose result is never checked' },
    messages: {
      discarded:
        '`{{name}}()` returns at once and its result is thrown away, so this line checks nothing. Use `await expect(locator).{{matcher}}()`, which waits and fails the test.',
      unusedBinding:
        '`{{id}}` holds the result of `{{name}}()` but is never used, so the value read from the page is never checked. Assert on it with `expect`, or remove the read.',
    },
    schema: TEST_ALIAS_SCHEMA,
  },
  create(context) {
    const testNames = testNamesFromOptions(context.options);
    return {
      ExpressionStatement(node: AnyNode) {
        let expr = unwrap(node.expression);
        if (expr?.type === 'AwaitExpression') expr = unwrap(expr.argument);
        const name = readCall(context, expr, DISCARDED);
        if (!name) return;
        context.report({ node: expr as never, messageId: 'discarded', data: { name, matcher: name === 'isVisible' ? 'toBeVisible' : 'toBeHidden' } });
      },
      VariableDeclarator(node: AnyNode) {
        const decl = node.parent;
        if (decl?.type !== 'VariableDeclaration' || (decl.kind !== 'const' && decl.kind !== 'let')) return;
        const id = node.id;
        if (id?.type !== 'Identifier' || id.name.startsWith('_')) return;
        const init = unwrap(node.init);
        if (init?.type !== 'AwaitExpression') return;
        const name = readCall(context, init.argument, READS);
        if (!name) return;
        const fn = enclosingFunction(node);
        if (!fn || !isTestBody(fn, testNames)) return;
        const variable = context.sourceCode.getDeclaredVariables(node).find((v) => v.name === id.name);
        if (!variable || variable.references.some((r) => r.isRead())) return;
        context.report({ node: node as never, messageId: 'unusedBinding', data: { id: id.name, name } });
      },
    };
  },
};
