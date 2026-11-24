/**
 * Test states (QAG-287 S12): one state per test, first match wins.
 *
 *  excluded-empty    the test callback contains no call expression;
 *  excluded-skipped  `test.skip/fixme(title, fn)`, a test inside `describe.skip/fixme`, or a body
 *                    whose first statement is an unconditional `test.skip()` / `test.fixme()`
 *                    (no argument, or a literal `true`; a conditional skip does not exclude);
 *  issue             a certain finding in the test or in a hook that is in scope for it;
 *  unasserted        no assertion is reachable and every callee was resolved;
 *  unverified        no assertion was found and at least one callee was not resolved (named);
 *  clean             an assertion is reachable.
 *
 * An assertion is (i) Playwright's `expect` with a matcher (also `expect.soft`, `expect.poll`,
 * `expect(...).toPass`), as the expect binding proves it (src/expect-binding.ts, by a call);
 * (ii) a call into an assertion library of catalogue/known-packages.json; (iii) a `throw` under
 * an `if` whose test is not a literal. An assertion that carries a `no-weak-assertion` or
 * `no-trivial-assertion` finding does not count. Assertions of a hook count for every test in
 * the hook's scope. Callees are resolved by src/test-callees.ts.
 *
 * Runs on the main thread, after the analysis. Trees come from the binding resolver's
 * environment (receiver-forms.ts `createEnv`), a fresh one per `FILES_PER_ENV` spec files so
 * the trees of a large suite are not all held at once. Two steps, like the expect binding:
 * `stageTestStates` reads the code before the catalogue fields exist, `settleTestStates`
 * decides `issue` once the tiers are known and adds one `pwscore/unasserted` finding per
 * unasserted test. An `issue` entry names its findings (`chargedBy`). The score is computed from
 * the states afterwards (src/state-score.ts); this step never touches it or any other finding.
 * Callees are resolved by src/test-callees.ts (syntax helpers in src/test-syntax.ts).
 */
import fs from 'node:fs';
import path from 'node:path';
import { decorateFindings, type SourceTexts } from './catalogue/decorate.js';
import { compareRefs, findingRef } from './finding-ref.js';
import { KNOWN_PACKAGES } from './catalogue/table.js';
import { EXPECT_BOUND_RULES, expectUse, type ExpectUse } from './expect-binding.js';
import type { TestSpans } from './metrics.js';
import { createEnv, type ReceiverContext } from './receiver-forms.js';
import type { N, ScopeFile } from './rules/proof.js';
import { strip } from './rules/scope-resolve.js';
import { valueOf, type CalleeCtx } from './test-callees.js';
import { chain, isFunction, text, walk } from './test-syntax.js';
import type { Finding, ScoreResult, TestState, TestStateEntry } from './types.js';

/** Switch for the unit test that compares a run with the step on and off. */
export const testStates = { enabled: true };
/** Files the last run's step parsed (one per file per environment). */
export const testStateStats = { parses: 0 };

