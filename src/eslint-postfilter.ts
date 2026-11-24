import { parseAst } from './parse-cache.js';
import { isExpectName } from './rules/ast-util.js';
import { matcherlessForm } from './use-forms.js';
import { callArgumentForm, isAwaitedPosition } from './awaited-call-argument.js';
import type { Severity } from './types.js';
import { passesAnywayForm } from './rules/assertion-passes-anyway.js';
import { uncheckedReadForm } from './rules/unchecked-read.js';

// QAG-287 slice F: AST post-filters for upstream eslint-plugin-playwright
// messages. A hand-check of real findings showed several upstream rules fire on
// shapes that are not defects. Each filter below drops (or downgrades) one
// documented FALSE shape. Rule of thumb: when a shape is unclear, keep the
// finding. An exemption must never hide a defect, so each one is narrow.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type N = { type: string; [k: string]: any };

export interface Decision {
  drop?: boolean;
  severity?: Severity;
  reportOnly?: boolean;
}

export interface PostFilterMessage {
  ruleId: string;
  messageId?: string;
  line: number;
  /** 1-based, as ESLint reports it. */
  column: number;
}

const SKIP_KEYS = new Set(['parent', 'loc', 'range', 'tokens', 'comments']);

export class Tree {
  readonly parents = new Map<N, N | undefined>();
  private readonly at = new Map<string, N[]>();
  readonly root: N;
  readonly comments: N[];

  constructor(ast: N) {
    this.root = ast;
    this.comments = (ast.comments as N[] | undefined) ?? [];
    const visit = (node: N, parent: N | undefined): void => {
      this.parents.set(node, parent);
      const loc = node.loc as { start: { line: number; column: number } } | undefined;
      if (loc) {
        const key = `${loc.start.line}:${loc.start.column}`;
        const list = this.at.get(key);
        if (list) list.push(node);
        else this.at.set(key, [node]);
      }
      for (const key of Object.keys(node)) {
        if (SKIP_KEYS.has(key)) continue;
        const value = node[key];
        if (Array.isArray(value)) {
          for (const item of value) if (item && typeof item.type === 'string') visit(item, node);
        } else if (value && typeof value === 'object' && typeof value.type === 'string') {
          visit(value, node);
        }
      }
    };
    visit(ast, undefined);
  }

  parent(n: N): N | undefined {
    return this.parents.get(n);
  }

  /** Deepest node starting at an ESLint (1-based column) position. */
  nodeAt(line: number, column: number): N | undefined {
    const list = this.at.get(`${line}:${column - 1}`);
    return list?.[list.length - 1];
  }

  children(n: N): N[] {
    const out: N[] = [];
    for (const key of Object.keys(n)) {
      if (SKIP_KEYS.has(key)) continue;
      const value = n[key];
      if (Array.isArray(value)) {
        for (const item of value) if (item && typeof item.type === 'string') out.push(item);
      } else if (value && typeof value === 'object' && typeof value.type === 'string') {
        out.push(value);
      }
    }
    return out;
  }

  /** Walk every node below `n` (inclusive); return true from `visit` to stop. */
  some(n: N, visit: (node: N) => boolean): boolean {
    if (visit(n)) return true;
    for (const key of Object.keys(n)) {
      if (SKIP_KEYS.has(key)) continue;
      const value = n[key];
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item.type === 'string' && this.some(item, visit)) return true;
        }
      } else if (value && typeof value === 'object' && typeof value.type === 'string') {
        if (this.some(value, visit)) return true;
      }
    }
    return false;
  }

  /** Top of the member/call chain `n` belongs to (`expect(x).not.toBe(1)` from `expect`). */
  chainTop(n: N): N {
    let cur = n;
    for (;;) {
      const p = this.parent(cur);
      if (!p) return cur;
      if (p.type === 'MemberExpression') cur = p;
      else if (p.type === 'CallExpression' && p.callee === cur) cur = p;
      else if (p.type === 'TSNonNullExpression' || p.type === 'ChainExpression') cur = p;
      else return cur;
    }
  }

  enclosingFunction(n: N): N | undefined {
    let cur = this.parent(n);
    while (cur && !isFunction(cur)) cur = this.parent(cur);
    return cur;
  }
}

