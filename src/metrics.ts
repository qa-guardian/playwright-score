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
 * Count native vs raw locator calls via the same AST the ESLint pass
 * already parses (rather than a regex), so this ratio can't silently
 * disagree with `no-raw-locators` findings. A regex anchored to literal
 * `page`/`frame` receivers misses raw locators on any other receiver —
 * e.g. `this.container.locator(...)` in a Page Object Model, or a second
 * `.locator()` chained off a prior locator call — both common in
 * real-world (and AI-generated) specs.
 */
export function countLocators(source: string, file?: string): LocatorCounts {
  let native = 0;
  let raw = 0;
  let ast: unknown;
  try {
    ast = parseForESLint(source, {
      ecmaVersion: 2022,
      sourceType: 'module',
      // JSX must be extension-driven, not always-on: a bare .ts file can
      // legally use the old-style `<Type>value` cast syntax, which is
      // ambiguous with — and would be misparsed as — a JSX element if JSX
      // were enabled unconditionally.
      ecmaFeatures: { jsx: /\.(tsx|jsx)$/.test(file ?? '') },
    }).ast;
  } catch {
    // Unparseable source: ESLint's own lint pass over the same file will
    // surface the real parse error as a finding; report zero locators here.
    return { native, raw };
  }
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
    if (NATIVE_METHODS.has(property.name ?? '')) native++;
    else if (property.name === 'locator') raw++;
  });
  return { native, raw };
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

/**
 * Detect test callbacks that appear to have zero expect( calls.
 * Heuristic: for each test( ... async (...) => { body }, check body for expect.
 */
export function findEmptyExpectTests(
  source: string,
  file: string
): Finding[] {
  const findings: Finding[] = [];
  // Rough scan: if file has test( but no expect( at all
  const hasTest = /\btest(?:\.(?:only|skip|fixme|slow))?\s*\(/.test(source);
  const hasExpect = /\bexpect\s*\(/.test(source);
  if (hasTest && !hasExpect) {
    findings.push({
      rule: 'metrics/no-empty-test',
      severity: 'error',
      message: 'Test file has test() but no expect() assertions',
      file,
      dimension: 'assertions',
    });
  }
  return findings;
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
    findings: [
      ...findEmptyExpectTests(source, file),
      ...findOversizedFile(source, file),
    ],
  };
}
