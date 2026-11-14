/**
 * Post-lint triage of two upstream rules whose own checks cannot see across
 * files or tell a guard from real branching (QAG-287):
 *
 * - `playwright/expect-expect` only sees `expect(...)` written in the test
 *   body. A test that asserts through a page-object method, an injected
 *   fixture or an imported helper was reported as "no assertion" at error
 *   severity even though the assertion runs. Each such finding is resolved
 *   here: dropped when a fixture the test uses is known to assert, turned
 *   into a report-only "needs a human check" finding when the test calls
 *   something this static scan cannot read, and kept as the error it is
 *   when every call resolves to code we could read (or is plain Playwright
 *   API on `page`, `request`, ...).
 * - `playwright/valid-expect` fires on a helper whose name ends in
 *   "Expect" (`clickSortableHeaderAndExpect(...)`) as if it were expect().
 * - `playwright/no-conditional-in-test` fires on a guard whose only body is
 *   `throw`. That is an assertion in disguise, not branching test logic.
 *
 * Purely syntactic and name-based, like the rest of this package: a
 * resolved-by-name match is the same trade-off `assertFunctionNames` makes.
 */
import path from 'node:path';
import { parseForESLint } from '@typescript-eslint/parser';
import { resolveRelativeImport } from './import-graph.js';
import { PLAYWRIGHT_API_METHODS } from './playwright-api-names.js';
import type { Finding } from './types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

export const ASSERTION_UNVERIFIED_RULE = 'playwright-score/assertion-unverified';

/** Identifiers whose calls are Playwright API or the language runtime, never a hidden assertion helper. */
const NEUTRAL_ROOTS = new Set([
  'page', 'context', 'request', 'browser', 'browserName', 'baseURL', 'testInfo', 'playwright',
  'expect', 'test', 'it', 'describe', 'console', 'Promise', 'JSON', 'Math', 'Date', 'Object',
  'Array', 'String', 'Number', 'Boolean', 'process', 'setTimeout', 'setInterval', 'require',
  'URL', 'Buffer', 'fetch', 'undefined', 'globalThis', 'window', 'document',
]);

const ASSERTIONISH_PREFIX = /^(assert|verify|check|validate|expect|ensure|should|confirm)/i;
const ASSERTIONISH_TO = /^to[A-Z]/;

/**
 * Only a method whose NAME reads like an assertion may be a hidden one:
 * `app.waitForLoad()` or `users.list()` on an unreadable object is just an
 * unverified call, and the test stays an expect-expect error. A Playwright
 * action on a locator chain (`po.locator('x').check()`) is not one either.
 */
function isAssertionLikeCall(name: string, callee: N): boolean {
  if (!ASSERTIONISH_PREFIX.test(name) && !ASSERTIONISH_TO.test(name)) return false;
  if (!PLAYWRIGHT_API_METHODS.has(name)) return true;
  const recv = callee?.type === 'MemberExpression' ? callee.object : undefined;
  const inner = recv?.type === 'AwaitExpression' ? recv.argument : recv;
  const m = inner?.type === 'CallExpression' ? inner.callee : undefined;
  return !(m?.type === 'MemberExpression' && m.property?.type === 'Identifier' && PLAYWRIGHT_API_METHODS.has(m.property.name));
}

function walk(node: N, visit: (n: N, parent: N | undefined) => void, parent?: N): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit, parent);
    return;
  }
  if (typeof node.type !== 'string') return;
  visit(node, parent);
  for (const key of Object.keys(node)) {
    if (key === 'parent') continue;
    const v = node[key];
    if (v && typeof v === 'object') walk(v, visit, node);
  }
}

type AstCache = Map<string, N>;
function parse(astCache: AstCache, source: string, file: string): N {
  const hit = astCache.get(file);
  if (hit && hit.source === source) return hit.ast;
  let ast: N;
  try {
    ast = parseForESLint(source, {
      ecmaVersion: 2022,
      sourceType: 'module',
      ecmaFeatures: { jsx: /\.(tsx|jsx)$/.test(file) },
    }).ast;
  } catch {
    ast = undefined;
  }
  astCache.set(file, { source, ast });
  return ast;
}

function isExpectCall(n: N): boolean {
  if (n?.type !== 'CallExpression') return false;
  const c = n.callee;
  if (c?.type === 'Identifier' && c.name === 'expect') return true;
  return c?.type === 'MemberExpression' && c.object?.type === 'Identifier' && c.object.name === 'expect';
}

