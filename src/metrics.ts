import type { Finding, LocatorCounts } from './types.js';
import { countSloc } from './sloc.js';

const NATIVE_RE =
  /\.\s*getBy(?:Role|Label|TestId|Text|Placeholder)\s*\(/g;
const RAW_RE = /(?:page|frame)\s*\.\s*locator\s*\(/g;

/** Count native vs raw locator calls (simple statistical). */
export function countLocators(source: string): LocatorCounts {
  const native = [...source.matchAll(NATIVE_RE)].length;
  const raw = [...source.matchAll(RAW_RE)].length;
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
