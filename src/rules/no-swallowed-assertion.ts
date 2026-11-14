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
 */
import type { Rule } from 'eslint';
import { FN_TYPES, memberName, parseMatcherCall, walk, type N } from './ast-util.js';

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
        else if (name && FAILISH.test(name)) ok = true;
        else if (name && ['push', 'add', 'set'].includes(name)) ok = true; // collects errors for later
      }
      return undefined;
    },
    true
  );
  return ok;
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
        let hasExpect = false;
        walk(node.block, (n) => {
          if (n.type === 'CallExpression' && parseMatcherCall(n)) hasExpect = true;
        });
        if (!hasExpect) return;
        if (propagates(node.handler.body)) return;
        for (let p = node.parent; p; p = p.parent) {
          if (LOOPS.has(p.type)) return;
          if (FN_TYPES.has(p.type)) break;
        }
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
        const isFn = FN_TYPES.has(handler.type);
        const isConsole = handler.type === 'MemberExpression' && handler.object?.name === 'console';
        if (!isFn && !isConsole) return;
        if (isFn) {
          const body = handler.body as N | undefined;
          if (body && body.type === 'BlockStatement' && propagates(body)) return;
        }
        context.report({ node: raw, messageId: 'swallowedCatch' });
      },
    };
  },
};
