/**
 * Use forms (QAG-287 B3b): three narrowing forms decided from how a reported value or call is used. No finding is
 * added, removed or moved; only `form` changes, and the catalogue row of the new form gives tier and copy.
 *
 *  handle-argument  playwright/no-element-handle (C11). The ElementHandle a `$()`, `$$()`, `elementHandle()` or
 *                   `elementHandles()` call gives is used only as an argument to a call that is neither a Playwright
 *                   API nor `expect`: directly (an `await` between is fine), or through a binding with one definition
 *                   and one write whose every read is such an argument. A callee counts as a Playwright API when it
 *                   is a method named in playwright-api-names.ts or starting with `$`, a method of a proven Page,
 *                   Frame or Locator, or anything whose root is `expect`, a proven Playwright expect or an export of
 *                   a Playwright package. A callee that is neither a name nor a member (a call result) counts too.
 *  escaped          playwright/valid-expect (C2). The matcherless `expect(...)` chain is returned (also as an arrow
 *                   body), assigned (declarator, assignment, class field), passed as a call argument or stored as a
 *                   property value of an object literal. An expression statement, every other position, a value
 *                   returned from a test, hook or step callback and a declared variable that is never read stay
 *                   `matcherless`: there no matcher can be applied elsewhere.
 *  gated            playwright/no-page-pause (C12). Between the call and its enclosing function, the call sits in a
 *                   branch of an `if`, on the right side of `&&` or in a branch of `?:`, so the test decides whether
 *                   it runs.
 *
 * Precedence: api-under-test > foreign-expect > unresolved > these forms > `-`; handle-argument > locator-handle.
 * `escaped` is decided in the lint's shape-form step (formOf in eslint-postfilter.ts), so expect-binding.ts still
 * moves a proven foreign expect to `foreign-expect`. applyUseForms runs after the receiver step and changes only
 * findings it left at `-` (and S4c's `locator-handle`), before project-identity.ts, which moves its rules to
 * `api-under-test`. Type-only wrappers (`as`, `!`, `satisfies`, `<T>`) are seen through. Nothing here throws.
 */
import path from 'node:path';
import type { Finding } from './types.js';
import { isStringTitledCallback, type Tree } from './eslint-postfilter.js';
import { ESCAPED_FORM, GATED_FORM, HANDLE_ARGUMENT_FORM } from './catalogue/use-forms.js';
import { LOCATOR_HANDLE_FORM, LOCATOR_HANDLE_RULE } from './catalogue/locator-handle.js';
import { PLAYWRIGHT_API_METHODS } from './playwright-api-names.js';
import { createEnv, reportedCalls, type ReceiverContext } from './receiver-forms.js';
import { FN_TYPES, isExpectName } from './rules/ast-util.js';
import { locatorKind } from './rules/locator-handle.js';
import { REPORTED, prove } from './rules/receiver-proof.js';
import { denotes, lookup, playwrightExpect, strip } from './rules/scope-resolve.js';
import type { N, ResolveEnv, ScopeFile } from './rules/proof.js';

/** Switch for the unit test that compares the findings with the forms on and off (both steps). */
export const useForms = { enabled: true };

const PAUSE_RULE = 'playwright/no-page-pause';
/** The calls a finding may point at. Read when called, never at module load (the lint imports this module too). */
const handleMethods = (): readonly string[] => [...(REPORTED.get(LOCATOR_HANDLE_RULE)?.methods ?? []), 'elementHandle', 'elementHandles'];
const pauseMethods = (): readonly string[] => REPORTED.get(PAUSE_RULE)?.methods ?? ['pause'];
const WRAPPERS = new Set(['TSAsExpression', 'TSNonNullExpression', 'TSSatisfiesExpression', 'TSTypeAssertion', 'ChainExpression']);
type Parents = ReadonlyMap<N, N | undefined>;

/** `n` once the type-only wrappers around it are passed, and the node that uses it. */
function usedBy(parents: Parents, n: N): { node: N; parent: N | undefined } {
  let node = n;
  let parent = parents.get(node);
  while (parent && WRAPPERS.has(parent.type) && parent.expression === node) {
    node = parent;
    parent = parents.get(node);
  }
  return { node, parent };
}

// ---- escaped (C2), in the lint's shape-form step --------------------------------------------------------------

/** Is the const or let declared by `d` read anywhere in its function (by name)? */
function readLater(t: Tree, d: N): boolean {
  if (d.id?.type !== 'Identifier') return true;
  const scope = t.enclosingFunction(d) ?? t.root;
  return t.some(scope, (n) => n.type === 'Identifier' && n.name === d.id.name && n !== d.id);
}

/**
 * Is the value of `top` (an expect chain) returned, assigned, passed as an argument or stored in an object? Two
 * positions where no matcher can be applied elsewhere stay `matcherless`: the return value of a test, hook or step
 * callback (the runner drops it), and a variable that is never read.
 */
function escapes(t: Tree, top: N): boolean {
  const parents = t.parents;
  const { node, parent: p } = usedBy(parents, top);
  switch (p?.type) {
    case 'ReturnStatement': {
      const fn = t.enclosingFunction(p);
      return p.argument === node && !(fn && isStringTitledCallback(t, fn));
    }
    case 'ArrowFunctionExpression':
      return p.body === node && !isStringTitledCallback(t, p);
    case 'VariableDeclarator':
      return p.init === node && readLater(t, p);
    case 'AssignmentExpression':
      return p.right === node;
    case 'PropertyDefinition':
      return p.value === node;
    case 'CallExpression':
    case 'NewExpression':
      return p.callee !== node && (p.arguments as N[]).includes(node);
    case 'Property':
      return p.value === node && parents.get(p)?.type === 'ObjectExpression';
    default:
      return false;
  }
}

