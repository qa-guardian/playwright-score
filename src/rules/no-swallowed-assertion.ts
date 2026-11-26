/**
 * An assertion whose failure is caught and discarded cannot fail the test.
 *
 * Matches:
 *  1. `try { ... expect(x).matcher() ... } catch { ... }` where the catch
 *     body does not throw, call expect / test.fail / a fail-ish helper,
 *     return a value, or assign/mutate outer state (any of which may carry
 *     the failure to a later assertion). Skipped inside loops (retry idiom).
 *  2. `await expect(x).matcher().catch(<fn that does not throw>)` as a
 *     statement (result discarded).
 *
 * Not reported (QAG-287 slice E1): a timed probe followed by a real check.
 * The expect is only a bounded wait, and something afterwards still fails
 * the test when the state is wrong:
 *  - a later hard assertion on the same subject (`expect(zone)` probed,
 *    then `expect(zone)` again);
 *  - a catch that performs an awaited action and then asserts / waits
 *    (`click()` then `.waitFor()` or `expect(...)`);
 *  - a variable assigned in the try and read afterwards (`cookieSet`);
 *  - an `expect.poll(() => f())` probe whose callback expression is read
 *    again afterwards (`ready = f()`);
 *  - a try that returns on success (early exit) with a hard assertion
 *    after it as the fallthrough.
 * A catch that only logs or ignores, with no later check of the same
 * thing, is still reported.
 *
 * QAG-287 S7b: a negated chain whose `.catch` discards the rejection
 * (`.not.toBeVisible().catch(() => {})`, see swallow-handler.ts) is
 * re-checked only by a later hard assertion that repeats the same negated
 * check on the same subject; a later positive assertion proves nothing about
 * the swallowed `not` condition.
 */
import type { Rule } from 'eslint';
import { FN_TYPES, memberName, nearestFunction, parseMatcherCall, walk, type N } from './ast-util.js';
import { checkSignature, isDiscardingHandler, isNegated } from './swallow-handler.js';

const LOOPS = new Set(['ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement']);
const FAILISH = /fail|error|throw|assert|report|expect/i;

const LOGGERS = /^(console|logger|log|logging|consola|pino|winston|bunyan|debug)$/i;

/** `console.error(...)`, `logger.warn(...)`, `this.logger.error(...)`: logging reports, it does not fail. */
function isLoggerCall(callee: N | undefined): boolean {
  if (callee?.type !== 'MemberExpression') return false;
  let o: N | undefined = callee.object;
  while (o) {
    if (o.type === 'Identifier') return LOGGERS.test(o.name ?? '');
    if (o.type !== 'MemberExpression') return false;
    if (!o.computed && o.property?.type === 'Identifier' && LOGGERS.test(o.property.name ?? '')) return true;
    o = o.object;
  }
  return false;
}

/** True when `body` can carry the failure onward: throw, expect, test.fail, return value, assignment, fail-ish call. */
function propagates(body: N | undefined): boolean {
  let ok = false;
  walk(
    body,
    (n) => {
      if (ok) return false;
      if (n.type === 'ThrowStatement') ok = true;
      else if (n.type === 'ReturnStatement' && n.argument) ok = true;
      else if (n.type === 'AssignmentExpression' || n.type === 'UpdateExpression') ok = true;
      else if (n.type === 'CallExpression') {
        const c = n.callee;
        if (isLoggerCall(c)) return undefined; // a log line is not a failure
        const name = c?.type === 'Identifier' ? c.name : memberName(c);
        if (c?.type === 'MemberExpression' && c.object?.type === 'Identifier' && c.object.name === 'expect') ok = true;
        else if (c?.type === 'MemberExpression' && memberName(c) === 'skip') ok = true; // test.skip(...) in the catch: a deliberate, visible outcome
        else if (name && FAILISH.test(name)) ok = true;
        else if (name && ['push', 'add', 'set'].includes(name)) ok = true; // collects errors for later
      }
      return undefined;
    },
    true
  );
  return ok;
}


function isWaitForCall(n: N): boolean {
  return n.type === 'CallExpression' && memberName(n.callee) === 'waitFor';
}

