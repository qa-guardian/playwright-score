import { isFunction, insideRetryingBlock } from './eslint-postfilter.js';
import type { N, Tree } from './eslint-postfilter.js';
import { memberName } from './rules/ast-util.js';
import { aliasOf, isExpectSubjectCall, isPageLike, isReference, matcherOf, resolve, unwrap } from './read-ast.js';
import type { Binding } from './read-ast.js';
import { readShapeForm } from './read-shape-forms.js';
import type { ReadShapeForm } from './read-shape-forms.js';

// QAG-287 B1 (S3b, S7c): forms of `playwright/prefer-web-first-assertions`.
//
// A finding of this rule is an `expect(<read>)` whose subject is a value read from the
// page once. Five forms, first match wins (ADR section 5, precedence within C7):
//   read-reused    the subject is a variable bound to a read that is used again (S3b)
//   read-url-count the read is `page.url()` or a locator `.count()` (S7c)
//   read-handle    the read's receiver is an ElementHandle (B3, read-shape-forms.ts)
//   read-compare   the expected value comes from an earlier read of the page (B3, read-shape-forms.ts)
//   read-direct    any other read the upstream rule reports
// Upstream reports the first two shapes' siblings only (isVisible, textContent...), so
// the url/count reads are found here and reported as new findings.

export type ReadForm = 'read-direct' | 'read-reused' | 'read-url-count' | ReadShapeForm;

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


/** Switch for the unit test that compares findings with form assignment on and off. */
export const readForms = { enabled: true };

/** Form of an upstream finding reported at (line, column): read-reused when the read is reused, then read-handle or read-compare, else read-direct. */
export function formOfReportedRead(t: Tree | undefined, line: number, column: number): ReadForm | undefined {
  const node = t?.nodeAt(line, column);
  if (!t || !node || !readForms.enabled) return undefined;
  if (reportedReadReused(t, node)) return 'read-reused';
  return readShapeForm(t, node) ?? 'read-direct';
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