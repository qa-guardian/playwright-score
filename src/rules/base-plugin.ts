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
  elements?: Array<Node | null>;
  expressions?: Node[];
  quasis?: Array<{ value: { cooked?: string | null; raw: string } }>;
  left?: Node;
  right?: Node;
  specifiers?: Array<{ type: string; imported?: { name?: string }; local?: { name?: string } }>;
  source?: { value?: unknown };
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
 * True when `callee` is `setTimeout` itself or `globalThis.setTimeout` —
 * both resolve to the exact same ambient function; the `globalThis.`
 * spelling is just as easy to reach for (and just as invisible to a
 * rule that only matches a bare `Identifier`) as the plain name.
 */
function isSetTimeoutCallee(callee: Node | undefined): boolean {
  if (!callee) return false;
  if (callee.type === 'Identifier' && callee.name === 'setTimeout') return true;
  return (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.object?.type === 'Identifier' &&
    callee.object.name === 'globalThis' &&
    callee.property?.type === 'Identifier' &&
    callee.property.name === 'setTimeout'
  );
}

/**
 * True when `fn` is a zero-argument wrapper whose entire body is a call
 * to `resolveName` — `() => r()` or `() => { r(); }`. `setTimeout(resolve,
 * ms)` and `setTimeout(() => resolve(), ms)` do the exact same thing; the
 * wrapper adds nothing except making the resolve-callback shape invisible
 * to a check that only matched a bare identifier argument.
 */
function callsResolve(fn: Node | undefined, resolveName: string): boolean {
  if (!fn || !FUNCTION_TYPES.has(fn.type)) return false;
  if ((fn.params ?? []).length > 0) return false;
  const body = fn.body;
  let call: Node | undefined;
  if (body && !Array.isArray(body) && body.type === 'BlockStatement') {
    const stmts = (body.body ?? []) as unknown as Node[];
    const only = Array.isArray(stmts) && stmts.length === 1 ? stmts[0] : undefined;
    if (only?.type === 'ExpressionStatement') {
      call = (only as unknown as { expression: Node }).expression;
    }
  } else if (body && !Array.isArray(body)) {
    call = body; // arrow expression body
  }
  return (
    !!call &&
    call.type === 'CallExpression' &&
    call.callee?.type === 'Identifier' &&
    call.callee.name === resolveName
  );
}

/**
 * `await new Promise((resolve) => setTimeout(resolve, ms))` is the same
 * hard-coded sleep as `page.waitForTimeout(ms)` (already flagged, as an
 * error, by upstream `playwright/no-wait-for-timeout`) wearing a disguise
 * that rule cannot see through — it has nothing to do with `page` at all.
 * Verified against the QAG-196 gameability sample: this exact pattern
 * scored zero findings before this rule existed. Also catches two easy
 * respellings found in a pre-1.1.0 review: `globalThis.setTimeout(...)`
 * (same function, different spelling) and wrapping the resolve callback
 * in a no-op arrow (`setTimeout(() => r(), ms)`) instead of passing it
 * directly — plus the unrelated but equally disguised `node:timers/
 * promises` sleep (`await setTimeout(ms)` from that module is an async
 * sleep on its own, no `new Promise` wrapper needed).
 */
