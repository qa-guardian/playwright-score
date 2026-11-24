/**
 * Receiver forms (QAG-287 B2).
 *
 * The rules in RECEIVER_TIERED_RULES report a method by name on something
 * called `page` or `frame`. This step never adds, removes or rewrites a
 * finding. It only decides the form: `-` when the receiver is proven to be a
 * Playwright Page or Frame, `unresolved` otherwise. The proof list is closed,
 * positive evidence only:
 *
 *  E1 fixture  a destructured `page`, `context` or `browser` parameter of a
 *              callback passed to a call on Playwright's `test` (a test, a
 *              hook or a step); a single-assignment `const` alias of a proven
 *              receiver is proven too.
 *  E2 type     the binding, class field or constructor parameter property is
 *              annotated `Page` or `Frame` from a Playwright package.
 *  E3 factory  every assignment is a Playwright factory call on a proven
 *              receiver, or on a launcher imported from a Playwright package.
 *
 * Untyped parameters, helper return values, members of other objects,
 * bindings with other writes, redeclared `var`s and loop or catch bindings are
 * `unresolved` by design. Any internal error also yields `unresolved`.
 * The proof itself is in rules/receiver-proof.ts; this file is the step that
 * takes a finding to its reported calls and sets the form.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Finding } from './types.js';
import { RECEIVER_TIERED_RULES } from './catalogue/receiver-unresolved.js';
import type { ImportResolver } from './import-graph.js';
import { exportTable } from './rules/module-exports.js';
import { notProven } from './rules/proof.js';
import type { N, NotProven, ResolveEnv, Result, ScopeFile } from './rules/proof.js';
import { REPORTED, prove, type Kind } from './rules/receiver-proof.js';
import { realRunnerEnv } from './rules/runner-resolve.js';
import { parseScopeFile } from './rules/scope-resolve.js';

export { RECEIVER_TIERED_RULES };

/** Switch for the unit test that compares the findings with the step on and off. */
export const receiverForms = { enabled: true };

export interface ReceiverContext {
  /** Directory the findings' `file` paths are relative to. */
  filesBase: string;
  /** Scored spec files, absolute path -> source. */
  sources: ReadonlyMap<string, string>;
  /** Locally imported files already read, absolute path -> source. */
  importedFiles?: ReadonlyMap<string, string>;
  /** Directory imports may not climb out of (defaults to filesBase). */
  importBoundary?: string;
  moduleResolver?: ImportResolver;
}

function propertyName(callee: N): string | undefined {
  const p = callee.property as N | undefined;
  if (!callee.computed) return p?.type === 'Identifier' ? p.name : undefined;
  if (p?.type === 'Literal' && typeof p.value === 'string') return p.value;
  return p?.type === 'TemplateLiteral' && p.expressions?.length === 0 ? p.quasis?.[0]?.value?.cooked : undefined;
}

const callIndex = new WeakMap<ScopeFile, Map<string, N[]>>();

/** Calls of one of `methods` that start at the reported position. The rules report the call, or its callee, which starts where the receiver starts. */
export function reportedCalls(sf: ScopeFile, line: number, column: number, methods: readonly string[]): N[] {
  let index = callIndex.get(sf);
  if (!index) {
    index = new Map();
    for (const n of sf.parents.keys()) {
      const start = n.type === 'CallExpression' && n.callee?.type === 'MemberExpression' ? (n.loc?.start as { line: number; column: number } | undefined) : undefined;
      if (!start) continue;
      const key = `${start.line}:${start.column + 1}`;
      const list = index.get(key);
      if (list) list.push(n);
      else index.set(key, [n]);
    }
    callIndex.set(sf, index);
  }
  return (index.get(`${line}:${column}`) ?? []).filter((n) => {
    const name = propertyName(n.callee);
    return name !== undefined && methods.includes(name);
  });
}

/** The env of one run: files parsed once, and rule R over the real file system. */
export function createEnv(ctx: ReceiverContext): ResolveEnv {
  const cache = new Map<string, ScopeFile | undefined>();
  return {
    load(file) {
      if (cache.has(file)) return cache.get(file);
      let sf: ScopeFile | undefined;
      try {
        const source = ctx.sources.get(file) ?? ctx.importedFiles?.get(file) ?? fs.readFileSync(file, 'utf8');
        sf = typeof source === 'string' ? parseScopeFile(source, file) : undefined;
      } catch {
        sf = undefined;
      }
      cache.set(file, sf);
      return sf;
    },
    runner: realRunnerEnv(ctx.importBoundary ?? ctx.filesBase, ctx.moduleResolver),
  };
}

/** Is the receiver of the finding's call proven to be a Playwright Page or Frame? Every call the finding may point at must be. Never throws. */
export function receiverProof(env: ResolveEnv, ctx: ReceiverContext, f: Pick<Finding, 'rule' | 'file' | 'line' | 'column'>): Result<Kind> {
  const file = typeof f.file === 'string' ? path.resolve(ctx.filesBase, f.file) : '';
  try {
    const reported = REPORTED.get(f.rule);
    if (!reported || typeof f.line !== 'number' || typeof f.column !== 'number' || file === '') return notProven('no-reported-call', file);
    // The spec file is the text that was scored: never a second read from disk.
    const sf = typeof ctx.sources.get(file) === 'string' ? env.load(file) : undefined;
    if (!sf) return notProven('module-unreadable', file);
    if (exportTable(sf).reflection) return notProven('reflection', file, sf.ast);
    const calls = reportedCalls(sf, f.line, f.column, reported.methods);
    let last: Result<Kind> = notProven('no-reported-call', file);
    for (const c of calls) {
      last = prove(env, sf, c.callee.object as N);
      if (!last.ok) return last;
      if (!reported.on.includes(last.value)) return notProven('receiver-shape', file, c);
    }
    return last;
  } catch {
    return notProven('internal-error', file);
  }
}

export const receiverIsProven = (env: ResolveEnv, ctx: ReceiverContext, f: Pick<Finding, 'rule' | 'file' | 'line' | 'column'>): boolean => receiverProof(env, ctx, f).ok;
export type { NotProven };

/**
 * Sets `form` on every finding of a receiver-tiered rule that has none yet: `-` when the receiver is proven,
 * `unresolved` otherwise. In place; no finding is added, removed or otherwise changed, and nothing here throws.
 */
export function applyReceiverForms(findings: Finding[], ctx: ReceiverContext): void {
  if (!receiverForms.enabled) return;
  let env: ResolveEnv | undefined;
  for (const f of findings) {
    if (f.form !== undefined || !RECEIVER_TIERED_RULES.includes(f.rule)) continue;
    let proven = false;
    try {
      env ??= createEnv(ctx);
      proven = receiverProof(env, ctx, f).ok;
    } catch {
      proven = false;
    }
    f.form = proven ? '-' : 'unresolved';
  }
}
