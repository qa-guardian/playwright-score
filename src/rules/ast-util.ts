/**
 * Small AST helpers shared by the QAG-287 "would miss a real bug" rules
 * (no-swallowed-assertion, no-weak-assertion, no-unawaited-expect-value,
 * no-fixme-test). Plain-object ESTree nodes;
 * `parent` is attached by ESLint during traversal.
 */
import type { Rule } from 'eslint';

export type N = {
  type: string;
  parent?: N;
  computed?: boolean;
  optional?: boolean;
  callee?: N;
  object?: N;
  property?: N;
  name?: string;
  arguments?: N[];
  params?: N[];
  body?: N | N[] | null;
  operator?: string;
  argument?: N | null;
  value?: unknown;
  expression?: N;
  left?: N;
  right?: N;
  test?: N;
  consequent?: N | N[];
  alternate?: N | null;
  block?: N;
  handler?: (N & { body?: N }) | null;
  finalizer?: N | null;
  id?: N;
  init?: N | null;
  declarations?: N[];
  range?: [number, number];
};

export const FN_TYPES = new Set(['FunctionExpression', 'ArrowFunctionExpression', 'FunctionDeclaration']);

/** Walk a subtree. `visit` returns false to skip that node's children. Never descends into nested functions unless `intoFunctions`. */
export function walk(node: unknown, visit: (n: N) => boolean | void, intoFunctions = false): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit, intoFunctions);
    return;
  }
  const rec = node as Record<string, unknown>;
  if (typeof rec.type !== 'string') return;
  if (visit(node as N) === false) return;
  for (const key of Object.keys(rec)) {
    if (key === 'parent') continue;
    const v = rec[key];
    if (!v || typeof v !== 'object') continue;
    const child = v as { type?: string };
    if (!intoFunctions && !Array.isArray(v) && child.type && FN_TYPES.has(child.type)) continue;
    walk(v, visit, intoFunctions);
  }
}

export function unwrap(node: N | null | undefined): N | undefined {
  let n = node ?? undefined;
  while (
    n &&
    (n.type === 'AwaitExpression' ||
      n.type === 'TSNonNullExpression' ||
      n.type === 'ChainExpression' ||
      n.type === 'TSAsExpression' ||
      n.type === 'ParenthesizedExpression')
  ) {
    n = (n.type === 'AwaitExpression' ? n.argument : (n.argument ?? n.expression)) ?? undefined;
  }
  return n;
}

export function memberName(callee: N | undefined): string | undefined {
  if (!callee || callee.type !== 'MemberExpression' || callee.computed) return undefined;
  return callee.property?.type === 'Identifier' ? callee.property.name : undefined;
}

const NO_ALIASES: ReadonlySet<string> = new Set();

/**
 * The names a rule reads as `expect` besides `expect` itself (QAG-287 S4b.2): the
 * `const` aliases of Playwright's expect that the file proves (src/expect-alias.ts).
 * Only the alias lint pass sets them, in `settings.playwright.globalAliases.expect`;
 * every other lint has none.
 */
export function expectAliasNames(context: { settings?: unknown }): ReadonlySet<string> {
  const list = (context.settings as { playwright?: { globalAliases?: { expect?: unknown } } } | undefined)?.playwright?.globalAliases?.expect;
  return Array.isArray(list) ? new Set(list.filter((n): n is string => typeof n === 'string')) : NO_ALIASES;
}

/** `expect`, or one of the alias names given. */
export function isExpectName(name: unknown, aliases?: ReadonlySet<string>): boolean {
  return name === 'expect' || (typeof name === 'string' && aliases !== undefined && aliases.has(name));
}

/** `expect(...)`, `expect.soft(...)`, `expect.poll(...)`; with `aliases`, also through one of those names. */
export function isExpectCall(node: N | undefined, aliases?: ReadonlySet<string>): boolean {
  if (!node || node.type !== 'CallExpression') return false;
  const c = node.callee;
  if (c?.type === 'Identifier' && isExpectName(c.name, aliases)) return true;
  return (
    c?.type === 'MemberExpression' &&
    !c.computed &&
    c.object?.type === 'Identifier' &&
    isExpectName(c.object.name, aliases) &&
    (c.property?.name === 'soft' || c.property?.name === 'poll')
  );
}

