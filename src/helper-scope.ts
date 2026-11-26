import type { HelperFacts } from './metrics.js';

/**
 * Which helper names clear `playwright/expect-expect` in which spec file
 * (QAG-287 D2). A name counts for a spec only when the helper is defined in
 * the spec itself or in a file the spec reaches through its import graph
 * (imports and re-exports the module resolver can follow), never because an
 * unrelated file happens to define a helper with the same name.
 *
 * Evidence rules:
 * - Same-file behaviour is unchanged: a helper whose body holds an expect, a
 *   `.waitFor()` or a call to such a helper of the same file counts (`local`).
 * - Cross-file delegation carries expect evidence only, and only through
 *   calls of imported bindings or methods on `this`, on imported bindings or
 *   on values built with `new <imported class>` (`HelperFacts.crossCalls`);
 *   `api.open()` on a parameter never inherits an imported `open()`.
 * - Cross-file delegation carries expect evidence only (`strong`): a wrapper
 *   gains assertion status from a helper in another file only if that helper
 *   really holds an expect, not a bare `.waitFor()`.
 * - A setup-shaped wrapper (`awaitBootstrapTest`, `setupPage`, `seedData`...)
 *   never gains status from another file: the expects in the setup chain
 *   check preconditions, not the behaviour the test is about.
 */
const SETUP_NAME = /^(await|setup|bootstrap|init|initialize|prepare|seed|goto|navigate|login|logIn|signIn|ensure)([A-Z0-9_]|$)/;

export function isSetupShapedName(name: string): boolean {
  return SETUP_NAME.test(name);
}

export type ImportEdges = ReadonlyMap<string, readonly string[]>;

export function createHelperScope(facts: HelperFacts[], edges: ImportEdges) {
  const byFile = new Map<string, HelperFacts[]>();
  for (const f of facts) {
    const list = byFile.get(f.file);
    if (list) list.push(f);
    else byFile.set(f.file, [f]);
  }

  // Same-file fixed point (pre-slice behaviour), per file.
  const local = new Map<string, Set<string>>();
  for (const [file, list] of byFile) {
    const names = new Set<string>();
    for (const f of list) if (f.expect || f.waitFor) names.add(f.name);
    for (let added = true; added; ) {
      added = false;
      for (const f of list) {
        if (names.has(f.name)) continue;
        for (const c of f.calls) {
          if (names.has(c)) {
            names.add(f.name);
            added = true;
            break;
          }
        }
      }
    }
    local.set(file, names);
  }

  const reachMemo = new Map<string, string[]>();
  const reach = (file: string): string[] => {
    const hit = reachMemo.get(file);
    if (hit) return hit;
    const seen = new Set<string>([file]);
    const queue = [file];
    for (let i = 0; i < queue.length; i++) {
      for (const next of edges.get(queue[i]) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    const out = [...seen];
    reachMemo.set(file, out);
    return out;
  };

  // Cross-file fixed point over expect evidence only.
  const strong = new Map<string, Set<string>>();
  for (const [file, list] of byFile) {
    strong.set(file, new Set(list.filter((f) => f.expect).map((f) => f.name)));
  }
  const sees = (file: string, name: string): boolean => reach(file).some((d) => strong.get(d)?.has(name));
  for (let added = true; added; ) {
    added = false;
    for (const [file, list] of byFile) {
      const mine = strong.get(file)!;
      for (const f of list) {
        if (mine.has(f.name)) continue;
        let hit = false;
        for (const c of f.calls) {
          if (mine.has(c)) { hit = true; break; }
        }
        if (!hit && !isSetupShapedName(f.name)) {
          // Cross-file evidence only through imported bindings or receivers
          // traceable to an import (never a bare property name on a parameter).
          for (const c of f.crossCalls) {
            if (sees(file, c)) { hit = true; break; }
          }
        }
        if (hit) {
          mine.add(f.name);
          added = true;
        }
      }
    }
  }

  /** Helper names that clear expect-expect inside `file`. */
  return function namesFor(file: string): string[] {
    const out = new Set<string>();
    for (const d of reach(file)) {
      for (const n of strong.get(d) ?? []) out.add(n);
      for (const n of local.get(d) ?? []) out.add(n);
    }
    return [...out].sort();
  };
}
