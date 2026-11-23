/**
 * The one entry point to the parser for this package's own syntax-tree
 * checks: each file is parsed once per thread, and every later reader of the
 * same file gets the same tree.
 *
 * Readers: metrics.ts, import-graph.ts, test-aliases.ts, shared-files.ts
 * (main thread, before the analysis) and finding-triage.ts,
 * eslint-postfilter.ts, metrics.ts (in the analysis). The lint engine's own
 * parse is not served from here, and playwright-config.ts parses config
 * files on its own: both stay as they were.
 *
 * Key: the file path, the source text (compared in full on a hit) and the
 * parser options that change the tree. Two files with the same text at
 * different paths never share a tree object.
 *
 * Parser options. Every reader asks for `ecmaVersion: 2022`, the source type
 * of the file's extension (source-type.ts) and JSX for .tsx/.jsx. Some also
 * ask for `comment`, `loc` and `range`; the parser's `parseForESLint` turns
 * those three (and `tokens`) on for every call whatever the caller passes, so
 * they do not change the tree and are not part of the key. tests/
 * parse-cache.test.ts holds that to a deep comparison for each reader's
 * options. Source type and JSX follow from the path, so the path covers them.
 *
 * A source that does not parse is cached as its error, and the error is
 * thrown again on every hit, as a fresh parse would throw.
 *
 * Trees are shared: a reader must never write to one (no `parent` links, no
 * sorting of a node's arrays, no added properties).
 *
 * Memory bound. The cache is a least-recently-used list with a budget in
 * tokens; a tree's cost is its token and comment count, which the parser has
 * already counted (a tree takes roughly 550 bytes per token). Over budget,
 * the entries read longest ago are dropped; the entry just parsed always
 * stays, so the bound is the budget plus one file.
 * - Main thread, `MAX_CACHED_TOKENS`: the readers before the analysis each
 *   pass over the whole suite, so the budget has to hold a whole suite to
 *   save a parse. The cache is cleared before the analysis worker starts
 *   (isolate.ts) and when a run ends.
 * - Analysis worker, `WORKER_MAX_CACHED_TOKENS`: its readers come back to a
 *   file within the file's own batch, so a few batches' worth is enough.
 *   The cache ends with the worker.
 */
import { parseForESLint } from '@typescript-eslint/parser';
import { heapCheckpoint } from './heap-guard.js';
import { sourceTypeFor } from './source-type.js';

export type Ast = ReturnType<typeof parseForESLint>['ast'];

/**
 * Budget of the main thread's cache, in tokens (comments included). A source
 * constant, never derived from the machine. Results do not depend on it:
 * a tree that was dropped is parsed again, to an equal tree.
 */
export const MAX_CACHED_TOKENS = 3_000_000;

/** Budget of the analysis worker's cache, in tokens. Set by the worker when it starts (isolate.ts). */
export const WORKER_MAX_CACHED_TOKENS = 400_000;

interface Entry {
  source: string;
  ast?: Ast;
  error?: unknown;
  cost: number;
}

const entries = new Map<string, Entry>();
let cost = 0;
let budget = MAX_CACHED_TOKENS;
const counters = { hits: 0, misses: 0 };

const JSX_FILE = /\.(tsx|jsx)$/;

function parseFresh(source: string, file: string): Ast {
  return parseForESLint(source, {
    ecmaVersion: 2022,
    sourceType: sourceTypeFor(file),
    // JSX must be extension-driven, not always-on: a bare .ts file can
    // legally use the old-style `<Type>value` cast syntax, which is
    // ambiguous with — and would be misparsed as — a JSX element if JSX
    // were enabled unconditionally.
    ecmaFeatures: { jsx: JSX_FILE.test(file) },
  }).ast;
}

function drop(key: string, entry: Entry): void {
  entries.delete(key);
  cost -= entry.cost;
}

/**
 * The syntax tree of `source`, parsed as the file at `file` would be.
 * Throws what the parser throws when the source does not parse.
 * The tree is shared with every other reader of the file: read only.
 */
export function parseAst(source: string, file: string | undefined): Ast {
  const key = file ?? '';
  const hit = entries.get(key);
  if (hit !== undefined) {
    if (hit.source === source) {
      counters.hits++;
      // Most recently read goes last.
      entries.delete(key);
      entries.set(key, hit);
      if (hit.ast === undefined) throw hit.error;
      return hit.ast;
    }
    drop(key, hit); // the same path with another text: the old tree is of no use
  }
  counters.misses++;
  const entry: Entry = { source, cost: 1 };
  try {
    entry.ast = parseFresh(source, key);
    entry.cost = 1 + (entry.ast.tokens?.length ?? 0) + (entry.ast.comments?.length ?? 0);
  } catch (error) {
    entry.error = error;
  }
  entries.set(key, entry);
  cost += entry.cost;
  for (const [oldKey, old] of entries) {
    if (cost <= budget || old === entry) break;
    drop(oldKey, old);
  }
  heapCheckpoint();
  if (entry.ast === undefined) throw entry.error;
  return entry.ast;
}

/** Drops every tree of this thread; returns how many there were. */
export function clearParseCache(): number {
  const dropped = entries.size;
  entries.clear();
  cost = 0;
  return dropped;
}

/** For tests: what this thread's cache holds, and how often it answered. */
export function parseCacheStats(): { entries: number; tokens: number; hits: number; misses: number } {
  return { entries: entries.size, tokens: cost, hits: counters.hits, misses: counters.misses };
}

/** Another budget for this thread (the worker's, and tests); returns the one it replaces. */
export function setParseCacheBudget(tokens: number): number {
  const before = budget;
  budget = tokens;
  return before;
}
