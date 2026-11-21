import { isFunction, insideRetryingBlock, patternNames, PAGE_OR_FRAME_NAME } from './eslint-postfilter.js';
import type { N, Tree } from './eslint-postfilter.js';
import { unwrap as unwrapNode, memberName, parseMatcherCall } from './rules/ast-util.js';

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

const LOCATOR_FACTORIES = new Set([
  'locator', 'getByRole', 'getByText', 'getByLabel', 'getByPlaceholder', 'getByAltText', 'getByTitle', 'getByTestId', 'frameLocator',
]);
const LOCATOR_NARROWERS = new Set(['filter', 'nth', 'first', 'last', 'and', 'or', 'locator', 'getByRole', 'getByText', 'getByLabel', 'getByPlaceholder', 'getByAltText', 'getByTitle', 'getByTestId']);
const MAX_ALIAS_DEPTH = 3;

/** The shared unwrap (await, non-null, optional chain, `as`, parentheses), typed for this module's nodes. */
const unwrap = (n: N | undefined): N | undefined => unwrapNode(n) as N | undefined;

/** `expect(<subject>)` or `expect.soft(<subject>)`: a call whose first argument is the value under test (`expect.poll` takes a function, so it is not one). */
function isExpectSubjectCall(n: N | undefined): boolean {
  if (n?.type !== 'CallExpression') return false;
  const c = n.callee as N | undefined;
  if (c?.type === 'Identifier') return c.name === 'expect';
  return c?.type === 'MemberExpression' && c.object?.type === 'Identifier' && c.object.name === 'expect' && memberName(c) === 'soft';
}

interface Binding {
  /** The declarator when the name is bound with an initialiser (`const x = <init>`); otherwise the binding node (parameter, loop or catch binding, destructuring). */
  decl: N;
  hasInit: boolean;
  isConst: boolean;
}

function bindingInDeclaration(d: N, name: string): Binding | undefined {
  for (const v of (d.declarations ?? []) as N[]) {
    if (!patternNames(v.id as N).includes(name)) continue;
    const simple = v.id?.type === 'Identifier' && !!v.init;
    return { decl: v, hasInit: simple, isConst: d.kind === 'const' };
  }
  return undefined;
}

/** `var` declarations belong to the whole function, so look through its nested blocks (not nested functions). */
function varInFunction(t: Tree, fn: N, name: string): Binding | undefined {
  let found: Binding | undefined;
  const walk = (n: N): boolean => {
    if (n !== fn && isFunction(n)) return false;
    if (n.type === 'VariableDeclaration' && n.kind === 'var') {
      found = bindingInDeclaration(n, name);
      if (found) return true;
    }
    for (const k of t.children(n)) if (walk(k)) return true;
    return false;
  };
  walk(fn);
  return found;
}

/** What `scope` itself binds under `name`, without looking into nested scopes. */
function bindingOf(t: Tree, scope: N, name: string): Binding | undefined {
  const own = (n: N | undefined): Binding | undefined =>
    n?.type === 'VariableDeclaration' ? bindingInDeclaration(n, name) : undefined;
  const asBinding = (n: N): Binding => ({ decl: n, hasInit: false, isConst: false });
  if (isFunction(scope)) {
    if (((scope.params ?? []) as N[]).some((q) => patternNames(q).includes(name))) return asBinding(scope);
    return varInFunction(t, scope, name);
  }
  switch (scope.type) {
    case 'Program':
    case 'BlockStatement':
    case 'StaticBlock':
      for (const st of (scope.body ?? []) as N[]) {
        const b = own(st) ?? (st.type === 'FunctionDeclaration' && st.id?.name === name ? asBinding(st) : undefined);
        if (b && !(st.type === 'VariableDeclaration' && st.kind === 'var')) return b;
      }
      return scope.type === 'Program' ? varInFunction(t, scope, name) : undefined;
    case 'ForStatement':
      return own(scope.init as N);
    case 'ForInStatement':
    case 'ForOfStatement':
      return scope.left?.type === 'VariableDeclaration' ? (patternNames(scope.left.declarations?.[0]?.id as N).includes(name) ? asBinding(scope.left as N) : undefined) : undefined;
    case 'CatchClause':
      return patternNames(scope.param as N).includes(name) ? asBinding(scope) : undefined;
    case 'SwitchStatement':
      for (const c of (scope.cases ?? []) as N[]) for (const st of (c.consequent ?? []) as N[]) {
        const b = own(st);
        if (b) return b;
      }
      return undefined;
    default:
      return undefined;
  }
}

