/**
 * Corrections to upstream eslint-plugin-playwright behavior, not house
 * style — always active.
 */
import type { Rule } from 'eslint';

type Node = {
  type: string;
  computed?: boolean;
  callee?: Node;
  object?: Node;
  property?: Node;
  name?: string;
  arguments?: Node[];
};

function isSkipCallee(callee: Node | undefined): boolean {
  if (!callee || callee.type !== 'MemberExpression' || callee.computed) return false;
  const obj = callee.object;
  const prop = callee.property;
  if (prop?.type !== 'Identifier' || prop.name !== 'skip') return false;
  // test.skip(...)
  if (obj?.type === 'Identifier' && obj.name === 'test') return true;
  // test.describe.skip(...)
  if (
    obj?.type === 'MemberExpression' &&
    !obj.computed &&
    obj.object?.type === 'Identifier' &&
    obj.object.name === 'test' &&
    obj.property?.type === 'Identifier' &&
    obj.property.name === 'describe'
  ) {
    return true;
  }
  return false;
}

const FUNCTION_TYPES = new Set(['FunctionExpression', 'ArrowFunctionExpression']);

/**
 * eslint-plugin-playwright's no-skipped-test flags every form of
 * test.skip(...)/test.describe.skip(...) identically. That conflates two
 * very different, both-real patterns:
 *
 *  - test.skip('name', fn) / test.describe.skip('name', fn) — a
 *    DECLARATION whose test/suite never runs at all. Worth flagging: this
 *    is the "test is broken, hide it" anti-pattern.
 *  - test.skip(condition, reason) / test.skip() called inside a test/hook
 *    body — Playwright's own documented API for conditionally skipping a
 *    test at runtime (e.g. per-browser, per-env). This is the correct,
 *    recommended way to handle exactly that case, not an anti-pattern —
 *    see playwright.dev/docs/test-annotations#conditionally-skip-a-test.
 *
 * Verified against real-world code: eslint-plugin-playwright's rule flags
 * both forms identically, generating warnings on entirely idiomatic
 * cross-browser test suites. This rule replaces it (see eslint-runner.ts,
 * where the upstream rule is turned off) with the same "declaration form"
 * severity but without the false positive on the conditional form — the
 * two are told apart by whether the trailing argument is a function (a
 * declaration always supplies the test body as a function; a conditional
 * skip's second argument, if any, is the string reason).
 */
const noSkippedTestDeclaration: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow test.skip()/test.describe.skip() used to declare an always-skipped test (conditional runtime skips are unaffected)',
    },
    messages: {
      skipped: 'Unexpected use of the .skip() annotation to declare an always-skipped test.',
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node: Node) {
        if (!isSkipCallee(node.callee)) return;
        const args = node.arguments ?? [];
        const lastArg = args[args.length - 1];
        const isDeclaration = args.length >= 2 && FUNCTION_TYPES.has(lastArg?.type ?? '');
        if (isDeclaration) {
          context.report({ node: node as never, messageId: 'skipped' });
        }
      },
    };
  },
};

export const basePlugin = {
  meta: { name: 'pwscore-base', version: '0.1.0' },
  rules: {
    'no-skipped-test-declaration': noSkippedTestDeclaration,
  },
};
