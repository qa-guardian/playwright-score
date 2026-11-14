/**
 * `test.fixme(...)` is the "known broken, do not run" marker. Same split as
 * pwscore/no-skipped-test-declaration:
 *
 *  - FLAGGED: declaration `test.fixme('t', fn)` / `test.describe.fixme(...)`
 *    (last argument is a function, 2+ arguments), and the unconditional
 *    in-body forms `test.fixme()` (no arguments) and `test.fixme(true, ...)`.
 *  - CLEAN: conditional `test.fixme(browserName === 'webkit', 'why')`
 *    (any first argument that is not the literal `true`).
 *
 * `test` includes `test.extend()` aliases (testAliasNames option).
 */
import type { Rule } from 'eslint';
import { FN_TYPES, memberName, type N } from './ast-util.js';

function isFixmeCallee(callee: N | undefined, names: ReadonlySet<string>): boolean {
  if (memberName(callee) !== 'fixme') return false;
  const obj = callee?.object;
  if (obj?.type === 'Identifier' && obj.name && names.has(obj.name)) return true;
  return (
    obj?.type === 'MemberExpression' &&
    !obj.computed &&
    obj.property?.name === 'describe' &&
    obj.object?.type === 'Identifier' &&
    !!obj.object.name &&
    names.has(obj.object.name)
  );
}

export const noFixmeTest: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Disallow unconditional test.fixme(): a test marked broken never runs' },
    messages: {
      declaration: 'Unexpected test.fixme() declaration: this test never runs. Fix it or delete it.',
      unconditional:
        'Unconditional test.fixme() inside a test: everything after it never runs. Use test.fixme(condition, reason) or fix the test.',
    },
    schema: [
      {
        additionalProperties: false,
        properties: { testAliasNames: { items: { type: 'string' }, type: 'array' } },
        type: 'object',
      },
    ],
  },
  create(context) {
    const aliases = (context.options[0] as { testAliasNames?: string[] } | undefined)?.testAliasNames ?? [];
    const names = new Set<string>(['test', ...aliases]);
    return {
      CallExpression(raw) {
        const node = raw as unknown as N;
        if (!isFixmeCallee(node.callee, names)) return;
        const args = node.arguments ?? [];
        const last = args[args.length - 1];
        if (args.length >= 2 && last && FN_TYPES.has(last.type)) {
          context.report({ node: raw, messageId: 'declaration' });
          return;
        }
        if (node.callee?.object?.type !== 'Identifier') return; // describe.fixme() in-body form is not a thing
        if (args.length === 0 || (args[0].type === 'Literal' && args[0].value === true)) {
          context.report({ node: raw, messageId: 'unconditional' });
        }
      },
    };
  },
};
