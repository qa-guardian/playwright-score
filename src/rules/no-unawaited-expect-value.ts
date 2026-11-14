/**
 * A Promise-returning Playwright call used without `await` inside
 * `expect(...)`, with a matcher that is not a web-first (auto-awaiting)
 * matcher. The assertion compares a Promise object, not the value.
 *
 * Matches `expect(<call>).[not.]<matcher>(...)` where <call> is not awaited,
 * its method is one of innerText/innerHTML/textContent/inputValue/
 * getAttribute/isVisible/isHidden/isEnabled/isDisabled/isChecked/isEditable/
 * count/title/allInnerTexts/allTextContents/boundingBox/content, and the
 * receiver is syntactically a Page/Locator (page, locator(), getBy*(), a
 * const from one, `*Locator`/`*Page` names). Also flags an un-awaited such
 * call as the argument of toBe/toEqual/toStrictEqual. Either position may be
 * a const initialised (un-awaited) from such a call. Never flags
 * `.resolves`/`.rejects` chains or web-first matchers.
 * `playwright/prefer-web-first-assertions` hits on the same line/column are
 * dropped by eslint-runner in favour of this message.
 */
import type { Rule } from 'eslint';
import { isPlaywrightReceiver, memberName, parseMatcherCall, resolveConstInit, type N } from './ast-util.js';

export const PROMISE_METHODS = new Set([
  'innerText', 'innerHTML', 'textContent', 'inputValue', 'getAttribute', 'isVisible', 'isHidden',
  'isEnabled', 'isDisabled', 'isChecked', 'isEditable', 'count', 'title', 'allInnerTexts',
  'allTextContents', 'boundingBox', 'content',
]);
const WEB_FIRST = /^(toHave|toBe(Visible|Hidden|Enabled|Disabled|Checked|Editable|Empty|Focused|Attached|InViewport|OK)$|toContainText$|toMatchAriaSnapshot$|toPass$|toMatchSnapshot$|toHaveScreenshot$)/;
const VALUE_ARG_MATCHERS = new Set(['toBe', 'toEqual', 'toStrictEqual']);

export const noUnawaitedExpectValue: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow un-awaited Promise-returning Playwright calls inside expect()' },
    messages: {
      missingAwait:
        'Missing await: {{call}}() returns a Promise, and this matcher compares the Promise itself, not the value (so it always passes or always fails). Add await, or use a web-first assertion on the locator.',
    },
    schema: [],
  },
  create(context) {
    function bareCall(n0: N | undefined): string | undefined {
      // `const t = page.title(); expect(t)...`: a const initialised from an un-awaited call.
      const n = n0?.type === 'Identifier' ? resolveConstInit(context, n0) : n0;
      if (!n || n.type !== 'CallExpression') return undefined; // AwaitExpression etc. are not bare
      const name = memberName(n.callee);
      if (!name || !PROMISE_METHODS.has(name)) return undefined;
      return isPlaywrightReceiver(context, n.callee?.object) ? name : undefined;
    }
    return {
      CallExpression(raw) {
        const node = raw as unknown as N;
        const m = parseMatcherCall(node);
        if (!m || m.modifiers.some((x) => x === 'resolves' || x === 'rejects')) return;
        if (WEB_FIRST.test(m.matcher)) return;
        const isPoll = m.expectCall.callee?.type === 'MemberExpression' && m.expectCall.callee.property?.name === 'poll';
        const subject = (m.expectCall.arguments ?? [])[0];
        const hit = (!isPoll && bareCall(subject)) ||
          (VALUE_ARG_MATCHERS.has(m.matcher) ? bareCall((node.arguments ?? [])[0]) : undefined);
        if (hit) context.report({ node: raw, messageId: 'missingAwait', data: { call: hit } });
      },
    };
  },
};
