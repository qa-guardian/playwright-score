import { isFunction, patternNames, PAGE_OR_FRAME_NAME } from './eslint-postfilter.js';
import type { N, Tree } from './eslint-postfilter.js';
import { unwrap as unwrapNode, isExpectName, memberName, parseMatcherCall } from './rules/ast-util.js';

// QAG-287 B3: syntax helpers the read-form and capture-window modules share (moved unchanged from read-forms.ts):
// the expect subject call, lexical bindings, and what counts as the Page a test works with.

export const MAX_ALIAS_DEPTH = 3;

/** The shared unwrap (await, non-null, optional chain, `as`, parentheses), typed for this module's nodes. */
export const unwrap = (n: N | undefined): N | undefined => unwrapNode(n) as N | undefined;

/** `expect(<subject>)` or `expect.soft(<subject>)`: a call whose first argument is the value under test (`expect.poll` takes a function, so it is not one). */
export function isExpectSubjectCall(n: N | undefined, aliases?: ReadonlySet<string>): boolean {
  if (n?.type !== 'CallExpression') return false;
  const c = n.callee as N | undefined;
  if (c?.type === 'Identifier') return isExpectName(c.name, aliases);
  return c?.type === 'MemberExpression' && c.object?.type === 'Identifier' && isExpectName(c.object.name, aliases) && memberName(c) === 'soft';
}

export interface Binding {
  /** The declarator when the name is bound with an initialiser (`const x = <init>`); otherwise the binding node (parameter, loop or catch binding, destructuring). */
  decl: N;
  hasInit: boolean;
  isConst: boolean;
}

export function bindingInDeclaration(d: N, name: string): Binding | undefined {
  for (const v of (d.declarations ?? []) as N[]) {
    if (!patternNames(v.id as N).includes(name)) continue;
    const simple = v.id?.type === 'Identifier' && !!v.init;
    return { decl: v, hasInit: simple, isConst: d.kind === 'const' };
  }
  return undefined;
}

/** `var` declarations belong to the whole function, so look through its nested blocks (not nested functions). */
export function varInFunction(t: Tree, fn: N, name: string): Binding | undefined {
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
export function bindingOf(t: Tree, scope: N, name: string): Binding | undefined {
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
export function resolve(t: Tree, from: N, name: string): Binding | undefined {
  for (let scope: N | undefined = t.parent(from); scope; scope = t.parent(scope)) {
    const b = bindingOf(t, scope, name);
    if (b) return b;
  }
  return undefined;
}

/** Is `id` a use of the variable, rather than a property name, a key or the declaration itself? */
export function isReference(t: Tree, id: N): boolean {
  const p = t.parent(id);
  if (!p) return true;
  if (p.type === 'MemberExpression' && p.property === id && !p.computed) return false;
  if ((p.type === 'Property' || p.type === 'PropertyDefinition') && p.key === id && !p.computed && !p.shorthand) return false;
  if (p.type === 'VariableDeclarator' && p.id === id) return false;
  return true;
}

/** Is `n` the Page (or Frame) a test works with: a `page` name, `this.page`, or a const bound to one? */
export function isPageLike(t: Tree, n: N | undefined, depth = 0): boolean {
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
export function boundToNew(t: Tree, id: N): boolean {
  const b = resolve(t, id, id.name);
  return !!b && b.hasInit && (b.decl.init as N).type === 'NewExpression';
}

/** An identifier bound once with const to something `accept` recognises. */
export function aliasOf(t: Tree, id: N, depth: number, accept: (init: N) => boolean): boolean {
  if (depth >= MAX_ALIAS_DEPTH) return false;
  const b = resolve(t, id, id.name);
  if (!b || !b.isConst || !b.hasInit) return false;
  return accept(unwrap(b.decl.init as N) as N);
}

/** The matcher call on the expect (`.not.toBe(1)` in `expect(x).not.toBe(1)`), if there is one. */
export function matcherCallOf(t: Tree, expectCall: N): N | undefined {
  let cur: N = expectCall;
  for (;;) {
    const p = t.parent(cur);
    if (p?.type === 'MemberExpression' && p.object === cur) cur = p;
    else if (p?.type === 'CallExpression' && p.callee === cur) return p;
    else return undefined;
  }
}

/** The matcher called on the expect (`toBe` in `expect(x).not.toBe(1)`), if there is one. */
export function matcherOf(t: Tree, expectCall: N): string | undefined {
  const call = matcherCallOf(t, expectCall);
  return call ? parseMatcherCall(call)?.matcher : undefined;
}
