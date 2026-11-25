/**
 * pwscore/negative-only-test (QAG-287 N4): likely, report-only.
 *
 * A test whose every assertion checks that something is absent:
 *
 *   await expect(locator).not.toBeVisible()      await expect(locator).toBeVisible({ visible: false })
 *   await expect(locator).toBeHidden()           await expect(locator).toBeAttached({ attached: false })
 *   await expect(locator).not.toBeAttached()     await expect(locator).toHaveCount(0)
 *
 * (also through `expect.soft`, `expect.configure(...)` or a const-bound expect), with an action (`goto`,
 * `click`, `fill`, ...) before the first assertion. Playwright's docs on toBeHidden: it "Ensures that Locator
 * either does not resolve to any DOM node, or resolves to a non-visible one." A locator that matches nothing
 * passes all six (playwright-core 1.65.1 `lib/coreBundle.js`, the missing-element branch of the frame's
 * expect: `to.have.count` 0, `to.be.hidden`, not `to.be.visible`, `to.be.detached`, not `to.be.attached`),
 * so the test would still pass if the page were blank or had not rendered the result. Scalar
 * `not.toHaveText` / `not.toContainText` are left out: on a missing element they fail ("element(s) not found").
 *
 * "Every assertion" is what the test states count (src/test-states.ts): the test's callback and each hook in
 * scope for it, with the functions they call that the states resolve. No finding when:
 *  - the states left a call unresolved (it may assert or wait), or found no assertion;
 *  - any assertion is another matcher or polarity (`toBeVisible()`, `toHaveCount(3)`, `toHaveURL`, `not.toBeHidden`,
 *    an option that is not a literal, `expect.poll`, a generic matcher, an assertion library, a guarded `throw`);
 *  - the test or a hook in scope waits for the page: `waitForURL`, `waitForResponse`, `waitForSelector`, `waitFor`;
 *  - no action comes before the first assertion, in run order: beforeAll, beforeEach, the test, afterEach, afterAll.
 * One finding per test, at its declaration.
 */
import type { N, ScopeFile } from './proof.js';
import { strip } from './scope-resolve.js';
import { KNOWN_PACKAGES } from '../catalogue/table.js';
import { chain, exportedName, isFunction, propName, walk } from '../test-syntax.js';
import type { ExpectUse } from '../expect-binding.js';
import type { Val } from '../test-callees.js';
import type { TestAssertions } from '../test-states.js';
import type { Finding, TestStateEntry } from '../types.js';

export const NEGATIVE_ONLY_RULE = 'pwscore/negative-only-test';

/** What the test states resolve with: the expect binding of a chain's root, and the value a callee denotes. */
export interface CallProbe {
  use(sf: ScopeFile, root: N): ExpectUse | null;
  callee(sf: ScopeFile, callee: N): Val;
}
type Kind = 'absent' | 'other' | 'action' | 'wait';
/** A function's events in source order (resolved calls inlined); `open` when something could not be followed. */
interface Seq {
  kinds: Kind[];
  open: boolean;
}

const MAX_NESTING = 32;
const MODIFIERS = new Set(['not', 'soft', 'configure']);
const RUN_ORDER: Record<string, number> = { beforeAll: 0, beforeEach: 1, afterEach: 3, afterAll: 4 };
const ACTIONS = new Set(
  ('goto reload goBack goForward setContent click dblclick tap fill type pressSequentially press check uncheck setChecked ' +
    'selectOption setInputFiles hover dragTo dragAndDrop clear focus dispatchEvent selectText').split(' ')
);
const DEVICE_ACTIONS = new Set(['down', 'up', 'move', 'wheel', 'insertText']);
const DEVICES = new Set(['keyboard', 'mouse', 'touchscreen']);
const WAITS = new Set(['waitForURL', 'waitForResponse', 'waitForSelector', 'waitFor']);
const memos = new WeakMap<CallProbe, Map<N, Seq>>();

