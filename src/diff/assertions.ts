/**
 * What a diff needs to know about the assertions and timeouts inside one test body (QAG-289 S2b):
 * each plain `expect(subject).matcher(args)` as text, and each explicit timeout written as a number.
 * Only what can be read with certainty is recorded; anything else is left out so it can never be
 * flagged. Negated (`.not`), `resolves` and `rejects` chains are not recorded.
 */
type Node = { type: string; range?: [number, number]; [key: string]: any };

export type Literal = string | number | boolean;

export interface AssertionFact {
  /** The `expect()` argument as normalized text (see `normalizeText`, and a trailing `.count()` dropped). */
  subject: string;
  matcher: string;
  /** Each matcher argument as normalized text. */
  args: string[];
  /** Per argument: its value when it is a plain string, number, boolean or substitution-free template; else undefined. */
  literals: Array<Literal | undefined>;
}

export type TimeoutKind = 'setTimeout' | 'expect' | 'waitFor';
export interface TimeoutFact {
  kind: TimeoutKind;
  /** What carries the timeout, normalized: `test.setTimeout`, `toHaveText on <subject>`, `<receiver>.waitFor`. */
  target: string;
  ms: number;
}

const SKIP_KEYS = new Set(['parent', 'loc', 'range', 'tokens', 'comments']);

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

/** Whitespace collapsed, double quotes read as single, so a reformat is not a change. */
export function normalizeText(s: string): string {
  return s.replace(/\s+/g, ' ').replace(/"/g, "'").trim();
}

function textOf(n: Node, source: string): string | undefined {
  return n.range ? normalizeText(source.slice(n.range[0], n.range[1])) : undefined;
}

function subjectText(n: Node, source: string): string | undefined {
  let t = textOf(n, source);
  if (t === undefined) return undefined;
  t = t.replace(/^await /, '').replace(/\(\s*await /, '(');
  // `expect(await list.count())` and `expect(list)` talk about the same thing.
  return t.replace(/\.count\(\)$/, '');
}

function literalOf(n: Node): Literal | undefined {
  if (n.type === 'Literal' && !n.regex && n.value !== null && n.value !== undefined && typeof n.value !== 'bigint') return n.value as Literal;
  if (n.type === 'TemplateLiteral' && n.expressions.length === 0) return n.quasis[0]?.value?.cooked ?? undefined;
  return undefined;
}

/** A number written as a literal, a unary minus, or a product/sum/difference of those (`5 * 1000`). */
export function numberOf(n: Node | undefined): number | undefined {
  if (!n) return undefined;
  if (n.type === 'Literal') return typeof n.value === 'number' ? n.value : undefined;
  if (n.type === 'BinaryExpression' && ['*', '+', '-'].includes(n.operator)) {
    const l = numberOf(n.left);
    const r = numberOf(n.right);
    if (l === undefined || r === undefined) return undefined;
    return n.operator === '*' ? l * r : n.operator === '+' ? l + r : l - r;
  }
  return undefined;
}

function timeoutIn(arg: Node | undefined): number | undefined {
  if (!arg || arg.type !== 'ObjectExpression') return undefined;
  for (const p of arg.properties as Node[]) {
    if (p.type !== 'Property' || p.computed) continue;
    const key = p.key?.type === 'Identifier' ? p.key.name : p.key?.value;
    if (key === 'timeout') return numberOf(p.value);
  }
  return undefined;
}

const isExpectCall = (n: Node | undefined): boolean => {
  if (!n || n.type !== 'CallExpression') return false;
  const c = n.callee as Node;
  if (c.type === 'Identifier') return c.name === 'expect';
  return c.type === 'MemberExpression' && !c.computed && c.object?.type === 'Identifier' && c.object.name === 'expect' && (c.property?.name === 'soft' || c.property?.name === 'poll');
};

export function readFacts(fn: Node, source: string): { assertions: AssertionFact[]; timeouts: TimeoutFact[] } {
  const assertions: AssertionFact[] = [];
  const timeouts: TimeoutFact[] = [];
  const stack: Node[] = [fn];
  const visited: Node[] = [];
  while (stack.length > 0) {
    const n = stack.pop()!;
    visited.push(n);
    stack.push(...children(n));
  }
  // Source order, so a repeated assertion pairs with its own twin on the other side.
  visited.sort((a, b) => (a.range?.[0] ?? 0) - (b.range?.[0] ?? 0));
  for (const n of visited) {
    if (n.type !== 'CallExpression' || n.callee?.type !== 'MemberExpression' || n.callee.computed) continue;
    const prop: string | undefined = n.callee.property?.name;
    const obj = n.callee.object as Node;
    const args = n.arguments as Node[];
    if (prop === undefined) continue;
    if (isExpectCall(obj)) {
      const subject = subjectText((obj.arguments as Node[])[0] ?? obj, source);
      const texts = args.map((a) => textOf(a, source));
      if (subject === undefined || texts.some((t) => t === undefined)) continue;
      assertions.push({ subject, matcher: prop, args: texts as string[], literals: args.map(literalOf) });
      const ms = timeoutIn(args[args.length - 1]) ?? timeoutIn((obj.arguments as Node[])[1]);
      if (ms !== undefined) timeouts.push({ kind: 'expect', target: `${prop} on ${subject}`, ms });
    } else if (prop === 'setTimeout' && obj.type === 'Identifier' && (obj.name === 'test' || obj.name === 'testInfo')) {
      const ms = numberOf(args[0]);
      if (ms !== undefined) timeouts.push({ kind: 'setTimeout', target: `${obj.name}.setTimeout`, ms });
    } else if (prop.startsWith('waitFor') && prop !== 'waitForTimeout') {
      const ms = timeoutIn(args[args.length - 1]);
      const recv = textOf(obj, source);
      const first = args[0] && args[0].type !== 'ObjectExpression' ? textOf(args[0], source) : undefined;
      if (ms !== undefined && recv !== undefined) timeouts.push({ kind: 'waitFor', target: `${recv}.${prop}${first ? `(${first})` : ''}`, ms });
    }
  }
  return { assertions, timeouts };
}
