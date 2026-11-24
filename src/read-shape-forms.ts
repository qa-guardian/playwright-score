import { isFunction } from './eslint-postfilter.js';
import type { N, Tree } from './eslint-postfilter.js';
import { memberName } from './rules/ast-util.js';
import { MAX_ALIAS_DEPTH, isExpectSubjectCall, isReference, matcherCallOf, resolve, unwrap } from './read-ast.js';
import type { Binding } from './read-ast.js';

// QAG-287 B3 (C7): two shapes of `playwright/prefer-web-first-assertions` that are not the plain one-shot read.
//   read-handle   the read's receiver is an ElementHandle (from `$`, `$$` or `elementHandle()`); the defect
//                 is the handle, which `no-element-handle` reports
//   read-compare  the expected argument is itself derived from an earlier read of page state in the same
//                 test; a web-first matcher re-reads only the subject against a fixed expected value
// Both only re-form a finding the rule already reports. read-forms.ts asks here after its own forms.

export type ReadShapeForm = 'read-handle' | 'read-compare';

/** Switch for the unit test that compares findings with these two forms on and off. */
export const readShapeForms = { enabled: true };

/** Calls that return an ElementHandle, or an array of them. */
const HANDLE_FACTORIES = new Set(['$', 'elementHandle']);
const HANDLE_LIST_FACTORIES = new Set(['$$']);

/** Playwright methods that read the state of the page once. */
const PAGE_STATE_READS = new Set([
  'textContent', 'innerText', 'innerHTML', 'inputValue', 'getAttribute', 'allTextContents', 'allInnerTexts',
  'isVisible', 'isHidden', 'isChecked', 'isEnabled', 'isDisabled', 'isEditable',
  'count', 'title', 'url', 'content', 'boundingBox', 'evaluate', 'evaluateAll', '$eval', '$$eval',
]);

const start = (n: N): number => (n.range as [number, number])[0];

/** The call `n` is once awaits and wrappers are removed, when it is a method call named in `names`. */
function methodCallIn(n: N | undefined, names: Set<string>): boolean {
  const u = unwrap(n);
  return u?.type === 'CallExpression' && u.callee?.type === 'MemberExpression' && names.has(memberName(u.callee) ?? '');
}

/** `for (const row of await page.$$('tr'))`: the iterated expression of the loop that binds `b`. */
function loopSource(t: Tree, b: Binding): N | undefined {
  const loop = b.decl.type === 'VariableDeclaration' ? t.parent(b.decl) : undefined;
  return loop?.type === 'ForOfStatement' && loop.left === b.decl ? (loop.right as N) : undefined;
}

/** Is `n` a list of ElementHandles: a `$$` call, or a variable bound to one? */
function isHandleList(t: Tree, n: N | undefined, depth: number): boolean {
  const u = unwrap(n);
  if (!u || depth >= MAX_ALIAS_DEPTH) return false;
  if (u.type !== 'Identifier') return methodCallIn(u, HANDLE_LIST_FACTORIES);
  const b = resolve(t, u, u.name);
  return !!b && b.hasInit && isHandleList(t, b.decl.init as N, depth + 1);
}

/** Is `n` an ElementHandle: a `$` call, an item of a `$$` list, or a variable bound to either? */
function isHandle(t: Tree, n: N | undefined, depth = 0): boolean {
  const u = unwrap(n);
  if (!u || depth >= MAX_ALIAS_DEPTH) return false;
  if (u.type === 'MemberExpression' && u.computed) return isHandleList(t, u.object as N, depth);
  if (u.type !== 'Identifier') return methodCallIn(u, HANDLE_FACTORIES);
  const b = resolve(t, u, u.name);
  if (!b) return false;
  if (b.hasInit) return isHandle(t, b.decl.init as N, depth + 1);
  return isHandleList(t, loopSource(t, b), depth + 1);
}