export const UNASSERTED_RULE = 'pwscore/unasserted';
export const FILES_PER_ENV = 20;
const MAX_NAMES = 8;
const MAX_NESTING = 32;
const DISCOUNTING = new Set(['pwscore/no-weak-assertion', 'pwscore/no-trivial-assertion']);
const HOOKS = new Set(['beforeEach', 'afterEach', 'beforeAll', 'afterAll']);
const SKIPS = ['skip', 'fixme'];
const PROBE_RULE = EXPECT_BOUND_RULES.find((r) => r !== 'playwright/missing-playwright-await') ?? EXPECT_BOUND_RULES[0];
const norm = (rule: string): string => rule.replace(/^playwright-score\//, 'pwscore/');

interface Facts {
  asserts: boolean;
  unresolved: Set<string>;
}
interface Staged {
  entry: TestStateEntry;
  column: number;
  excluded?: TestState;
  facts: Facts;
  /** Line spans of the hooks in scope for the test. */
  hooks: Array<[number, number]>;
}
export interface StateInput {
  ctx: ReceiverContext;
  /** Test spans of every scored file, by its path relative to `ctx.filesBase`. */
  fileSpans: ReadonlyMap<string, TestSpans>;
  findings: readonly Finding[];
}

type Pos = { line: number; column: number };
const within = (loc: { start: Pos; end: Pos }, line: number, col: number): boolean =>
  (line > loc.start.line || (line === loc.start.line && col >= loc.start.column)) && (line < loc.end.line || (line === loc.end.line && col <= loc.end.column));
const functionArg = (call: N): N | undefined => [...((call.arguments ?? []) as N[])].reverse().find((a) => isFunction(a));

function analyzer(c: CalleeCtx, ctx: ReceiverContext, discounts: ReadonlyMap<string, Pos[]>) {
  const memo = new Map<N, Facts>();
  const active = new Set<N>();
  const uses = new Map<N, ExpectUse | null>();

  const useOf = (sf: ScopeFile, root: N): ExpectUse | null => {
    let use = uses.get(root);
    if (use === undefined) {
      const file = path.relative(ctx.filesBase, sf.file).split(path.sep).join('/');
      use = expectUse(c.env, ctx, { rule: PROBE_RULE, file, line: root.loc.start.line, column: root.loc.start.column + 1, form: undefined }) ?? null;
      uses.set(root, use);
    }
    return use;
  };
  /** Does the assertion chain this call belongs to carry a weak or trivial finding? */
  const discounted = (sf: ScopeFile, call: N): boolean => {
    let top = call;
    for (let p = sf.parents.get(top); p; top = p, p = sf.parents.get(p)) {
      const up = (p.type === 'MemberExpression' && p.object === top) || (p.type === 'CallExpression' && p.callee === top) || p.type === 'AwaitExpression' || strip(p) !== p;
      if (!up) break;
    }
    return (discounts.get(sf.file) ?? []).some((d) => within(top.loc, d.line, d.column));
  };
  /** A `throw` under an `if` whose test is not a literal constant, inside the same function. */
  const guarded = (sf: ScopeFile, node: N): boolean => {
    for (let p = sf.parents.get(node); p && !isFunction(p); p = sf.parents.get(p)) {
      if (p.type === 'IfStatement' && strip(p.test)?.type !== 'Literal') return true;
    }
    return false;
  };

  function factsOf(sf: ScopeFile, fn: N): Facts {
    const done = memo.get(fn);
    if (done) return done;
    if (active.has(fn)) return { asserts: false, unresolved: new Set() }; // a cycle adds nothing
    if (active.size >= MAX_NESTING) return { asserts: false, unresolved: new Set(['(call depth limit)']) };
    active.add(fn);
    const out: Facts = { asserts: false, unresolved: new Set() };
    walk(fn.body, (n) => {
      if (n.type === 'ThrowStatement') out.asserts ||= guarded(sf, n);
      if (n.type === 'NewExpression') {
        const v = valueOf(c, sf, n.callee);
        if (v.k === 'unres') out.unresolved.add(v.name);
      }
      if (n.type !== 'CallExpression') return;
      const { root } = chain(n.callee);
      const use = root ? useOf(sf, root) : null;
      if (use) {
        const b = use.binding;
        const library = b.kind === 'foreign' && KNOWN_PACKAGES.assertion.includes(b.package);
        // Playwright's expect asserts in its matcher call, not in `expect(x)` itself.
        if (b.kind === 'playwright' ? chain(n.callee).props.length > 0 && hasCall(n.callee) && !discounted(sf, n) : library && !discounted(sf, n)) out.asserts = true;
        else if (b.kind === 'unresolved' || (b.kind === 'foreign' && !library)) out.unresolved.add(root!.name);
        return;
      }
      const v = valueOf(c, sf, n.callee);
      if (v.k === 'assert') out.asserts ||= !discounted(sf, n);
      else if (v.k === 'unres') out.unresolved.add(v.name);
      else if (v.k === 'param') out.unresolved.add(text(n.callee));
      else if (v.k === 'fn') {
        const inner = factsOf(v.sf, v.node);
        out.asserts ||= inner.asserts;
        for (const name of inner.unresolved) out.unresolved.add(name);
      }
    });
    active.delete(fn);
    memo.set(fn, out);
    return out;
  }
  return factsOf;
}

/** Is there a call below this callee (`expect(x)` below `.toBe`)? */
function hasCall(callee: N | null | undefined): boolean {
  for (let n = strip(callee), i = 0; n && i < 64; i++) {
    if (n.type === 'CallExpression') return true;
    n = strip(n.type === 'MemberExpression' ? n.object : n.type === 'AwaitExpression' ? n.argument : undefined);
  }
  return false;
}

/** Does the callback contain a call expression anywhere (ADR: `excluded-empty` is a body with none)? */
function hasAnyCall(body: N | null | undefined): boolean {
  let found = false;
  walk(body, (n) => {
    found ||= n.type === 'CallExpression';
  });
  return found;
}

function stageFile(sf: ScopeFile, rel: string, spans: TestSpans, factsOf: (sf: ScopeFile, fn: N) => Facts): Staged[] {
  const calls = [...sf.parents.keys()].filter((n) => n.type === 'CallExpression' && functionArg(n));
  const size = (n: N): number => n.range[1] - n.range[0];
  const describesOf = (node: N): N[] => {
    const out: N[] = [];
    for (let child = node, p = sf.parents.get(node); p; child = p, p = sf.parents.get(p)) {
      if (p.type !== 'CallExpression' || !(p.arguments as N[]).includes(child)) continue;
      const { root, props } = chain(p.callee);
      if (props.includes('describe') || (root?.name === 'describe' && p.callee.type !== 'CallExpression')) out.push(p);
    }
    return out;
  };
  const hooks = calls
    .filter((n) => HOOKS.has(chain(n.callee).props.slice(-1)[0] ?? (n.callee.type === 'Identifier' ? n.callee.name : '')))
    .map((node) => ({ node, scope: describesOf(node)[0] as N | undefined }));
  return spans.tests.map((span, index) => {
    const entry: TestStateEntry = { file: rel, testKey: `${rel}#${index}`, line: span.startLine, state: 'unverified' };
    const node = calls.filter((n) => n.loc.start.line === span.startLine && n.loc.end.line === span.endLine && !chain(n.callee).props.includes('describe')).sort((a, b) => size(b) - size(a))[0];
    const fn = node ? functionArg(node) : undefined;
    if (!node || !fn) return { entry, column: 1, facts: { asserts: false, unresolved: new Set(['(test not located)']) }, hooks: [] };
    const { root, props } = chain(node.callee);
    const describes = describesOf(node);
    const first = fn.body?.type === 'BlockStatement' ? (fn.body.body[0] as N | undefined) : undefined;
    const lead = first?.type === 'ExpressionStatement' ? strip(first.expression?.type === 'AwaitExpression' ? first.expression.argument : first.expression) : undefined;
    const leadChain = lead?.type === 'CallExpression' ? chain(lead.callee) : undefined;
    // Unconditional: no argument, or a literal `true` (`test.skip(true, 'reason')`).
    const always = lead?.type === 'CallExpression' && (lead.arguments.length === 0 || strip(lead.arguments[0])?.value === true);
    const skipsFirst = !!leadChain && always && leadChain.props.length === 1 && SKIPS.includes(leadChain.props[0]) && !!root && leadChain.root?.name === root.name;
    let excluded: TestState | undefined;
    if (!hasAnyCall(fn.body)) excluded = 'excluded-empty';
    else if (props.some((p) => SKIPS.includes(p)) || describes.some((d) => chain(d.callee).props.some((p) => SKIPS.includes(p))) || skipsFirst) excluded = 'excluded-skipped';
    const scoped = hooks.filter((h) => !h.scope || describes.includes(h.scope));
    const facts: Facts = { asserts: false, unresolved: new Set() };
    if (!excluded) {
      for (const f of [fn, ...scoped.map((h) => functionArg(h.node)!)]) {
        const part = factsOf(sf, f);
        facts.asserts ||= part.asserts;
        for (const name of part.unresolved) facts.unresolved.add(name);
      }
    }
    return { entry, column: node.loc.start.column + 1, excluded, facts, hooks: scoped.map((h) => [h.node.loc.start.line, h.node.loc.end.line] as [number, number]) };
  });
}

const staged = new WeakMap<object, Staged[]>();

/** Reads the code of every counted test. Returns `result` unchanged; nothing here throws. */
export function stageTestStates<T extends object>(result: T, input: StateInput): T {
  testStateStats.parses = 0;
  if (!testStates.enabled) return result;
  const { ctx, fileSpans } = input;
  const all: Staged[] = [];
  // Every text the resolver reads is "a scored text" for the expect binding: specs, their imports, and what is read on the way.
  const sources = new Map<string, string>([...(ctx.importedFiles ?? []), ...ctx.sources]);
  const mine: ReceiverContext = { ...ctx, sources, importedFiles: undefined };
  const discounts = new Map<string, Pos[]>();
  for (const f of input.findings) {
    if (!DISCOUNTING.has(norm(f.rule)) || f.line === undefined || f.column === undefined) continue;
    const file = path.resolve(ctx.filesBase, f.file);
    discounts.set(file, [...(discounts.get(file) ?? []), { line: f.line, column: f.column - 1 }]);
  }
  const rels = [...fileSpans.keys()].filter((rel) => (fileSpans.get(rel)?.tests.length ?? 0) > 0).sort();
  for (let at = 0; at < rels.length; at += FILES_PER_ENV) {
    const inner = createEnv(mine);
    const seen = new Set<string>();
    const env = {
      runner: inner.runner,
      load(file: string): ScopeFile | undefined {
        if (!seen.has(file)) {
          seen.add(file);
          testStateStats.parses++;
          try {
            if (!sources.has(file)) sources.set(file, fs.readFileSync(file, 'utf8'));
          } catch {
            return undefined;
          }
        }
        return inner.load(file);
      },
    };
    const factsOf = analyzer({ env, boundary: ctx.importBoundary ?? ctx.filesBase, moduleResolver: ctx.moduleResolver }, mine, discounts);
    for (const rel of rels.slice(at, at + FILES_PER_ENV)) {
      const spans = fileSpans.get(rel)!;
      try {
        const sf = env.load(path.resolve(ctx.filesBase, rel));
        if (!sf) throw new Error('not parsed');
        all.push(...stageFile(sf, rel, spans, factsOf));
      } catch {
        spans.tests.forEach((span, index) =>
          all.push({ entry: { file: rel, testKey: `${rel}#${index}`, line: span.startLine, state: 'unverified' }, column: 1, facts: { asserts: false, unresolved: new Set(['(analysis error)']) }, hooks: [] })
        );
      }
    }
  }
  staged.set(result, all);
  return result;
}

/**
 * After the catalogue fields are added: decides each state, writes `testStates` (sorted by file,
 * then line), sets `summary.unassertedTests` to the number of unasserted tests and appends one
 * report-only `pwscore/unasserted` finding per such test, at the test's declaration.
 */
export function settleTestStates(result: ScoreResult, texts?: SourceTexts): void {
  if (!testStates.enabled) return;
  const added: Finding[] = [];
  // A spec-cell finding: scope `test` or `hook` (a shared-file finding has scope `shared` and never charges a test).
  const certain = result.findings.filter((f) => f.tier === 'certain' && f.line !== undefined);
  const entries = (staged.get(result) ?? []).map((s) => {
    const { entry, facts } = s;
    const by = certain.filter((f) => (f.scope === 'test' ? f.testKey === entry.testKey : f.scope === 'hook' && f.file === entry.file && s.hooks.some(([a, b]) => f.line! >= a && f.line! <= b)));
    entry.state = s.excluded ?? (by.length > 0 ? 'issue' : facts.asserts ? 'clean' : facts.unresolved.size > 0 ? 'unverified' : 'unasserted');
    if (entry.state === 'issue') entry.chargedBy = by.map(findingRef).sort(compareRefs);
    if (entry.state === 'unverified') entry.unresolved = [...facts.unresolved].sort().slice(0, MAX_NAMES);
    if (entry.state === 'unasserted') {
      added.push({
        rule: UNASSERTED_RULE,
        severity: 'info',
        message: 'This test has no assertion: every call in it was followed and none of them checks the application.',
        file: entry.file,
        line: entry.line,
        column: s.column,
        dimension: 'assertions',
        reportOnly: true,
        scope: 'test',
        testKey: entry.testKey,
      });
    }
    return entry;
  });
  entries.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
  result.testStates = entries;
  result.summary.unassertedTests = added.length;
  decorateFindings(added, result.baseDir, texts);
  result.findings.push(...added);
}
