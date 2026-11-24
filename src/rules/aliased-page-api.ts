/**
 * Scope aliases (QAG-287 S4a): Playwright's page fixture, Playwright's `test` and a `networkidle` held in a
 * `const`, reached under a name the rules do not read (`const p = page; await p.waitForSelector('#x')`,
 * `({ page: p })`, `const it = test; it.only(...)`, `const o = { waitUntil: 'networkidle' }`). A call counts
 * only where the binding resolver (scope-resolve.ts, receiver-proof.ts) proves it at that position:
 *  - page: a chain of single-assignment `const` aliases ending at the destructured `page` fixture of a callback
 *    given to Playwright's `test` (proof E1). A `let`, a `var`, a parameter of any other function, a helper's
 *    return value or a binding with several writes is never one.
 *  - test: a `const` alias of Playwright's `test` (or an import of one from a local module), as in expect-alias.ts.
 *  - networkidle: `'networkidle'` reaches `waitUntil` or `waitForLoadState` through `const` declarations (rule V2)
 *    on a call whose receiver is the page fixture or a page alias.
 *
 * Before the analysis, `findScopeAliases` lists per spec file the names proven at one site or more. Only those
 * files are linted once more, in the lint pass of expect-alias.ts, with SCOPE_RULES on: test aliases go in
 * `settings.playwright.globalAliases.test`, and the page and value rules see the shadow copy of scope-shadow.ts.
 * After the analysis, `keepScopeAliasFindings` keeps a new finding only where the resolver proves a site of that
 * rule at that exact position, and marks it `evidence: 'scope'`.
 */
import path from 'node:path';
import type { Linter } from 'eslint';
import type { Finding } from '../types.js';
import { createEnv, type ReceiverContext } from '../receiver-forms.js';
import { prove } from './receiver-proof.js';
import { lookup, origin, playwrightTest, strip } from './scope-resolve.js';
import { MAX_STEPS } from './proof.js';
import type { N, ResolveEnv, ScopeFile } from './proof.js';
import { FOCUSED, NETWORKIDLE, PAGE_RULES, SCOPE_RULES, UNAWAITED, scopePlugin, type ScopeAliases } from './scope-shadow.js';

export { SCOPE_RULES, type ScopeAliases } from './scope-shadow.js';

/** The methods `no-networkidle` reads (eslint-plugin-playwright 2.11.0). */
const IDLE_METHODS = new Set(['goBack', 'goForward', 'goto', 'reload', 'setContent', 'waitForLoadState', 'waitForURL']);
/** The upstream page-name check: a receiver that passes it is reported already. */
const UPSTREAM_PAGE = /(^(page|frame)|(Page|Frame)$)/;

/** Switch for the unit test that compares the findings with the step on and off. */
export const scopeAliases = { enabled: true };

interface Site {
  kind: keyof ScopeAliases;
  name: string;
  /** For `no-networkidle`: the call; a finding of the rule already inside it means no second one. */
  call?: N;
}

const posKey = (rule: string, line: number, column: number): string => `${rule}@${line}:${column}`;
const keyAt = (rule: string, n: N): string => posKey(rule, n.loc.start.line, n.loc.start.column + 1);
const propName = (m: N): string | undefined =>
  !m.computed && m.property?.type === 'Identifier' ? m.property.name : m.property?.type === 'Literal' && typeof m.property.value === 'string' ? m.property.value : undefined;
const isIdle = (n: N | undefined): boolean => {
  const e = strip(n);
  return (e?.type === 'Literal' && e.value === 'networkidle') || (e?.type === 'TemplateLiteral' && e.expressions?.length === 0 && e.quasis?.[0]?.value?.cooked === 'networkidle');
};

/** An alias of Playwright's page fixture: `const` links only, ending at the fixture parameter (proof E1). */
function isPageAlias(env: ResolveEnv, sf: ScopeFile, id: N): boolean {
  let cur: N = id;
  for (let i = 0; i <= MAX_STEPS; i++) {
    const v = lookup(sf, cur, cur.name as string);
    const def = v?.defs?.length === 1 ? (v.defs[0] as N) : undefined;
    if (def?.type === 'Parameter') {
      const r = prove(env, sf, id);
      return r.ok && r.value === 'page' && r.rules.includes('E1');
    }
    if (def?.type !== 'Variable' || def.parent?.kind !== 'const' || def.node?.id !== def.name) return false;
    const init = strip(def.node.init as N | undefined);
    if (init?.type !== 'Identifier') return false;
    cur = init;
  }
  return false;
}

/** A `const` alias of Playwright's `test` that no rule reads as `test` already (the shapes of expect-alias.ts). */
function isTestAlias(env: ResolveEnv, sf: ScopeFile, id: N): boolean {
  if (id.name === 'test') return false;
  const v = lookup(sf, id, id.name as string);
  const def = v?.defs?.length === 1 ? (v.defs[0] as N) : undefined;
  const local = def?.type === 'Variable' && def.parent?.kind === 'const' && def.node?.id?.type === 'Identifier';
  if (!local && def?.type !== 'ImportBinding') return false;
  const d = playwrightTest(env, sf, id);
  return d.ok && (local || d.rules.includes('V2') || d.rules.includes('X3'));
}