export function isFunction(n: N | undefined): boolean {
  return (
    !!n &&
    (n.type === 'FunctionDeclaration' ||
      n.type === 'FunctionExpression' ||
      n.type === 'ArrowFunctionExpression')
  );
}

function rootIdentifierName(node: N | undefined): string | undefined {
  let cur = node;
  while (cur) {
    if (cur.type === 'Identifier') return cur.name as string;
    if (cur.type === 'MemberExpression') cur = cur.object;
    else if (cur.type === 'CallExpression') cur = cur.callee;
    else if (cur.type === 'AwaitExpression' || cur.type === 'TSNonNullExpression') cur = cur.argument ?? cur.expression;
    else return undefined;
  }
  return undefined;
}

export function isExpectCall(n: N): boolean {
  return n.type === 'CallExpression' && rootIdentifierName(n.callee) === 'expect';
}

/** `name('title', () => {...})`: a function that is the last argument of a call whose first argument is a string. */
export function isStringTitledCallback(t: Tree, fn: N): boolean {
  const call = t.parent(fn);
  if (!call || call.type !== 'CallExpression') return false;
  const args = call.arguments as N[];
  if (args[args.length - 1] !== fn || args.length < 2) return false;
  const first = args[0];
  return first.type === 'Literal' ? typeof first.value === 'string' : first.type === 'TemplateLiteral';
}

/** A named helper: declared function, or a function stored in a variable, object property or class member. */
export function isHelperFunction(t: Tree, fn: N): boolean {
  if (fn.type === 'FunctionDeclaration') return true;
  const p = t.parent(fn);
  if (!p) return false;
  if (p.type === 'VariableDeclarator' && p.init === fn) return true;
  if (p.type === 'Property' && p.value === fn) return true;
  if ((p.type === 'MethodDefinition' || p.type === 'PropertyDefinition') && p.value === fn) return true;
  return false;
}

// ---- valid-expect -------------------------------------------------------

function helperName(t: Tree, fn: N): string | undefined {
  if (fn.type === 'FunctionDeclaration') return fn.id?.name as string | undefined;
  const p = t.parent(fn);
  if (!p) return undefined;
  if (p.type === 'VariableDeclarator' && p.id?.type === 'Identifier') return p.id.name as string;
  if ((p.type === 'Property' || p.type === 'MethodDefinition' || p.type === 'PropertyDefinition') && !p.computed && p.key?.type === 'Identifier') {
    return p.key.name as string;
  }
  return undefined;
}

function calleeName(callee: N | undefined): string | undefined {
  if (callee?.type === 'Identifier') return callee.name as string;
  if (callee?.type === 'MemberExpression' && !callee.computed && callee.property?.type === 'Identifier') return callee.property.name as string;
  return undefined;
}

/**
 * A helper that returns a matcher-less `expect(x)` only does its job when a
 * caller chains the matcher on the result (`helper(x).toBeVisible()`,
 * `(await helper(x)).not.toBe(..)`, or `const e = helper(x); e.toBe(..)`).
 * Exported helpers with no call in this file are given the benefit of the
 * doubt (their callers are in other files); a helper with even one in-file
 * caller that does not chain a matcher is a defect.
 */
export function returnedExpectIsMatched(t: Tree, fn: N): boolean {
  const c = returnedExpectCallers(t, fn);
  return c === 'exempt' || c === 'all';
}

/**
 * Evidence side of the same rule: does ANY caller chain a matcher? The
 * helper's `expect` counts as assertion evidence for its callers (so
 * `expect-expect` is not flagged on a test that calls `helper(x).toBe(..)`)
 * unless no caller anywhere in the file ever chains one. Callers are matched
 * by helper name, not per call site, so a test that drops the matcher while a
 * sibling chains it keeps the benefit; `valid-expect` still reports the helper.
 */
export function returnedExpectIsEverMatched(t: Tree, fn: N): boolean {
  const c = returnedExpectCallers(t, fn);
  return c === 'exempt' || c === 'all' || c === 'some';
}

