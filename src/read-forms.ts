import { isFunction, insideRetryingBlock } from './eslint-postfilter.js';
import type { N, Tree } from './eslint-postfilter.js';

// QAG-287 B1 (S3b, S7c): forms of `playwright/prefer-web-first-assertions`.
//
// A finding of this rule is an `expect(<read>)` whose subject is a value read from the
// page once. Three forms, first match wins (ADR section 5, precedence within C7):
//   read-reused    the subject is a variable bound to a read that is used again (S3b)
//   read-url-count the read is `page.url()` or a locator `.count()` (S7c)
//   read-direct    any other read the upstream rule reports
// Upstream reports the first two shapes' siblings only (isVisible, textContent...), so
// the url/count reads are found here and reported as new findings.

export type ReadForm = 'read-direct' | 'read-reused' | 'read-url-count';

export interface ReadFinding {
  /** 1-based, as ESLint reports it. */
  line: number;
  column: number;
  form: ReadForm;
}

const PAGE_NAME = /^(page|frame)$|(Page|Frame)$/;
const LOCATOR_FACTORIES = new Set([
  'locator', 'getByRole', 'getByText', 'getByLabel', 'getByPlaceholder', 'getByAltText', 'getByTitle', 'getByTestId', 'frameLocator',
]);
const LOCATOR_NARROWERS = new Set(['filter', 'nth', 'first', 'last', 'and', 'or', 'locator', 'getByRole', 'getByText', 'getByLabel', 'getByPlaceholder', 'getByAltText', 'getByTitle', 'getByTestId']);
const MAX_ALIAS_DEPTH = 3;

const unwrap = (n: N | undefined): N | undefined => {
  let cur = n;
  while (cur && (cur.type === 'TSNonNullExpression' || cur.type === 'ChainExpression' || cur.type === 'TSAsExpression' || cur.type === 'ParenthesizedExpression')) {
    cur = (cur.expression ?? cur.argument) as N | undefined;
  }
  return cur;
};
const unwrapAwait = (n: N | undefined): N | undefined => {
  const u = unwrap(n);
  return u?.type === 'AwaitExpression' ? unwrap(u.argument as N) : u;
};
const propName = (m: N): string | undefined => (m.computed ? undefined : (m.property?.name as string | undefined));

/** The `expect(...)` call that starts at the reported position, or the one that encloses it. */
function expectCallAt(t: Tree, node: N): N | undefined {
  for (let c: N | undefined = node; c; c = t.parent(c)) {
    if (c.type === 'CallExpression' && c.callee?.type === 'Identifier' && c.callee.name === 'expect') return c;
    if (isFunction(c)) return undefined;
  }
  return undefined;
}

/** The nearest declaration of `name` visible from `from`: its declarator and the node that scopes it. */
function declarationOf(t: Tree, from: N, name: string): { decl: N; scope: N } | undefined {
  for (let scope: N | undefined = t.parent(from); scope; scope = t.parent(scope)) {
    if (!isFunction(scope) && scope.type !== 'Program' && scope.type !== 'BlockStatement' && scope.type !== 'StaticBlock') continue;
    let found: N | undefined;
    const walk = (n: N): boolean => {
      if (n !== scope && isFunction(n)) return false;
      if (n.type === 'VariableDeclarator' && n.id?.type === 'Identifier' && n.id.name === name) {
        found = n;
        return true;
      }
      for (const k of t.children(n)) if (walk(k)) return true;
      return false;
    };
    for (const k of t.children(scope)) if (walk(k)) break;
    if (found) return { decl: found, scope };
  }
  return undefined;
}

/** Is `id` a use of the variable, rather than a property name, a key or the declaration itself? */
function isReference(t: Tree, id: N): boolean {
  const p = t.parent(id);
  if (!p) return true;
  if (p.type === 'MemberExpression' && p.property === id && !p.computed) return false;
  if ((p.type === 'Property' || p.type === 'PropertyDefinition') && p.key === id && !p.computed && !p.shorthand) return false;
  if (p.type === 'VariableDeclarator' && p.id === id) return false;
  return true;
}

/** A variable bound to a read whose name is used again beyond the subject of this expect. */
function reusedVariable(t: Tree, expectCall: N): boolean {
  const subject = unwrapAwait(expectCall.arguments?.[0] as N | undefined);
  if (subject?.type !== 'Identifier') return false;
  const d = declarationOf(t, expectCall, subject.name);
  if (!d || !d.decl.init) return false;
  let others = 0;
  t.some(d.scope, (n) => {
    if (n.type === 'Identifier' && n.name === subject.name && n !== subject && isReference(t, n)) others++;
    return false;
  });
  return others > 0;
}