/** Is there a call below this callee (`expect(x)` below `.toBe`)? As in src/test-states.ts. */
function hasCall(callee: N | null | undefined): boolean {
  for (let n = strip(callee), i = 0; n && i < 64; i++) {
    if (n.type === 'CallExpression') return true;
    n = strip(n.type === 'MemberExpression' ? n.object : n.type === 'AwaitExpression' ? n.argument : undefined);
  }
  return false;
}
/**
 * Is the expect itself called at the bottom of this chain: `expect(x)`, `expect.soft(x)`, `expect.configure(o)(x)`,
 * an alias `check(x)`? The expect binding also answers for a value stored and later passed to expect
 * (`const rows = page.getByRole('row').filter(...)`), and that call is not a matcher call.
 */
function expectCalled(call: N): boolean {
  let bottom: N | undefined;
  for (let n = strip(call), i = 0; n && i < 64; i++) {
    if (n.type === 'CallExpression') bottom = n;
    n = strip(n.type === 'MemberExpression' ? n.object : n.type === 'CallExpression' ? n.callee : n.type === 'AwaitExpression' ? n.argument : undefined);
  }
  const c = strip(bottom?.callee);
  return c?.type === 'Identifier' || (c?.type === 'MemberExpression' && strip(c.object)?.type === 'Identifier' && ['soft', 'configure', 'poll'].includes(propName(c) ?? ''));
}
/** A `throw` under an `if` whose test is not a literal, inside the same function: an assertion for the states. */
function guarded(sf: ScopeFile, node: N): boolean {
  for (let p = sf.parents.get(node); p && !isFunction(p); p = sf.parents.get(p)) if (p.type === 'IfStatement' && strip(p.test)?.type !== 'Literal') return true;
  return false;
}

/** A boolean option: true when absent, its value when a literal boolean, undefined when it cannot be read. */
function flag(arg: N | undefined, key: string): boolean | undefined {
  const a = strip(arg);
  if (!a) return true;
  if (a.type !== 'ObjectExpression' || a.properties.some((p: N) => p.type !== 'Property' || p.computed)) return undefined;
  const p = (a.properties as N[]).find((q) => exportedName(q.key) === key);
  if (!p) return true;
  const v = strip(p.value);
  return v?.type === 'Literal' && typeof v.value === 'boolean' ? v.value : undefined;
}

/** A Playwright matcher call: an absence check of the list, or any other assertion. */
function matcherKind(n: N, props: string[]): Kind {
  const matcher = props[props.length - 1];
  const mods = props.slice(0, -1);
  if (!mods.every((m) => MODIFIERS.has(m))) return 'other';
  const negated = mods.includes('not');
  const arg = n.arguments?.[0] as N | undefined;
  switch (matcher) {
    case 'toBeHidden':
      return negated ? 'other' : 'absent';
    // playwright 1.65.1 lib/matchers/expect.js:12822 sends `visible ? "to.be.visible" : "to.be.hidden"`, so
    // toBeVisible({ visible: false }) is the same check as toBeHidden; { visible: true } is a plain toBeVisible.
    // An absence check when the option and the `.not` agree: not.toBeVisible(), toBeVisible({ visible: false }).
    case 'toBeVisible':
      return flag(arg, 'visible') === negated ? 'absent' : 'other';
    // expect.js:12758 sends `attached ? "to.be.attached" : "to.be.detached"`: not.toBeAttached(), toBeAttached({ attached: false }).
    case 'toBeAttached':
      return flag(arg, 'attached') === negated ? 'absent' : 'other';
    case 'toHaveCount': {
      const a = strip(arg);
      return !negated && a?.type === 'Literal' && a.value === 0 ? 'absent' : 'other';
    }
    default:
      return 'other';
  }
}

