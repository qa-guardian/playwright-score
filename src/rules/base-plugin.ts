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

/**
 * `testNames` is `'test'` plus any `test.extend(...)`-derived fixture
 * aliases detected by test-aliases.ts (see eslint-runner.ts, which feeds
 * this rule's `testAliasNames` option) — a suite that always declares its
 * tests via `loggedTest.skip(...)` instead of `test.skip(...)` still needs
 * the always-skipped-declaration check below, same as upstream
 * eslint-plugin-playwright's own rules need the alias for no-standalone-
 * expect (see METHODOLOGY.md/test-aliases.ts).
 */
function isSkipCallee(callee: Node | undefined, testNames: ReadonlySet<string>): boolean {
  if (!callee || callee.type !== 'MemberExpression' || callee.computed) return false;
  const obj = callee.object;
  const prop = callee.property;
  if (prop?.type !== 'Identifier' || prop.name !== 'skip') return false;
  // test.skip(...) / loggedTest.skip(...)
  if (obj?.type === 'Identifier' && obj.name && testNames.has(obj.name)) return true;
  // test.describe.skip(...) / loggedTest.describe.skip(...)
  if (
    obj?.type === 'MemberExpression' &&
    !obj.computed &&
    obj.object?.type === 'Identifier' &&
    obj.object.name &&
    testNames.has(obj.object.name) &&
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
    schema: [
      {
        additionalProperties: false,
        properties: {
          testAliasNames: { items: { type: 'string' }, type: 'array' },
        },
        type: 'object',
      },
    ],
  },
  create(context) {
    const testAliasNames = (context.options[0] as { testAliasNames?: string[] } | undefined)
      ?.testAliasNames ?? [];
    const testNames = new Set<string>(['test', ...testAliasNames]);
    return {
      CallExpression(node: Node) {
        if (!isSkipCallee(node.callee, testNames)) return;
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

/** Any object whose `.setTimeout` member resolves to the same ambient function as a bare `setTimeout` call. */
const SET_TIMEOUT_HOST_OBJECTS = new Set(['globalThis', 'window']);

/**
 * True when `callee` is `setTimeout` itself, `globalThis.setTimeout`, or
 * `window.setTimeout` — all three resolve to the exact same ambient
 * function; `window.` is just as easy to reach for in a browser-flavored
 * test file (and just as invisible to a rule that only matches a bare
 * `Identifier` or the `globalThis.` spelling) as either of the others.
 */
function isSetTimeoutCallee(callee: Node | undefined): boolean {
  if (!callee) return false;
  if (callee.type === 'Identifier' && callee.name === 'setTimeout') return true;
  return (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.object?.type === 'Identifier' &&
    typeof callee.object.name === 'string' &&
    SET_TIMEOUT_HOST_OBJECTS.has(callee.object.name) &&
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
 * scored zero findings before this rule existed. Also catches respellings
 * found in review: `globalThis.setTimeout(...)`/`window.setTimeout(...)`
 * (same function, different spelling — see isSetTimeoutCallee) and
 * wrapping the resolve callback in a no-op arrow (`setTimeout(() => r(),
 * ms)`) instead of passing it directly — plus the unrelated but equally
 * disguised `node:timers/promises` sleep (`await setTimeout(ms)` from
 * that module is an async sleep on its own, no `new Promise` wrapper
 * needed), including a namespace-import/`require()` spelling of the same
 * module (`import * as timers from 'node:timers/promises'` or `const
 * timers = require('node:timers/promises')`, then `await
 * timers.setTimeout(ms)`) — not just the named-import form.
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
    // Local names bound to the *module namespace* (not the bare
    // `setTimeout` function itself): `import * as timers from
    // 'node:timers/promises'` or `const timers =
    // require('node:timers/promises')`. `timers.setTimeout(ms)` is the
    // same sleep as the named-import form, just reached through a member
    // access instead of a bare identifier call.
    const timersPromisesNamespaceLocalNames = new Set<string>();
    const isTimersPromisesSource = (value: unknown): boolean =>
      value === 'node:timers/promises' || value === 'timers/promises';
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
        if (!isTimersPromisesSource(node.source?.value)) return;
        for (const spec of node.specifiers ?? []) {
          if (spec.type === 'ImportSpecifier' && spec.imported?.name === 'setTimeout' && spec.local?.name) {
            timersPromisesLocalNames.add(spec.local.name);
          } else if (spec.type === 'ImportNamespaceSpecifier' && spec.local?.name) {
            timersPromisesNamespaceLocalNames.add(spec.local.name);
          }
        }
      },
      // `const timers = require('node:timers/promises')` — CommonJS
      // equivalent of the namespace import above. Typed loosely for the
      // same reason as ImportDeclaration; `id`/`init` aren't on our
      // shared Node type.
      VariableDeclarator(raw: unknown) {
        const node = raw as { id?: Node; init?: Node | null };
        if (node.id?.type !== 'Identifier' || !node.id.name || !node.init) return;
        const init = node.init;
        const isRequireTimersPromises =
          init.type === 'CallExpression' &&
          init.callee?.type === 'Identifier' &&
          init.callee.name === 'require' &&
          isTimersPromisesSource((init.arguments ?? [])[0]?.value);
        if (isRequireTimersPromises) {
          timersPromisesNamespaceLocalNames.add(node.id.name);
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
        if (
          node.callee?.type === 'MemberExpression' &&
          !node.callee.computed &&
          node.callee.object?.type === 'Identifier' &&
          typeof node.callee.object.name === 'string' &&
          timersPromisesNamespaceLocalNames.has(node.callee.object.name) &&
          node.callee.property?.type === 'Identifier' &&
          node.callee.property.name === 'setTimeout'
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
      // Single full-tree pass at the end of the file rather than the
      // usual incremental per-node visitor: alias detection (`const m =
      // page.mouse`) needs every declaration collected before any
      // CallExpression can be checked against it, and declarations don't
      // reliably precede their uses in a single top-down traversal
      // ordering guarantee otherwise. Typed loosely (not our shared
      // `Node`, nor the real ESTree `Program`) for the same reason as
      // ImportDeclaration/VariableDeclarator above — walkNode only needs
      // a `type` string and recurses over own enumerable properties, so
      // an `unknown` in is enough.
      'Program:exit'(raw: unknown) {
        const program = raw as Node;
        // Any variable initialized directly from `.mouse` (`page.mouse`,
        // `this.page.mouse`, ...) is the same Mouse API under an
        // arbitrary local name — `const m = page.mouse; m.click(x, y)` is
        // exactly as brittle as `page.mouse.click(x, y)`, just harder to
        // grep for. Seeded with the bare name `mouse` so `const { mouse }
        // = page; mouse.click(...)` (destructuring, not an assignment
        // this pass's MemberExpression check would match) is still
        // caught, same as before this alias tracking existed. A simple
        // identifier-to-identifier chain (`const m2 = m1`) is also
        // followed, since the walk below visits declarations in source
        // order for the common sequential-declaration case.
        const mouseAliasNames = new Set<string>(['mouse']);
        walkNode(program, (n) => {
          if (n.type !== 'VariableDeclarator') return;
          const decl = n as unknown as { id?: Node; init?: Node | null };
          if (decl.id?.type !== 'Identifier' || !decl.id.name || !decl.init) return;
          const init = decl.init;
          const isDotMouseInit =
            init.type === 'MemberExpression' &&
            !init.computed &&
            init.property?.type === 'Identifier' &&
            init.property.name === 'mouse';
          const isChainedAlias =
            init.type === 'Identifier' &&
            typeof init.name === 'string' &&
            mouseAliasNames.has(init.name);
          if (isDotMouseInit || isChainedAlias) {
            mouseAliasNames.add(decl.id.name);
          }
        });

        walkNode(program, (n) => {
          if (n.type !== 'CallExpression') return;
          const callee = n.callee;
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
          // `const { mouse } = page; mouse.click(...)` (bare `mouse`,
          // always in the set) or `const m = page.mouse; m.click(...)`
          // (any other name aliased above) — either way, the exact same
          // Mouse API under a name that isn't a `.mouse` member access.
          const isAliasedMouseIdentifier =
            obj.type === 'Identifier' && typeof obj.name === 'string' && mouseAliasNames.has(obj.name);
          if (!isDotMouse && !isAliasedMouseIdentifier) return;
          context.report({
            node: n as never,
            messageId: 'coordinateClick',
            data: { method: methodName },
          });
        });
      },
    };
  },
};

type ConstResult = { ok: true; value: unknown } | { ok: false };
const NOT_CONST: ConstResult = { ok: false };

/**
 * Resolves a bare `Identifier` to an already-evaluated constant, e.g. a
 * `const t = true` binding collected by `collectConstBindings` — see
 * `evalConst`'s `resolve` parameter.
 */
type ConstResolver = (name: string) => ConstResult | undefined;

/**
 * Statically evaluates the small subset of constant-expression shapes a
 * literal-assertion idiom actually uses: literals, `!`/`-`/`+`/`~` on a
 * constant, simple arithmetic (`1 + 1`), a no-expression template literal
 * (`` `hello` ``, indistinguishable in intent from `'hello'`), an array
 * of constants (for `toEqual`/`toStrictEqual`, e.g. `[]`), and — given a
 * `resolve` callback — a bare `Identifier` bound to one of these shapes
 * by a `const` declaration (`const t = true; expect(t).toBe(true)` is
 * the exact same always-passing assertion as `expect(true).toBe(true)`,
 * one local rename away from this rule's original identifier-only
 * check). Anything else (a `let`/`var` binding, a function call, an
 * array containing a non-constant) is deliberately NOT evaluated — a
 * false negative here is safe (we just don't flag it); a false positive
 * would mean claiming real app state "always passes", which would be
 * wrong.
 */
function evalConst(node: Node | undefined | null, resolve?: ConstResolver): ConstResult {
  if (!node) return NOT_CONST;
  if (node.type === 'Literal') return { ok: true, value: node.value };
  if (node.type === 'Identifier' && typeof node.name === 'string') {
    return resolve?.(node.name) ?? NOT_CONST;
  }
  if (node.type === 'TemplateLiteral') {
    if ((node.expressions ?? []).length > 0) return NOT_CONST;
    const quasi = (node.quasis ?? [])[0];
    if (!quasi) return NOT_CONST;
    return { ok: true, value: quasi.value.cooked ?? quasi.value.raw };
  }
  if (node.type === 'UnaryExpression' && node.operator) {
    const arg = evalConst(node.argument, resolve);
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
    const left = evalConst(node.left, resolve);
    const right = evalConst(node.right, resolve);
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
      const r = evalConst(el, resolve);
      if (!r.ok) return NOT_CONST; // includes sparse-array holes (el === null)
      values.push(r.value);
    }
    return { ok: true, value: values };
  }
  return NOT_CONST;
}

/**
 * Collects every `const <Identifier> = <constant>` binding in `root`
 * (typically a single test's function body — see `noTrivialAssertion`)
 * into a name → value map, chasing `const a = <constant>; const b = a;`
 * chains via `evalConst`'s own `resolve` callback closing over the map
 * being built. `let`/`var` are deliberately excluded: they can be
 * reassigned after declaration, so a value captured at declaration time
 * could be stale by the time the assertion actually runs — a false
 * positive risk this rule does not take.
 */
function collectConstBindings(root: Node | Node[] | null | undefined): Map<string, ConstResult> {
  const bindings = new Map<string, ConstResult>();
  const resolve: ConstResolver = (name) => bindings.get(name);
  walkNode(root, (n) => {
    if (n.type !== 'VariableDeclaration') return;
    const decl = n as unknown as {
      kind?: string;
      declarations?: Array<{ id?: Node; init?: Node | null }>;
    };
    if (decl.kind !== 'const') return;
    for (const d of decl.declarations ?? []) {
      if (d.id?.type !== 'Identifier' || !d.id.name || !d.init) continue;
      const value = evalConst(d.init, resolve);
      if (value.ok) bindings.set(d.id.name, value);
    }
  });
  return bindings;
}

/**
 * Climbs from `node` to the body of the nearest enclosing function (the
 * test/hook callback in the common case) — the scope `noTrivialAssertion`
 * resolves local `const` bindings within, so a `const` of the same name
 * in a different test can't be mistaken for this one's.
 */
function nearestEnclosingFunctionBody(
  context: Rule.RuleContext,
  node: Node
): Node | Node[] | null | undefined {
  const ancestors = (
    context.sourceCode?.getAncestors
      ? context.sourceCode.getAncestors(node as never)
      : (context as unknown as { getAncestors(): unknown[] }).getAncestors()
  ) as Node[];
  for (let i = ancestors.length - 1; i >= 0; i--) {
    if (FUNCTION_TYPES.has(ancestors[i].type)) return ancestors[i].body;
  }
  return undefined;
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
  expectedNode: Node | undefined,
  resolve?: ConstResolver
): boolean | undefined {
  switch (matcherName) {
    case 'toBe': {
      const expected = evalConst(expectedNode, resolve);
      return expected.ok ? Object.is(subject, expected.value) : undefined;
    }
    case 'toEqual':
    case 'toStrictEqual': {
      const expected = evalConst(expectedNode, resolve);
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
 * an assertion") while asserting nothing real. Also catches the same
 * idiom one local rename away: `const t = true; expect(t).toBe(true)` —
 * a `const` bound directly to a statically-evaluable constant within the
 * same test is resolved via `evalConst`'s `resolve` callback (see
 * `collectConstBindings`/`nearestEnclosingFunctionBody`), including a
 * short `const a = ...; const b = a;` chain. Deliberately conservative in
 * two directions beyond that: a `let`/`var` binding is never resolved
 * (it can be reassigned before the assertion runs, so a value captured
 * at declaration time could be stale — a false negative we accept rather
 * than risk flagging real app state), and the matcher + `.not`
 * combination is actually evaluated rather than assumed — `expect(true).
 * toBe(false)` and `expect(true, msg).toBeFalsy()` are the deliberate
 * force-fail idiom (asserting something that can only ever be false, to
 * fail a test unconditionally), the opposite of this rule's target, and
 * are never flagged: the message says "always passes" and must stay true
 * every time it fires.
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

        // Resolve a bare-identifier subject/expected-arg against any
        // `const` bound to a constant within the nearest enclosing
        // function (typically the test/hook callback) — see
        // collectConstBindings's docs for why only `const` qualifies.
        // Computed once per assertion call, not per identifier resolved.
        const scopeBindings = collectConstBindings(nearestEnclosingFunctionBody(context, node));
        const resolve: ConstResolver = (name) => scopeBindings.get(name);

        const subject = evalConst((expectCall.arguments ?? [])[0], resolve);
        if (!subject.ok) return;

        const expectedArg = (node.arguments ?? [])[0];
        const alwaysPasses = matcherAlwaysPasses(matcherName, subject.value, expectedArg, resolve);
        if (alwaysPasses === undefined) return;

        if (hasNot ? !alwaysPasses : alwaysPasses) {
          context.report({ node: node as never, messageId: 'trivial' });
        }
      },
    };
  },
};

/** `testNames` — see isSkipCallee's doc comment above; same alias treatment. */
function isTestDeclarationCallee(callee: Node | undefined, testNames: ReadonlySet<string>): boolean {
  if (!callee) return false;
  if (callee.type === 'Identifier' && callee.name && testNames.has(callee.name)) return true;
  if (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.object?.type === 'Identifier' &&
    callee.object.name &&
    testNames.has(callee.object.name) &&
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
    schema: [
      {
        additionalProperties: false,
        properties: {
          testAliasNames: { items: { type: 'string' }, type: 'array' },
        },
        type: 'object',
      },
    ],
  },
  create(context) {
    const testAliasNames = (context.options[0] as { testAliasNames?: string[] } | undefined)
      ?.testAliasNames ?? [];
    const testNames = new Set<string>(['test', ...testAliasNames]);
    return {
      CallExpression(node: Node) {
        if (!isTestDeclarationCallee(node.callee, testNames)) return;
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
