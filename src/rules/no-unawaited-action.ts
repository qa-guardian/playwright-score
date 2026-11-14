import type { Rule } from 'eslint';
import { isPwReceiver, propName, unwrap, enclosingFunction, type AnyNode } from './rule-util.js';

/**
 * `pwscore/no-unawaited-action` (QAG-287). A Playwright action or
 * navigation used as a bare expression statement, inside an async function
 * (test, hook or helper), with no `await`, `return`, `void`, assignment or
 * argument position: `page.goto(url);`, `page.getByRole('button').click();`,
 * `const b = page.locator('#b'); b.fill('x');`.
 *
 * Matched shape: ExpressionStatement whose expression is exactly
 * `<receiver>.<method>(...)`, where the receiver is syntactically a Page or
 * Locator (see `isPwReceiver`) and `<method>` is an action/navigation/wait
 * (list below, plus any `waitFor*`). Not matched: anything inside
 * `Promise.all([...])`, assigned, returned, passed as an argument, chained
 * into `.catch()`/`.then()`, or in a non-async function.
 *
 * Why not eslint-plugin-playwright's `missing-playwright-await` with its
 * `includePageLocatorMethods` option: it matches the method NAME on any
 * receiver (`el.click()`, `items.count()`, `$btn.check()` all count), which
 * is not precise enough for a public score, and it also reports value
 * getters. This rule requires a Page/Locator receiver.
 */
const ACTIONS = new Set([
  'goto',
  'reload',
  'goBack',
  'goForward',
  'click',
  'dblclick',
  'fill',
  'clear',
  'press',
  'pressSequentially',
  'type',
  'check',
  'uncheck',
  'setChecked',
  'selectOption',
  'hover',
  'focus',
  'tap',
  'dragTo',
  'dragAndDrop',
  'setInputFiles',
  'setContent',
  'scrollIntoViewIfNeeded',
]);

export const noUnawaitedAction: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow Playwright actions/navigations that are not awaited' },
    messages: {
      unawaited:
        '`{{name}}()` returns a promise that is never awaited, so the test moves on before the action finishes (a flake and a swallowed failure). Add `await`.',
    },
    schema: [],
  },
  create(context) {
    return {
      ExpressionStatement(node: AnyNode) {
        const expr = node.expression;
        if (!expr || expr.type !== 'CallExpression') return;
        const callee = unwrap(expr.callee);
        if (callee?.type !== 'MemberExpression') return;
        const name = propName(callee);
        if (!name || !(ACTIONS.has(name) || /^waitFor[A-Z]?/.test(name) || name === 'waitFor')) return;
        const fn = enclosingFunction(node);
        if (!fn || !fn.async) return;
        if (!isPwReceiver(context, callee.object)) return;
        context.report({ node: expr as never, messageId: 'unawaited', data: { name } });
      },
    };
  },
};