/** What `id` holds through one `const` or more (rule V2), or undefined. */
function constValue(sf: ScopeFile, id: N | undefined): N | undefined {
  if (id?.type !== 'Identifier') return undefined;
  const o = origin(sf, id);
  return o.ok === 'expr' && o.via.includes('V2') ? strip(o.expr) : undefined;
}

/** The `waitUntil` property of an object literal. */
const waitUntil = (o: N): N | undefined =>
  (o.properties as N[]).find((p) => p.type === 'Property' && !p.computed && (p.key?.name === 'waitUntil' || p.key?.value === 'waitUntil'));

const cache = new WeakMap<ScopeFile, Map<string, Site>>();

/** Every site of a SCOPE_RULES rule in the file that the resolver proves, by rule and reported position. Never throws. */
function sitesOf(env: ResolveEnv, sf: ScopeFile): Map<string, Site> {
  let out = cache.get(sf);
  if (out) return out;
  out = new Map();
  cache.set(sf, out);
  const pages = new Map<N, boolean>();
  const page = (id: N): boolean => {
    const v = lookup(sf, id, id.name as string) ?? id;
    let ok = pages.get(v);
    if (ok === undefined) pages.set(v, (ok = isPageAlias(env, sf, id)));
    return ok;
  };
  for (const n of sf.parents.keys()) {
    try {
      if (n.type === 'ExpressionStatement') {
        // no-unawaited-action: `alias.action()` or `alias.getByRole(...).action()` as a statement.
        const c = n.expression?.type === 'CallExpression' ? (n.expression.callee as N) : undefined;
        let head = c?.type === 'MemberExpression' ? (c.object as N) : undefined;
        while (head?.type === 'CallExpression' && head.callee?.type === 'MemberExpression') head = head.callee.object as N;
        if (head?.type === 'Identifier' && head.name !== 'page' && page(head)) out.set(keyAt(UNAWAITED, n.expression), { kind: 'page', name: head.name });
        continue;
      }
      if (n.type !== 'CallExpression') continue;
      const callee = n.callee as N;
      if (callee?.type === 'MemberExpression') {
        const method = propName(callee);
        const recv = callee.object as N;
        for (const [rule, methods] of PAGE_RULES) {
          if (method && methods.includes(method) && recv?.type === 'Identifier' && !UPSTREAM_PAGE.test(recv.name) && page(recv)) out.set(keyAt(rule, n), { kind: 'page', name: recv.name });
        }
        const r = strip(recv);
        if (method && IDLE_METHODS.has(method) && r?.type === 'Identifier' && page(r)) {
          const arg = (n.arguments as N[])[method === 'waitForLoadState' ? 0 : 1];
          const held = constValue(sf, arg);
          if (method === 'waitForLoadState' ? isIdle(held) : held?.type === 'ObjectExpression' && idleOption(sf, held)) {
            out.set(keyAt(NETWORKIDLE, arg), { kind: 'value', name: arg.name, call: n });
          } else if (method !== 'waitForLoadState' && arg?.type === 'ObjectExpression') {
            const v = waitUntil(arg)?.value as N | undefined;
            if (v?.type === 'Identifier' && isIdle(constValue(sf, v))) out.set(keyAt(NETWORKIDLE, v), { kind: 'value', name: v.name, call: n });
          }
        }
      }
      // no-focused-test: `alias.only(...)`, `alias.describe.only(...)`.
      let c = strip(callee);
      let only: N | undefined;
      while (c?.type === 'MemberExpression') {
        if (propName(c) === 'only') only = c.property as N;
        c = strip(c.object as N);
      }
      if (only && c?.type === 'Identifier' && isTestAlias(env, sf, c)) out.set(keyAt(FOCUSED, only), { kind: 'test', name: c.name });
    } catch {
      continue;
    }
  }
  return out;
}

/** `{ waitUntil: 'networkidle' }`, the value written or held in a `const`. */
function idleOption(sf: ScopeFile, o: N): boolean {
  const v = waitUntil(o)?.value as N | undefined;
  return isIdle(v) || isIdle(constValue(sf, v));
}