function returnedExpectCallers(t: Tree, fn: N): 'exempt' | 'all' | 'some' | 'none' {
  const name = helperName(t, fn);
  if (!name) return 'exempt';
  let called = false;
  let chainedAny = false;
  let unchained = false;
  t.some(t.root, (n) => {
    if (n.type !== 'CallExpression' || calleeName(n.callee) !== name) return false;
    called = true;
    let cur = n;
    for (;;) {
      const p = t.parent(cur);
      if (p && (p.type === 'AwaitExpression' || p.type === 'TSNonNullExpression' || p.type === 'ChainExpression')) cur = p;
      else break;
    }
    const p = t.parent(cur);
    let chained = false;
    if (p?.type === 'MemberExpression' && p.object === cur) {
      chained = true;
    } else if (p?.type === 'VariableDeclarator' && p.init === cur && p.id?.type === 'Identifier') {
      const stored = p.id.name as string;
      const scope = t.enclosingFunction(cur) ?? t.root;
      chained = t.some(scope, (m) => m.type === 'MemberExpression' && m.object?.type === 'Identifier' && m.object.name === stored);
    }
    if (chained) chainedAny = true;
    else unchained = true;
    return false;
  });
  if (!called) {
    const exported = t.some(t.root, (n) => n.type === 'ExportNamedDeclaration' || n.type === 'ExportDefaultDeclaration' || n.type === 'ExportAllDeclaration');
    return exported ? 'exempt' : 'none';
  }
  if (!unchained) return 'all';
  return chainedAny ? 'some' : 'none';
}

/** Matcher-less `expect(...)` / `expect.poll(...)` calls that `fn` hands back to its caller. */
export function returnedMatcherlessExpects(t: Tree, fn: N): N[] {
  const out: N[] = [];
  const unwrap = (e: N | undefined): N | undefined => {
    let cur = e;
    while (cur && (cur.type === 'AwaitExpression' || cur.type === 'TSNonNullExpression')) cur = cur.argument ?? cur.expression;
    return cur;
  };
  const consider = (e: N | undefined): void => {
    const u = unwrap(e);
    if (u && u.type === 'CallExpression' && isExpectCall(u) && rootIdentifierName(u.callee) === 'expect') {
      // matcher-less: the call itself is the chain's top (no `.toBe` on it)
      if (t.chainTop(u) === u) out.push(u);
    }
  };
  if (fn.body?.type !== 'BlockStatement') consider(fn.body);
  t.some(fn, (n) => {
    if (n.type === 'ReturnStatement' && t.enclosingFunction(n) === fn) consider(n.argument);
    return false;
  });
  return out;
}

/**
 * `expect(...)` / `expect.poll(...)` with no matcher is a defect, except when
 * the expectation object is handed on: returned from a named helper (the caller
 * adds the matcher) or stored in a variable whose matcher is called later.
 * A returned expect inside a test callback is still a defect.
 */
function validExpectExempt(t: Tree, node: N): boolean {
  let top = t.chainTop(node);
  let p = t.parent(top);
  while (p && p.type === 'AwaitExpression') {
    top = p;
    p = t.parent(p);
  }
  if (!p) return false;
  if (p.type === 'ReturnStatement') {
    const fn = t.enclosingFunction(top);
    return !!fn && isHelperFunction(t, fn) && !isStringTitledCallback(t, fn) && returnedExpectIsMatched(t, fn);
  }
  if (p.type === 'ArrowFunctionExpression' && p.body === top) {
    return isHelperFunction(t, p) && !isStringTitledCallback(t, p) && returnedExpectIsMatched(t, p);
  }
  if (p.type === 'VariableDeclarator' && p.init === top && p.id.type === 'Identifier') {
    const name = p.id.name as string;
    const scope = t.enclosingFunction(top) ?? t.root;
    const startLine = (top.loc as { end: { line: number } }).end.line;
    return t.some(scope, (n) => {
      if (n.type !== 'MemberExpression' || n.object?.type !== 'Identifier' || n.object.name !== name) return false;
      return (n.loc as { start: { line: number } }).start.line >= startLine;
    });
  }
  return false;
}

// ---- no-conditional-expect ---------------------------------------------

/** The arms of an if / else-if / else chain; undefined when there is no final `else`. */
function ifArms(node: N): N[] | undefined {
  const arms: N[] = [node.consequent];
  let alt: N | null = node.alternate;
  while (alt) {
    if (alt.type === 'IfStatement') {
      arms.push(alt.consequent);
      alt = alt.alternate;
    } else {
      arms.push(alt);
      return arms;
    }
  }
  return undefined;
}

