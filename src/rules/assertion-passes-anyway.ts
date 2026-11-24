/**
 * Assertions that pass on almost any page. Three forms, each its own cell:
 *
 *  root-content    `expect(<root>).toBeVisible()` / `.toBeAttached()` / `.not.toBeEmpty()`, where <root> is
 *                  `x.locator('body' | 'html' | ':root')` with no options, directly or through a const. The
 *                  document root is attached, visible and non-empty on nearly every page. Whether `x` is a
 *                  Playwright Page, Frame or frame locator is proven afterwards (src/passes-anyway-forms.ts).
 *  match-anything  the expected value of `toHaveText`, `toContainText`, `toHaveURL` or `toHaveTitle` is a
 *                  regular expression every string satisfies (source `.*`, `^.*$` or `[\s\S]*`), or `''` is given to
 *                  `toContainText`, or to `toContain` on a string.
 *  empty-fallback  the expected value of `toContainText`, of `toContain` on a string, or of
 *                  `toMatch(new RegExp(...))` is `X || ''` or `X ?? ''`: when X is null the check
 *                  contains the empty string, which every string does.
 *
 * Negated matchers, `expect.poll`, `.resolves` and `.rejects` are left alone, and so are `toBeVisible` and
 * `toBeAttached` with an option other than `timeout`. Where the `expect` comes from is decided by the expect
 * binding (src/expect-binding.ts), not here.
 */
import type { Rule } from 'eslint';
import { memberName, parseMatcherCall, resolveConstInit, unwrap, type N } from './ast-util.js';

export type PassesAnywayForm = 'root-content' | 'match-anything' | 'empty-fallback';

export interface PassesAnyway {
  form: PassesAnywayForm;
  /** root-content only: the expression the root locator is called on. */
  receiver?: N;
}

/** The part of a rule context the const resolver reads; a parsed scope file has the same. */
type Ctx = Rule.RuleContext;
/** Node fields the shared node type does not list (template parts, object properties, the regex of a literal). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = { type: string; [k: string]: any };

const MESSAGE_FORMS: Readonly<Record<string, PassesAnywayForm>> = {
  rootContent: 'root-content',
  matchAnything: 'match-anything',
  emptyFallback: 'empty-fallback',
};
const MESSAGE_OF = Object.fromEntries(Object.entries(MESSAGE_FORMS).map(([id, form]) => [form, id])) as Record<PassesAnywayForm, string>;

/** Form of a finding of this rule, from the message id it was reported with. */
export const passesAnywayForm = (messageId: string | undefined): PassesAnywayForm | undefined => (messageId ? MESSAGE_FORMS[messageId] : undefined);

const ROOTS = new Set(['body', 'html', ':root']);
const ROOT_MATCHERS = new Set(['toBeVisible', 'toBeAttached']);
const TEXT_MATCHERS = new Set(['toHaveText', 'toContainText', 'toHaveURL', 'toHaveTitle']);
/** Sources of patterns that every string satisfies. */
const MATCH_ALL = new Set(['.*', '^.*$', '[\\s\\S]*']);
/** Calls that give a string (or null), and string methods that keep it one. */
const STRING_CALLS = new Set([
  'textContent', 'innerText', 'innerHTML', 'inputValue', 'getAttribute', 'title', 'url', 'content', 'text',
  'trim', 'trimStart', 'trimEnd', 'toLowerCase', 'toUpperCase', 'toString', 'replace', 'replaceAll', 'slice', 'substring', 'normalize', 'join',
]);

/** Type-only wrappers, parentheses and `await` removed. */
function bare(node: N | null | undefined): N | undefined {
  let n = unwrap(node);
  while (n && (n.type === 'TSSatisfiesExpression' || n.type === 'TSTypeAssertion')) n = unwrap(n.expression);
  return n;
}

/** The value of a string literal or of a template with no expressions. */
function staticText(n: N | undefined): string | undefined {
  const node = n as Loose | undefined;
  if (node?.type === 'Literal') return typeof node.value === 'string' ? node.value : undefined;
  if (node?.type === 'TemplateLiteral' && (node.expressions ?? []).length === 0) return (node.quasis?.[0]?.value?.cooked as string | undefined) ?? undefined;
  return undefined;
}

/** `x.locator('body')` with no options, directly or through a const: gives `x`. */
function rootReceiver(context: Ctx, node: N | undefined, depth = 0): N | undefined {
  const n = bare(node);
  if (!n || depth > 2) return undefined;
  if (n.type === 'Identifier') {
    const init = resolveConstInit(context, n);
    return init ? rootReceiver(context, init, depth + 1) : undefined;
  }
  if (n.type !== 'CallExpression' || memberName(n.callee) !== 'locator' || (n.arguments ?? []).length !== 1) return undefined;
  const selector = staticText(bare(n.arguments![0]));
  return selector !== undefined && ROOTS.has(selector.trim().toLowerCase()) ? (n.callee!.object ?? undefined) : undefined;
}