function seqOf(probe: CallProbe, sf: ScopeFile, fn: N, active: Set<N>): Seq {
  let memo = memos.get(probe);
  if (!memo) memos.set(probe, (memo = new Map()));
  const done = memo.get(fn);
  if (done) return done;
  if (active.has(fn)) return { kinds: [], open: false }; // a cycle adds nothing
  if (active.size >= MAX_NESTING) return { kinds: [], open: true };
  active.add(fn);
  const found: Array<[number, Kind[]]> = [];
  let open = false;
  const at = (n: N, kinds: Kind[]): void => void found.push([n.range[0], kinds]);
  walk(fn.body, (n) => {
    if (n.type === 'ThrowStatement' && guarded(sf, n)) at(n, ['other']);
    if (n.type !== 'CallExpression') return;
    const { root, props } = chain(n.callee);
    const use = root ? probe.use(sf, root) : null;
    if (use && (use.binding.kind !== 'playwright' || expectCalled(n))) {
      const b = use.binding;
      if (b.kind === 'playwright') {
        // `expect(x)` and `expect.configure(...)(x)` are not matcher calls; the matcher on top of them is.
        if (props.length > 0 && hasCall(n.callee) && !MODIFIERS.has(props[props.length - 1])) at(n, [matcherKind(n, props)]);
      } else if (b.kind === 'foreign' && KNOWN_PACKAGES.assertion.includes(b.package)) at(n, ['other']);
      else open = true;
      return;
    }
    const v = probe.callee(sf, n.callee);
    if (v.k === 'assert') at(n, ['other']);
    else if (v.k === 'unres' || v.k === 'param') open = true;
    else if (v.k === 'fn') {
      const inner = seqOf(probe, v.sf, v.node, active);
      open ||= inner.open;
      at(n, inner.kinds);
    } else {
      const last: string = props[props.length - 1] ?? (strip(n.callee)?.type === 'Identifier' ? strip(n.callee)!.name : '');
      if (WAITS.has(last)) at(n, ['wait']);
      else if (ACTIONS.has(last) || (DEVICE_ACTIONS.has(last) && DEVICES.has(props[props.length - 2] ?? ''))) at(n, ['action']);
    }
  });
  active.delete(fn);
  found.sort((a, b) => a[0] - b[0]);
  const out = { kinds: found.flatMap(([, k]) => k), open };
  memo.set(fn, out);
  return out;
}

/** Does this counted test check only for absence, after an action? `t` is the test states' view of it. */
export function negativeOnlyTest(t: TestAssertions, probe: CallProbe): boolean {
  const { sf, parts } = t;
  if (parts.some((p) => p.open.length > 0) || !parts.some((p) => p.sites.length > 0)) return false;
  const rank = (hook?: string): number => (hook === undefined ? 2 : (RUN_ORDER[hook] ?? -1));
  if (parts.some((p) => rank(p.hook) < 0)) return false;
  const ordered = [...parts].sort((a, b) => rank(a.hook) - rank(b.hook) || a.fn.range[0] - b.fn.range[0]);
  const kinds: Kind[] = [];
  for (const part of ordered) {
    const s = seqOf(probe, part.at ?? sf, part.fn, new Set());
    if (s.open) return false;
    kinds.push(...s.kinds);
  }
  if (kinds.includes('other') || kinds.includes('wait')) return false;
  const first = kinds.indexOf('absent');
  const action = kinds.indexOf('action');
  return first >= 0 && action >= 0 && action < first;
}

export function negativeOnlyFinding(entry: TestStateEntry, column: number): Finding {
  return {
    rule: NEGATIVE_ONLY_RULE,
    severity: 'info',
    message:
      'Every assertion of this test checks that something is absent (hidden, detached or a count of 0): the test would still pass if the page were blank or had not rendered the result.',
    file: entry.file,
    line: entry.line,
    column,
    dimension: 'assertions',
    reportOnly: true,
    scope: 'test',
    testKey: entry.testKey,
  };
}
