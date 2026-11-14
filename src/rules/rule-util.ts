import { FACTORY_MARK } from '../test-aliases.js';

/**
 * Small AST helpers shared by the QAG-287 flake-risk rules (one rule per
 * file). Nodes are typed loosely on purpose: the parser may produce
 * TypeScript-ESTree node types that the plain ESTree typings do not model.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyNode = any;

/** Strips `x!`, `x as T` and optional-chain wrappers. */
export function unwrap(node: AnyNode): AnyNode {
  let n = node;
  while (
    n &&
    (n.type === 'TSNonNullExpression' ||
      n.type === 'ChainExpression' ||
      n.type === 'TSAsExpression' ||
      n.type === 'TSSatisfiesExpression' ||
      n.type === 'TSTypeAssertion')
  ) {
    n = n.expression;
  }
  return n;
}

/** Name of a non-computed member property (or string-literal computed one). */
export function propName(member: AnyNode): string | undefined {
  if (!member || member.type !== 'MemberExpression') return undefined;
  const p = member.property;
  if (!member.computed && p?.type === 'Identifier') return p.name;
  if (member.computed && p?.type === 'Literal' && typeof p.value === 'string') return p.value;
  return undefined;
}

const LOCATOR_PRODUCERS = new Set([
  'locator',
  'getByRole',
  'getByText',
  'getByLabel',
  'getByPlaceholder',
  'getByAltText',
  'getByTitle',
  'getByTestId',
  'first',
  'last',
  'nth',
  'filter',
  'and',
  'or',
  'frameLocator',
  'contentFrame',
]);

function findConstInit(context: { sourceCode: AnyNode }, node: AnyNode, name: string): AnyNode {
  let scope = context.sourceCode.getScope(node);
  while (scope) {
    const v = scope.set?.get(name);
    if (v) {
      const defs = v.defs ?? [];
      if (defs.length !== 1) return undefined;
      const def = defs[0];
      if (def.type !== 'Variable' || def.parent?.kind !== 'const') return undefined;
      return def.node?.init;
    }
    scope = scope.upper;
  }
  return undefined;
}

/**
 * True when the expression is *syntactically* a Playwright Page or Locator:
 * the identifier `page`, a `.page` property (`this.page`, `fixtures.page`),
 * a locator-producing call chain on one of those (`page.getByRole(..)`,
 * `page.locator(..).first()`), or an identifier bound once by `const` to
 * such an expression. Anything else (a parameter called `el`, a jQuery
 * wrapper, an array) is not a receiver, so a method that happens to share a
 * Playwright name on another object is never matched.
 */
export function isPwReceiver(context: { sourceCode: AnyNode }, expr: AnyNode, depth = 0): boolean {
  const n = unwrap(expr);
  if (!n || depth > 4) return false;
  if (n.type === 'Identifier') {
    if (n.name === 'page') return true;
    const init = findConstInit(context, n, n.name);
    return init ? isPwReceiver(context, init, depth + 1) : false;
  }
  if (n.type === 'MemberExpression') {
    return propName(n) === 'page';
  }
  if (n.type === 'CallExpression' && n.callee?.type === 'MemberExpression') {
    const name = propName(n.callee);
    return !!name && LOCATOR_PRODUCERS.has(name) && isPwReceiver(context, n.callee.object, depth + 1);
  }
  return false;
}

/** Nearest enclosing function node, or undefined at module level. */
export function enclosingFunction(node: AnyNode): AnyNode {
  let p = node?.parent;
  while (p) {
    if (
      p.type === 'FunctionDeclaration' ||
      p.type === 'FunctionExpression' ||
      p.type === 'ArrowFunctionExpression'
    ) {
      return p;
    }
    p = p.parent;
  }
  return undefined;
}

/** Evaluates a numeric literal / simple arithmetic expression, else undefined. */
export function evalNumber(node: AnyNode): number | undefined {
  const n = unwrap(node);
  if (!n) return undefined;
  if (n.type === 'Literal' && typeof n.value === 'number') return n.value;
  if (n.type === 'UnaryExpression' && (n.operator === '-' || n.operator === '+')) {
    const v = evalNumber(n.argument);
    return v === undefined ? undefined : n.operator === '-' ? -v : v;
  }
  if (n.type === 'BinaryExpression' && ['+', '-', '*', '/', '**'].includes(n.operator)) {
    const a = evalNumber(n.left);
    const b = evalNumber(n.right);
    if (a === undefined || b === undefined) return undefined;
    switch (n.operator) {
      case '+':
        return a + b;
      case '-':
        return a - b;
      case '*':
        return a * b;
      case '/':
        return b === 0 ? undefined : a / b;
      default:
        return a ** b;
    }
  }
  return undefined;
}

/** Static string value of a literal or an expression-free template literal. */
export function staticString(node: AnyNode): string | undefined {
  const n = unwrap(node);
  if (!n) return undefined;
  if (n.type === 'Literal' && typeof n.value === 'string') return n.value;
  if (n.type === 'TemplateLiteral' && n.expressions.length === 0 && n.quasis.length === 1) {
    return n.quasis[0].value.cooked ?? undefined;
  }
  return undefined;
}

function isCurriedFactory(node: AnyNode, testNames: ReadonlySet<string>): boolean {
  return node?.type === 'CallExpression' && node.callee?.type === 'Identifier' && testNames.has(node.callee.name + FACTORY_MARK);
}

