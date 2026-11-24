/**
 * Aliases of Playwright's `expect` (QAG-287 S4b.2).
 *
 * The assertion rules find an `expect` by its name, so `const check = expect;
 * check(locator).toBeVisible()` was checked by none of them. A name counts as an
 * alias only where the binding resolver (rules/scope-resolve.ts) proves, at the
 * call, that it is Playwright's `expect` reached through a single-assignment
 * `const`: `const check = expect`, an alias of an alias, an alias of an expect
 * made by `extend`, `configure` or `mergeExpects`, or such a `const` exported by
 * a local module. Never by its spelling; a `let`, a parameter or a foreign
 * `expect` is never one.
 *
 * How the findings are added, in three steps:
 *  1. Before the analysis (`findExpectAliases`): the spec files that prove at
 *     least one alias, with the alias names. A cheap text check comes first, so
 *     a file with no candidate name is never parsed here.
 *  2. In the analysis (eslint-runner.ts): every file is linted exactly as
 *     before. A file of step 1 is linted once more, with only ALIAS_RULES on and
 *     its alias names in `settings.playwright.globalAliases.expect`, which
 *     eslint-plugin-playwright reads and the scorer's own rules read through
 *     `expectAliasNames` (rules/ast-util.ts). A finding of that lint that the
 *     first lint already has is not new (`newFindings`).
 *  3. After the analysis (`keepProvenAliasFindings`): the plugin does not
 *     resolve scope, so a new finding is kept only when an `expect` of it is an
 *     identifier the resolver proves an alias at that position.
 * No source text is rewritten and no rule is reimplemented. A file with no
 * proven alias is linted with the same configuration and cost as before.
 */
import type { Linter } from 'eslint';
import type { Finding } from './types.js';
import { createEnv, type ReceiverContext } from './receiver-forms.js';
import { findingHeads, readAsExpect, type AddedAliasFindings } from './expect-binding.js';
import { isExpectExport } from './rules/proof.js';
import type { N, ResolveEnv, ScopeFile } from './rules/proof.js';
import { lookup, playwrightExpect } from './rules/scope-resolve.js';

/** The rules an alias is checked by. Every other rule never sees one. */
export const ALIAS_RULES: readonly string[] = [
  'playwright/missing-playwright-await',
  'playwright/valid-expect',
  'pwscore/no-unawaited-expect-value',
  'pwscore/no-weak-assertion',
  'pwscore/no-trivial-assertion',
  'playwright/prefer-web-first-assertions',
];

/** Switch for the unit test that compares the findings with the step on and off. */
export const expectAliases = { enabled: true };

/**
 * Is `id` a proven alias of Playwright's `expect`: a name no rule reads as `expect` already, bound by one
 * `const` declarator or by an import, that the resolver proves Playwright's `expect` through a `const`
 * (rule V2, or X3 for an `export const` of a local module). Never throws.
 */
export function isProvenAlias(env: ResolveEnv, sf: ScopeFile, id: N): boolean {
  try {
    if (id?.type !== 'Identifier' || readAsExpect(sf, id)) return false;
    const v = lookup(sf, id, id.name as string);
    const def = v?.defs?.length === 1 ? (v.defs[0] as N) : undefined;
    const local = def?.type === 'Variable' && def.parent?.kind === 'const' && def.node?.id?.type === 'Identifier';
    if (!local && def?.type !== 'ImportBinding') return false;
    const d = playwrightExpect(env, sf, id);
    return d.ok && isExpectExport(d.value) && (local || d.rules.includes('V2') || d.rules.includes('X3'));
  } catch {
    return false;
  }
}

/** `const NAME = <init>`, also exported, with an optional type annotation. */
const CONST_DECL = /(?<![\w$.])const\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]{0,120})?=(?!=)\s*([^;]{0,200})/g;
const NAMES_EXPECT = /(?<![\w$])(?:expect|mergeExpects)(?![\w$])|Expect(?![\w$])/;
const BARE_NAME = /^[A-Za-z_$][\w$]*$/;
const escapeRe = (s: string): string => s.replace(/[$]/g, '\\$&');

/**
 * Names that may be an alias, from the text of every readable file: a `const` whose initialiser names an expect,
 * or whose initialiser is another such name. Over-approximate on purpose: the resolver decides.
 */
function candidateNames(texts: Iterable<string>): Set<string> {
  const decls: Array<[string, string]> = [];
  for (const text of texts) for (const m of text.matchAll(CONST_DECL)) decls.push([m[1], m[2]]);
  const names = new Set<string>();
  for (const [name, init] of decls) if (NAMES_EXPECT.test(init)) names.add(name);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [name, init] of decls) {
      const first = init.split('\n')[0].trim();
      if (!names.has(name) && BARE_NAME.test(first) && names.has(first)) {
        names.add(name);
        grew = true;
      }
    }
  }
  return names;
}

