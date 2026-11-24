/**
 * Expect binding (QAG-287 S4b).
 *
 * The rules in EXPECT_BOUND_RULES describe how Playwright's `expect` behaves, and
 * they find an `expect` by its name. This step never adds, removes or rewrites a
 * finding. It asks the binding resolver (rules/scope-resolve.ts) what the `expect`
 * of the finding denotes, and only then decides:
 *
 *  proven Playwright  `expect` of a Playwright test package, also through a local re-export,
 *                     a `const` alias, `.extend`, `.configure` or `mergeExpects`: unchanged.
 *  proven foreign     `expect` or `assert` of chai, @jest/globals, vitest, expect or
 *                     node:assert: form `foreign-expect` (advisory).
 *  anything else      a global, an unknown package, any shape the resolver does not
 *                     prove: the form stays, the tier is `needs-check`, with the reason.
 *
 * A finding with no `expect` at its position (an action, a step) is left alone, and
 * so is a finding that already has form `api-under-test`. A `void`-ed expect is a
 * deliberate, still unchecked assertion: its finding is never certain.
 * Any internal error counts as "not resolved".
 */
import path from 'node:path';
import type { Finding } from './types.js';
import { defaultRow, rowFor, rowsOf } from './catalogue/table.js';
import { EXPECT_BOUND_RULES, FOREIGN_EXPECT_FORM } from './catalogue/foreign-expect.js';
import { createEnv, type ReceiverContext } from './receiver-forms.js';
import { exportTable } from './rules/module-exports.js';
import { isExpectExport } from './rules/proof.js';
import type { N, PackageExport, ResolveEnv, Result, ScopeFile } from './rules/proof.js';
import { lookup, playwrightExpect } from './rules/scope-resolve.js';
import { awaitedAssertionRoots, FLOATING_CALLBACK_RULE } from './rules/no-floating-callback-assertion.js';

export { EXPECT_BOUND_RULES, FOREIGN_EXPECT_FORM };

/** Switch for the unit test that compares the findings with the step on and off. */
export const expectBinding = { enabled: true };

/** Assertion libraries whose `expect` or `assert` is proven foreign. A closed list: any other package is "not resolved". */
export const FOREIGN_PACKAGES: readonly string[] = ['chai', '@jest/globals', 'vitest', 'expect', 'node:assert'];
/** Exports of those packages that are an `expect` or an `assert`: by name, as the default export, or as the module object of a `require`. */
const FOREIGN_EXPORTS = new Set(['expect', 'assert', 'default', '*']);
/** Forms that win over `foreign-expect` (form precedence: `api-under-test` > `foreign-expect` > `unresolved` > shape forms > `-`). */
const STRONGER_FORMS = new Set(['api-under-test']);

export type Binding =
  | { kind: 'playwright' }
  | { kind: 'foreign'; package: string }
  /** `at` is where the proof stopped: a file relative to the report base, and a line. */
  | { kind: 'unresolved'; at: string };

export interface ExpectUse {
  binding: Binding;
  /** The expect chain is the operand of `void`. */
  voided: boolean;
}

