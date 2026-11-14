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

const ASSERTIONISH = /^(assert|verify|check|validate|expect|ensure|should|is|has|wait|confirm)/i;

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

const astCache = new Map<string, N>();
function parse(source: string, file: string): N {
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
}

interface Knowledge {
  /** Every function / method / class name declared in any readable file. */
  defined: Set<string>;
  /** Names of `test.extend({...})` fixtures whose body contains an expect(...). */
  assertingFixtures: Set<string>;
}

function gather(ctx: TriageContext): Knowledge {
  const defined = new Set<string>();
  const assertingFixtures = new Set<string>();
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
          if (k && isFn(p.value) && containsExpect(p.value)) assertingFixtures.add(k);
        }
      }
    });
  }
  return { defined, assertingFixtures };
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
    if (kind === 'external' || (kind === 'lib' && ASSERTIONISH.test(name))) unresolved.push(name);
  });
  return unresolved;
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
  const know = gather(ctx);
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
    const fn = [...(call.arguments ?? [])].reverse().find(isFn);
    const params = new Set<string>();
    for (const p of fn?.params?.[0]?.properties ?? []) {
      const k = propKeyName(p);
      if (k) params.add(k);
    }
    if ([...params].some((p) => know.assertingFixtures.has(p))) continue; // fixture asserts
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