/** The text identifying what an expect probes: the subject, or a poll callback's expression body. */
function probeKey(source: { getText(n: unknown): string }, chain: ReturnType<typeof parseMatcherCall>): string {
  const arg = (chain?.expectCall.arguments ?? [])[0];
  if (!arg) return '';
  const isPoll = memberName(chain?.expectCall.callee) === 'poll';
  if (isPoll && FN_TYPES.has(arg.type)) {
    const b = arg.body as N | undefined;
    if (b && b.type !== 'BlockStatement') return source.getText(b);
    return '';
  }
  return source.getText(arg);
}

/** A later assertion that can fail the test: not itself inside a swallowing try block or `.catch`. */
function isHardAssertionNode(n: N, stop: N | undefined): boolean {
  if (!(parseMatcherCall(n) || isWaitForCall(n))) return false;
  let child: N = n;
  for (let p = n.parent; p && p !== stop; child = p, p = p.parent) {
    if (p.type === 'TryStatement' && p.handler && p.block === child) return false;
    if (p.type === 'CallExpression' && memberName(p.callee) === 'catch' && p.callee?.object === child) return false;
  }
  return true;
}

/**
 * An awaited call between a swallowed negated probe and a later repeat of the same check that can change the page: any
 * awaited call that is not itself an assertion, a `waitFor*` or a log line (`await page.evaluate(...)`, `await el.click()`).
 * The repeat then checks a later state, not the one the probe was dropped for, so it does not re-check the probe.
 */
function stateChangedBetween(later: N[], from: number, to: number): boolean {
  return later.some((n) => {
    const at = n.range?.[0] ?? -1;
    if (n.type !== 'AwaitExpression' || at < from || at >= to) return false;
    const call = unwrapCall(n.argument);
    if (!call) return false;
    const name = memberName(call.callee);
    return !(parseMatcherCall(call) || isWaitForCall(call) || (name !== undefined && name.startsWith('waitFor')) || isLoggerCall(call.callee));
  });
}

/**
 * True when the swallowed probe is followed by something that still fails
 * the test on a bad state: see the file header. `stmt` is the statement
 * holding the probe (TryStatement or the `.catch` expression statement),
 * `tryBlock`/`catchBody` the parts of a try/catch, if any. `sameCheck`
 * (S7b): the later same-subject assertion must also repeat this check.
 */
function probeIsRechecked(
  source: { getText(n: unknown): string },
  stmt: N,
  probes: N[],
  tryBlock: N | undefined,
  catchBody: N | undefined,
  sameCheck?: string
): boolean {
  const scope = nearestFunction(stmt) ?? (() => { let t: N = stmt; while (t.parent) t = t.parent; return t; })();
  const after = stmt.range?.[1] ?? Infinity;
  const later: N[] = [];
  walk(scope.type === 'Program' ? scope : scope.body, (n) => { if ((n.range?.[0] ?? -1) >= after) later.push(n); }, true);
  const hardLater = later.filter((n) => isHardAssertionNode(n, scope));

  // 1. a later hard assertion on the same subject
  const keys = probes.map((c) => probeKey(source, parseMatcherCall(c))).filter((k) => k.length > 0);
  for (const n of hardLater) {
    const chain = parseMatcherCall(n);
    const subject = chain ? probeKey(source, chain) : isWaitForCall(n) && n.callee?.object ? source.getText(n.callee.object) : '';
    if (sameCheck !== undefined && (!chain || checkSignature(source, chain) !== sameCheck)) continue;
    if (sameCheck !== undefined && stateChangedBetween(later, after, n.range?.[0] ?? Infinity)) continue;
    if (subject && keys.includes(subject)) return true;
  }

  // 2. a catch that performs an awaited action and then asserts or waits
  if (catchBody) {
    let awaited = false;
    let checks = false;
    walk(catchBody, (n) => {
      if (n.type === 'AwaitExpression' && unwrapCall(n.argument) && !isLoggerCall(unwrapCall(n.argument)?.callee)) awaited = true;
      if (parseMatcherCall(n) || isWaitForCall(n)) checks = true;
    }, true);
    if (awaited && checks) return true;
  }

  // 3. a variable assigned in the try, read afterwards
  if (tryBlock) {
    const assigned = new Set<string>();
    walk(tryBlock, (n) => {
      if (n.type === 'AssignmentExpression' && n.left?.type === 'Identifier' && n.left.name) assigned.add(n.left.name);
    });
    if (assigned.size > 0) {
      for (const n of later) {
        if (n.type !== 'Identifier' || !n.name || !assigned.has(n.name)) continue;
        const par = n.parent;
        if (par?.type === 'AssignmentExpression' && par.left === n) continue; // a write, not a read
        return true;
      }
    }
  }

  // 4. a poll callback expression read again afterwards (`ready = f()`)
  for (const c of probes) {
    const chain = parseMatcherCall(c);
    if (memberName(chain?.expectCall.callee) !== 'poll') continue;
    const key = probeKey(source, chain);
    if (key.length < 6) continue;
    for (const n of later) if (n.type === 'CallExpression' && source.getText(n) === key) return true;
  }

  // 5. success returns early; the fallthrough still asserts
  if (tryBlock) {
    let returns = false;
    walk(tryBlock, (n) => { if (n.type === 'ReturnStatement') returns = true; });
    if (returns && hardLater.length > 0) return true;
  }
  return false;
}