/** `test(...)`, `test.only(...)`, `it(...)` — a test declaration call (not describe/hook). */
export function isTestDeclaration(call: AnyNode, testNames: ReadonlySet<string>): boolean {
  if (call?.type !== 'CallExpression') return false;
  const c = call.callee;
  // Curried `factory({...})("title", fn)` / `.only/.skip/.fixme` (QAG-287);
  // factories travel in the same name set as `name()` (see test-aliases.ts).
  if (isCurriedFactory(c, testNames)) return true;
  if (c?.type === 'MemberExpression' && isCurriedFactory(c.object, testNames)) {
    const m = propName(c);
    return m === 'only' || m === 'fail' || m === 'fixme' || m === 'skip';
  }
  if (c?.type === 'Identifier') return testNames.has(c.name) || c.name === 'it';
  if (c?.type === 'MemberExpression' && c.object?.type === 'Identifier') {
    const m = propName(c);
    return (testNames.has(c.object.name) || c.object.name === 'it') && (m === 'only' || m === 'fail' || m === 'fixme');
  }
  return false;
}

const HOOKS = new Set(['beforeEach', 'afterEach', 'beforeAll', 'afterAll']);
export function hookName(call: AnyNode, testNames: ReadonlySet<string>): string | undefined {
  const c = call?.type === 'CallExpression' ? call.callee : undefined;
  if (c?.type === 'MemberExpression' && c.object?.type === 'Identifier' && testNames.has(c.object.name)) {
    const m = propName(c);
    if (m && HOOKS.has(m)) return m;
  }
  if (c?.type === 'Identifier' && HOOKS.has(c.name)) return c.name;
  return undefined;
}

/** `test.describe(...)`, `describe(...)`, `test.describe.serial/parallel/only(...)`. */
export function isDescribeCall(call: AnyNode, testNames: ReadonlySet<string>): boolean {
  if (call?.type !== 'CallExpression') return false;
  const c = call.callee;
  if (c?.type === 'Identifier') return c.name === 'describe';
  if (c?.type !== 'MemberExpression') return false;
  const m = propName(c);
  const o = unwrap(c.object);
  if (m === 'describe') return o?.type === 'Identifier' && (testNames.has(o.name) || o.name === 'it');
  if (m === 'serial' || m === 'parallel' || m === 'only' || m === 'skip' || m === 'fixme') {
    return (
      o?.type === 'MemberExpression' &&
      propName(o) === 'describe' &&
      o.object?.type === 'Identifier' &&
      testNames.has(o.object.name)
    );
  }
  return false;
}

/** `test.describe.serial(...)` call. */
export function isSerialDescribeCall(call: AnyNode, testNames: ReadonlySet<string>): boolean {
  if (call?.type !== 'CallExpression') return false;
  const c = unwrap(call.callee);
  if (c?.type !== 'MemberExpression' || propName(c) !== 'serial') return false;
  const o = unwrap(c.object);
  return o?.type === 'MemberExpression' && propName(o) === 'describe' && o.object?.type === 'Identifier' && testNames.has(o.object.name);
}

/** `test.describe.configure({ mode: 'serial' })` call. */
export function isSerialConfigureCall(call: AnyNode, testNames: ReadonlySet<string>): boolean {
  if (call?.type !== 'CallExpression') return false;
  const c = unwrap(call.callee);
  if (c?.type !== 'MemberExpression' || propName(c) !== 'configure') return false;
  const o = unwrap(c.object);
  if (!(o?.type === 'MemberExpression' && propName(o) === 'describe' && o.object?.type === 'Identifier' && testNames.has(o.object.name))) return false;
  const arg = unwrap(call.arguments?.[0]);
  if (arg?.type !== 'ObjectExpression') return false;
  return arg.properties.some(
    (p: AnyNode) => p.type === 'Property' && (p.key?.name ?? p.key?.value) === 'mode' && p.value?.type === 'Literal' && p.value.value === 'serial'
  );
}

/** Does this statement list directly contain `test.describe.configure({ mode: 'serial' })`? */
function bodyHasSerialConfigure(body: AnyNode[] | undefined, testNames: ReadonlySet<string>): boolean {
  return (body ?? []).some((st) => {
    if (st?.type !== 'ExpressionStatement') return false;
    const e = unwrap(st.expression);
    return isSerialConfigureCall(e?.type === 'AwaitExpression' ? unwrap(e.argument) : e, testNames);
  });
}

/**
 * Is `node` in a scope declared serial: the file has a top-level
 * `test.describe.configure({ mode: 'serial' })`, or any enclosing describe is
 * `test.describe.serial(...)` or configures serial mode in its own body.
 */
export function isInSerialScope(node: AnyNode, testNames: ReadonlySet<string>): boolean {
  for (let p = node?.parent; p; p = p.parent) {
    if (p.type === 'Program') return bodyHasSerialConfigure(p.body, testNames);
    if ((p.type === 'ArrowFunctionExpression' || p.type === 'FunctionExpression') && p.parent?.type === 'CallExpression' && p.parent.arguments.includes(p)) {
      const call = p.parent;
      if (isSerialDescribeCall(call, testNames)) return true;
      if (isDescribeCall(call, testNames) && p.body?.type === 'BlockStatement' && bodyHasSerialConfigure(p.body.body, testNames)) return true;
    }
  }
  return false;
}

export function testNamesFromOptions(options: unknown[]): Set<string> {
  const names = (options[0] as { testAliasNames?: string[] } | undefined)?.testAliasNames ?? [];
  return new Set<string>(['test', ...names]);
}

export const TEST_ALIAS_SCHEMA = [
  {
    type: 'object' as const,
    properties: { testAliasNames: { items: { type: 'string' as const }, type: 'array' as const } },
    additionalProperties: false,
  },
];
