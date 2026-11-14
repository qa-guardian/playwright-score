/**
 * "If the app did not do it, the test does it itself, then asserts."
 *
 * Inside a test callback, for a statement S in a block that is
 *  - `if (<negated state check>) { ...actions... }`, or the `else` branch of
 *    `if (<state check>) {...} else { ...actions... }`, or
 *  - `try { ...expect/state check... } catch { ...actions... }`
 * ALL of the following must hold:
 *  (a) the fallback branch (not descending into nested functions) calls a
 *      content-supplying Playwright action: fill, type,
 *      pressSequentially, selectOption, setInputFiles (click-only fallbacks
 *      are the common "ensure the menu/toggle is open" setup idiom and are
 *      not flagged);
 *  (b) a later statement in the same block contains an expect(...);
 *  (c) the later expect's text shares a locator/selector expression with the
 *      state check (or try block), or with the action targets. "Locator
 *      expression" = the receiver text of a member call, e.g.
 *      `page.getByRole('textbox')` or the variable `input`; the bare `page`
 *      never counts.
 *
 * A "state check" is a call to isVisible/isHidden/isEnabled/isChecked/count/
 * textContent/innerText/inputValue/getAttribute (or a const boolean derived
 * from one). "Negated" means: `!check`, `check === false`, `count() === 0`,
 * `count() < 1`, `.length === 0`, `text !== '...'`, `isHidden()`/
 * `isDisabled()`, or `||`/`&&` containing one. Positive-branch conditional
 * actions (dismiss a banner if visible) are never flagged.
 */
import type { Rule } from 'eslint';
import { FN_TYPES, isExpectCall, memberName, resolveConstInit, unwrap, walk, type N } from './ast-util.js';

const CHECKS = new Set([
  'isVisible', 'isHidden', 'isEnabled', 'isDisabled', 'isChecked', 'isEditable', 'count',
  'textContent', 'innerText', 'inputValue', 'getAttribute', 'allTextContents', 'allInnerTexts',
]);
const NEGATIVE_STATE_CHECKS = new Set(['isHidden', 'isDisabled']);
// Only actions that SUPPLY content count. A click-only fallback is the
// "make sure the menu/toggle is open, then assert" setup idiom (checked on
// rill, mattermost: all click-only hits were setup, not self-fulfilment;
// `press('Escape')` in an else branch was setup too, so press is excluded).
const ACTIONS = new Set(['fill', 'type', 'pressSequentially', 'selectOption', 'setInputFiles']);

