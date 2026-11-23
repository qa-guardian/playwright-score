/**
 * Post-lint triage of two upstream rules whose own checks cannot see across
 * files or tell a guard from real branching (QAG-287):
 *
 * - `playwright/expect-expect` only sees `expect(...)` written in the test
 *   body. A test that asserts through a page-object method, an injected
 *   fixture or an imported helper was reported as "no assertion" at error
 *   severity even though the assertion runs. Each such finding is resolved
 *   here: dropped when a fixture the test uses is known to assert, turned
 *   into a report-only "not decided automatically" finding when the test calls
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
import { createModuleResolver, resolveImportSpecifier, type ImportResolver } from './import-graph.js';
import { PLAYWRIGHT_API_METHODS } from './playwright-api-names.js';
import type { Finding } from './types.js';
import { parseAst } from './parse-cache.js';

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

// Word-boundary, case-sensitive (same idea as the assertFunctionPatterns in
// eslint-runner.ts): `checkout`, `toISOString`, `toLowerCase` or `shop.checkout()`
// are not assertions, `checkFoo`, `assert_ok` and `toBeVisible` are.
const ASSERTIONISH_PREFIX = /^(assert|verify|check|validate|expect|ensure|should|confirm)([A-Z_0-9]|$)/;
const ASSERTIONISH_TO = /^to(Be|Have|Contain|Match|Equal|Throw)/;

/** JS / Node built-ins: `new Date().toISOString()` is never a page-object call. */
const BUILTIN_CLASSES = new Set([
  'Date', 'Map', 'Set', 'WeakMap', 'WeakSet', 'URL', 'URLSearchParams', 'Array', 'Error', 'TypeError',
  'RangeError', 'RegExp', 'Promise', 'Object', 'String', 'Number', 'Boolean', 'Buffer', 'Uint8Array',
  'ArrayBuffer', 'Intl', 'AbortController', 'TextEncoder', 'TextDecoder', 'FormData', 'Headers', 'Blob',
]);

/**
 * Only a method whose NAME reads like an assertion may be a hidden one:
 * `app.waitForLoad()` or `users.list()` on an unreadable object is just an
 * unverified call, and the test stays an expect-expect error. A name that is
 * a Playwright API verb (`check`, `fill`, `goto`) is an action whatever the
 * receiver: `loginPage.rememberMe.check()` is a locator held in a property.
 */
function isAssertionLikeCall(name: string): boolean {
  if (!ASSERTIONISH_PREFIX.test(name) && !ASSERTIONISH_TO.test(name)) return false;
  return !PLAYWRIGHT_API_METHODS.has(name);
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

/** The file's tree from the thread's parse cache (parse-cache.ts); undefined when it does not parse. */
function parse(source: string, file: string): N {
  try {
    return parseAst(source, file);
  } catch {
    return undefined;
  }
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
  /** Alias / workspace-package resolver shared with the import-graph walk (built from importBoundary when absent). */
  moduleResolver?: ImportResolver;
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
  /** Per file: every `test.extend({...})` fixture name, asserting or not. */
  fixtureKeys: Map<string, Set<string>>;
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

function gather(ctx: TriageContext): Knowledge {
  const defined = new Set<string>();
  const assertingFixtures = new Map<string, Set<string>>();
  const fixtureKeys = new Map<string, Set<string>>();
  const all = [...ctx.sources, ...ctx.importedFiles];
  for (const [file, source] of all) {
    const ast = parse(source, file);
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
          if (k) {
            if (!fixtureKeys.has(file)) fixtureKeys.set(file, new Set());
            fixtureKeys.get(file)!.add(k);
          }
          if (!k || NEUTRAL_ROOTS.has(k) || !isFn(p.value) || !usesAssertingCallable(p.value)) continue;
          if (!assertingFixtures.has(file)) assertingFixtures.set(file, new Set());
          assertingFixtures.get(file)!.add(k);
        }
      }
    });
  }
  return { defined, assertingFixtures, fixtureKeys };
}

