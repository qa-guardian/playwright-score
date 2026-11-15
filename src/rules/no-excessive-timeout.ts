import type { Rule } from 'eslint';
import {
  TEST_ALIAS_SCHEMA,
  enclosingFunction,
  evalNumber,
  hookName,
  isDescribeCall,
  isTestDeclaration,
  propName,
  testNamesFromOptions,
  unwrap,
  type AnyNode,
} from './rule-util.js';

/**
 * `pwscore/no-excessive-timeout` (QAG-287). A timeout so long that a real
 * failure takes minutes to show and a slow app is silently tolerated.
 * Matches (literals and simple arithmetic such as `2 * 60 * 1000`, numeric
 * separators included):
 *  - `{ timeout: N }` with N > 60_000 passed to an action, wait or
 *    matcher call: `x.click/fill/goto/waitFor*(...)`, `expect(..).toXxx(..)`,
 *    `expect.poll(..)`
 *  - `test.setTimeout(N)` / `testInfo.setTimeout(N)` with N >= 300_000
 *  - `test.slow()` with no arguments written directly at file or describe
 *    level (a conditional `test.slow(cond, why)` or one inside a test is fine)
 * Not matched: config-file timeouts, non-literal values, `timeout: 0`, and
 * `setTimeout(N)` written inside a `beforeAll/beforeEach/afterAll/afterEach`
 * hook (seeding or teardown waiting on a slow backend is setup, not a test
 * with a stretched budget; QAG-287 slice E2).
 *
 * Info severity (no score effect), set in profiles.ts: in the corpus hand-check
 * only 4 of 20 hits were clearly wrong; 14 were slow external steps (VM boot,
 * ingestion pipelines, downloads) that a human has to judge.
 */
const WAIT_METHODS = new Set([
  'goto', 'reload', 'goBack', 'goForward', 'click', 'dblclick', 'fill', 'clear', 'press',
  'pressSequentially', 'type', 'check', 'uncheck', 'setChecked', 'selectOption', 'hover',
  'focus', 'tap', 'dragTo', 'dragAndDrop', 'setInputFiles', 'waitFor', 'poll', 'toPass',
]);

export const noExcessiveTimeout: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Disallow very long literal timeouts' },
    messages: {
      long: 'A {{seconds}}s timeout means a failure takes that long to report and slowness is hidden. Check this is a genuinely slow external step; otherwise fix the wait condition or the app instead of stretching the limit.',
      longTest: '`setTimeout({{seconds}}s)` gives this test an extreme budget. Check it covers a genuinely slow external step; otherwise split the test or fix the slow step.',
      slow: 'Unconditional `test.slow()` triples every timeout in scope, hiding slowness. Apply it to the specific slow test with a reason, or fix the slowness.',
    },
    schema: TEST_ALIAS_SCHEMA,
  },
  create(context) {
    const testNames = testNamesFromOptions(context.options);
    const owners = new Set<string>([...testNames, 'testInfo']);
    const inHook = (node: AnyNode): boolean => {
      let fn = enclosingFunction(node);
      while (fn) {
        const call = fn.parent;
        if (call?.type === 'CallExpression' && call.arguments.includes(fn)) {
          if (hookName(call, testNames)) return true;
          if (isTestDeclaration(call, testNames)) return false;
        }
        fn = enclosingFunction(fn);
      }
      return false;
    };
    return {
      CallExpression(node: AnyNode) {
        const callee = unwrap(node.callee);
        const isExpectRoot = callee?.type === 'Identifier' && callee.name === 'expect';
        if (callee?.type !== 'MemberExpression' && !isExpectRoot) return;
        const name = callee.type === 'MemberExpression' ? propName(callee) : undefined;

        // test.setTimeout(N) / testInfo.setTimeout(N)
        if (name === 'setTimeout' && callee.object?.type === 'Identifier' && owners.has(callee.object.name)) {
          const ms = evalNumber(node.arguments?.[0]);
          if (ms !== undefined && ms >= 300_000 && !inHook(node)) {
            context.report({ node: node as never, messageId: 'longTest', data: { seconds: String(ms / 1000) } });
          }
          return;
        }

        // test.slow() at file/describe level
        if (name === 'slow' && callee.object?.type === 'Identifier' && testNames.has(callee.object.name) && node.arguments.length === 0) {
          const stmt = node.parent;
          if (stmt?.type !== 'ExpressionStatement') return;
          const fn = enclosingFunction(node);
          if (!fn) {
            context.report({ node: node as never, messageId: 'slow' });
            return;
          }
          const call = fn.parent;
          if (call?.type === 'CallExpression' && isDescribeCall(call, testNames) && !hookName(call, testNames) && !isTestDeclaration(call, testNames)) {
            context.report({ node: node as never, messageId: 'slow' });
          }
          return;
        }

        // { timeout: N } on an action / wait / matcher
        if (!name || !(WAIT_METHODS.has(name) || /^waitFor[A-Z]/.test(name) || /^to[A-Z]/.test(name))) return;
        for (const arg of node.arguments ?? []) {
          const obj = unwrap(arg);
          if (obj?.type !== 'ObjectExpression') continue;
          for (const prop of obj.properties) {
            if (prop.type !== 'Property' || prop.computed) continue;
            const key = prop.key?.name ?? prop.key?.value;
            if (key !== 'timeout') continue;
            const ms = evalNumber(prop.value);
            if (ms !== undefined && ms > 60_000) {
              context.report({ node: prop as never, messageId: 'long', data: { seconds: String(ms / 1000) } });
            }
          }
        }
      },
    };
  },
};