/** No argument, or an options object that only sets `timeout`. */
function onlyTimeout(args: N[]): boolean {
  if (args.length === 0) return true;
  const o = bare(args[0]) as Loose | undefined;
  return args.length === 1 && o?.type === 'ObjectExpression' &&
    (o.properties ?? []).every((p: Loose) => p.type === 'Property' && !p.computed && (p.key?.name ?? p.key?.value) === 'timeout');
}

/** Is the subject evidently a string: a text read, a string method on one, a literal, or a const from one? */
function isStringSubject(context: Ctx, node: N | undefined, depth = 0): boolean {
  const n = bare(node);
  if (!n || depth > 3) return false;
  if (staticText(n) !== undefined || n.type === 'TemplateLiteral') return true;
  if (n.type === 'Identifier') {
    const init = resolveConstInit(context, n);
    return init ? isStringSubject(context, init, depth + 1) : false;
  }
  if (n.type === 'LogicalExpression') return isStringSubject(context, n.left, depth + 1) || isStringSubject(context, n.right, depth + 1);
  if (n.type !== 'CallExpression') return false;
  if (n.callee?.type === 'Identifier') return n.callee.name === 'String';
  const name = memberName(n.callee);
  return name !== undefined && STRING_CALLS.has(name);
}

/** `X || ''` or `X ?? ''`, where X is not itself a literal. */
function isEmptyFallback(node: N | undefined): boolean {
  const n = bare(node);
  if (n?.type !== 'LogicalExpression' || (n.operator !== '||' && n.operator !== '??')) return false;
  const left = bare(n.left);
  return staticText(bare(n.right)) === '' && !!left && left.type !== 'Literal' && staticText(left) === undefined;
}

/** What `call` is, if it is one of the three shapes. Works on a rule context and on a parsed scope file alike. */
export function classifyPassesAnyway(context: Ctx, call: N): PassesAnyway | undefined {
  const m = parseMatcherCall(call);
  if (!m || m.modifiers.some((x) => x !== 'not')) return undefined;
  const expectCallee = m.expectCall.callee;
  if (expectCallee?.type === 'MemberExpression' && expectCallee.property?.name === 'poll') return undefined;
  const negated = m.modifiers.length % 2 === 1;
  const subject = (m.expectCall.arguments ?? [])[0];
  const args = call.arguments ?? [];

  if ((!negated && ROOT_MATCHERS.has(m.matcher) && onlyTimeout(args)) || (negated && m.modifiers.length === 1 && m.matcher === 'toBeEmpty')) {
    const receiver = rootReceiver(context, subject);
    return receiver ? { form: 'root-content', receiver } : undefined;
  }
  if (negated || args.length === 0) return undefined;
  const expected = bare(args[0]);
  const regex = (expected as Loose | undefined)?.regex as { pattern?: unknown } | undefined;
  const containment = m.matcher === 'toContainText' || (m.matcher === 'toContain' && isStringSubject(context, subject));

  if (TEXT_MATCHERS.has(m.matcher) && expected?.type === 'Literal' && regex && MATCH_ALL.has(String(regex.pattern))) return { form: 'match-anything' };
  if (containment && staticText(expected) === '') return { form: 'match-anything' };
  if (containment && isEmptyFallback(expected)) return { form: 'empty-fallback' };
  if (m.matcher === 'toMatch' && expected?.type === 'NewExpression' && expected.callee?.type === 'Identifier' && expected.callee.name === 'RegExp' &&
      isEmptyFallback((expected.arguments ?? [])[0])) {
    return { form: 'empty-fallback' };
  }
  return undefined;
}

export const assertionPassesAnyway: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow assertions that pass on almost any page' },
    messages: {
      rootContent: 'The document root is attached, visible and non-empty on almost any page, so this assertion passes whatever the page shows. Assert on an element the test is about.',
      matchAnything: 'Every string satisfies this expected value, so the assertion passes whatever the page shows. Assert the text, URL or title you expect.',
      emptyFallback: 'When the value on the left is missing, this check contains the empty string, which every string does. Assert that the value is present first, or compare against a fixed expected text.',
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(raw) {
        const found = classifyPassesAnyway(context, raw as unknown as N);
        if (found) context.report({ node: raw, messageId: MESSAGE_OF[found.form] });
      },
    };
  },
};