/** The expects whose subject is the reported read, and the read itself. Upstream reports the expect, or the read inside the declaration it followed. */
function reportedRead(t: Tree, node: N): { read: N | undefined; expects: N[] } {
  for (let c: N | undefined = node; c; c = t.parent(c)) {
    if (isExpectSubjectCall(c)) {
      const subject = unwrap(c.arguments?.[0] as N | undefined);
      if (subject?.type !== 'Identifier') return { read: subject, expects: [c] };
      const b = resolve(t, c, subject.name);
      return { read: b?.hasInit ? unwrap(b.decl.init as N) : undefined, expects: [c] };
    }
    if (c.type === 'VariableDeclarator' && c.id?.type === 'Identifier' && c.init) {
      const decl = c;
      const name = c.id.name as string;
      const expects: N[] = [];
      t.some(t.enclosingFunction(c) ?? t.root, (n) => {
        if (!isExpectSubjectCall(n)) return false;
        const subject = unwrap(n.arguments?.[0] as N | undefined);
        if (subject?.type === 'Identifier' && subject.name === name && resolve(t, n, name)?.decl === decl) expects.push(n);
        return false;
      });
      return { read: unwrap(c.init as N), expects };
    }
    if (isFunction(c)) break;
  }
  return { read: undefined, expects: [] };
}

/** Does the expression hold a one-shot read of the page? A function that would read the page when called is not a value read from it. */
function holdsPageRead(t: Tree, expr: N): boolean {
  const walk = (n: N): boolean => {
    if (isFunction(n)) return false;
    if (n.type === 'CallExpression' && n.callee?.type === 'MemberExpression' && PAGE_STATE_READS.has(memberName(n.callee) ?? '')) return true;
    return t.children(n).some(walk);
  };
  return walk(expr);
}

/** Is `fn` the function `n` sits in, or one around it? The read and the assertion must be in the same test. */
function inFunctionOf(t: Tree, n: N, fn: N | undefined): boolean {
  for (let f = t.enclosingFunction(n); f; f = t.enclosingFunction(f)) if (f === fn) return true;
  return false;
}

/** Values assigned to the variable of `b` before `before`, inside a function around it: its initialiser and later `x = <value>` writes. */
function valuesBefore(t: Tree, b: Binding, name: string, before: N): N[] {
  const out: N[] = [];
  const usable = (at: N): boolean => start(at) < start(before) && inFunctionOf(t, before, t.enclosingFunction(at));
  if (b.hasInit && usable(b.decl)) out.push(b.decl.init as N);
  if (b.decl.type !== 'VariableDeclarator' || b.isConst) return out;
  let scope: N | undefined = t.parent(b.decl);
  while (scope && scope.type === 'VariableDeclaration') scope = t.parent(scope);
  t.some(scope ?? t.root, (n) => {
    if (n.type !== 'AssignmentExpression' || n.left?.type !== 'Identifier' || n.left.name !== name) return false;
    if (usable(n) && resolve(t, n, name)?.decl === b.decl) out.push(n.right as N);
    return false;
  });
  return out;
}

/** Is the value of `expr`, used at `at`, derived from an earlier one-shot read of the page? */
function derivedFromRead(t: Tree, expr: N, at: N, depth = 0): boolean {
  if (holdsPageRead(t, expr)) return true;
  if (depth >= MAX_ALIAS_DEPTH) return false;
  return t.some(expr, (n) => {
    if (n.type !== 'Identifier' || !isReference(t, n)) return false;
    const b = resolve(t, n, n.name);
    return !!b && valuesBefore(t, b, n.name, at).some((v) => derivedFromRead(t, v, at, depth + 1));
  });
}

/** An argument of the matcher on `expectCall` comes from an earlier read of the page. */
function comparesWithRead(t: Tree, expectCall: N): boolean {
  const matcher = matcherCallOf(t, expectCall);
  return !!matcher && ((matcher.arguments ?? []) as N[]).some((a) => derivedFromRead(t, a, expectCall));
}

/** The form of the read reported at `node` when it is one of the two shapes; read-handle wins over read-compare. */
export function readShapeForm(t: Tree, node: N): ReadShapeForm | undefined {
  if (!readShapeForms.enabled) return undefined;
  const { read, expects } = reportedRead(t, node);
  if (read?.type === 'CallExpression' && read.callee?.type === 'MemberExpression' && isHandle(t, read.callee.object as N)) return 'read-handle';
  return expects.some((e) => comparesWithRead(t, e)) ? 'read-compare' : undefined;
}
