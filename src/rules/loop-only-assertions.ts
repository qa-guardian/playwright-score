/**
 * pwscore/loop-only-assertions (QAG-287 N3): likely, report-only.
 *
 * A test whose every assertion sits inside a loop over a list that is read without waiting:
 *
 *   for (const x of await <locator>.all()) { ... }
 *   for (const x of await <page>.$$(<selector>)) { ... }
 *   for (let i = 0; i < n; i++) { ... }      n is `await <locator>.count()`, inline or a `const`
 *
 * (the list may also be a `const` bound to the awaited call). Playwright's docs on locator.all():
 * it "does not wait for elements to match the locator, and instead immediately returns whatever
 * is present in the page". When the list is empty the loop runs zero times and the test passes
 * having checked nothing.
 *
 * "Every assertion" is what the test states count (src/test-states.ts): the assertion sites of
 * the test's callback and of each hook in scope for it, handed over as `TestAssertions` while
 * the file's tree is alive. Nothing here decides what an assertion is. No finding when:
 *  - the test and its hooks have no assertion;
 *  - an assertion, or a call the states could not resolve, is outside every such loop;
 *  - before the loop (earlier in its callback, in a beforeEach/beforeAll hook in scope, or in
 *    the test itself for a loop in an after-hook) a call waits for the list: `waitFor`,
 *    `waitForSelector`, `waitForFunction`, an action on the same locator
 *    (`items.first().click()`), or for `$$` any call with the same selector.
 * An assertion on the list before the loop (`toHaveCount`, `expect(items.first())`) is an
 * assertion outside the loop. One finding per loop, at the outermost such loop.
 */
import type { N, ScopeFile } from './proof.js';
import { strip } from './scope-resolve.js';
import { resolveConstInit } from './ast-util.js';
import { propName, walk } from '../test-syntax.js';
import type { TestAssertions } from '../test-states.js';
import type { Finding, TestStateEntry } from '../types.js';

export const LOOP_RULE = 'pwscore/loop-only-assertions';
export interface LoopHit {
  line: number;
  column: number;
  /** The hook the loop is in; none when it is in the test's own callback. */
  hook?: string;
}
type Part = TestAssertions['parts'][number];
/** The list a loop reads: the locator (`all`, `count`) or the selector argument (`$$`). */
interface List {
  kind: 'all' | '$$' | 'count';
  on: N;
}

const WAITS = new Set(['waitFor', 'waitForSelector', 'waitForFunction']);
const BEFORE = new Set(['beforeEach', 'beforeAll']);
/** Calls on a locator that neither wait for an element nor act on one. */
const NO_WAIT = new Set(
  ('all count allTextContents allInnerTexts evaluateAll isVisible isHidden isEnabled isDisabled isEditable isChecked highlight ' +
    'first last nth locator filter and or frameLocator contentFrame getByRole getByText getByLabel getByPlaceholder getByAltText getByTitle getByTestId').split(' ')
);
const NO_WAIT_SELECTOR = new Set(['$', '$$', '$eval', '$$eval']);

const methodOf = (call: N): string | undefined => {
  const c = strip(call.callee);
  return c?.type === 'MemberExpression' ? propName(c) : undefined;
};
/** An identifier's `const` initialiser, else the node itself. */
const valueOf = (sf: ScopeFile, node: N | null | undefined): N | undefined => {
  const n = strip(node);
  return (n?.type === 'Identifier' ? strip(resolveConstInit(sf.context, n as never) as N | undefined) : undefined) ?? n;
};

/** Same expression, by structure: identifiers, literals, members, calls, object arguments. */
function same(a: N | null | undefined, b: N | null | undefined, depth = 0): boolean {
  const x = strip(a);
  const y = strip(b);
  if (!x || !y || x.type !== y.type || depth > 24) return false;
  const all = (p: N[] = [], q: N[] = []): boolean => p.length === q.length && p.every((v, i) => same(v, q[i], depth + 1));
  switch (x.type) {
    case 'Identifier':
      return x.name === y.name;
    case 'ThisExpression':
      return true;
    case 'Literal':
      return typeof x.value === typeof y.value && String(x.value) === String(y.value);
    case 'TemplateLiteral':
      return all(x.expressions, y.expressions) && x.quasis.map((q: N) => q.value.cooked).join('\u0000') === y.quasis.map((q: N) => q.value.cooked).join('\u0000');
    case 'AwaitExpression':
      return same(x.argument, y.argument, depth + 1);
    case 'MemberExpression':
      return !!x.computed === !!y.computed && same(x.object, y.object, depth + 1) && (x.computed ? same(x.property, y.property, depth + 1) : propName(x) === propName(y));
    case 'CallExpression':
      return same(x.callee, y.callee, depth + 1) && all(x.arguments, y.arguments);
    case 'ObjectExpression':
      return (
        x.properties.length === y.properties.length &&
        x.properties.every((p: N, i: number) => {
          const q = y.properties[i] as N;
          return p.type === 'Property' && q.type === 'Property' && !p.computed && !q.computed && same(p.key, q.key, depth + 1) && same(p.value, q.value, depth + 1);
        })
      );
    default:
      return false;
  }
}