function containsExpect(node: N): boolean {
  let found = false;
  walk(node, (n) => {
    if (!found && isExpectCall(n)) found = true;
  });
  return found;
}

function isFn(n: N): boolean {
  return n?.type === 'ArrowFunctionExpression' || n?.type === 'FunctionExpression';
}

function propKeyName(p: N): string | undefined {
  if (p?.type !== 'Property' && p?.type !== 'ObjectProperty') return undefined;
  if (p.key?.type === 'Identifier' && !p.computed) return p.key.name;
  if (p.key?.type === 'Literal' && typeof p.key.value === 'string') return p.key.value;
  return undefined;
}

export interface TriageContext {
  /** Directory the findings' `file` paths are relative to. */
  filesBase: string;
  /** Scored spec files, absolute path -> source. */
  sources: Map<string, string>;
  /** Locally imported dependency files (page objects, fixtures), absolute path -> source. */
  importedFiles: Map<string, string>;
  /** Directory relative imports may not climb out of (defaults to filesBase). */
  importBoundary?: string;
}

interface Knowledge {
  /** Every function / method / class name declared in any readable file. */
  defined: Set<string>;
  /**
   * Per file: names of `test.extend({...})` fixtures that hand a CALLABLE
   * containing an expect(...) to `use(...)`. Expects in fixture setup or
   * teardown do not count, and neither does a fixture named like a built-in
   * Playwright fixture (`page`, `context`, ...).
   */
  assertingFixtures: Map<string, Set<string>>;
  cache: AstCache;
}

/** Does the fixture function hand a function containing expect(...) to use(...)? */
function usesAssertingCallable(fixtureFn: N): boolean {
  const p1 = fixtureFn.params?.[1];
  const useName = p1?.type === 'Identifier' ? p1.name : 'use';
  let found = false;
  walk(fixtureFn.body, (n) => {
    if (found || n.type !== 'CallExpression' || n.callee?.type !== 'Identifier' || n.callee.name !== useName) return;
    if ((n.arguments ?? []).some((a: N) => isFn(a) && containsExpect(a))) found = true;
  });
  return found;
}

function gather(ctx: TriageContext, cache: AstCache): Knowledge {
  const defined = new Set<string>();
  const assertingFixtures = new Map<string, Set<string>>();
  const all = [...ctx.sources, ...ctx.importedFiles];
  for (const [file, source] of all) {
    const ast = parse(cache, source, file);
    if (!ast) continue;
    walk(ast, (n) => {
      if (n.type === 'FunctionDeclaration' && n.id?.name) defined.add(n.id.name);
      else if (n.type === 'ClassDeclaration' && n.id?.name) defined.add(n.id.name);
      else if (n.type === 'VariableDeclarator' && n.id?.type === 'Identifier' && isFn(n.init)) {
        defined.add(n.id.name);
      } else if (n.type === 'MethodDefinition' && !n.computed && n.key?.type === 'Identifier') {
        defined.add(n.key.name);
      } else if (n.type === 'PropertyDefinition' && !n.computed && n.key?.type === 'Identifier' && isFn(n.value)) {
        defined.add(n.key.name);
      } else if (n.type === 'Property' && isFn(n.value)) {
        const k = propKeyName(n);
        if (k) defined.add(k);
      } else if (
        n.type === 'CallExpression' &&
        n.callee?.type === 'MemberExpression' &&
        n.callee.property?.name === 'extend' &&
        n.arguments?.[0]?.type === 'ObjectExpression'
      ) {
        for (const p of n.arguments[0].properties ?? []) {
          const k = propKeyName(p);
          if (!k || NEUTRAL_ROOTS.has(k) || !isFn(p.value) || !usesAssertingCallable(p.value)) continue;
          if (!assertingFixtures.has(file)) assertingFixtures.set(file, new Set());
          assertingFixtures.get(file)!.add(k);
        }
      }
    });
  }
  return { defined, assertingFixtures, cache };
}

/** Root identifier / expression of a call or member chain. */
function chainRoot(node: N): N {
  let cur = node;
  for (let i = 0; i < 64 && cur; i++) {
    if (cur.type === 'AwaitExpression') cur = cur.argument;
    else if (cur.type === 'TSNonNullExpression' || cur.type === 'ChainExpression') cur = cur.expression;
    else if (cur.type === 'TSAsExpression' || cur.type === 'TSTypeAssertion') cur = cur.expression;
    else if (cur.type === 'CallExpression') cur = cur.callee;
    else if (cur.type === 'MemberExpression') cur = cur.object;
    else break;
  }
  return cur;
}

