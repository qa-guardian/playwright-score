import { parseForESLint } from '@typescript-eslint/parser';
import type { Finding, LocatorCounts } from './types.js';
import { countSloc } from './sloc.js';

// A positive "this IS a Playwright spec" check turned out to be unsafe:
// Playwright's own custom-fixtures pattern (test/expect re-exported from a
// project-local module built with base.extend()) is extremely common in
// real suites, and the fixtures a test destructures can be named anything
// (`bomPage`, `authedUser`, ...) — not necessarily the stock page/context/
// browser/request names. A file that legitimately imports `test`/`expect`
// from '../fixtures' and destructures `{ bomPage }` has zero syntactic
// signal distinguishing it from an unrelated framework, so requiring
// positive Playwright evidence false-negatives on real production specs
// (verified against real code: it silently skipped 18 of 19 genuine specs
// in one real suite). Denylisting known non-Playwright frameworks is much
// safer — a missed rare/unusual file just scores harmlessly, where a
// falsely-skipped real spec silently stops being scored at all.
const NON_PLAYWRIGHT_IMPORT_RE =
  /from\s+['"](?:vitest|jest|@jest\/[a-z-]+|mocha|jasmine|chai|@testing-library\/[a-z-]+)['"]/;
const RTL_API_RE = /\bscreen\.(?:getBy|queryBy|findBy|getAllBy|queryAllBy|findAllBy)\w*\(|\btoBeInTheDocument\(/;

/**
 * Heuristic: does this file show positive evidence of being a *non*-
 * Playwright test (Jest/Vitest/Mocha/Jasmine/React Testing Library), as
 * opposed to a Playwright spec that a broad `**\/*.test.ts` glob would
 * otherwise sweep in alongside real e2e specs? Used only to decide whether
 * to auto-exclude a file discovered via directory/glob expansion — never
 * applied to a file path the caller named explicitly.
 */
export function looksLikeNonPlaywrightTest(source: string): boolean {
  return NON_PLAYWRIGHT_IMPORT_RE.test(source) || RTL_API_RE.test(source);
}

const NATIVE_METHODS = new Set([
  'getByRole',
  'getByLabel',
  'getByTestId',
  'getByText',
  'getByPlaceholder',
]);

/**
 * Generic ESTree walk (no visitor-keys dependency). `parent` is excluded so
 * this stays a walk over a DAG even if a parent back-reference is ever
 * attached to the tree upstream.
 */
function walk(node: unknown, visit: (node: Record<string, unknown>) => void): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
    return;
  }
  const obj = node as Record<string, unknown>;
  if (typeof obj.type === 'string') visit(obj);
  for (const key in obj) {
    if (key === 'parent') continue;
    walk(obj[key], visit);
  }
}

/**
 * Parses source into an ESTree-compatible AST for our own lightweight
 * AST-walk checks (locator counting, local assertion-helper discovery).
 * Returns undefined on any parse failure — callers degrade to "found
 * nothing" rather than throwing; ESLint's own lint pass over the same
 * file surfaces the real parse error as a finding.
 */
function parseSource(source: string, file?: string): unknown {
  try {
    return parseForESLint(source, {
      ecmaVersion: 2022,
      sourceType: 'module',
      // JSX must be extension-driven, not always-on: a bare .ts file can
      // legally use the old-style `<Type>value` cast syntax, which is
      // ambiguous with — and would be misparsed as — a JSX element if JSX
      // were enabled unconditionally.
      ecmaFeatures: { jsx: /\.(tsx|jsx)$/.test(file ?? '') },
    }).ast;
  } catch {
    return undefined;
  }
}

/**
 * Count native vs raw locator calls via the same AST the ESLint pass
 * already parses (rather than a regex), so this ratio can't silently
 * disagree with `no-raw-locators` findings. A regex anchored to literal
 * `page`/`frame` receivers misses raw locators on any other receiver —
 * e.g. `this.container.locator(...)` in a Page Object Model, or a second
 * `.locator()` chained off a prior locator call — both common in
 * real-world (and AI-generated) specs.
 */
// Playwright's older direct-action API takes a raw selector string as the
// first argument — page.click('#foo') instead of page.locator('#foo').click()
// or a native locator. This is arguably the single most common raw-selector
// anti-pattern in naive/AI-generated code (verified against a realistic
// sample: a file using this exclusively scored a perfect 100 on the
// locators dimension before this fix). Restricted to methods a Locator
// itself takes zero required arguments for (click/dblclick/hover/check/
// uncheck/tap/focus) — real Playwright types never allow a string there on
// a Locator, so a string first argument unambiguously means the legacy
// page/frame form regardless of receiver name. fill/type/press/
// selectOption are deliberately excluded: their first argument is
// legitimately a string on a Locator too (the value/key, not a selector),
// so counting them would risk new false positives on correct code.
const LEGACY_SELECTOR_ACTION_METHODS = new Set([
  'click',
  'dblclick',
  'hover',
  'check',
  'uncheck',
  'tap',
  'focus',
]);

export function countLocators(source: string, file?: string): LocatorCounts {
  let native = 0;
  let raw = 0;
  const ast = parseSource(source, file);
  if (!ast) return { native, raw };
  walk(ast, (node) => {
    if (
      node.type !== 'CallExpression' ||
      (node as { callee?: Record<string, unknown> }).callee?.type !== 'MemberExpression'
    ) {
      return;
    }
    const callee = (node as { callee: Record<string, unknown> }).callee;
    if (callee.computed) return;
    const property = callee.property as { type?: string; name?: string } | undefined;
    if (property?.type !== 'Identifier') return;
    if (NATIVE_METHODS.has(property.name ?? '')) {
      native++;
    } else if (property.name === 'locator') {
      raw++;
    } else if (LEGACY_SELECTOR_ACTION_METHODS.has(property.name ?? '')) {
      const args = (node as { arguments?: Array<{ type?: string; value?: unknown }> }).arguments;
      const first = args?.[0];
      if (first?.type === 'Literal' && typeof first.value === 'string') raw++;
    }
  });
  return { native, raw };
}

function isExpectCallee(callee: Record<string, unknown> | undefined): boolean {
  if (!callee) return false;
  if (callee.type === 'Identifier') return callee.name === 'expect';
  if (callee.type === 'MemberExpression') {
    // Walk down to the root of a member chain, e.g. expect.poll(fn).toBe(x)
    // — the callee of the outer .toBe() call is `expect.poll(fn).toBe`,
    // whose object is the `expect.poll(fn)` CallExpression.
    let obj = callee.object as Record<string, unknown> | undefined;
    while (obj?.type === 'MemberExpression') obj = obj.object as Record<string, unknown> | undefined;
    if (obj?.type === 'Identifier' && obj.name === 'expect') return true;
    if (obj?.type === 'CallExpression') {
      return isExpectCallee(obj.callee as Record<string, unknown> | undefined);
    }
  }
  return false;
}

function containsExpectCall(node: unknown): boolean {
  let found = false;
  walk(node, (n) => {
    if (found || n.type !== 'CallExpression') return;
    if (isExpectCallee(n.callee as Record<string, unknown> | undefined)) found = true;
  });
  return found;
}

/**
 * Names of same-file functions (function declarations, or a const bound to
 * an arrow/function expression) whose own body contains an expect(...)-
 * shaped call anywhere. Fed into playwright/expect-expect's own
 * assertFunctionNames option (see eslint-runner.ts) so a test that
 * delegates its assertion to a locally-defined helper — `audit(page,
 * path)`, `checkFlashMessageVisibility(page, msg)`, `assertDashboardLoaded`
 * — isn't flagged as having no assertions, regardless of what the helper
 * happens to be named. expect-expect can only see expect() calls written
 * directly in the test body, so without this, delegating to a helper at
 * all — an extremely common way to dedupe near-identical specs — reads as
 * "no assertions"; verified against several real production files using
 * several different naming conventions for the exact same shape.
 * Deliberately local-only: a helper imported from another file can't be
 * resolved without following module specifiers and parsing that file too,
 * well beyond what a fast, per-file syntactic check should attempt.
 */
export function findLocalAssertionHelperNames(source: string, file?: string): string[] {
  const ast = parseSource(source, file);
  if (!ast) return [];
  const names = new Set<string>();
  walk(ast, (node) => {
    let name: string | undefined;
    let body: unknown;
    if (node.type === 'FunctionDeclaration') {
      const id = node.id as { type?: string; name?: string } | undefined;
      if (id?.type === 'Identifier') {
        name = id.name;
        body = node;
      }
    } else if (node.type === 'VariableDeclarator') {
      const id = node.id as { type?: string; name?: string } | undefined;
      const init = node.init as { type?: string } | undefined;
      if (
        id?.type === 'Identifier' &&
        (init?.type === 'ArrowFunctionExpression' || init?.type === 'FunctionExpression')
      ) {
        name = id.name;
        body = init;
      }
    }
    if (name && body && containsExpectCall(body)) names.add(name);
  });
  return [...names];
}

const TEST_NON_DECL_RE =
  /\btest\.(describe|step|beforeEach|afterEach|beforeAll|afterAll|use|setTimeout|info|expect)\b/;

/** Count test( / test.only( / test.skip( / test.fixme( style declarations (approx). */
export function countTests(source: string): number {
  // Playwright's real modifier API is test.fixme() — not test.fix().
  const re = /\btest(?:\.(?:only|skip|fixme|slow))?\s*\(/g;
  let count = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const before = source.slice(Math.max(0, m.index - 1), m.index + 20);
    if (TEST_NON_DECL_RE.test(before)) continue;
    count++;
  }
  return count;
}

export function findOversizedFile(
  source: string,
  file: string,
  maxSloc = 400
): Finding[] {
  const sloc = countSloc(source);
  if (sloc > maxSloc) {
    return [
      {
        rule: 'metrics/oversized-file',
        severity: 'warning',
        message: `File has ${sloc} SLOC (limit ${maxSloc})`,
        file,
        dimension: 'structure',
      },
    ];
  }
  return [];
}

export function analyzeSource(source: string, file: string) {
  return {
    sloc: countSloc(source),
    tests: countTests(source),
    locators: countLocators(source, file),
    // No homegrown "has no assertions" check here: playwright/expect-expect
    // (a real AST-based community rule, always enabled — see
    // eslint-runner.ts) already covers this correctly, including
    // expect.poll(...)/expect.soft(...) chained forms that a source-text
    // regex would need to special-case. A prior regex-based version of
    // this check (metrics/no-empty-test) only matched a bare `expect(`
    // call and so false-positived at error severity on any file whose only
    // assertions were expect.poll()/expect.soft() — verified against real
    // production code.
    findings: [...findOversizedFile(source, file)],
  };
}