/** Form of a matcherless valid-expect finding reported at `node` of the lint's tree: `escaped` or `matcherless`. */
export function matcherlessForm(t: Tree, node: N): string {
  if (!useForms.enabled) return 'matcherless';
  try {
    return escapes(t, t.chainTop(node)) ? ESCAPED_FORM : 'matcherless';
  } catch {
    return 'matcherless';
  }
}

// ---- gated (C12) -----------------------------------------------------------------------------------------------

/** Does a condition in the same function decide whether `call` runs? */
function gated(parents: Parents, call: N): boolean {
  let child = call;
  for (let p = parents.get(child); p && !FN_TYPES.has(p.type); child = p, p = parents.get(p)) {
    if ((p.type === 'IfStatement' || p.type === 'ConditionalExpression') && (p.consequent === child || p.alternate === child)) return true;
    if (p.type === 'LogicalExpression' && p.operator === '&&' && p.right === child) return true;
  }
  return false;
}

// ---- handle-argument (C11) -------------------------------------------------------------------------------------

/** Does `id` denote Playwright's expect or an export of a Playwright package? */
function playwrightName(env: ResolveEnv, sf: ScopeFile, id: N): boolean {
  if (isExpectName(id.name)) return true;
  // Both resolve an import of any package; only an export of a Playwright package counts.
  const d = denotes(env, sf, id);
  if (d.ok === true && d.value.playwright) return true;
  const e = playwrightExpect(env, sf, id);
  return e.ok === true && e.value.playwright;
}

/** Is the callee a Playwright API or `expect`? Any shape not read here counts as one (the form is not given). */
function playwrightCallee(env: ResolveEnv, sf: ScopeFile, calleeIn: N): boolean {
  const callee = strip(calleeIn);
  if (callee?.type === 'Identifier') return playwrightName(env, sf, callee);
  if (callee?.type !== 'MemberExpression') return true;
  const name = !callee.computed && callee.property?.type === 'Identifier' ? (callee.property.name as string) : undefined;
  if (name === undefined || PLAYWRIGHT_API_METHODS.has(name) || name.startsWith('$')) return true;
  let root = strip(callee.object);
  while (root && (root.type === 'MemberExpression' || root.type === 'CallExpression')) root = strip(root.type === 'MemberExpression' ? root.object : root.callee);
  if (root?.type === 'Identifier' && playwrightName(env, sf, root)) return true;
  return locatorKind(env, sf, callee.object) !== undefined || prove(env, sf, callee.object).ok;
}

/** Is `node` (as used by `parent`) an argument of a call that is neither a Playwright API nor expect? */
function foreignArgument(env: ResolveEnv, sf: ScopeFile, node: N, parent: N | undefined): boolean {
  return parent?.type === 'CallExpression' && parent.callee !== node && (parent.arguments as N[]).includes(node) && !playwrightCallee(env, sf, parent.callee);
}

/** Is the handle `call` gives used only as such an argument? */
function handleArgumentOnly(env: ResolveEnv, sf: ScopeFile, call: N): boolean {
  let { node, parent } = usedBy(sf.parents, call);
  if (parent?.type === 'AwaitExpression' && parent.argument === node) ({ node, parent } = usedBy(sf.parents, parent));
  if (parent?.type === 'CallExpression') return foreignArgument(env, sf, node, parent);
  if (parent?.type !== 'VariableDeclarator' || parent.init !== node || parent.id?.type !== 'Identifier') return false;
  const decl = sf.parents.get(parent);
  if (decl && sf.parents.get(decl)?.type === 'ExportNamedDeclaration') return false;
  const v = lookup(sf, parent.id, parent.id.name as string);
  if (!v || v.defs.length !== 1 || v.defs[0].node !== parent) return false;
  const refs = v.references as N[];
  if (refs.filter((r) => r.isWrite()).length !== 1) return false;
  const reads = refs.filter((r) => r.isRead());
  return reads.length > 0 && reads.every((r) => {
    const u = usedBy(sf.parents, r.identifier as N);
    return foreignArgument(env, sf, u.node, u.parent);
  });
}

/**
 * Sets `handle-argument` on no-element-handle findings of form `-` or `locator-handle`, and `gated` on no-page-pause
 * findings of form `-`, when every call reported at the finding's position has the shape. In place; only `form`
 * changes, and nothing here throws.
 */
export function applyUseForms(findings: Finding[], ctx: ReceiverContext): void {
  if (!useForms.enabled) return;
  let env: ResolveEnv | undefined;
  for (const f of findings) {
    const next =
      f.rule === LOCATOR_HANDLE_RULE && (f.form === '-' || f.form === LOCATOR_HANDLE_FORM) ? HANDLE_ARGUMENT_FORM : f.rule === PAUSE_RULE && f.form === '-' ? GATED_FORM : undefined;
    if (!next || typeof f.line !== 'number' || typeof f.column !== 'number') continue;
    try {
      const file = path.resolve(ctx.filesBase, f.file);
      if (typeof ctx.sources.get(file) !== 'string') continue;
      const e = (env ??= createEnv(ctx));
      const sf = e.load(file);
      if (!sf) continue;
      const calls = reportedCalls(sf, f.line, f.column, next === GATED_FORM ? pauseMethods() : handleMethods());
      if (calls.length === 0) continue;
      if (next === GATED_FORM ? calls.every((c) => gated(sf.parents, c)) : calls.every((c) => handleArgumentOnly(e, sf, c))) f.form = next;
    } catch {
      continue;
    }
  }
}