const norm = (rule: string): string => rule.replace(/^playwright-score\//, 'pwscore/');
const isExpectBound = (f: Pick<Finding, 'rule' | 'form'>): boolean =>
  EXPECT_BOUND_RULES.includes(norm(f.rule)) && !(f.rule === 'playwright/missing-playwright-await' && f.form === 'action');

/** Another identifier read as `expect` at a finding: a proven alias, for an alias finding only (S4b.2). */
type AlsoExpect = (sf: ScopeFile, id: N) => boolean;
/** The findings the alias pass added (src/expect-alias.ts), and its proof that an identifier is an alias. */
export interface AddedAliasFindings {
  findings: ReadonlySet<Finding>;
  isAlias(env: ResolveEnv, sf: ScopeFile, id: N): boolean;
}

const positions = new WeakMap<ScopeFile, Map<string, N[]>>();
const proofs = new WeakMap<object, Result<PackageExport>>();
const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const size = (n: N): number => (Array.isArray(n.range) ? n.range[1] - n.range[0] : Number.MAX_SAFE_INTEGER);

/** The smallest node that starts at an ESLint (1-based column) position. */
function nodeAt(sf: ScopeFile, line: number, column: number): N | undefined {
  let index = positions.get(sf);
  if (!index) {
    index = new Map();
    for (const n of sf.parents.keys()) {
      const start = n.loc?.start as { line: number; column: number } | undefined;
      if (!start) continue;
      const key = `${start.line}:${start.column + 1}`;
      const list = index.get(key);
      if (list) list.push(n);
      else index.set(key, [n]);
    }
    positions.set(sf, index);
  }
  let best: N | undefined;
  for (const n of index.get(`${line}:${column}`) ?? []) if (!best || size(n) < size(best)) best = n;
  if (best) return best;
  // No node starts there (the plugin reports the empty argument list of `expect()` this way): the smallest node around it.
  const before = (a: { line: number; column: number }, l: number, c: number): boolean => a.line < l || (a.line === l && a.column <= c);
  for (const n of sf.parents.keys()) {
    const loc = n.loc as { start: { line: number; column: number }; end: { line: number; column: number } } | undefined;
    if (!loc || !before(loc.start, line, column - 1) || before(loc.end, line, column - 2)) continue;
    if (!best || size(n) < size(best)) best = n;
  }
  return best;
}

/** The identifier a call chain starts with: `expect` in `await expect.soft(x).not.toBe(1)`. */
function chainRoot(node: N | null | undefined): N | undefined {
  let n = node ?? undefined;
  for (let i = 0; n && i < 64; i++) {
    switch (n.type) {
      case 'Identifier':
        return n;
      case 'CallExpression':
        n = n.callee;
        break;
      case 'MemberExpression':
        n = n.object;
        break;
      case 'AwaitExpression':
        n = n.argument;
        break;
      case 'TaggedTemplateExpression':
        n = n.tag;
        break;
      case 'ChainExpression':
      case 'TSNonNullExpression':
      case 'TSAsExpression':
      case 'TSSatisfiesExpression':
      case 'TSTypeAssertion':
      case 'ExpressionStatement':
        n = n.expression;
        break;
      case 'UnaryExpression':
        n = n.operator === 'void' ? n.argument : undefined;
        break;
      default:
        return undefined;
    }
  }
  return undefined;
}

/**
 * Is this identifier one the rules read as `expect`? The upstream plugin reads `expect`, any name that ends in
 * `Expect`, and a named import of `expect` under another local name; the scorer's own rules read `expect` only.
 */
export function readAsExpect(sf: ScopeFile, id: N): boolean {
  const name = id.name as string;
  if (/(^expect|Expect)$/.test(name)) return true;
  const defs = (lookup(sf, id, name)?.defs ?? []) as N[];
  return defs.some((d) => d.type === 'ImportBinding' && d.node?.type === 'ImportSpecifier' && (d.node.imported?.name ?? d.node.imported?.value) === 'expect');
}

/**
 * The `expect` identifier of the finding at this position: the root of the chain that starts there, of the chain
 * the reported matcher belongs to, or of the nearest enclosing chain inside the same function.
 */
function expectHeads(sf: ScopeFile, line: number, column: number, also?: AlsoExpect): N[] {
  let n = nodeAt(sf, line, column);
  for (let i = 0; n && i < 64; i++) {
    const root = chainRoot(n);
    if (root && (readAsExpect(sf, root) || also?.(sf, root))) {
      // An identifier that is only a property (`x.expect`) is not the start of a chain.
      const p = sf.parents.get(root);
      if (!(p?.type === 'MemberExpression' && p.property === root && !p.computed)) return [root];
    }
    // The plugin reports a stored read (`const shown = await row.isVisible()`) at the read: its expects are the ones the name is passed to.
    if (n.type === 'VariableDeclarator') return n.id?.type === 'Identifier' ? expectsOf(sf, n.id, also) : [];
    if (FUNCTIONS.has(n.type)) return [];
    n = sf.parents.get(n);
  }
  return [];
}

/**
 * QAG-287 S7a: a floating-callback finding sits on the `forEach` / `map` name. Its `expect`s are those of the awaited
 * assertions in the call's async callback.
 */
function callbackHeads(sf: ScopeFile, line: number, column: number): N[] {
  const name = nodeAt(sf, line, column);
  const member = name ? sf.parents.get(name) : undefined;
  const call = member ? sf.parents.get(member) : undefined;
  if (member?.type !== 'MemberExpression' || member.property !== name || call?.type !== 'CallExpression' || call.callee !== member) return [];
  const callback = (call.arguments as N[])[0];
  return callback ? awaitedAssertionRoots(callback, (id) => readAsExpect(sf, id)) : [];
}

/** The `expect` identifier of every call the variable declared by `id` is passed to as an argument. */
function expectsOf(sf: ScopeFile, id: N, also?: AlsoExpect): N[] {
  const heads: N[] = [];
  const variable = lookup(sf, id, id.name as string);
  for (const ref of (variable?.references ?? []) as N[]) {
    const use = ref.identifier as N;
    const call = use === id ? undefined : sf.parents.get(use);
    if (call?.type !== 'CallExpression' || !(call.arguments as N[]).includes(use)) continue;
    const root = chainRoot(call);
    if (root && (readAsExpect(sf, root) || also?.(sf, root)) && !heads.includes(root)) heads.push(root);
  }
  return heads;
}

/** Is the chain that starts with `head` the operand of `void`? */
function isVoided(sf: ScopeFile, head: N): boolean {
  let child = head;
  for (let p = sf.parents.get(child); p; child = p, p = sf.parents.get(p)) {
    if (p.type === 'UnaryExpression') return p.operator === 'void';
    const up =
      (p.type === 'CallExpression' && p.callee === child) ||
      (p.type === 'MemberExpression' && p.object === child) ||
      (p.type === 'TaggedTemplateExpression' && p.tag === child) ||
      p.type === 'ChainExpression' || p.type === 'TSNonNullExpression' || p.type === 'TSAsExpression' || p.type === 'TSSatisfiesExpression' || p.type === 'TSTypeAssertion';
    if (!up) return false;
  }
  return false;
}

const relative = (ctx: ReceiverContext, file: string, line: number): string => {
  const rel = (path.relative(ctx.filesBase, file) || path.basename(file)).split(path.sep).join('/');
  return line > 0 ? `${rel}:${line}` : rel;
};

/** What one `expect` identifier denotes. */
function useOf(env: ResolveEnv, ctx: ReceiverContext, sf: ScopeFile, head: N, file: string, line: number): ExpectUse {
  const voided = isVoided(sf, head);
  // One proof per binding: every finding on the same `expect` variable shares it.
  const variable = lookup(sf, head, head.name as string) as N | undefined;
  let d = variable ? proofs.get(variable) : undefined;
  if (!d) {
    d = playwrightExpect(env, sf, head);
    if (variable) proofs.set(variable, d);
  }
  if (!d.ok) return { binding: { kind: 'unresolved', at: d.at.file ? relative(ctx, d.at.file, d.at.line) : relative(ctx, file, line) }, voided };
  if (isExpectExport(d.value)) return { binding: { kind: 'playwright' }, voided };
  if (!d.value.playwright && FOREIGN_PACKAGES.includes(d.value.package) && FOREIGN_EXPORTS.has(d.value.name)) return { binding: { kind: 'foreign', package: d.value.package }, voided };
  // A proven export that is neither Playwright's expect nor on the foreign list: the reason points at the declaration.
  const declared = (variable?.defs?.[0]?.node?.loc?.start?.line as number | undefined) ?? line;
  return { binding: { kind: 'unresolved', at: relative(ctx, file, declared) }, voided };
}

type Located = Pick<Finding, 'rule' | 'file' | 'line' | 'column' | 'form'>;

/** The parsed spec file and the `expect` identifiers of a finding, or undefined when it has none. May throw. */
export function findingHeads(env: ResolveEnv, ctx: ReceiverContext, f: Located, also?: AlsoExpect): { sf: ScopeFile; heads: N[] } | undefined {
  if (!isExpectBound(f) || typeof f.file !== 'string' || typeof f.line !== 'number' || typeof f.column !== 'number') return undefined;
  const file = path.resolve(ctx.filesBase, f.file);
  // The spec file is the text that was scored: never a second read from disk.
  const sf = typeof ctx.sources.get(file) === 'string' ? env.load(file) : undefined;
  const heads = sf ? expectHeads(sf, f.line, f.column, also) : [];
  return sf && heads.length > 0 ? { sf, heads } : undefined;
}

/** What the `expect` of a finding denotes, or undefined when the finding has no `expect` at its position. Never throws. */
export function expectUse(env: ResolveEnv, ctx: ReceiverContext, f: Located, also?: AlsoExpect): ExpectUse | undefined {
  if (!isExpectBound(f) || typeof f.file !== 'string' || typeof f.line !== 'number' || typeof f.column !== 'number') return undefined;
  const file = path.resolve(ctx.filesBase, f.file);
  const here: Binding = { kind: 'unresolved', at: relative(ctx, file, f.line) };
  try {
    // The spec file is the text that was scored: never a second read from disk.
    const sf = typeof ctx.sources.get(file) === 'string' ? env.load(file) : undefined;
    if (!sf) return undefined;
    const heads = f.rule === FLOATING_CALLBACK_RULE ? callbackHeads(sf, f.line, f.column) : expectHeads(sf, f.line, f.column, also);
    if (heads.length === 0) return undefined;
    if (exportTable(sf).reflection) return { binding: here, voided: heads.every((h) => isVoided(sf, h)) };
    // Several expects (a stored read passed to more than one): Playwright's if any is, else not resolved if any is not, else foreign.
    const uses = heads.map((head) => useOf(env, ctx, sf, head, file, f.line as number));
    return uses.find((u) => u.binding.kind === 'playwright') ?? uses.find((u) => u.binding.kind === 'unresolved') ?? uses[0];
  } catch {
    return { binding: here, voided: false };
  }
}

interface Mark {
  use: ExpectUse;
  /** The form the finding had before this step (undefined: the rule's default row). */
  form: string | undefined;
}
const marks = new WeakMap<Finding, Mark>();

/** The reason a finding with an unresolved binding carries, in its `what`. */
export const unresolvedReason = (at: string): string => `expect binding not resolved (global or unknown package) in ${at}`;

/** A certain finding on a `void`-ed expect is reported as likely; every other tier stays. */
export const voidedTier = <T extends string>(tier: T): T | 'likely' => (tier === 'certain' ? 'likely' : tier);

/**
 * Before the catalogue fields are added: sets form `foreign-expect` on a finding whose `expect` is proven foreign,
 * and remembers the findings whose binding is not resolved or whose expect is `void`-ed. In place; no finding is
 * added, removed or otherwise changed, and nothing here throws.
 */
export function applyExpectBinding(findings: Finding[], ctx: ReceiverContext, added?: AddedAliasFindings): void {
  if (!expectBinding.enabled) return;
  const isAlias = added?.isAlias;
  let env: ResolveEnv | undefined;
  for (const f of findings) {
    if (!isExpectBound(f) || (f.form !== undefined && STRONGER_FORMS.has(f.form))) continue;
    // A rule with one shape gets that form here: the `foreign-expect` cell must not leave its other findings without one.
    if (f.form === undefined) {
      const shapes = rowsOf(f.rule).filter((r) => r.form !== FOREIGN_EXPECT_FORM);
      if (shapes.length === 1) f.form = shapes[0].form;
    }
    let use: ExpectUse | undefined;
    try {
      const e = (env ??= createEnv(ctx));
      // An alias finding (S4b.2) also reads the proven alias at its position as `expect`; every other finding is as before.
      use = expectUse(e, ctx, f, isAlias && added?.findings.has(f) ? (sf, id) => isAlias(e, sf, id) : undefined);
    } catch {
      use = undefined;
    }
    if (!use || (use.binding.kind === 'playwright' && !use.voided)) continue;
    marks.set(f, { use, form: f.form });
    if (use.binding.kind === 'foreign') f.form = FOREIGN_EXPECT_FORM;
  }
}

/**
 * Right after applyExpectBinding: a finding moved to form `foreign-expect` whose rule has no such cell is dropped, in
 * place (QAG-287 S7a: an async callback whose assertions all come from another library is not a floating Playwright
 * assertion). Every other finding stays.
 */
export function dropForeignWithoutCell(findings: Finding[]): void {
  for (let i = findings.length - 1; i >= 0; i--) {
    const f = findings[i];
    if (f.form === FOREIGN_EXPECT_FORM && marks.has(f) && !rowFor(f.rule, FOREIGN_EXPECT_FORM)) findings.splice(i, 1);
  }
}

/**
 * After the catalogue fields are added. A foreign finding keeps the family, basis and docs of the row it came
 * from. An unresolved binding gives tier `needs-check` and the reason. A `void`-ed expect is never certain.
 */
export function settleExpectBinding(findings: Finding[]): void {
  for (const f of findings) {
    const mark = marks.get(f);
    if (!mark) continue;
    const { binding, voided } = mark.use;
    if (binding.kind === 'foreign') {
      const from = (mark.form !== undefined ? rowFor(f.rule, mark.form) : undefined) ?? defaultRow(f.rule);
      if (from) {
        f.family = from.family;
        f.basis = from.basis;
        if (from.docs) f.docs = from.docs;
        else delete f.docs;
      }
      continue;
    }
    if (binding.kind === 'unresolved') {
      f.tier = 'needs-check';
      f.what = `${f.what ?? ''} The scorer could not confirm that this expect is the one from Playwright: ${unresolvedReason(binding.at)}.`.trim();
      f.fix = `First check where this expect comes from. If it is the one from Playwright: ${f.fix ?? ''}`.trim();
    } else if (voided && f.tier) {
      f.tier = voidedTier(f.tier);
    }
  }
}