export interface MatcherChain {
  expectCall: N;
  matcher: string;
  modifiers: string[]; // not / resolves / rejects
  call: N;
}

/** If `call` is `expect(x).[not.]matcher(...)`, describe it (`aliases`: see isExpectCall). */
export function parseMatcherCall(call: N, aliases?: ReadonlySet<string>): MatcherChain | undefined {
  if (call.type !== 'CallExpression') return undefined;
  const matcher = memberName(call.callee);
  if (!matcher) return undefined;
  const modifiers: string[] = [];
  let obj = call.callee?.object;
  while (obj && obj.type === 'MemberExpression' && !obj.computed && obj.property?.type === 'Identifier') {
    modifiers.push(obj.property.name ?? '');
    obj = obj.object;
  }
  if (!obj || !isExpectCall(obj, aliases)) return undefined;
  if (!modifiers.every((m) => m === 'not' || m === 'resolves' || m === 'rejects')) return undefined;
  return { expectCall: obj, matcher, modifiers, call };
}

/** Scope-resolved `const x = <init>` initialiser for an identifier, if any. */
export function resolveConstInit(context: Rule.RuleContext, id: N): N | undefined {
  if (id.type !== 'Identifier' || !id.name) return undefined;
  let scope = (context.sourceCode as unknown as { getScope(n: unknown): { set: Map<string, unknown>; upper: unknown } }).getScope(id);
  while (scope) {
    const v = scope.set.get(id.name) as
      | { defs: Array<{ type: string; node: N; parent?: N }>; references: Array<{ isWrite(): boolean; init?: boolean }> }
      | undefined;
    if (v) {
      const def = v.defs[0];
      if (!def || def.type !== 'Variable') return undefined;
      if (def.parent?.type === 'VariableDeclaration' && (def.parent as N & { kind?: string }).kind !== 'const') return undefined;
      return def.node.id?.type === 'Identifier' ? (def.node.init ?? undefined) : undefined;
    }
    scope = scope.upper as typeof scope;
  }
  return undefined;
}

const CHAIN_OK = new Set(['first', 'last', 'nth', 'filter', 'locator', 'and', 'or', 'frameLocator', 'contentFrame']);

/** Syntactic Locator: `page.locator(..)`, `x.getBy*(..)`, those chained with first/last/nth/filter/..., or a const initialised from one. */
export function isLocatorExpr(context: Rule.RuleContext, node: N | undefined, depth = 0): boolean {
  const n = unwrap(node);
  if (!n || depth > 3) return false;
  if (n.type === 'Identifier') {
    const init = resolveConstInit(context, n);
    return init ? isLocatorExpr(context, init, depth + 1) : false;
  }
  if (n.type !== 'CallExpression') return false;
  const name = memberName(n.callee);
  if (!name) return false;
  if (name === 'locator' || name.startsWith('getBy')) return true;
  if (CHAIN_OK.has(name)) return isLocatorExpr(context, n.callee?.object, depth + 1);
  return false;
}

/** Receiver is plausibly a Playwright Page/Locator/Frame (syntactic). */
export function isPlaywrightReceiver(context: Rule.RuleContext, node: N | undefined, depth = 0): boolean {
  const n = unwrap(node);
  if (!n || depth > 3) return false;
  if (isLocatorExpr(context, n)) return true;
  if (n.type === 'Identifier') {
    return n.name === 'page' || n.name === 'frame' || /[a-z]Locator$/.test(n.name ?? '') || /^(locator|page)$/i.test(n.name ?? '');
  }
  if (n.type === 'MemberExpression' && !n.computed) {
    return n.property?.name === 'page' && n.object?.type === 'ThisExpression';
  }
  return false;
}

export function nearestFunction(node: N): N | undefined {
  let p = node.parent;
  while (p) {
    if (FN_TYPES.has(p.type)) return p;
    p = p.parent;
  }
  return undefined;
}