/** Names bound by an identifier, object or array pattern. */
function boundNames(pat: N, out: string[] = []): string[] {
  if (!pat) return out;
  if (pat.type === 'Identifier') out.push(pat.name);
  else if (pat.type === 'ObjectPattern') for (const p of pat.properties ?? []) boundNames(p.type === 'RestElement' ? p.argument : p.value, out);
  else if (pat.type === 'ArrayPattern') for (const e of pat.elements ?? []) boundNames(e, out);
  else if (pat.type === 'AssignmentPattern') boundNames(pat.left, out);
  else if (pat.type === 'RestElement') boundNames(pat.argument, out);
  return out;
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
      if (cls && (BUILTIN_CLASSES.has(cls) || NEUTRAL_ROOTS.has(cls))) return 'neutral';
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
    if (n.type === 'VariableDeclarator' && n.init) {
      // `const x = ...` and destructuring (`const { a, b: [c] } = await ...`):
      // every bound name takes the kind of the initializer's root.
      const kind = rootKind(chainRoot(n.init));
      for (const bound of boundNames(n.id)) kinds.set(bound, kind);
      return;
    }
    if (n.type !== 'CallExpression') return;
    const c = n.callee;
    let name: string | undefined;
    if (c?.type === 'Identifier') name = c.name;
    else if (c?.type === 'MemberExpression' && !c.computed && c.property?.type === 'Identifier') name = c.property.name;
    if (!name || know.defined.has(name)) return;
    const kind = rootKind(chainRoot(c));
    if ((kind === 'external' || kind === 'lib') && isAssertionLikeCall(name)) unresolved.push(name);
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
    const ast = source === undefined ? undefined : parse(source, file);
    for (const stmt of ast?.body ?? []) {
      const spec2 = stmt.source?.value;
      if (typeof spec2 !== 'string') continue;
      const target = resolveImportSpecifier(file, spec2, boundary, ctx.moduleResolver);
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

/**
 * Fixtures the test destructures AND calls (`a11y()`) that no reachable file
 * defines, while its `test` comes from a non-relative module this scan does
 * not resolve (a tsconfig `paths` alias such as `@fx/base`, a workspace
 * package). The fixture may well assert there, so it is "unverified", not
 * "no assertion". Relative imports are followed by reachableFiles instead.
 */
function unresolvedFixtureCalls(call: N, ast: N, fn: N, reachable: Set<string>, know: Knowledge): string[] {
  const testRoot = chainRoot(call.callee);
  if (testRoot?.type !== 'Identifier') return [];
  const fromUnresolvedModule = (ast.body ?? []).some(
    (stmt: N) =>
      stmt.type === 'ImportDeclaration' &&
      typeof stmt.source?.value === 'string' &&
      !stmt.source.value.startsWith('.') &&
      !/^(@playwright\/|playwright|node:)/.test(stmt.source.value) &&
      (stmt.specifiers ?? []).some((sp: N) => sp.local?.name === testRoot.name)
  );
  if (!fromUnresolvedModule) return [];
  const out: string[] = [];
  for (const p of fn?.params?.[0]?.properties ?? []) {
    const key = propKeyName(p);
    if (!key || NEUTRAL_ROOTS.has(key)) continue;
    if ([...reachable].some((f) => know.fixtureKeys.get(f)?.has(key))) continue;
    const local = p.value?.type === 'AssignmentPattern' ? p.value.left : p.value;
    if (local?.type === 'Identifier' && callsAny(fn.body, new Set([local.name]))) out.push(key);
  }
  return out;
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

/**
 * `test.skip('title', fn)` / `test.fixme('title', fn)`: a declaration whose
 * first argument is a string and which has a body is skipped unconditionally
 * (the conditional forms take a boolean/function first, or are called inside
 * a test body with one argument). It never runs, so "no assertion" is noise;
 * the structure rules already penalise the skipped test.
 */
function isUnconditionalSkipDeclaration(call: N): boolean {
  const c = call.callee;
  if (c?.type !== 'MemberExpression' || c.computed || c.object?.type !== 'Identifier') return false;
  const prop = c.property?.name;
  if (prop !== 'skip' && prop !== 'fixme') return false;
  const args = call.arguments ?? [];
  if (args.length < 2) return false;
  const a0 = args[0];
  const titled = (a0?.type === 'Literal' && typeof a0.value === 'string') || a0?.type === 'TemplateLiteral';
  return titled && args.some(isFn);
}

export function triageFindings(findings: Finding[], ctx: TriageContext): Finding[] {
  return createTriage(ctx)(findings);
}

/**
 * A triage function for one run. What it knows about the suite is gathered
 * once, on the first call that needs it, so a run that lints its files in
 * batches triages each batch exactly as one call over all findings would.
 */
export function createTriage(context: TriageContext): (findings: Finding[]) => Finding[] {
  const ctx = {
    ...context,
    moduleResolver: context.moduleResolver ?? createModuleResolver(context.importBoundary ?? context.filesBase),
  };
  let know: Knowledge | undefined;
  return (findings) => {
    const wants = findings.some(
      (f) =>
        f.rule === 'playwright/expect-expect' ||
        f.rule === 'playwright/no-conditional-in-test' ||
        f.rule === 'playwright/valid-expect'
    );
    if (!wants) return findings;
    know ??= gather(ctx);
    return triageWith(findings, ctx, know);
  };
}

function triageWith(findings: Finding[], ctx: TriageContext, know: Knowledge): Finding[] {
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
    const ast = source === undefined ? undefined : parse(source, abs);
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
    if (isUnconditionalSkipDeclaration(call)) continue; // never runs; structure rules already count it
    const fn = [...(call.arguments ?? [])].reverse().find(isFn);
    const reachable = reachableFiles(abs, ctx, know);
    const fixtureLocals = assertingFixtureLocals(fn, reachable, know);
    if (fixtureLocals.size > 0 && callsAny(fn.body, fixtureLocals)) continue; // a callable fixture that asserts is invoked
    const calls = [...new Set([...unresolvedCalls(call, ast, know), ...unresolvedFixtureCalls(call, ast, fn, reachable, know)])];
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
        `The scorer cannot decide this one automatically, so a person should look: no expect(...) in this test body, but it calls ${calls
          .slice(0, 3)
          .map((c) => `${c}()`)
          .join(', ')}${calls.length > 3 ? ', ...' : ''} on an object defined elsewhere (page object, injected fixture or ` +
        'imported helper) that this scan cannot read, so the assertion may live there. Not counted against the score.',
    });
  }
  return out;
}
