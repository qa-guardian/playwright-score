/**
 * `test.fixme(...)` is the "known broken, do not run" marker. Same split as
 * pwscore/no-skipped-test-declaration:
 *
 *  - FLAGGED: declaration `test.fixme('t', fn)` / `test.describe.fixme(...)`
 *    (last argument is a function, 2+ arguments), and the unconditional
 *    in-body forms `test.fixme()` (no arguments) and `test.fixme(true, ...)`.
 *  - CLEAN: conditional `test.fixme(browserName === 'webkit', 'why')`
 *    (any first argument that is not the literal `true`).
 *
 * Four messages (QAG-287 slice E2), so the text always matches the code:
 *  - `declaration` / `unconditional`: nothing says why it is off. Warning.
 *  - `reasoned`: the call carries a reason (`test.fixme(true, 'why')`), or a
 *    tracker reference / re-enable condition sits right next to it. Still
 *    switched off, so still listed, but info: someone already wrote it down.
 *  - `placeholder`: `test.fixme('title', () => {})` with an empty body is a
 *    to-do entry for a test nobody wrote yet, not a broken test. Info.
 * Severity per message is set in eslint-runner (MESSAGE_SEVERITY).
 *
 * `test` includes `test.extend()` aliases (testAliasNames option).
 */
import type { Rule } from 'eslint';
import { FN_TYPES, memberName, type N } from './ast-util.js';

function isFixmeCallee(callee: N | undefined, names: ReadonlySet<string>): boolean {
  if (memberName(callee) !== 'fixme') return false;
  const obj = callee?.object;
  if (obj?.type === 'Identifier' && obj.name && names.has(obj.name)) return true;
  return (
    obj?.type === 'MemberExpression' &&
    !obj.computed &&
    obj.property?.name === 'describe' &&
    obj.object?.type === 'Identifier' &&
    !!obj.object.name &&
    names.has(obj.object.name)
  );
}

const TRACKER_REF = /\b[A-Z][A-Z0-9]+-\d+\b|\/(?:issues|pull|-\/issues)\/\d+|(?:^|[\s(])#\d{2,}\b/;
const REENABLE_HINT = /\b(?:re-?enable|un-?skip|remove this|once (?:the|it|that|this|\w+ (?:is|are|has|have))|until|when (?:the|it|that|this|\w+) (?:is|are|has|have) (?:fixed|merged|supported|implemented))\b/i;

/** An explanation sitting right next to the call: a comment directly above it with a tracker reference or a re-enable condition, or an annotation set earlier in the same body. */
function hasNearbyReason(context: Rule.RuleContext, call: N): boolean {
  const sc = context.sourceCode;
  const stmt = (call as unknown as { parent?: N }).parent;
  const target = (stmt?.type === 'ExpressionStatement' ? stmt : call) as unknown as Parameters<typeof sc.getCommentsBefore>[0];
  const comments = sc.getCommentsBefore(target);
  const text = comments.map((c) => c.value).join('\n');
  if (text && (TRACKER_REF.test(text) || REENABLE_HINT.test(text))) return true;
  const block = stmt?.type === 'ExpressionStatement' ? (stmt as unknown as { parent?: { type: string; body?: N[] } }).parent : undefined;
  if (block?.type === 'BlockStatement') {
    for (const sib of block.body ?? []) {
      if (sib === stmt) break;
      if (/\bannotations\b/.test(sc.getText(sib as never))) return true;
    }
  }
  return false;
}

function isEmptyBody(fn: N): boolean {
  const body = (fn as unknown as { body?: N }).body;
  return body?.type === 'BlockStatement' && (body as unknown as { body?: unknown[] }).body?.length === 0;
}

export const noFixmeTest: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Disallow unconditional test.fixme(): a test marked broken never runs' },
    messages: {
      declaration:
        'This test is switched off with test.fixme() and nothing says why, so it never runs. Fix it, delete it, or write down the reason and what has to change before it comes back.',
      unconditional:
        'test.fixme() with no condition and no reason: everything it covers never runs. Fix it, delete it, or pass a reason, test.fixme(true, reason).',
      reasoned:
        'This test is switched off with test.fixme() and a reason is given, but it still never runs, so the behaviour it covers is untested. Keep track of when it comes back.',
      placeholder:
        'Empty test.fixme() placeholder: there is no test body, so nothing is checked. Write the test or remove the line so it does not look like coverage.',
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
    const names = new Set<string>(['test', ...aliases]);
    return {
      CallExpression(raw) {
        const node = raw as unknown as N;
        if (!isFixmeCallee(node.callee, names)) return;
        const args = node.arguments ?? [];
        const last = args[args.length - 1];
        if (args.length >= 2 && last && FN_TYPES.has(last.type)) {
          const id = isEmptyBody(last)
            ? 'placeholder'
            : hasNearbyReason(context, node)
              ? 'reasoned'
              : 'declaration';
          context.report({ node: raw, messageId: id });
          return;
        }
        if (node.callee?.object?.type !== 'Identifier') return; // describe.fixme() in-body form is not a thing
        if (args.length === 0 || (args[0].type === 'Literal' && args[0].value === true)) {
          const reason = args[1];
          const hasReason =
            (reason?.type === 'Literal' && typeof reason.value === 'string' && reason.value.trim() !== '') ||
            reason?.type === 'TemplateLiteral';
          context.report({
            node: raw,
            messageId: hasReason || hasNearbyReason(context, node) ? 'reasoned' : 'unconditional',
          });
        }
      },
    };
  },
};
