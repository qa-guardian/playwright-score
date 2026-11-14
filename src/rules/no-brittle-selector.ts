import type { Rule } from 'eslint';
import { isPwReceiver, propName, staticString, unwrap, type AnyNode } from './rule-util.js';

/**
 * `pwscore/no-brittle-selector` (QAG-287). Selector strings that encode
 * page structure instead of what the user sees. Matches, on the first
 * argument of `.locator(...)`, `.frameLocator(...)` and the legacy
 * selector-taking page methods (`page.click('..')`, `page.$('..')`, ...)
 * when it is a fully static string:
 *  - XPath: `xpath=...`, or a string starting with `//` or `(//`
 *  - `:nth-child(` / `:nth-of-type(`
 *  - a CSS chain with 4 or more combinators (`>`, `+`, `~`, descendant
 *    space) outside brackets/parentheses/quotes
 *  - generated class names: `.css-1a2b3c`, `.sc-bdfBwQ`, `.jss123`,
 *    `.MuiBox-root-12`, `.makeStyles-root-12`
 * and `.nth(n)` / `.first()` / `.last()` applied directly to a raw
 * `.locator('<string>')` (a `data-testid`/`role=`/`text=` selector string
 * is exempt: it names something stable).
 *
 * Reported as warning but report-only (evidence, not score): the locators
 * dimension already counts every raw `.locator()`/legacy selector call in
 * its native/raw ratio; scoring these as well would charge the same call
 * twice. The finding says why the raw call is fragile.
 */
const SELECTOR_METHODS = new Set(['locator', 'frameLocator']);
const LEGACY = new Set([
  'click', 'dblclick', 'fill', 'type', 'press', 'check', 'uncheck', 'hover', 'focus',
  'selectOption', 'textContent', 'innerText', 'innerHTML', 'getAttribute', 'inputValue',
  'isVisible', 'isChecked', 'isEnabled', 'isDisabled', 'isHidden', 'waitForSelector', '$', '$$',
  'setInputFiles', 'dispatchEvent', 'tap',
]);

function countCombinators(css: string): number {
  let depthParen = 0;
  let depthBracket = 0;
  let quote = '';
  let count = 0;
  let pendingSpace = false;
  let sawCompound = false;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; sawCompound = true; continue; }
    if (ch === '(') { depthParen++; continue; }
    if (ch === ')') { depthParen = Math.max(0, depthParen - 1); continue; }
    if (ch === '[') { depthBracket++; continue; }
    if (ch === ']') { depthBracket = Math.max(0, depthBracket - 1); continue; }
    if (depthParen || depthBracket) continue;
    if (ch === ',') return 0; // selector list: do not guess
    if (ch === '>' || ch === '+' || ch === '~') {
      if (sawCompound) count++;
      sawCompound = false;
      pendingSpace = false;
      continue;
    }
    if (/\s/.test(ch)) {
      if (sawCompound) pendingSpace = true;
      continue;
    }
    if (pendingSpace) { count++; pendingSpace = false; }
    sawCompound = true;
  }
  return count;
}

export function brittleReason(sel: string): string | undefined {
  const s = sel.trim();
  if (/^xpath=/i.test(s) || s.startsWith('//') || s.startsWith('(//')) return 'an XPath selector';
  if (/:nth-(child|of-type|last-child|last-of-type)\(/.test(s)) return 'a positional :nth-child/:nth-of-type selector';
  if (/\.css-(?=[a-z0-9]*\d)[a-z0-9]{5,}\b/.test(s) || /\.sc-(?=[A-Za-z0-9]*[A-Z0-9])[A-Za-z0-9]{5,}/.test(s) ||
      /\.jss\d+/.test(s) || /\.Mui[A-Za-z]+-[A-Za-z]+-\d+/.test(s) || /\.makeStyles-[A-Za-z]+-\d+/.test(s)) {
    return 'a generated class name that changes between builds';
  }
  // Only plain CSS gets the combinator count (not text=/role=/>> chains).
  if (!/^[a-z-]+=/i.test(s) || /^css=/i.test(s)) {
    const css = s.replace(/^css=/i, '');
    if (!css.includes('>>') && countCombinators(css) >= 4) return 'a long CSS chain (4+ combinators) tied to the page structure';
  }
  return undefined;
}

export const noBrittleSelector: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Disallow selectors that encode page structure' },
    messages: {
      brittle:
        'Brittle selector: {{reason}}. It breaks when markup is reorganised; prefer getByRole/getByLabel/getByTestId.',
      positional:
        '`.{{method}}()` on a raw `.locator(...)` picks an element by its position, which changes with the data or layout. Narrow the locator instead (role, label, test id, filter).',
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node: AnyNode) {
        const callee = unwrap(node.callee);
        if (callee?.type !== 'MemberExpression') return;
        const name = propName(callee);
        if (!name) return;

        if (SELECTOR_METHODS.has(name) || (LEGACY.has(name) && isPwReceiver(context, callee.object))) {
          const sel = staticString(node.arguments?.[0]);
          if (sel !== undefined) {
            const reason = brittleReason(sel);
            if (reason) context.report({ node: node as never, messageId: 'brittle', data: { reason } });
          }
        }

        if (name === 'first' || name === 'last' || name === 'nth') {
          const inner = unwrap(callee.object);
          if (inner?.type === 'CallExpression' && inner.callee?.type === 'MemberExpression' && propName(inner.callee) === 'locator') {
            const sel = staticString(inner.arguments?.[0]);
            if (sel === undefined) return;
            if (/data-(testid|test-id|test|cy|qa|pw)|^role=|^text=|^internal:|^id=|^testid=/i.test(sel.trim())) return;
            context.report({ node: node as never, messageId: 'positional', data: { method: name } });
          }
        }
      },
    };
  },
};
