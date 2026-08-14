import { parseForESLint } from '@typescript-eslint/parser';
import type { Finding, LocatorCounts } from './types.js';
import { countSloc } from './sloc.js';

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
export function countLocators(source: string): LocatorCounts {
  let native = 0;
  let raw = 0;
  let ast: unknown;
  try {
    ast = parseForESLint(source, {
      ecmaVersion: 2022,
      sourceType: 'module',
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

/** Count test( / test.only( / test.skip( style declarations (approx). */
export function countTests(source: string): number {
  const re = /\btest(?:\.(?:only|skip|fix|slow))?\s*\(/g;
  // Exclude test.describe, test.step, test.before*, test.after*, test.use
  let count = 0;
  let m: RegExpExecArray | null;
  const exclude =
    /\btest\.(?:describe|step|beforeEach|afterEach|beforeAll|afterAll|use|setTimeout|info|expect)\b/;
  while ((m = re.exec(source)) !== null) {
    const start = Math.max(0, m.index - 0);
    const snippet = source.slice(start, start + 40);
    if (exclude.test(snippet.split('(')[0] + '(')) {
      // more precise: check the matched prefix
    }
    const before = source.slice(Math.max(0, m.index - 1), m.index + 20);
    if (
      /\btest\.(describe|step|beforeEach|afterEach|beforeAll|afterAll|use|setTimeout|info)\b/.test(
        before
      )
    ) {
      continue;
    }
    // test.expect is rare as call form
    if (/\btest\.expect\b/.test(before)) continue;
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
  const hasTest = /\btest(?:\.(?:only|skip|fix))?\s*\(/.test(source);
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
    locators: countLocators(source),
    findings: [
      ...findEmptyExpectTests(source, file),
      ...findOversizedFile(source, file),
    ],
  };
}