/** The binding of `name` that `from` sees: the nearest enclosing scope that declares it. */
function resolve(t: Tree, from: N, name: string): Binding | undefined {
  for (let scope: N | undefined = t.parent(from); scope; scope = t.parent(scope)) {
    const b = bindingOf(t, scope, name);
    if (b) return b;
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

/** Uses of the variable declared by `b` that resolve to it (an inner binding of the same name is not one). */
function referenceCount(t: Tree, b: Binding, name: string): number {
  let scope: N | undefined = t.parent(b.decl);
  while (scope && scope.type === 'VariableDeclaration') scope = t.parent(scope);
  let count = 0;
  t.some(scope ?? t.root, (n) => {
    if (n.type === 'Identifier' && n.name === name && isReference(t, n) && resolve(t, n, name)?.decl === b.decl) count++;
    return false;
  });
  return count;
}

/** Is the variable `name`, as seen from `from`, bound to a read and used more than once? */
function reusedName(t: Tree, from: N, name: string): boolean {
  const b = resolve(t, from, name);
  return !!b && b.hasInit && referenceCount(t, b, name) >= 2;
}

/** A variable bound to a read whose name is used again beyond the subject of this expect. */
function reusedVariable(t: Tree, expectCall: N): boolean {
  const subject = unwrap(expectCall.arguments?.[0] as N | undefined);
  return subject?.type === 'Identifier' && reusedName(t, expectCall, subject.name);
}

/**
 * Is the read reported at `node` reused? Upstream reports either the `expect(<read>)` or, for reads it
 * follows into a declaration (`const names = await list.allTextContents()`), the read inside the
 * declarator. In the second case the declared variable is what is asked about.
 */
function reportedReadReused(t: Tree, node: N): boolean {
  for (let c: N | undefined = node; c; c = t.parent(c)) {
    if (isExpectSubjectCall(c)) return reusedVariable(t, c);
    if (c.type === 'VariableDeclarator' && c.id?.type === 'Identifier' && c.init) return reusedName(t, c.id as N, c.id.name as string);
    if (isFunction(c)) return false;
  }
  return false;
}

/** Is `n` the Page (or Frame) a test works with: a `page` name, `this.page`, or a const bound to one? */
function isPageLike(t: Tree, n: N | undefined, depth = 0): boolean {
  const u = unwrap(n);
  if (!u) return false;
  if (u.type === 'Identifier') {
    if (PAGE_OR_FRAME_NAME.test(u.name)) return !boundToNew(t, u);
    return aliasOf(t, u, depth, (init) => isPageLike(t, init, depth + 1));
  }
  if (u.type === 'MemberExpression') return PAGE_OR_FRAME_NAME.test(memberName(u) ?? '');
  return false;
}

/** `const checkoutPage = new CheckoutPage(page)`: a page object named like a Page, whose `url()` is its own method. */
function boundToNew(t: Tree, id: N): boolean {
  const b = resolve(t, id, id.name);
  return !!b && b.hasInit && (b.decl.init as N).type === 'NewExpression';
}

/** Is `n` a Locator built from a page: a factory call on a page, narrowed by locator methods, or a const bound to one? */
function isLocatorLike(t: Tree, n: N | undefined, depth = 0): boolean {
  const u = unwrap(n);
  if (!u) return false;
  if (u.type === 'Identifier') return aliasOf(t, u, depth, (init) => isLocatorLike(t, init, depth + 1));
  if (u.type !== 'CallExpression' || u.callee?.type !== 'MemberExpression') return false;
  const name = memberName(u.callee);
  if (!name) return false;
  const obj = u.callee.object as N;
  if (LOCATOR_FACTORIES.has(name) && isPageLike(t, obj, depth)) return true;
  return LOCATOR_NARROWERS.has(name) && isLocatorLike(t, obj, depth);
}

/** An identifier bound once with const to something `accept` recognises. */
function aliasOf(t: Tree, id: N, depth: number, accept: (init: N) => boolean): boolean {
  if (depth >= MAX_ALIAS_DEPTH) return false;
  const b = resolve(t, id, id.name);
  if (!b || !b.isConst || !b.hasInit) return false;
  return accept(unwrap(b.decl.init as N) as N);
}

/** `page.url()` is a url read, `<locator>.count()` a count read. */
function readKind(t: Tree, n: N | undefined): 'url' | 'count' | undefined {
  const u = unwrap(n);
  if (!u || u.type !== 'CallExpression' || u.callee?.type !== 'MemberExpression' || (u.arguments as N[]).length > 0) return undefined;
  const name = memberName(u.callee);
  const obj = u.callee.object as N;
  if (name === 'url') return isPageLike(t, obj) ? 'url' : undefined;
  if (name === 'count') return isLocatorLike(t, obj) ? 'count' : undefined;
  return undefined;
}

/** The subject of the expect is a url/count read, directly or through a const bound to one. */
function urlOrCountKind(t: Tree, expectCall: N): 'url' | 'count' | undefined {
  const subject = unwrap(expectCall.arguments?.[0] as N | undefined);
  if (!subject) return undefined;
  if (subject.type === 'Identifier') {
    const b = resolve(t, expectCall, subject.name);
    return b?.hasInit ? readKind(t, b.decl.init as N) : undefined;
  }
  return readKind(t, subject);
}

/** Matchers that have a web-first equivalent for a url or count read (toHaveURL, toHaveCount). */
const URL_MATCHERS = new Set(['toBe', 'toEqual', 'toStrictEqual', 'toContain', 'toMatch', 'toBeTruthy', 'toBeFalsy']);
const COUNT_MATCHERS = new Set(['toBe', 'toEqual', 'toStrictEqual', 'toBeTruthy', 'toBeFalsy']);

/** The matcher called on the expect (`toBe` in `expect(x).not.toBe(1)`), if there is one. */
function matcherOf(t: Tree, expectCall: N): string | undefined {
  let cur: N = expectCall;
  for (;;) {
    const p = t.parent(cur);
    if (p?.type === 'MemberExpression' && p.object === cur) cur = p;
    else if (p?.type === 'CallExpression' && p.callee === cur) return parseMatcherCall(p)?.matcher;
    else return undefined;
  }
}

/** Switch for the unit test that compares findings with form assignment on and off. */
export const readForms = { enabled: true };

/** Form of an upstream finding reported at (line, column): read-reused when the read is reused, else read-direct. */
export function formOfReportedRead(t: Tree | undefined, line: number, column: number): ReadForm | undefined {
  const node = t?.nodeAt(line, column);
  if (!t || !node || !readForms.enabled) return undefined;
  return reportedReadReused(t, node) ? 'read-reused' : 'read-direct';
}

/** The url/count reads upstream does not report: `expect(<read>).toX()` with an equivalent web-first matcher, outside a retrying block. */
export function urlCountReads(t: Tree | undefined): ReadFinding[] {
  const out: ReadFinding[] = [];
  if (!t || !readForms.enabled) return out;
  t.some(t.root, (n) => {
    if (!isExpectSubjectCall(n)) return false;
    const matcher = matcherOf(t, n);
    if (!matcher || insideRetryingBlock(t, n)) return false;
    const kind = urlOrCountKind(t, n);
    if (!kind || !(kind === 'url' ? URL_MATCHERS : COUNT_MATCHERS).has(matcher)) return false;
    const start = (n.loc as { start: { line: number; column: number } }).start;
    out.push({ line: start.line, column: start.column + 1, form: reusedVariable(t, n) ? 'read-reused' : 'read-url-count' });
    return false;
  });
  return out;
}
