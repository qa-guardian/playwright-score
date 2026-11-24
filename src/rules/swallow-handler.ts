/**
 * QAG-287 S7b: a negated assertion whose rejection is thrown away.
 *
 * `await expect(banner).not.toBeVisible().catch(() => {})` followed by
 * `await expect(banner).toHaveText('Sale')` is not a timed probe plus a real
 * check: the later positive assertion says nothing about the `not` condition,
 * which may have failed and been dropped. no-swallowed-assertion therefore
 * keeps the later-same-subject exemption for a negated chain only when the
 * later hard assertion repeats the same negated check (same matcher, same
 * arguments, a timeout-only options object aside), and only for handlers
 * that discard the rejection outright:
 *  - an empty function: `() => {}`, `(e) => {}`, `function () {}`;
 *  - `() => undefined`;
 *  - the name of a local function with an empty body, never reassigned:
 *    `function noop() {}`, `const noop = () => {}`.
 * Every other handler, and every non-negated chain, keeps the rule's
 * existing behaviour.
 */
import type { Rule } from 'eslint';
import { FN_TYPES, type MatcherChain, type N } from './ast-util.js';

/** `() => {}`, `function () {}`, `() => undefined`. */
function isEmptyFunction(fn: N | null | undefined): boolean {
  if (!fn || !FN_TYPES.has(fn.type)) return false;
  const body = fn.body as N | null | undefined;
  if (!body) return false;
  if (body.type === 'BlockStatement') return ((body.body as N[] | undefined) ?? []).length === 0;
  return body.type === 'Identifier' && body.name === 'undefined';
}

type Def = { type: string; node: N; parent?: N & { kind?: string } };
type Variable = { defs: Def[]; references: Array<{ isWrite(): boolean; init?: boolean }> };
type Scope = { set: Map<string, Variable>; upper: Scope | null };

/** A `.catch` handler that discards the rejection: an empty function, inline or a local name for one. */
export function isDiscardingHandler(context: Rule.RuleContext, handler: N | undefined): boolean {
  if (!handler) return false;
  if (isEmptyFunction(handler)) return true;
  if (handler.type !== 'Identifier' || !handler.name) return false;
  let scope: Scope | null = (context.sourceCode as unknown as { getScope(n: unknown): Scope }).getScope(handler);
  for (; scope; scope = scope.upper) {
    const v = scope.set.get(handler.name);
    if (!v) continue;
    if (v.defs.length !== 1) return false;
    if (v.references.some((r) => r.isWrite() && !r.init)) return false; // reassigned: not provably the empty function
    const def = v.defs[0];
    if (def.type === 'FunctionName') return isEmptyFunction(def.node);
    if (def.type === 'Variable' && def.parent?.kind === 'const' && def.node.id?.type === 'Identifier') return isEmptyFunction(def.node.init);
    return false;
  }
  return false; // a global or an import: not a local function
}

export function isNegated(chain: MatcherChain | undefined): boolean {
  return !!chain?.modifiers.includes('not');
}

/** `{ timeout: 2000 }`: an options object that only sets how long to wait, not what is checked. */
function isTimeoutOnly(arg: N | undefined): boolean {
  const props = (arg as (N & { properties?: N[] }) | undefined)?.properties;
  if (arg?.type !== 'ObjectExpression' || !props || props.length === 0) return false;
  return props.every((p) => p.type === 'Property' && !p.computed && (p as N & { key?: N }).key?.type === 'Identifier' && (p as N & { key?: N }).key?.name === 'timeout');
}

/**
 * The check a later assertion must repeat to re-check a negated probe: modifiers, matcher and argument text
 * (`not.toBeVisible()`, `not.toHaveText('Saving')`), without a trailing `{ timeout }`. The subject is compared
 * separately.
 */
export function checkSignature(source: { getText(n: unknown): string }, chain: MatcherChain): string {
  const args = (chain.call.arguments ?? []).slice();
  if (isTimeoutOnly(args[args.length - 1])) args.pop();
  return `${chain.modifiers.slice().reverse().join('.')}.${chain.matcher}(${args.map((a) => source.getText(a)).join(', ')})`;
}