/** Cheap text checks: a file none of them match is never parsed here. */
const PAGE_CALL = /(?<![\w$.])([A-Za-z_$][\w$]*)\s*\.\s*(?:waitForSelector|waitForNavigation|waitForTimeout|pause|\$\$?)\s*\(/g;
const RENAMED_FIXTURE = /[{,]\s*page\s*:\s*[A-Za-z_$]/;
const IDLE_CONST = /(?<![\w$.])const\s+[A-Za-z_$][\w$]*\s*(?::[^=;]{0,120})?=(?!=)[^;]{0,200}?['"`]networkidle['"`]/;
const ONLY_CALL = /\.\s*only\s*\(|\[\s*['"`]only['"`]\s*\]/;
const CONST_ALIAS = /(?<![\w$.])const\s+[A-Za-z_$][\w$]*\s*=\s*[A-Za-z_$][\w$.]*\s*[;\n]/;
const mayHaveSite = (s: string): boolean =>
  RENAMED_FIXTURE.test(s) ||
  IDLE_CONST.test(s) ||
  (ONLY_CALL.test(s) && CONST_ALIAS.test(s)) ||
  [...s.matchAll(PAGE_CALL)].some((m) => !UPSTREAM_PAGE.test(m[1]));

/** Spec file -> the names it proves at one site or more (sorted). Only files with a name are listed. Never throws. */
export function findScopeAliases(ctx: ReceiverContext, files: readonly string[]): Map<string, ScopeAliases> {
  const out = new Map<string, ScopeAliases>();
  if (!scopeAliases.enabled) return out;
  let env: ResolveEnv | undefined;
  for (const file of files) {
    const source = ctx.sources.get(file);
    if (typeof source !== 'string' || !mayHaveSite(source)) continue;
    try {
      env ??= createEnv(ctx);
      const sf = env.load(file);
      if (!sf) continue;
      const names = { page: new Set<string>(), value: new Set<string>(), test: new Set<string>() };
      for (const s of sitesOf(env, sf).values()) names[s.kind].add(s.name);
      if (names.page.size + names.value.size + names.test.size > 0) out.set(file, { page: [...names.page].sort(), value: [...names.value].sort(), test: [...names.test].sort() });
    } catch {
      continue;
    }
  }
  return out;
}

/**
 * The configuration of the scope lint: `base` with only SCOPE_RULES on, the wrapped plugins, and per file its
 * names. Undefined when no file has one. `glob` makes a file's `files` pattern.
 */
export function scopeAliasConfig(
  base: readonly Linter.Config[],
  byFile: ReadonlyMap<string, ScopeAliases> | undefined,
  glob: (file: string) => string,
  testAliases: string[],
  plugins: Record<string, { rules?: Record<string, unknown> }>
): Linter.Config[] | undefined {
  if (!byFile || byFile.size === 0) return undefined;
  const wrapped = Object.fromEntries(Object.entries(plugins).map(([prefix, p]) => [prefix, scopePlugin(prefix, p)]));
  const groups = new Map<string, { names: ScopeAliases; files: string[] }>();
  for (const [file, names] of byFile) {
    const key = JSON.stringify(names);
    const g = groups.get(key) ?? { names, files: [] };
    g.files.push(glob(file));
    groups.set(key, g);
  }
  const only = (rules: NonNullable<Linter.Config['rules']>): Linter.Config['rules'] => Object.fromEntries(Object.entries(rules).filter(([id]) => SCOPE_RULES.includes(id)));
  return [
    ...base.map((c) => ({
      ...c,
      ...(c.rules ? { rules: only(c.rules) } : {}),
      ...(c.plugins ? { plugins: Object.fromEntries(Object.entries(c.plugins).map(([k, p]) => [k, wrapped[k] ?? p])) } : {}),
    })),
    ...[...groups.values()].map((g) => ({
      files: g.files,
      settings: { playwright: { globalAliases: { test: [...testAliases, ...g.names.test] } }, scopeAliases: { page: g.names.page, value: g.names.value } },
    })),
  ] as Linter.Config[];
}

/**
 * The new findings of the scope lint that sit at a site the resolver proves for their rule, marked
 * `evidence: 'scope'`. Never a second finding at a position (or, for no-networkidle, in a call) that `found`
 * already reports for the same rule. Never throws.
 */
export function keepScopeAliasFindings(candidates: readonly Finding[], found: readonly Finding[], ctx: ReceiverContext): Finding[] {
  const kept: Finding[] = [];
  if (candidates.length === 0) return kept;
  const env = createEnv(ctx);
  const taken = new Set(found.map((f) => `${f.file}|${posKey(f.rule, f.line ?? 0, f.column ?? 0)}`));
  for (const f of candidates) {
    try {
      const file = path.resolve(ctx.filesBase, f.file);
      const sf = typeof ctx.sources.get(file) === 'string' ? env.load(file) : undefined;
      const site = sf && typeof f.line === 'number' && typeof f.column === 'number' ? sitesOf(env, sf).get(posKey(f.rule, f.line, f.column)) : undefined;
      const key = `${f.file}|${posKey(f.rule, f.line ?? 0, f.column ?? 0)}`;
      if (!site || taken.has(key)) continue;
      const call = site.call?.loc as { start: { line: number; column: number }; end: { line: number; column: number } } | undefined;
      const inside = (g: Finding): boolean =>
        !!call && g.line !== undefined && g.column !== undefined && (g.line > call.start.line || (g.line === call.start.line && g.column > call.start.column)) && (g.line < call.end.line || (g.line === call.end.line && g.column <= call.end.column));
      if (call && found.some((g) => g.rule === f.rule && g.file === f.file && inside(g))) continue;
      taken.add(key);
      kept.push({ ...f, evidence: 'scope' });
    } catch {
      continue;
    }
  }
  return kept;
}