function unwrapCall(n: N | null | undefined): N | undefined {
  let c: N | undefined = n ?? undefined;
  while (c && (c.type === 'ChainExpression' || c.type === 'TSNonNullExpression')) c = (c.expression ?? c.argument) ?? undefined;
  return c?.type === 'CallExpression' ? c : undefined;
}

export const noSwallowedAssertion: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow assertions whose failure is caught and discarded' },
    messages: {
      swallowed:
        'This assertion is inside a try/catch that swallows its failure, so it can never fail the test. Rethrow in the catch, or drop the try.',
      swallowedCatch:
        'This assertion ends in .catch(...) that discards the failure, so it can never fail the test. Remove the .catch.',
    },
    schema: [],
  },
  create(context) {
    return {
      TryStatement(raw) {
        const node = raw as unknown as N;
        if (!node.handler) return;
        const probes: N[] = [];
        walk(node.block, (n) => {
          if (n.type === 'CallExpression' && parseMatcherCall(n)) probes.push(n);
        });
        if (probes.length === 0) return;
        if (propagates(node.handler.body)) return;
        for (let p = node.parent; p; p = p.parent) {
          if (LOOPS.has(p.type)) return;
          if (FN_TYPES.has(p.type)) break;
        }
        if (probeIsRechecked(context.sourceCode, node, probes, node.block, node.handler.body)) return;
        context.report({ node: raw, messageId: 'swallowed' });
      },
      CallExpression(raw) {
        const node = raw as unknown as N;
        if (memberName(node.callee) !== 'catch') return;
        const inner = node.callee?.object;
        if (!inner || !parseMatcherCall(inner)) return;
        const handler = (node.arguments ?? [])[0];
        if (!handler) return;
        // Result must be discarded: `await expect(...).catch(...)` as a statement.
        let up: N | undefined = node.parent;
        if (up?.type === 'AwaitExpression') up = up.parent;
        if (up?.type !== 'ExpressionStatement') return;
        const chain = parseMatcherCall(inner);
        // S7b: a negated check whose rejection is discarded outright (empty handler, or a local empty function).
        const negatedDiscard = isNegated(chain) && isDiscardingHandler(context, handler);
        const isFn = FN_TYPES.has(handler.type);
        const isConsole = handler.type === 'MemberExpression' && handler.object?.name === 'console';
        if (!isFn && !isConsole && !negatedDiscard) return;
        if (isFn) {
          const body = handler.body as N | undefined;
          if (body && body.type === 'BlockStatement' && propagates(body)) return;
        }
        const holder = (node.parent?.type === 'AwaitExpression' ? node.parent.parent : node.parent) as N;
        const handlerBody = isFn ? (handler.body as N | undefined) : undefined;
        const sameCheck = negatedDiscard && chain ? checkSignature(context.sourceCode, chain) : undefined;
        if (chain && probeIsRechecked(context.sourceCode, holder, [inner], undefined, handlerBody, sameCheck)) return;
        context.report({ node: raw, messageId: 'swallowedCatch' });
      },
    };
  },
};