/** Does running this node always run an expect? Functions, loops and other conditionals do not count. */
function alwaysAsserts(t: Tree, n: N): boolean {
  if (isExpectCall(n)) return true;
  if (isFunction(n)) return false;
  switch (n.type) {
    case 'IfStatement': {
      const arms = ifArms(n);
      return !!arms && arms.every((a) => alwaysAsserts(t, a));
    }
    case 'ConditionalExpression':
    case 'LogicalExpression':
    case 'SwitchStatement':
    case 'CatchClause':
    case 'ForStatement':
    case 'ForOfStatement':
    case 'ForInStatement':
    case 'WhileStatement':
    case 'DoWhileStatement':
      return false;
    case 'TryStatement':
      return alwaysAsserts(t, n.block);
    default:
      return t.children(n).some((c) => alwaysAsserts(t, c));
  }
}

/**
 * An expect whose only conditional ancestors are if/else chains where every arm
 * (including a final `else`) asserts is not skippable: some assertion always
 * runs. Any other conditional on the way (ternary, `&&`, switch, catch, an if
 * without `else`, an expect inside the condition) keeps the finding.
 */
function conditionalExpectExempt(t: Tree, node: N): boolean {
  let child = t.chainTop(node);
  let cur = t.parent(child);
  let sawIf = false;
  while (cur) {
    if (isFunction(cur) && isStringTitledCallback(t, cur)) break;
    switch (cur.type) {
      case 'IfStatement': {
        if (cur.test === child) return false;
        const arms = ifArms(cur);
        if (!arms || !arms.every((a) => alwaysAsserts(t, a))) return false;
        sawIf = true;
        break;
      }
      case 'ConditionalExpression':
      case 'LogicalExpression':
      case 'SwitchStatement':
      case 'CatchClause':
        return false;
      case 'CallExpression':
        if (cur.callee?.type === 'MemberExpression' && cur.callee.property?.name === 'catch') return false;
        break;
      default:
    }
    child = cur;
    cur = t.parent(cur);
  }
  return sawIf;
}

// ---- no-conditional-in-test --------------------------------------------

const LIVE_QUERY_METHODS = new Set([
  'isVisible', 'isHidden', 'isChecked', 'isEnabled', 'isDisabled', 'isEditable', 'count', 'getAttribute',
  'textContent', 'innerText', 'innerHTML', 'inputValue', 'boundingBox', 'allTextContents', 'allInnerTexts',
  'url', 'title', 'viewportSize', 'evaluate', 'evaluateAll',
]);

/** The conditional node upstream reported (a ternary or `&&` starts where its first operand starts). */
function reportedConditional(t: Tree, node: N): N | undefined {
  const start = node.loc as { start: { line: number; column: number } };
  let cur: N | undefined = node;
  while (cur) {
    if (['IfStatement', 'ConditionalExpression', 'LogicalExpression', 'SwitchStatement'].includes(cur.type)) return cur;
    const p = t.parent(cur);
    const ps = p?.loc as { start: { line: number; column: number } } | undefined;
    if (!p || !ps || ps.start.line !== start.start.line || ps.start.column !== start.start.column) return undefined;
    cur = p;
  }
  return undefined;
}

/** Every name a binding pattern introduces (`x`, `[a, b]`, `{ a, b: c, ...rest }`, defaults). */
export function patternNames(p: N | null | undefined, out: string[] = []): string[] {
  if (!p) return out;
  switch (p.type) {
    case 'Identifier':
      out.push(p.name as string);
      break;
    case 'ArrayPattern':
      for (const e of p.elements as Array<N | null>) patternNames(e, out);
      break;
    case 'ObjectPattern':
      for (const prop of p.properties as N[]) patternNames(prop.type === 'RestElement' ? prop.argument : prop.value, out);
      break;
    case 'AssignmentPattern':
      patternNames(p.left, out);
      break;
    case 'RestElement':
      patternNames(p.argument, out);
      break;
  }
  return out;
}

