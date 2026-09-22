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
  params?: Node[];
  body?: Node | Node[] | null;
  operator?: string;
  argument?: Node | null;
  value?: unknown;
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

/**
 * Generic ESTree/TS-ESTree subtree walk — every AST node here is a plain
 * object (or array of them) with a `type` string; no visitorKeys table is
 * needed to find nested nodes of interest, just recursion over own
 * enumerable properties. `parent` is skipped to avoid the cycle ESLint
 * attaches during traversal.
 */
function walkNode(node: unknown, visit: (n: Node) => void): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) walkNode(item, visit);
    return;
  }
  const record = node as Record<string, unknown>;
  if (typeof record.type !== 'string') return;
  visit(node as Node);
  for (const key of Object.keys(record)) {
    if (key === 'parent') continue;
    const value = record[key];
    if (value && typeof value === 'object') walkNode(value, visit);
  }
}

/**
 * QAG-196 baseline (2026-09-21): a spec with two timer sleeps, a
 * coordinate click and a tautological assertion scored 93/A under model
 * v3 — all four are real, common ways AI- and human-written specs fake
 * stability or coverage while contributing zero real signal. These four
 * rules close that gap; see CHANGELOG.md for the corpus before/after.
 */

/**
 * `await new Promise((resolve) => setTimeout(resolve, ms))` is the same
 * hard-coded sleep as `page.waitForTimeout(ms)` (already flagged, as an
 * error, by upstream `playwright/no-wait-for-timeout`) wearing a disguise
 * that rule cannot see through — it has nothing to do with `page` at all.
 * Verified against the QAG-196 gameability sample: this exact pattern
 * scored zero findings before this rule existed.
 */
const noTimerSleep: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow sleeping via new Promise((resolve) => setTimeout(resolve, ms)) — the same anti-pattern as page.waitForTimeout, just undetectable by name',
    },
    messages: {
      sleep:
        'Unexpected hard-coded sleep via new Promise + setTimeout. Wait for a specific condition (a locator, a response, an event) instead.',
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node: Node) {
        if (node.callee?.type !== 'Identifier' || node.callee.name !== 'setTimeout') return;
        const ancestors = (
          context.sourceCode?.getAncestors
            ? context.sourceCode.getAncestors(node as never)
            : (context as unknown as { getAncestors(): unknown[] }).getAncestors()
        ) as Node[];
        for (let i = ancestors.length - 1; i >= 0; i--) {
          const anc = ancestors[i];
          if (!FUNCTION_TYPES.has(anc.type)) continue;
          const parent = ancestors[i - 1];
          const executorArgs = (parent?.arguments ?? []) as Node[];
          if (
            parent?.type === 'NewExpression' &&
            parent.callee?.type === 'Identifier' &&
            parent.callee.name === 'Promise' &&
            executorArgs[0] === anc
          ) {
            const resolveParam = (anc.params ?? [])[0];
            const firstArg = (node.arguments ?? [])[0];
            if (
              resolveParam?.type === 'Identifier' &&
              firstArg?.type === 'Identifier' &&
              firstArg.name === resolveParam.name
            ) {
              context.report({ node: node as never, messageId: 'sleep' });
            }
          }
          break; // only the nearest enclosing function matters
        }
      },
    };
  },
};

/**
 * `page.mouse.click(x, y)` (or `this.page.mouse.click(...)`, any object
 * expression ending in `.mouse.click`) clicks a fixed viewport coordinate
 * instead of an element — brittle by construction (breaks on any layout,
 * zoom, or viewport-size change) and, unlike `locator.click({ force:
 * true })`, has no upstream rule at all.
 */
const noCoordinateClick: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow page.mouse.click(x, y) coordinate clicks — click a locator instead',
    },
    messages: {
      coordinateClick:
        'Unexpected coordinate click via *.mouse.click(x, y). Click a locator (locator.click()) so the action targets an element, not a fixed pixel position.',
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node: Node) {
        const callee = node.callee;
        if (!callee || callee.type !== 'MemberExpression' || callee.computed) return;
        if (callee.property?.type !== 'Identifier' || callee.property.name !== 'click') return;
        const obj = callee.object;
        if (!obj || obj.type !== 'MemberExpression' || obj.computed) return;
        if (obj.property?.type !== 'Identifier' || obj.property.name !== 'mouse') return;
        context.report({ node: node as never, messageId: 'coordinateClick' });
      },
    };
  },
};

