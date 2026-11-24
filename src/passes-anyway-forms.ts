/**
 * The proof step of `pwscore/assertion-passes-anyway` (QAG-287 N1).
 *
 * The rule (rules/assertion-passes-anyway.ts) reports its three forms by shape. Two of its
 * premises need more than the shape, and both are decided here, by calls into the existing
 * resolvers:
 *
 *  foreign expect   a finding whose `expect` is proven to come from another assertion library
 *                   is removed: the rule describes Playwright's matchers only.
 *  root-content     the root locator must be called on a proven Playwright Page or Frame
 *                   (rules/receiver-proof.ts), directly or through `frameLocator(...)` calls
 *                   and const aliases of them. Anything else is removed.
 *
 * An `expect` that is neither proven Playwright's nor proven foreign stays: the expect binding
 * step, which runs next, gives it tier `needs-check` with its reason. Nothing here throws, and
 * no finding of another rule is touched.
 */
import path from 'node:path';
import type { Finding } from './types.js';
import { expectUse } from './expect-binding.js';
import { createEnv, type ReceiverContext } from './receiver-forms.js';
import { memberName, resolveConstInit, type N as AstNode } from './rules/ast-util.js';
import { classifyPassesAnyway } from './rules/assertion-passes-anyway.js';
import { exportTable } from './rules/module-exports.js';
import type { N, ResolveEnv, ScopeFile } from './rules/proof.js';
import { prove } from './rules/receiver-proof.js';
import { strip } from './rules/scope-resolve.js';

export const PASSES_ANYWAY_RULE = 'pwscore/assertion-passes-anyway';

/** Switch for the unit test that compares the findings with the step on and off. */
export const passesAnywayProof = { enabled: true };

const norm = (rule: string): string => rule.replace(/^playwright-score\//, 'pwscore/');

/** The receiver of the root locator of the root-content assertion reported at this position. */
function rootReceiverAt(sf: ScopeFile, line: number, column: number): N | undefined {
  for (const n of sf.parents.keys()) {
    const start = n.loc?.start as { line: number; column: number } | undefined;
    if (n.type !== 'CallExpression' || start?.line !== line || start.column + 1 !== column) continue;
    const found = classifyPassesAnyway(sf.context, n as AstNode);
    if (found?.form === 'root-content' && found.receiver) return found.receiver as N;
  }
  return undefined;
}

/** Is the document root asked of a proven Page or Frame, also through frame locators? */
function rootIsProven(env: ResolveEnv, ctx: ReceiverContext, f: Finding): boolean {
  if (typeof f.file !== 'string' || typeof f.line !== 'number' || typeof f.column !== 'number') return false;
  const file = path.resolve(ctx.filesBase, f.file);
  // The spec file is the text that was scored: never a second read from disk.
  const sf = typeof ctx.sources.get(file) === 'string' ? env.load(file) : undefined;
  if (!sf || exportTable(sf).reflection) return false;
  let receiver = strip(rootReceiverAt(sf, f.line, f.column));
  for (let i = 0; receiver && i < 8; i++) {
    if (receiver.type === 'CallExpression' && memberName(receiver.callee as AstNode) === 'frameLocator') {
      receiver = strip(receiver.callee.object as N);
      continue;
    }
    // A const that holds a frame locator: read through it. Any other const is the proof's to follow.
    const init = receiver.type === 'Identifier' ? strip(resolveConstInit(sf.context, receiver as AstNode) as N | undefined) : undefined;
    if (init?.type === 'CallExpression' && memberName(init.callee as AstNode) === 'frameLocator') {
      receiver = init;
      continue;
    }
    break;
  }
  const proof = prove(env, sf, receiver);
  return proof.ok && (proof.value === 'page' || proof.value === 'frame');
}

/**
 * Removes the findings of the rule that do not hold: a proven foreign `expect`, and a document root that is not
 * asked of a proven Page or Frame. In place; findings of other rules are not read.
 */
export function applyPassesAnyway(findings: Finding[], ctx: ReceiverContext): void {
  if (!passesAnywayProof.enabled) return;
  let env: ResolveEnv | undefined;
  for (let i = findings.length - 1; i >= 0; i--) {
    const f = findings[i];
    if (norm(f.rule) !== PASSES_ANYWAY_RULE) continue;
    let keep: boolean;
    try {
      env ??= createEnv(ctx);
      const foreign = expectUse(env, ctx, f)?.binding.kind === 'foreign';
      keep = !foreign && (f.form !== 'root-content' || rootIsProven(env, ctx, f));
    } catch {
      // Not decided: a root-content finding needs its proof; the other forms stay for the binding step.
      keep = f.form !== 'root-content';
    }
    if (!keep) findings.splice(i, 1);
  }
}