const noTimerSleep: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow sleeping via new Promise((resolve) => setTimeout(resolve, ms)), its globalThis/wrapped-callback respellings, or node:timers/promises setTimeout',
    },
    messages: {
      sleep:
        'Unexpected hard-coded sleep via new Promise + setTimeout. Wait for a specific condition (a locator, a response, an event) instead.',
      timersPromisesSleep:
        "Unexpected hard-coded sleep via node:timers/promises' setTimeout(ms). Wait for a specific condition (a locator, a response, an event) instead.",
    },
    schema: [],
  },
  create(context) {
    const timersPromisesLocalNames = new Set<string>();
    return {
      // Typed loosely (not our shared `Node`) — the real ESTree
      // ImportDeclaration shape (e.g. `imported` can be a string Literal
      // for `import { "setTimeout" as x }`) doesn't structurally match
      // our simplified CallExpression-oriented Node type.
      ImportDeclaration(raw: unknown) {
        const node = raw as {
          source?: { value?: unknown };
          specifiers?: Array<{
            type: string;
            imported?: { name?: string };
            local?: { name?: string };
          }>;
        };
        const source = node.source?.value;
        if (source !== 'node:timers/promises' && source !== 'timers/promises') return;
        for (const spec of node.specifiers ?? []) {
          if (spec.type === 'ImportSpecifier' && spec.imported?.name === 'setTimeout' && spec.local?.name) {
            timersPromisesLocalNames.add(spec.local.name);
          }
        }
      },
      CallExpression(node: Node) {
        if (
          node.callee?.type === 'Identifier' &&
          typeof node.callee.name === 'string' &&
          timersPromisesLocalNames.has(node.callee.name)
        ) {
          context.report({ node: node as never, messageId: 'timersPromisesSleep' });
          return;
        }
        if (!isSetTimeoutCallee(node.callee)) return;
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
            const isDirectResolve =
              resolveParam?.type === 'Identifier' &&
              firstArg?.type === 'Identifier' &&
              firstArg.name === resolveParam.name;
            const resolveName = resolveParam?.type === 'Identifier' ? resolveParam.name : undefined;
            const isWrappedResolve =
              typeof resolveName === 'string' && callsResolve(firstArg, resolveName);
            if (isDirectResolve || isWrappedResolve) {
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
 * true })`, has no upstream rule at all. Also catches three respellings
 * found in a pre-1.1.0 review, all still coordinate-based interaction
 * through the same `Mouse` API: `const { mouse } = page; mouse.click(...)`
 * (destructuring hides the `.mouse.` member access this rule originally
 * looked for), `mouse.dblclick(x, y)` (same brittleness, different
 * method), and the manual `move(x, y)` + `down()` + `up()` sequence that
 * reimplements a click one step at a time — still landing at a fixed
 * pixel position, just spread across three calls instead of one.
 */
const MOUSE_COORDINATE_METHODS = new Set(['click', 'dblclick', 'move', 'down', 'up']);

const noCoordinateClick: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow page.mouse.click/dblclick/move/down/up(...) coordinate-based interaction — click a locator instead',
    },
    messages: {
      coordinateClick:
        'Unexpected coordinate-based interaction via *.mouse.{{method}}(...). Interact through a locator (locator.click()/locator.hover()) so the action targets an element, not a fixed pixel position.',
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node: Node) {
        const callee = node.callee;
        if (!callee || callee.type !== 'MemberExpression' || callee.computed) return;
        const methodName = callee.property?.type === 'Identifier' ? callee.property.name : undefined;
        if (!methodName || !MOUSE_COORDINATE_METHODS.has(methodName)) return;
        const obj = callee.object;
        if (!obj) return;
        // `page.mouse.click(...)` / `this.page.mouse.click(...)` — any
        // expression ending in `.mouse`.
        const isDotMouse =
          obj.type === 'MemberExpression' &&
          !obj.computed &&
          obj.property?.type === 'Identifier' &&
          obj.property.name === 'mouse';
        // `const { mouse } = page; mouse.click(...)` — the destructured
        // binding is a bare identifier, not a `.mouse` member access, but
        // it is the exact same Mouse API. Name-based, same convention as
        // this file's other rules (e.g. isSkipCallee's `test` heuristic).
        const isBareMouseIdentifier = obj.type === 'Identifier' && obj.name === 'mouse';
        if (!isDotMouse && !isBareMouseIdentifier) return;
        context.report({
          node: node as never,
          messageId: 'coordinateClick',
          data: { method: methodName },
        });
      },
    };
  },
};

type ConstResult = { ok: true; value: unknown } | { ok: false };
const NOT_CONST: ConstResult = { ok: false };

/**
 * Statically evaluates the small subset of constant-expression shapes a
 * literal-assertion idiom actually uses: literals, `!`/`-`/`+`/`~` on a
 * constant, simple arithmetic (`1 + 1`), a no-expression template literal
 * (`` `hello` ``, indistinguishable in intent from `'hello'`), and an
 * array of constants (for `toEqual`/`toStrictEqual`, e.g. `[]`). Anything
 * else (a variable, a function call, an array containing a non-constant)
 * is deliberately NOT evaluated — a false negative here is safe (we just
 * don't flag it); a false positive would mean claiming real app state
 * "always passes", which would be wrong.
 */
function evalConst(node: Node | undefined | null): ConstResult {
  if (!node) return NOT_CONST;
  if (node.type === 'Literal') return { ok: true, value: node.value };
  if (node.type === 'TemplateLiteral') {
    if ((node.expressions ?? []).length > 0) return NOT_CONST;
    const quasi = (node.quasis ?? [])[0];
    if (!quasi) return NOT_CONST;
    return { ok: true, value: quasi.value.cooked ?? quasi.value.raw };
  }
  if (node.type === 'UnaryExpression' && node.operator) {
    const arg = evalConst(node.argument);
    if (!arg.ok) return NOT_CONST;
    switch (node.operator) {
      case '!':
        return { ok: true, value: !arg.value };
      case '-':
        return { ok: true, value: -(arg.value as number) };
      case '+':
        return { ok: true, value: +(arg.value as number) };
      case '~':
        return { ok: true, value: ~(arg.value as number) };
      default:
        return NOT_CONST;
    }
  }
  if (node.type === 'BinaryExpression' && node.left && node.right) {
    const left = evalConst(node.left);
    const right = evalConst(node.right);
    if (!left.ok || !right.ok) return NOT_CONST;
    const l = left.value as never;
    const r = right.value as never;
    switch (node.operator) {
      case '+':
        return { ok: true, value: (l as unknown as number) + (r as unknown as number) };
      case '-':
        return { ok: true, value: (l as unknown as number) - (r as unknown as number) };
      case '*':
        return { ok: true, value: (l as unknown as number) * (r as unknown as number) };
      case '/':
        return { ok: true, value: (l as unknown as number) / (r as unknown as number) };
      case '%':
        return { ok: true, value: (l as unknown as number) % (r as unknown as number) };
      case '**':
        return { ok: true, value: (l as unknown as number) ** (r as unknown as number) };
      default:
        return NOT_CONST;
    }
  }
  if (node.type === 'ArrayExpression') {
    const values: unknown[] = [];
    for (const el of node.elements ?? []) {
      const r = evalConst(el);
      if (!r.ok) return NOT_CONST; // includes sparse-array holes (el === null)
      values.push(r.value);
    }
    return { ok: true, value: values };
  }
  return NOT_CONST;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  return false;
}

/**
 * Given a matcher name and its (already-evaluated) subject, returns
 * whether `expect(subject).<matcher>(...expectedNode)` always evaluates
 * true — or `undefined` when the matcher isn't one we understand well
 * enough to say either way (e.g. its expected argument isn't a constant
 * we can evaluate). Only a small, common subset of matchers is covered;
 * an unrecognized matcher is a false negative, never a false positive.
 */
function matcherAlwaysPasses(
  matcherName: string,
  subject: unknown,
  expectedNode: Node | undefined
): boolean | undefined {
  switch (matcherName) {
    case 'toBe': {
      const expected = evalConst(expectedNode);
      return expected.ok ? Object.is(subject, expected.value) : undefined;
    }
    case 'toEqual':
    case 'toStrictEqual': {
      const expected = evalConst(expectedNode);
      return expected.ok ? deepEqual(subject, expected.value) : undefined;
    }
    case 'toBeTruthy':
      return Boolean(subject);
    case 'toBeFalsy':
      return !subject;
    case 'toBeNull':
      return subject === null;
    case 'toBeNaN':
      return typeof subject === 'number' && Number.isNaN(subject);
    default:
      return undefined;
  }
}

/** `expect(...)` / `expect.soft(...)` / `expect.poll(...)`. */
function isExpectCallNode(node: Node | undefined): boolean {
  if (!node || node.type !== 'CallExpression') return false;
  const callee = node.callee;
  if (callee?.type === 'Identifier' && callee.name === 'expect') return true;
  return (
    callee?.type === 'MemberExpression' &&
    !callee.computed &&
    callee.object?.type === 'Identifier' &&
    callee.object.name === 'expect' &&
    callee.property?.type === 'Identifier' &&
    (callee.property.name === 'soft' || callee.property.name === 'poll')
  );
}

/**
 * `expect(true).toBe(true)`, `` expect(`x`).toBe(`x`) ``, `expect(1 +
 * 1).toBe(2)`, `expect([]).toEqual([])` — any assertion whose subject and
 * matcher combination can only ever pass, regardless of anything the app
 * under test does. It satisfies `playwright/expect-expect` (a test "has
 * an assertion") while asserting nothing real. Deliberately conservative
 * in two directions: only a subject that's a statically-evaluable
 * constant is considered (a variable holding a constant is a false
 * negative we accept rather than risk flagging real app state), and the
 * matcher + `.not` combination is actually evaluated rather than assumed
 * — `expect(true).toBe(false)` and `expect(true, msg).toBeFalsy()` are
 * the deliberate force-fail idiom (asserting something that can only
 * ever be false, to fail a test unconditionally), the opposite of this
 * rule's target, and are never flagged: the message says "always passes"
 * and must stay true every time it fires.
 */
const noTrivialAssertion: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow an assertion whose subject and matcher can only ever pass (expect(true).toBe(true), expect([]).toEqual([]), expect(1 + 1).toBe(2)) — proves nothing about the application under test. Does not flag a deliberate force-fail assertion (e.g. expect(true).toBe(false)), which always fails, not passes.',
    },
    messages: {
      trivial:
        'Unexpected assertion that always passes on a constant — it can never fail and verifies nothing about the application under test.',
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node: Node) {
        const callee = node.callee;
        if (!callee || callee.type !== 'MemberExpression' || callee.computed) return;
        const matcherName = callee.property?.type === 'Identifier' ? callee.property.name : undefined;
        if (!matcherName) return;

        let expectCall: Node | undefined;
        let hasNot = false;
        if (isExpectCallNode(callee.object)) {
          expectCall = callee.object;
        } else if (
          callee.object?.type === 'MemberExpression' &&
          !callee.object.computed &&
          callee.object.property?.type === 'Identifier' &&
          callee.object.property.name === 'not' &&
          isExpectCallNode(callee.object.object)
        ) {
          expectCall = callee.object.object;
          hasNot = true;
        }
        if (!expectCall) return;

        const subject = evalConst((expectCall.arguments ?? [])[0]);
        if (!subject.ok) return;

        const expectedArg = (node.arguments ?? [])[0];
        const alwaysPasses = matcherAlwaysPasses(matcherName, subject.value, expectedArg);
        if (alwaysPasses === undefined) return;

        if (hasNot ? !alwaysPasses : alwaysPasses) {
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
 * A contentious, opinionated check (soft assertions are a legitimate,
 * deliberate choice, not always a defect) — scored as a warning-level
 * demerit as of 2.0.0/model v4, same as the rest of the QAG-196 rules
 * (see profiles.ts and CHANGELOG.md). `expect.poll(...)` counts as a hard
 * assertion, not soft: unlike `expect.soft`, a failed poll still throws
 * and fails the test — it just retries first.
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
            c.property?.type === 'Identifier'
          ) {
            if (c.property.name === 'soft') soft += 1;
            else if (c.property.name === 'poll') hard += 1;
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
