/**
 * Locator handles (QAG-287 S4c): `elementHandle()` and `elementHandles()` called on a Playwright Locator.
 *
 * The upstream no-element-handle rule reads only `page.$()` and `page.$$()`. A Locator turned back into an
 * ElementHandle is the API the docs discourage (playwright.dev/docs/api/class-elementhandle), so this step reports
 * the call under the same rule, with form `locator-handle`. A call counts only where the receiver is proven to be
 * a Locator, by these links and nothing else (playwright.dev/docs/api/class-locator, class-framelocator):
 *  L1  `locator(...)`, `getBy*(...)` on a receiver receiver-proof.ts proves to be a Playwright Page or Frame;
 *  L2  `frameLocator(...)` on such a page or frame, on a FrameLocator or on a Locator gives a FrameLocator, whose
 *      `locator(...)` and `getBy*(...)` give a Locator;
 *  L3  a Locator link on a proven Locator: `locator`, `getBy*`, `first`, `last`, `nth`, `filter`, `and`, `or`;
 *  L4  a single-assignment `const` bound to one of these (rule V2 of scope-resolve.ts, through `origin`).
 * Anything else (a parameter, a `let`, an object with its own `elementHandle`, a helper's return value, an
 * `await`ed value) is not proven and gives no finding at all: not `unresolved`, not `-`, because the call was
 * never reported before. In a Playwright package, project-identity.ts moves the finding to `api-under-test`.
 */
import path from 'node:path';
import type { Finding } from '../types.js';
import { mapRule } from '../profiles.js';
import { createEnv, type ReceiverContext } from '../receiver-forms.js';
import { LOCATOR_HANDLE_FORM, LOCATOR_HANDLE_RULE } from '../catalogue/locator-handle.js';
import { prove } from './receiver-proof.js';
import { origin, strip } from './scope-resolve.js';
import { MAX_STEPS } from './proof.js';
import type { N, ResolveEnv, ScopeFile } from './proof.js';

/** Switch for the unit test that compares the findings with the step on and off. */
export const locatorHandles = { enabled: true };

type Kind = 'locator' | 'frame-locator';
type From = 'page' | Kind;

const GET_BY = ['locator', 'getByAltText', 'getByLabel', 'getByPlaceholder', 'getByRole', 'getByTestId', 'getByText', 'getByTitle'];
const links = (rows: Array<[string, Kind]>): ReadonlyMap<string, Kind> => new Map(rows);
/** `receiver.method(...)` on a proven receiver: what the call returns. A method not listed proves nothing. */
const LINKS: ReadonlyMap<From, ReadonlyMap<string, Kind>> = new Map([
  ['page', links([...GET_BY.map((m): [string, Kind] => [m, 'locator']), ['frameLocator', 'frame-locator']])],
  ['frame-locator', links([...GET_BY.map((m): [string, Kind] => [m, 'locator']), ['frameLocator', 'frame-locator']])],
  ['locator', links([...[...GET_BY, 'first', 'last', 'nth', 'filter', 'and', 'or'].map((m): [string, Kind] => [m, 'locator']), ['frameLocator', 'frame-locator']])],
]);

/** The calls this step reports. */
const METHODS = new Set(['elementHandle', 'elementHandles']);
/** Cheap text check: a file that does not match is never parsed here. */
const MAY_CALL = /\.\s*elementHandles?\s*\(/;

/** Is `expr` proven to be a Locator or a FrameLocator? Undefined when it is not proven. */
export function locatorKind(env: ResolveEnv, sf: ScopeFile, expr: N | null | undefined, steps = 0): Kind | undefined {
  const e = strip(expr);
  if (!e || steps > MAX_STEPS) return undefined;
  if (e.type === 'Identifier') {
    // L4: only a `const` with one initializer leads on; a parameter, a `let`, an import or a global stops here.
    const o = origin(sf, e);
    return o.ok === 'expr' && o.via.includes('V2') ? locatorKind(env, sf, o.expr, steps + 1) : undefined;
  }
  if (e.type !== 'CallExpression') return undefined;
  const callee = strip(e.callee);
  if (callee?.type !== 'MemberExpression' || callee.computed || callee.property?.type !== 'Identifier') return undefined;
  const from = receiverOf(env, sf, callee.object, steps + 1);
  return from ? LINKS.get(from)?.get(callee.property.name as string) : undefined;
}

/** What a link's receiver is proven to be: a Locator or FrameLocator (L2 to L4), or a Page or Frame (receiver-proof.ts). */
function receiverOf(env: ResolveEnv, sf: ScopeFile, expr: N | undefined, steps: number): From | undefined {
  const kind = locatorKind(env, sf, expr, steps);
  if (kind) return kind;
  const p = prove(env, sf, expr, steps);
  return p.ok && (p.value === 'page' || p.value === 'frame') ? 'page' : undefined;
}

/** The finding for one call, shaped as the lint's findings of the same rule are. */
function finding(file: string, call: N, method: string): Finding {
  const mapping = mapRule(LOCATOR_HANDLE_RULE);
  const start = call.loc.start as { line: number; column: number };
  return {
    rule: LOCATOR_HANDLE_RULE,
    // The runner turns the rule on as 'warn'; a severity override in the catalogue would win, as it does there.
    severity: mapping.severityOverride ?? 'warning',
    message: `Unexpected use of element handles: use the Locator directly instead of calling ${method}().`,
    file,
    line: start.line,
    // Where the rule reports `page.$()`: the callee, which starts where the receiver starts. 1-based, as ESLint's.
    column: start.column + 1,
    dimension: mapping.dimension,
    ...(mapping.reportOnly ? { reportOnly: true } : {}),
    form: LOCATOR_HANDLE_FORM,
    evidence: 'scope',
  };
}

/**
 * The `locator-handle` findings of the scored spec files `files` (absolute paths), in file order and then source
 * order. Never a second finding of the rule at a position `found` already reports. Never throws.
 */
export function findLocatorHandles(ctx: ReceiverContext, files: readonly string[], found: readonly Finding[]): Finding[] {
  const out: Finding[] = [];
  if (!locatorHandles.enabled) return out;
  const taken = new Set(found.filter((f) => f.rule === LOCATOR_HANDLE_RULE).map((f) => `${f.file}|${f.line}:${f.column}`));
  let env: ResolveEnv | undefined;
  for (const file of files) {
    const source = ctx.sources.get(file);
    if (typeof source !== 'string' || !MAY_CALL.test(source)) continue;
    const mine: Finding[] = [];
    try {
      env ??= createEnv(ctx);
      const sf = env.load(file);
      if (!sf) continue;
      const rel = path.relative(ctx.filesBase, file) || path.basename(file);
      for (const n of sf.parents.keys()) {
        if (n.type !== 'CallExpression') continue;
        const callee = strip(n.callee as N);
        const method = callee?.type === 'MemberExpression' && !callee.computed && callee.property?.type === 'Identifier' ? (callee.property.name as string) : undefined;
        if (!method || !METHODS.has(method)) continue;
        try {
          if (locatorKind(env, sf, callee!.object as N) !== 'locator') continue;
        } catch {
          continue;
        }
        const f = finding(rel, n, method);
        const key = `${f.file}|${f.line}:${f.column}`;
        if (taken.has(key)) continue;
        taken.add(key);
        mine.push(f);
      }
    } catch {
      continue;
    }
    mine.sort((a, b) => a.line! - b.line! || a.column! - b.column!);
    out.push(...mine);
  }
  return out;
}