/** The awaited call a list expression stands for (through a `const`), or undefined when it is not awaited. */
function awaited(sf: ScopeFile, node: N | null | undefined): N | undefined {
  const v = valueOf(sf, node);
  const call = v?.type === 'AwaitExpression' ? strip(v.argument) : undefined;
  return call?.type === 'CallExpression' && strip(call.callee)?.type === 'MemberExpression' ? call : undefined;
}

function listOf(sf: ScopeFile, loop: N): List | undefined {
  if (loop.type === 'ForOfStatement') {
    const call = awaited(sf, loop.right);
    if (!call) return undefined;
    const on = strip(call.callee)!.object as N;
    const m = methodOf(call);
    if (m === 'all' && call.arguments.length === 0 && !(strip(on)?.type === 'Identifier' && strip(on)!.name === 'Promise')) return { kind: 'all', on };
    if (m === '$$' && call.arguments.length > 0) return { kind: '$$', on: call.arguments[0] as N };
    return undefined;
  }
  const t = loop.type === 'ForStatement' ? strip(loop.test) : undefined;
  if (t?.type !== 'BinaryExpression') return undefined;
  const bound = t.operator === '<' || t.operator === '<=' ? t.right : t.operator === '>' || t.operator === '>=' ? t.left : undefined;
  const counter = strip(bound === t.right ? t.left : t.right);
  const call = counter?.type === 'Identifier' ? awaited(sf, bound) : undefined;
  return call && methodOf(call) === 'count' && call.arguments.length === 0 ? { kind: 'count', on: strip(call.callee)!.object as N } : undefined;
}

/** The outermost loop over a list whose body holds `site`, below the callback `fn`. */
function loopOf(sf: ScopeFile, site: N, fn: N, listFor: (loop: N) => List | undefined): N | undefined {
  let found: N | undefined;
  for (let child = site, p = sf.parents.get(site); p && child !== fn; child = p, p = sf.parents.get(p)) {
    if ((p.type === 'ForOfStatement' || p.type === 'ForStatement') && p.body === child && listFor(p)) found = p;
  }
  return found;
}

/** Does this call wait for an item of the list? */
function waits(sf: ScopeFile, call: N, list: List): boolean {
  const m = methodOf(call);
  if (m && WAITS.has(m)) return true;
  if (list.kind === '$$') return !NO_WAIT_SELECTOR.has(m ?? '') && call.arguments.length > 0 && same(valueOf(sf, call.arguments[0]), valueOf(sf, list.on));
  if (!m || NO_WAIT.has(m)) return false;
  const targets = [list.on, valueOf(sf, list.on)];
  for (let n = strip(strip(call.callee)?.object), i = 0; n && i < 64; i++) {
    if (targets.some((t) => same(n, t)) || targets.some((t) => same(valueOf(sf, n), t))) return true;
    n = strip(n.type === 'CallExpression' ? n.callee : n.type === 'MemberExpression' ? n.object : n.type === 'AwaitExpression' ? n.argument : undefined);
  }
  return false;
}

/** Calls that run before `loop`: earlier in its callback, in the before-hooks, and in the test for a loop in an after-hook. */
function waitedBefore(sf: ScopeFile, parts: TestAssertions['parts'], loop: N, own: Part, list: List): boolean {
  const after = own.hook !== undefined && !BEFORE.has(own.hook);
  for (const part of parts) {
    const whole = part !== own && (BEFORE.has(part.hook ?? '') || (after && part.hook === undefined));
    if (part !== own && !whole) continue;
    let hit = false;
    walk(part.fn.body, (n) => {
      if (!hit && n.type === 'CallExpression' && (whole || n.range[1] <= loop.range[0])) hit = waits(sf, n, list);
    });
    if (hit) return true;
  }
  return false;
}

/** The loops to report for one test, in source order; empty when the test does not qualify. */
export function loopOnlyAssertions(t: TestAssertions): LoopHit[] {
  const { sf, parts } = t;
  const lists = new Map<N, List | undefined>();
  const listFor = (loop: N): List | undefined => {
    if (!lists.has(loop)) lists.set(loop, listOf(sf, loop));
    return lists.get(loop);
  };
  const loops = new Map<N, Part>();
  for (const part of parts) {
    for (const site of part.sites) {
      const loop = loopOf(sf, site, part.fn, listFor);
      if (!loop) return [];
      loops.set(loop, part);
    }
    for (const site of part.open) if (!loopOf(sf, site, part.fn, listFor)) return [];
  }
  for (const [loop, part] of loops) if (waitedBefore(sf, parts, loop, part, listFor(loop)!)) return [];
  return [...loops]
    .sort(([a], [b]) => a.range[0] - b.range[0])
    .map(([loop, part]) => ({ line: loop.loc.start.line, column: loop.loc.start.column + 1, ...(part.hook ? { hook: part.hook } : {}) }));
}

export function loopFinding(entry: TestStateEntry, hit: LoopHit): Finding {
  return {
    rule: LOOP_RULE,
    severity: 'info',
    message: 'Every assertion of this test is inside a loop over a list that is read without waiting: when the list is empty, the loop runs zero times and the test checks nothing.',
    file: entry.file,
    line: hit.line,
    column: hit.column,
    dimension: 'assertions',
    reportOnly: true,
    ...(hit.hook ? { scope: 'hook' as const } : { scope: 'test' as const, testKey: entry.testKey }),
  };
}