/** Names bound to an awaited value (`const shown = await x.isVisible()`, `const [rows] = await ...`): branching on them is live UI state. */
function awaitedNames(t: Tree): Set<string> {
  const names = new Set<string>();
  const live = (e: N | null | undefined): boolean =>
    !!e && t.some(e, (n) => n.type === 'AwaitExpression' || (n.type === 'Identifier' && names.has(n.name)));
  // Fixed point: a name derived from an awaited one (`const has = !!tx.spans?.find(...)`
  // after `const tx = await p`) is live too (corpus C1-065, Sentry middleware.test.ts:116).
  for (let grew = true; grew; ) {
    grew = false;
    t.some(t.root, (n) => {
      if (n.type === 'VariableDeclarator' && live(n.init)) {
        for (const name of patternNames(n.id)) {
          if (!names.has(name)) {
            names.add(name);
            grew = true;
          }
        }
      }
      if (n.type === 'AssignmentExpression' && live(n.right)) {
        for (const name of patternNames(n.left)) {
          if (!names.has(name)) {
            names.add(name);
            grew = true;
          }
        }
      }
      return false;
    });
  }
  return names;
}

/**
 * A branch on live UI state (an awaited call, a Playwright query, a value read
 * from one) is a real risk: the test takes a different path per run. A branch on
 * static data, a fixture flag or a computed value is not; those findings stay in
 * the report as information only.
 */
function conditionIsLive(t: Tree, cond: N, awaited: () => Set<string>): boolean {
  return t.some(cond, (n) => {
    if (n.type === 'AwaitExpression') return true;
    if (n.type === 'CallExpression' && n.callee?.type === 'MemberExpression') {
      const name = n.callee.property?.name ?? n.callee.property?.value;
      if (LIVE_QUERY_METHODS.has(name)) return true;
    }
    if (n.type === 'Identifier' && awaited().has(n.name)) return true;
    return false;
  });
}

// ---- prefer-web-first-assertions ---------------------------------------

/**
 * Inside `expect(async () => {...}).toPass()` or `expect.poll(fn)` the block is
 * retried as a whole, so reading a value and asserting on it is the retrying
 * form already.
 */
export function insideRetryingBlock(t: Tree, node: N, aliases?: ReadonlySet<string>): boolean {
  let cur: N | undefined = t.parent(node);
  let child: N = node;
  while (cur) {
    if (cur.type === 'CallExpression' && (cur.arguments as N[]).includes(child) && isFunction(child)) {
      const callee = cur.callee as N;
      if (callee.type === 'MemberExpression' && isExpectName(callee.object?.name, aliases) && callee.property?.name === 'poll') {
        return true;
      }
      if (callee.type === 'Identifier' && isExpectName(callee.name, aliases)) {
        const outer = t.parent(cur);
        if (outer?.type === 'MemberExpression' && outer.object === cur && outer.property?.name === 'toPass') return true;
      }
    }
    child = cur;
    cur = t.parent(cur);
  }
  return false;
}

// ---- missing-playwright-await ------------------------------------------

const PROMISE_COMBINATORS = new Set(['all', 'allSettled', 'race', 'any']);

/** Is the array bound to `name` awaited after `afterLine`: `await Promise.all(name)`, `await name[i]`, or `for (p of name) await p`? */
function arrayAwaitedLater(t: Tree, scope: N, name: string, afterLine: number): boolean {
  const mentions = (e: N | undefined): boolean =>
    !!e && ((e.type === 'Identifier' && e.name === name) || (e.type === 'SpreadElement' && e.argument?.name === name));
  return t.some(scope, (n) => {
    const line = (n.loc as { start: { line: number } }).start.line;
    if (line <= afterLine) return false;
    if (n.type === 'CallExpression' && n.callee?.type === 'MemberExpression' && n.callee.object?.name === 'Promise' &&
        PROMISE_COMBINATORS.has(n.callee.property?.name) && (n.arguments as N[]).some(mentions)) {
      return isAwaitedPosition(t, n);
    }
    if (n.type === 'AwaitExpression') {
      const a = n.argument as N;
      return mentions(a) || (a.type === 'MemberExpression' && a.object?.name === name);
    }
    if (n.type === 'ForOfStatement' && mentions(n.right)) {
      return t.some(n.body, (x) => x.type === 'AwaitExpression');
    }
    return false;
  });
}

/**
 * A promise collected in an array that is awaited later is awaited. Narrow on
 * purpose: only an array literal bound to a variable, or `arr.push(promise)`,
 * and only a later `await`, `Promise.all`-style call or awaiting loop on that
 * same name.
 */