function isTrivialLiteral(node: Node | undefined): boolean {
  if (!node) return false;
  if (node.type === 'Literal') return true; // true/false/number/string/null
  if (node.type === 'UnaryExpression' && node.operator === '!') {
    return isTrivialLiteral(node.argument as Node | undefined);
  }
  return false;
}

/**
 * `expect(true).toBe(true)`, `expect(1).toBe(1)`, `expect(5).toBeDefined()`
 * — any assertion whose subject is a literal constant rather than
 * something the app under test produced. It always passes, so it
 * satisfies `playwright/expect-expect` (a test "has an assertion") while
 * asserting nothing about the application. Deliberately conservative:
 * only flags a literal directly inside `expect(...)`/`expect.soft(...)`/
 * `expect.poll(...)` — a variable that happens to hold a constant is a
 * false negative we accept rather than risk flagging real app state.
 */
const noTrivialAssertion: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow asserting on a literal constant (expect(true).toBe(true), expect(1).toBe(1)) — always passes, proves nothing',
    },
    messages: {
      trivial:
        'Unexpected assertion on a literal constant — this can never fail and verifies nothing about the application under test.',
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node: Node) {
        const callee = node.callee;
        let isExpectCall = false;
        if (callee?.type === 'Identifier' && callee.name === 'expect') isExpectCall = true;
        else if (
          callee?.type === 'MemberExpression' &&
          !callee.computed &&
          callee.object?.type === 'Identifier' &&
          callee.object.name === 'expect' &&
          callee.property?.type === 'Identifier' &&
          (callee.property.name === 'soft' || callee.property.name === 'poll')
        ) {
          isExpectCall = true;
        }
        if (!isExpectCall) return;
        const subject = (node.arguments ?? [])[0];
        if (isTrivialLiteral(subject)) {
          context.report({ node: node as never, messageId: 'trivial' });
        }
      },
    };
  },
};

function isTestDeclarationCallee(callee: Node | undefined): boolean {
  if (!callee) return false;
  if (callee.type === 'Identifier' && callee.name === 'test') return true;
  if (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.object?.type === 'Identifier' &&
    callee.object.name === 'test' &&
    callee.property?.type === 'Identifier' &&
    (callee.property.name === 'only' || callee.property.name === 'fixme')
  ) {
    return true;
  }
  return false;
}

/**
 * A test whose every assertion is `expect.soft(...)` never actually
 * fails: a soft assertion records a failure but lets the test keep
 * running and only fails it at the very end via `test.info().errors` —
 * fine for "gather every problem in one run" audit steps, poor default
 * for ordinary flow verification, where a failed precondition should
 * stop the test rather than cascade into confusing downstream failures.
 * Report-only under `standard` (soft assertions are a legitimate,
 * deliberate choice, not a defect) — a contentious, opinionated check
 * counted for real only under the `strict` profile. See
 * profiles.ts/mapRule and CHANGELOG.md.
 */
const noSoftAssertionOnlyTest: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Flag a test whose only assertions are expect.soft(...) — a failed check never fails the test run',
    },
    messages: {
      softOnly:
        'This test only uses expect.soft(...) assertions — a failed check is recorded but never fails the test. Use a hard expect() for anything that should stop the test.',
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node: Node) {
        if (!isTestDeclarationCallee(node.callee)) return;
        const args = node.arguments ?? [];
        const body = args[args.length - 1];
        if (!body || !FUNCTION_TYPES.has(body.type)) return;
        let hard = 0;
        let soft = 0;
        walkNode(body.body, (n) => {
          if (n.type !== 'CallExpression') return;
          const c = n.callee;
          if (!c) return;
          if (c.type === 'Identifier' && c.name === 'expect') hard += 1;
          else if (
            c.type === 'MemberExpression' &&
            !c.computed &&
            c.object?.type === 'Identifier' &&
            c.object.name === 'expect' &&
            c.property?.type === 'Identifier' &&
            c.property.name === 'soft'
          ) {
            soft += 1;
          }
        });
        if (soft > 0 && hard === 0) {
          context.report({ node: node as never, messageId: 'softOnly' });
        }
      },
    };
  },
};

export const basePlugin = {
  meta: { name: 'pwscore-base', version: '0.1.0' },
  rules: {
    'no-skipped-test-declaration': noSkippedTestDeclaration,
    'no-timer-sleep': noTimerSleep,
    'no-coordinate-click': noCoordinateClick,
    'no-trivial-assertion': noTrivialAssertion,
    'no-soft-assertion-only-test': noSoftAssertionOnlyTest,
  },
};