export const noSelfFulfillingFallback: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Disallow fallbacks that perform the expected state themselves before asserting it' },
    messages: {
      fallback:
        'Self-fulfilling fallback: when the app does not produce this state, the test performs the actions itself and then asserts the result. The assertion can no longer detect the app failing to do it. Assert first and fail, or remove the fallback.',
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
    const testNames = new Set<string>(['test', ...aliases]);
    const text = (n: N): string => context.sourceCode.getText(n as never).replace(/\s+/g, '');

    function isTestCallback(fn: N): boolean {
      const call = fn.parent;
      if (!call || call.type !== 'CallExpression' || !(call.arguments ?? []).includes(fn)) return false;
      let c = call.callee;
      if (c?.type === 'MemberExpression') c = c.object?.type === 'MemberExpression' ? c.object.object : c.object;
      return c?.type === 'Identifier' && !!c.name && testNames.has(c.name);
    }
    function inTest(n: N): boolean {
      for (let p = n.parent; p; p = p.parent) if (FN_TYPES.has(p.type) && isTestCallback(p)) return true;
      return false;
    }

    /** Does the expression contain a state check (resolving one level of const)? */
    function hasCheck(e: N | undefined, depth = 0): boolean {
      let found = false;
      walk(e, (n) => {
        if (found) return false;
        if (n.type === 'CallExpression' && CHECKS.has(memberName(n.callee) ?? '')) found = true;
        else if (n.type === 'MemberExpression' && !n.computed && n.property?.name === 'length') found = true;
        else if (n.type === 'Identifier' && depth < 2) {
          const init = resolveConstInit(context, n);
          if (init && hasCheck(init, depth + 1)) found = true;
        }
        return undefined;
      });
      return found;
    }
    function isZeroish(n: N | undefined): boolean {
      return !!n && n.type === 'Literal' && (n.value === 0 || n.value === '' || n.value === false);
    }
    /** The test expression is true when the app did NOT produce the state. */
    function negated(e: N | undefined, depth = 0): boolean {
      const n = unwrap(e);
      if (!n || depth > 3) return false;
      if (n.type === 'UnaryExpression' && n.operator === '!') return hasCheck(n.argument ?? undefined);
      if (n.type === 'LogicalExpression') return negated(n.left, depth + 1) || negated(n.right, depth + 1);
      if (n.type === 'BinaryExpression') {
        const op = n.operator;
        const l = unwrap(n.left);
        const r = unwrap(n.right);
        if ((op === '===' || op === '==') && hasCheck(l) && isZeroish(r)) return true;
        if ((op === '<' && hasCheck(l) && r?.type === 'Literal' && r.value === 1)) return true;
        if ((op === '!==' || op === '!=') && hasCheck(l) && r?.type === 'Literal' && typeof r.value === 'string') return true;
        return false;
      }
      if (n.type === 'CallExpression') return NEGATIVE_STATE_CHECKS.has(memberName(n.callee) ?? '');
      if (n.type === 'Identifier' && depth < 2) {
        const init = resolveConstInit(context, n);
        // `const hidden = await x.isHidden(); if (hidden)`
        return init ? negated(init, depth + 1) : false;
      }
      return false;
    }
    function positive(e: N | undefined): boolean {
      return hasCheck(e) && !negated(e);
    }

    /** Receiver texts of member calls and expect() subjects in a subtree. */
    function keys(root: unknown, depth = 0): Set<string> {
      const out = new Set<string>();
      walk(root, (n) => {
        if (n.type === 'CallExpression') {
          if (isExpectCall(n)) {
            const a = unwrap((n.arguments ?? [])[0]);
            if (a) addKey(out, a, depth);
          } else if (n.callee?.type === 'MemberExpression') {
            addKey(out, n.callee.object, depth);
          }
        }
      });
      return out;
    }
    function addKey(out: Set<string>, n: N | undefined, depth: number): void {
      const u = unwrap(n);
      if (!u) return;
      const t = text(u);
      if (t === 'page' || t === 'this.page' || t === 'expect' || t === 'test' || t.length < 3) return;
      out.add(t);
      if (u.type === 'Identifier' && depth < 2) {
        const init = resolveConstInit(context, u);
        if (init) for (const k of keys(init, depth + 1)) out.add(k);
        if (init) addKey(out, init, depth + 1);
      }
    }
    function overlap(a: Set<string>, b: Set<string>): boolean {
      for (const x of a) for (const y of b) if (x === y) return true;
      return false;
    }

    function hasAction(branch: N | undefined): { has: boolean; targets: Set<string> } {
      let has = false;
      const targets = new Set<string>();
      walk(branch, (n) => {
        if (n.type === 'CallExpression' && ACTIONS.has(memberName(n.callee) ?? '')) {
          has = true;
          addKey(targets, n.callee?.object, 0);
        }
      });
      return { has, targets };
    }
    function expectsAfter(siblings: N[], from: number): N[] {
      const found: N[] = [];
      for (const s of siblings.slice(from + 1)) {
        walk(s, (n) => {
          if (isExpectCall(n)) found.push(n);
        });
      }
      return found;
    }

    function evaluate(stmt: N, siblings: N[], idx: number): void {
      let fallback: N | undefined;
      let condKeys = new Set<string>();
      if (stmt.type === 'IfStatement') {
        const test = stmt.test;
        if (negated(test)) fallback = stmt.consequent as N;
        else if (positive(test) && stmt.alternate) fallback = stmt.alternate;
        if (!fallback) return;
        condKeys = keys(test);
        // keys() only sees member-call receivers/expect subjects; a const-derived test needs its init too.
        walk(test, (n) => {
          if (n.type === 'Identifier') {
            const init = resolveConstInit(context, n);
            if (init) for (const k of keys(init)) condKeys.add(k);
          }
        });
      } else if (stmt.type === 'TryStatement' && stmt.handler) {
        let guarded = false;
        walk(stmt.block, (n) => {
          if (isExpectCall(n) || (n.type === 'CallExpression' && CHECKS.has(memberName(n.callee) ?? ''))) guarded = true;
        });
        if (!guarded) return;
        fallback = stmt.handler.body;
        condKeys = keys(stmt.block);
      } else return;

      const act = hasAction(fallback);
      if (!act.has) return;
      const expects = expectsAfter(siblings, idx);
      if (expects.length === 0) return;
      const later = new Set<string>();
      for (const e of expects) for (const k of keys(e)) later.add(k);
      if (overlap(condKeys, later) || overlap(act.targets, later)) {
        context.report({ node: stmt as never, messageId: 'fallback' });
      }
    }

    function onBlock(raw: unknown): void {
      const block = raw as N;
      if (!inTest(block)) return;
      const body = (Array.isArray(block.body) ? block.body : []) as N[];
      body.forEach((s, i) => evaluate(s, body, i));
    }
    return { BlockStatement: onBlock };
  },
};