function collectedAndAwaited(t: Tree, node: N): boolean {
  const top = t.chainTop(node);
  const p = t.parent(top);
  if (!p) return false;
  const line = (top.loc as { end: { line: number } }).end.line;
  let name: string | undefined;
  let scopeFrom: N = top;
  if (p.type === 'ArrayExpression') {
    const decl = t.parent(p);
    if (decl?.type === 'VariableDeclarator' && decl.init === p && decl.id?.type === 'Identifier') name = decl.id.name;
    scopeFrom = p;
  } else if (
    p.type === 'CallExpression' &&
    p.callee?.type === 'MemberExpression' &&
    p.callee.property?.name === 'push' &&
    p.callee.object?.type === 'Identifier' &&
    (p.arguments as N[]).includes(top)
  ) {
    name = p.callee.object.name;
  }
  if (!name) return false;
  const scope = t.enclosingFunction(scopeFrom) ?? t.root;
  return arrayAwaitedLater(t, scope, name, line);
}

// ---- no-wait-for-selector ----------------------------------------------

/** A wait inside a try block or before `.catch(...)` is swallowed: the wait can silently do nothing. */
function waitIsSwallowed(t: Tree, node: N): boolean {
  const top = t.chainTop(node);
  for (let c: N | undefined = node; c && c !== top; c = t.parent(c)) {
    const p = t.parent(c);
    if (p?.type === 'MemberExpression' && p.object === c && p.property?.name === 'catch') return true;
  }
  let child: N = top;
  let cur = t.parent(top);
  while (cur && !isFunction(cur)) {
    if (cur.type === 'TryStatement' && cur.block === child) return true;
    child = cur;
    cur = t.parent(cur);
  }
  return false;
}

// ---- prefer-locator ------------------------------------------------------

export const PAGE_OR_FRAME_NAME = /^(page|frame)$|(Page|Frame)$/;

/**
 * Upstream treats any receiver whose name starts with `page`/`frame` as a Page
 * (`pageCount.textContent()`, `pagerButton(page, 'Next').click()`). Keep the
 * finding for a receiver that is plausibly a Page or Frame: an identifier named
 * `page`/`frame` or ending in Page/Frame, a member such as `this.page`, or a
 * call on one (`page.frame('x')`). Drop it for an identifier that merely starts
 * with `page` and for a call to a plain function.
 */
function receiverIsNotPage(t: Tree, node: N): boolean {
  const start = node.loc as { start: { line: number; column: number } };
  let call: N | undefined;
  for (let c: N | undefined = node; c; c = t.parent(c)) {
    const cs = c.loc as { start: { line: number; column: number } };
    if (cs.start.line !== start.start.line || cs.start.column !== start.start.column) break;
    if (c.type === 'CallExpression' && c.callee?.type === 'MemberExpression') call = c;
  }
  if (!call) return false;
  const obj = call.callee.object as N;
  switch (obj.type) {
    case 'Identifier':
      return !PAGE_OR_FRAME_NAME.test(obj.name);
    case 'MemberExpression':
      return false;
    case 'CallExpression':
      return obj.callee?.type === 'Identifier';
    default:
      return false;
  }
}

/**
 * Form of a missing-playwright-await finding. The plugin reports an assertion
 * or test.step at the `expect` / `test` identifier and an action at the start
 * of the call, so both begin at the root of a member/call chain. It is an
 * assertion when the chain starts at `expect`, goes through `.step`, or ends
 * in a `to...` matcher or `.poll`; any other chain is an action.
 */
function missingAwaitForm(t: Tree, node: N, aliases?: ReadonlySet<string>): 'assertion' | 'action' {
  const names: string[] = [];
  let cur: N | undefined = t.chainTop(node);
  let last: string | undefined;
  while (cur) {
    if (cur.type === 'CallExpression') cur = cur.callee;
    else if (cur.type === 'MemberExpression') {
      const prop = cur.property as N;
      const name = !cur.computed && prop.type === 'Identifier' ? (prop.name as string) : undefined;
      if (name !== undefined) names.unshift(name);
      if (last === undefined) last = name;
      cur = cur.object;
    } else if (cur.type === 'TSNonNullExpression' || cur.type === 'ChainExpression') cur = cur.expression;
    else break;
  }
  const root = cur && cur.type === 'Identifier' ? (cur.name as string) : undefined;
  if (isExpectName(root, aliases) || names[0] === 'step' || names.includes('poll')) return 'assertion';
  return last !== undefined && /^to[A-Z]/.test(last) ? 'assertion' : 'action';
}

