/**
 * Finds the tests of one spec file by title path (QAG-289 S2). The scorer's test states say which
 * line a test is declared on and whether it counts; this adds what a diff needs and the states do
 * not carry: the title path (enclosing describe titles, then the test title) and how many
 * `expect()` calls the test body holds. A test is matched across two versions by file + title path.
 */
import { parseAst } from '../parse-cache.js';
import { readFacts, type AssertionFact, type TimeoutFact } from './assertions.js';

type Node = { type: string; loc?: { start: { line: number } }; [key: string]: any };

export interface IndexedTest {
  /** Enclosing describe titles, then the test title. */
  titlePath: string[];
  /** Line of the declaration, the line the test states carry. */
  line: number;
  /** Count of `expect(...)`, `expect.soft(...)` and `expect.poll(...)` calls written in the test's own body. */
  expects: number;
  /** Plain `expect(x).matcher(args)` calls, in source order (see assertions.ts). */
  assertions: AssertionFact[];
  /** Explicit numeric timeouts written in the test body. */
  timeouts: TimeoutFact[];
}

const SKIP_KEYS = new Set(['parent', 'loc', 'range', 'tokens', 'comments']);
const isFn = (n: Node | undefined): boolean =>
  !!n && (n.type === 'ArrowFunctionExpression' || n.type === 'FunctionExpression');

/** A literal title as text. A template with substitutions keeps `${}` in place of each one. */
function titleOf(n: Node | undefined): string | undefined {
  if (!n) return undefined;
  if (n.type === 'Literal' && typeof n.value === 'string') return n.value;
  if (n.type === 'TemplateLiteral') return (n.quasis as Node[]).map((q) => q.value?.cooked ?? q.value?.raw ?? '').join('${}');
  return undefined;
}

/** A call written `something('title', ..., () => {})`: a describe, a test, a step or a wrapper of them. */
function titledCall(n: Node): { title: string; fn: Node } | undefined {
  if (n.type !== 'CallExpression') return undefined;
  const args = n.arguments as Node[];
  const title = titleOf(args[0]);
  const fn = [...args].reverse().find(isFn);
  return title !== undefined && fn !== undefined ? { title, fn } : undefined;
}

function isExpectCall(n: Node): boolean {
  if (n.type !== 'CallExpression') return false;
  const c = n.callee as Node;
  if (c.type === 'Identifier') return c.name === 'expect';
  return (
    c.type === 'MemberExpression' &&
    c.object?.type === 'Identifier' &&
    c.object.name === 'expect' &&
    !c.computed &&
    (c.property?.name === 'soft' || c.property?.name === 'poll')
  );
}

function children(n: Node): Node[] {
  const out: Node[] = [];
  for (const key of Object.keys(n)) {
    if (SKIP_KEYS.has(key)) continue;
    const v = n[key];
    if (Array.isArray(v)) {
      for (const item of v) if (item && typeof item.type === 'string') out.push(item);
    } else if (v && typeof v === 'object' && typeof v.type === 'string') out.push(v);
  }
  return out;
}

function countExpects(fn: Node): number {
  let count = 0;
  const stack: Node[] = [fn];
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (isExpectCall(n)) count++;
    stack.push(...children(n));
  }
  return count;
}

/**
 * The titled calls of a file at the given declaration lines, as tests. A file that does not parse
 * gives none. The first call on a line wins (the outermost); two tests with the same title path
 * in one file get ` [2]`, ` [3]` after the last title, in source order.
 */
export function indexTests(source: string, file: string, lines: ReadonlySet<number>): Map<number, IndexedTest> {
  const out = new Map<number, IndexedTest>();
  let ast: Node;
  try {
    ast = parseAst(source, file) as unknown as Node;
  } catch {
    return out;
  }
  const visit = (n: Node, path: string[]): void => {
    const call = titledCall(n);
    const line = n.loc?.start.line;
    if (call && line !== undefined && lines.has(line) && !out.has(line)) {
      out.set(line, { titlePath: [...path, call.title], line, expects: countExpects(call.fn), ...readFacts(call.fn, source) });
    }
    const next = call ? [...path, call.title] : path;
    for (const c of children(n)) visit(c, next);
  };
  visit(ast, []);
  const seen = new Map<string, number>();
  for (const t of [...out.values()].sort((a, b) => a.line - b.line)) {
    const key = t.titlePath.join('\u0000');
    const k = (seen.get(key) ?? 0) + 1;
    seen.set(key, k);
    if (k > 1) t.titlePath = [...t.titlePath.slice(0, -1), `${t.titlePath[t.titlePath.length - 1]} [${k}]`];
  }
  return out;
}