type Kind = 'neutral' | 'external' | 'lib';

function importKind(specifier: string): 'external' | 'lib' {
  if (specifier.startsWith('.') || /^(@\/|~\/|#|src\/|tests?\/|e2e\/|pages\/|fixtures\/|utils?\/|lib\/)/.test(specifier)) {
    return 'external';
  }
  return 'lib';
}

/**
 * Calls inside a test callback whose receiver lives somewhere this scan
 * cannot read: names of those calls (empty when every call is plain
 * Playwright API, a same-file/readable helper, or a utility library).
 */
function unresolvedCalls(testCall: N, ast: N, know: Knowledge): string[] {
  const fn = [...(testCall.arguments ?? [])].reverse().find(isFn);
  if (!fn) return [];
  const imports = new Map<string, 'external' | 'lib'>();
  for (const stmt of ast.body ?? []) {
    if (stmt.type !== 'ImportDeclaration' || typeof stmt.source?.value !== 'string') continue;
    for (const s of stmt.specifiers ?? []) {
      if (s.local?.name) imports.set(s.local.name, importKind(stmt.source.value));
    }
  }
  const kinds = new Map<string, Kind>();
  const first = fn.params?.[0];
  if (first?.type === 'ObjectPattern') {
    for (const p of first.properties ?? []) {
      const local = p.value?.type === 'AssignmentPattern' ? p.value.left : p.value;
      const name = local?.type === 'Identifier' ? local.name : undefined;
      if (name) kinds.set(name, NEUTRAL_ROOTS.has(propKeyName(p) ?? name) ? 'neutral' : 'external');
    }
  }
  const rootKind = (root: N): Kind => {
    if (root?.type === 'NewExpression') {
      const cls = root.callee?.name;
      return cls && know.defined.has(cls) ? 'neutral' : 'external';
    }
    if (root?.type !== 'Identifier') return 'neutral';
    const local = kinds.get(root.name);
    if (local) return local;
    if (NEUTRAL_ROOTS.has(root.name)) return 'neutral';
    return imports.get(root.name) ?? 'neutral';
  };

  const unresolved: string[] = [];
  walk(fn.body, (n) => {
    if (n.type === 'VariableDeclarator' && n.id?.type === 'Identifier' && n.init) {
      kinds.set(n.id.name, rootKind(chainRoot(n.init)));
      return;
    }
    if (n.type !== 'CallExpression') return;
    const c = n.callee;
    let name: string | undefined;
    if (c?.type === 'Identifier') name = c.name;
    else if (c?.type === 'MemberExpression' && !c.computed && c.property?.type === 'Identifier') name = c.property.name;
    if (!name || know.defined.has(name)) return;
    const kind = rootKind(chainRoot(c));
    if ((kind === 'external' || kind === 'lib') && isAssertionLikeCall(name, c)) unresolved.push(name);
  });
  return unresolved;
}

/** The spec file plus every file reachable from it through relative imports / re-exports. */
function reachableFiles(spec: string, ctx: TriageContext, know: Knowledge): Set<string> {
  const boundary = ctx.importBoundary ?? ctx.filesBase;
  const seen = new Set<string>([spec]);
  const queue = [spec];
  while (queue.length) {
    const file = queue.pop()!;
    const source = ctx.sources.get(file) ?? ctx.importedFiles.get(file);
    const ast = source === undefined ? undefined : parse(know.cache, source, file);
    for (const stmt of ast?.body ?? []) {
      const spec2 = stmt.source?.value;
      if (typeof spec2 !== 'string' || !spec2.startsWith('.')) continue;
      const target = resolveRelativeImport(file, spec2, boundary);
      if (target && !seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }
  return seen;
}

/** Local names of destructured test args that are asserting fixtures reachable from this spec. */
function assertingFixtureLocals(testFn: N, reachable: Set<string>, know: Knowledge): Set<string> {
  const locals = new Set<string>();
  for (const p of testFn?.params?.[0]?.properties ?? []) {
    const key = propKeyName(p);
    if (!key || NEUTRAL_ROOTS.has(key)) continue;
    if (![...reachable].some((f) => know.assertingFixtures.get(f)?.has(key))) continue;
    const local = p.value?.type === 'AssignmentPattern' ? p.value.left : p.value;
    if (local?.type === 'Identifier') locals.add(local.name);
  }
  return locals;
}

/** Does the body call `name(...)` directly (the fixture is invoked, not merely destructured)? */
function callsAny(body: N, names: Set<string>): boolean {
  let found = false;
  walk(body, (n) => {
    if (!found && n.type === 'CallExpression' && n.callee?.type === 'Identifier' && names.has(n.callee.name)) found = true;
  });
  return found;
}

function findCall(ast: N, line: number, col0: number): N | undefined {
  let hit: N;
  walk(ast, (n) => {
    if (!hit && n.type === 'CallExpression' && n.loc?.start.line === line && n.loc.start.column === col0) hit = n;
  });
  return hit;
}

function findIf(ast: N, line: number, col0: number): N | undefined {
  let hit: N;
  walk(ast, (n) => {
    if (!hit && n.type === 'IfStatement' && n.loc?.start.line === line && n.loc.start.column === col0) hit = n;
  });
  return hit;
}

function isThrowOnly(stmt: N): boolean {
  if (stmt?.type === 'ThrowStatement') return true;
  return stmt?.type === 'BlockStatement' && stmt.body?.length === 1 && stmt.body[0].type === 'ThrowStatement';
}

export function triageFindings(findings: Finding[], ctx: TriageContext): Finding[] {
  const wants = findings.some(
    (f) =>
      f.rule === 'playwright/expect-expect' ||
      f.rule === 'playwright/no-conditional-in-test' ||
      f.rule === 'playwright/valid-expect'
  );
  if (!wants) return findings;
  const cache: AstCache = new Map(); // per call: nothing leaks between scorePaths runs
  const know = gather(ctx, cache);
  const out: Finding[] = [];
  for (const f of findings) {
    if (
      (f.rule !== 'playwright/expect-expect' &&
        f.rule !== 'playwright/no-conditional-in-test' &&
        f.rule !== 'playwright/valid-expect') ||
      f.line === undefined ||
      f.column === undefined
    ) {
      out.push(f);
      continue;
    }
    const abs = path.resolve(ctx.filesBase, f.file);
    const source = ctx.sources.get(abs);
    const ast = source === undefined ? undefined : parse(cache, source, abs);
    if (!ast) {
      out.push(f);
      continue;
    }
    if (f.rule === 'playwright/valid-expect') {
      // Upstream treats any callee whose name merely ends in "Expect"
      // (`clickSortableHeaderAndExpect(header, 'ascending')`) as an expect()
      // call missing its matcher. Only the real `expect` is one.
      const node = findCall(ast, f.line, f.column - 1);
      const callee = node?.callee;
      const isRealExpect =
        callee?.type === 'Identifier'
          ? callee.name === 'expect'
          : callee?.type === 'MemberExpression' && callee.object?.name === 'expect';
      if (node && !isRealExpect) continue;
      out.push(f);
      continue;
    }
    if (f.rule === 'playwright/no-conditional-in-test') {
      const node = findIf(ast, f.line, f.column - 1);
      if (node && !node.alternate && isThrowOnly(node.consequent)) continue; // a guard, not branching
      out.push(f);
      continue;
    }
    const call = findCall(ast, f.line, f.column - 1);
    if (!call) {
      out.push(f);
      continue;
    }
    const fn = [...(call.arguments ?? [])].reverse().find(isFn);
    const fixtureLocals = assertingFixtureLocals(fn, reachableFiles(abs, ctx, know), know);
    if (fixtureLocals.size > 0 && callsAny(fn.body, fixtureLocals)) continue; // a callable fixture that asserts is invoked
    const calls = [...new Set(unresolvedCalls(call, ast, know))];
    if (calls.length === 0) {
      out.push(f);
      continue;
    }
    out.push({
      ...f,
      rule: ASSERTION_UNVERIFIED_RULE,
      severity: 'info',
      reportOnly: true,
      message:
        `Needs a human check: no expect(...) in this test body, but it calls ${calls
          .slice(0, 3)
          .map((c) => `${c}()`)
          .join(', ')}${calls.length > 3 ? ', ...' : ''} on an object defined elsewhere (page object, injected fixture or ` +
        'imported helper) that this scan cannot read, so the assertion may live there. Not counted against the score.',
    });
  }
  return out;
}