// ---- entry point --------------------------------------------------------

export type PostFilter = ((msg: PostFilterMessage) => Decision | undefined) & {
  /**
   * Form of the finding within its rule (src/catalogue), decided from the
   * reported syntax node. Undefined for a rule with one shape, or when the
   * node cannot be found.
   */
  formOf: (msg: PostFilterMessage) => string | undefined;
  /** The parsed file, for form modules the caller runs itself (src/read-forms.ts); undefined when it does not parse. */
  tree: () => Tree | undefined;
};

function parse(source: string, file: string): Tree | undefined {
  try {
    // Comments, `loc` and `range` are on every tree the parser returns (parse-cache.ts).
    const ast = parseAst(source, file) as unknown as N;
    return new Tree(ast);
  } catch {
    return undefined;
  }
}

/**
 * Parses lazily, once per file; a file that does not parse gets no decisions (all findings kept).
 * `aliases`: the names the alias lint pass reads as `expect` in this file (S4b.2, src/expect-alias.ts).
 */
export function createPostFilter(source: () => string, file: string, aliases?: ReadonlySet<string>): PostFilter {
  let tree: Tree | undefined;
  let tried = false;
  let awaited: Set<string> | undefined;
  const ensureTree = (): Tree | undefined => {
    if (!tried) {
      tried = true;
      try {
        tree = parse(source(), file);
      } catch {
        tree = undefined;
      }
    }
    return tree;
  };
  const decide = (msg: PostFilterMessage): Decision | undefined => {
    ensureTree();
    if (!tree) return undefined;
    const node = tree.nodeAt(msg.line, msg.column);
    if (!node) return undefined;
    switch (msg.ruleId) {
      case 'playwright/valid-expect':
        if ((msg.messageId === 'matcherNotFound' || msg.messageId === 'matcherNotCalled') && validExpectExempt(tree, node)) {
          return { drop: true };
        }
        return undefined;
      case 'playwright/no-conditional-in-test': {
        const cond = reportedConditional(tree, node);
        if (!cond) return undefined;
        const subject = cond.type === 'LogicalExpression' ? cond : cond.type === 'SwitchStatement' ? cond.discriminant : cond.test;
        const t = tree;
        if (conditionIsLive(t, subject, () => (awaited ??= awaitedNames(t)))) return undefined;
        return { severity: 'info', reportOnly: true };
      }
      case 'playwright/prefer-locator':
        return receiverIsNotPage(tree, node) ? { drop: true } : undefined;
      case 'playwright/no-wait-for-selector':
        return waitIsSwallowed(tree, node) ? { severity: 'error' } : undefined;
      case 'playwright/prefer-web-first-assertions':
        return insideRetryingBlock(tree, node, aliases) ? { drop: true } : undefined;
      case 'playwright/missing-playwright-await':
        return collectedAndAwaited(tree, node) ? { drop: true } : undefined;
      case 'playwright/no-conditional-expect':
        return conditionalExpectExempt(tree, node) ? { drop: true } : undefined;
      default:
        return undefined;
    }
  };
  const formOf = (msg: PostFilterMessage): string | undefined => {
    switch (msg.ruleId) {
      case 'playwright/valid-expect': {
        if (msg.messageId !== 'matcherNotFound' && msg.messageId !== 'matcherNotCalled') return 'other';
        // QAG-287 B3b: a matcherless expect that is returned, assigned, passed on or stored is `escaped`.
        const t = ensureTree();
        const node = t?.nodeAt(msg.line, msg.column);
        return t && node ? matcherlessForm(t, node) : 'matcherless';
      }
      case 'playwright/missing-playwright-await': {
        const t = ensureTree();
        const node = t?.nodeAt(msg.line, msg.column);
        return t && node ? callArgumentForm(t, node, missingAwaitForm(t, node, aliases)) : undefined;
      }
      case 'pwscore/assertion-passes-anyway':
        return passesAnywayForm(msg.messageId);
      case 'pwscore/unchecked-read':
        return uncheckedReadForm(msg.messageId);
      default:
        return undefined;
    }
  };
  return Object.assign(decide, { formOf, tree: ensureTree });
}