/** Is `n` the Page (or Frame) a test works with: a `page` name, `this.page`, or a const bound to one? */
function isPageLike(t: Tree, n: N | undefined, depth = 0): boolean {
  const u = unwrap(n);
  if (!u) return false;
  if (u.type === 'Identifier') {
    if (PAGE_NAME.test(u.name)) return true;
    return aliasOf(t, u, depth, (init) => isPageLike(t, init, depth + 1));
  }
  if (u.type === 'MemberExpression') return PAGE_NAME.test(propName(u) ?? '');
  return false;
}

/** Is `n` a Locator built from a page: a factory call on a page, narrowed by locator methods, or a const bound to one? */
function isLocatorLike(t: Tree, n: N | undefined, depth = 0): boolean {
  const u = unwrap(n);
  if (!u) return false;
  if (u.type === 'Identifier') return aliasOf(t, u, depth, (init) => isLocatorLike(t, init, depth + 1));
  if (u.type !== 'CallExpression' || u.callee?.type !== 'MemberExpression') return false;
  const name = propName(u.callee);
  if (!name) return false;
  const obj = u.callee.object as N;
  if (LOCATOR_FACTORIES.has(name) && isPageLike(t, obj, depth)) return true;
  return LOCATOR_NARROWERS.has(name) && isLocatorLike(t, obj, depth);
}

/** An identifier bound once with const to something `accept` recognises. */
function aliasOf(t: Tree, id: N, depth: number, accept: (init: N) => boolean): boolean {
  if (depth >= MAX_ALIAS_DEPTH) return false;
  const d = declarationOf(t, id, id.name);
  const decl = d?.decl;
  const kind = decl ? t.parent(decl)?.kind : undefined;
  if (!decl || kind !== 'const' || !decl.init) return false;
  return accept(unwrapAwait(decl.init as N) as N);
}

/** `page.url()` or `<locator>.count()`. */
function isUrlOrCountRead(t: Tree, n: N | undefined): boolean {
  const u = unwrapAwait(n);
  if (!u || u.type !== 'CallExpression' || u.callee?.type !== 'MemberExpression' || (u.arguments as N[]).length > 0) return false;
  const name = propName(u.callee);
  const obj = u.callee.object as N;
  if (name === 'url') return isPageLike(t, obj);
  if (name === 'count') return isLocatorLike(t, obj);
  return false;
}

/** The subject of the expect is a url/count read, directly or through a const bound to one. */
function subjectIsUrlOrCount(t: Tree, expectCall: N): boolean {
  const subject = unwrapAwait(expectCall.arguments?.[0] as N | undefined);
  if (!subject) return false;
  if (subject.type === 'Identifier') {
    const d = declarationOf(t, expectCall, subject.name);
    return !!d?.decl.init && isUrlOrCountRead(t, d.decl.init as N);
  }
  return isUrlOrCountRead(t, subject);
}

/** Does the expect call carry a matcher (`expect(x).toBe(1)`), and is it not a soft or polled form? */
function hasMatcher(t: Tree, expectCall: N): boolean {
  let cur: N = expectCall;
  for (;;) {
    const p = t.parent(cur);
    if (p?.type === 'MemberExpression' && p.object === cur) cur = p;
    else if (p?.type === 'CallExpression' && p.callee === cur) return /^to[A-Z]/.test(propName(cur) ?? '') ;
    else return false;
  }
}

/** Form of an upstream finding reported at (line, column): read-reused when the subject is a reused read, else read-direct. */
export function formOfReportedRead(t: Tree, node: N): ReadForm {
  const call = expectCallAt(t, node);
  return call && reusedVariable(t, call) ? 'read-reused' : 'read-direct';
}

/** The url/count reads upstream does not report: every `expect(<read>).toX()` outside a retrying block. */
export function urlCountReads(t: Tree): ReadFinding[] {
  const out: ReadFinding[] = [];
  t.some(t.root, (n) => {
    if (n.type !== 'CallExpression' || n.callee?.type !== 'Identifier' || n.callee.name !== 'expect') return false;
    if (!hasMatcher(t, n) || insideRetryingBlock(t, n) || !subjectIsUrlOrCount(t, n)) return false;
    const start = (n.loc as { start: { line: number; column: number } }).start;
    out.push({ line: start.line, column: start.column + 1, form: reusedVariable(t, n) ? 'read-reused' : 'read-url-count' });
    return false;
  });
  return out;
}