/** Identifiers that start a call chain: `check(...)`, `check.soft(...)`, `check.poll(...)`. */
function callHeads(sf: ScopeFile): N[] {
  const out: N[] = [];
  for (const [n, p] of sf.parents) {
    if (n.type !== 'Identifier' || !p) continue;
    if (p.type === 'CallExpression' && p.callee === n) out.push(n);
    else if (p.type === 'MemberExpression' && p.object === n && !p.computed && sf.parents.get(p)?.type === 'CallExpression' && sf.parents.get(p)?.callee === p) out.push(n);
  }
  return out;
}

/** The imported name of an import binding (`check` in `import { check as c }`), if `id` is bound by one. */
function importedName(sf: ScopeFile, id: N): string | undefined {
  const def = lookup(sf, id, id.name as string)?.defs?.[0] as N | undefined;
  const spec = def?.type === 'ImportBinding' ? def.node : undefined;
  return spec?.type === 'ImportSpecifier' ? String(spec.imported?.name ?? spec.imported?.value) : undefined;
}

/**
 * Step 1: spec file -> the alias names it proves at one call or more (sorted). Only files with at least one name
 * are listed. Never throws: a file that cannot be read or parsed proves nothing.
 */
export function findExpectAliases(ctx: ReceiverContext, files: readonly string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!expectAliases.enabled) return out;
  const names = candidateNames([...ctx.sources.values(), ...(ctx.importedFiles?.values() ?? [])]);
  if (names.size === 0) return out;
  const mentions = new RegExp(`(?<![\\w$])(?:${[...names].map(escapeRe).join('|')})(?![\\w$])`);
  let env: ResolveEnv | undefined;
  for (const file of files) {
    const source = ctx.sources.get(file);
    if (typeof source !== 'string' || !mentions.test(source)) continue;
    try {
      env ??= createEnv(ctx);
      const sf = env.load(file);
      if (!sf) continue;
      const proven = new Set<string>();
      const tried = new Map<N, boolean>();
      for (const id of callHeads(sf)) {
        const name = id.name as string;
        if (proven.has(name) || !(names.has(name) || names.has(importedName(sf, id) ?? ''))) continue;
        const variable = lookup(sf, id, name);
        if (!variable) continue;
        let ok = tried.get(variable);
        if (ok === undefined) tried.set(variable, (ok = isProvenAlias(env, sf, id)));
        if (ok) proven.add(name);
      }
      if (proven.size > 0) out.set(file, [...proven].sort());
    } catch {
      continue;
    }
  }
  return out;
}

/**
 * Step 2, the configuration of the alias lint: `base` (the run's own configuration) with only ALIAS_RULES on,
 * and per file its alias names. Undefined when no file has one. `glob` makes a file's `files` pattern.
 */
export function expectAliasConfig(
  base: readonly Linter.Config[],
  byFile: ReadonlyMap<string, readonly string[]> | undefined,
  glob: (file: string) => string,
  testAliases: string[]
): Linter.Config[] | undefined {
  if (!byFile || byFile.size === 0) return undefined;
  const groups = new Map<string, { names: string[]; files: string[] }>();
  for (const [file, names] of byFile) {
    const key = names.join('\u0000');
    const g = groups.get(key) ?? { names: [...names], files: [] };
    g.files.push(glob(file));
    groups.set(key, g);
  }
  const only = (rules: NonNullable<Linter.Config['rules']>): Linter.Config['rules'] =>
    Object.fromEntries(Object.entries(rules).filter(([id]) => ALIAS_RULES.includes(id)));
  return [
    ...base.map((c) => (c.rules ? { ...c, rules: only(c.rules) } : c)),
    ...[...groups.values()].map((g) => ({
      files: g.files,
      settings: { playwright: { globalAliases: { test: testAliases, expect: g.names } } },
    })),
  ];
}

const identity = (f: Finding): string => JSON.stringify([f.rule, f.file, f.line, f.column, f.message]);

/** Step 2: the findings of the alias lint that the first lint of the same files does not have (as a multiset). */
export function newFindings(first: readonly Finding[], again: readonly Finding[]): Finding[] {
  const left = new Map<string, number>();
  for (const f of first) left.set(identity(f), (left.get(identity(f)) ?? 0) + 1);
  return again.filter((f) => {
    const n = left.get(identity(f)) ?? 0;
    if (n > 0) left.set(identity(f), n - 1);
    return n === 0;
  });
}

/**
 * Step 3: the new findings whose `expect` is, at that position, an identifier the resolver proves an alias. The
 * kept findings, and how the expect binding step reads them (expect-binding.ts). Never throws.
 */
export function keepProvenAliasFindings(candidates: readonly Finding[], ctx: ReceiverContext): AddedAliasFindings {
  const kept = new Set<Finding>();
  if (candidates.length > 0) {
    const env = createEnv(ctx);
    const also = (sf: ScopeFile, id: N): boolean => isProvenAlias(env, sf, id);
    for (const f of candidates) {
      try {
        const found = findingHeads(env, ctx, f, also);
        if (found && found.heads.some((h) => also(found.sf, h))) kept.add(f);
      } catch {
        continue;
      }
    }
  }
  return { findings: kept, isAlias: isProvenAlias };
}
