/**
 * Holds the analysis worker to its heap limit when the engine does not.
 *
 * A worker's `resourceLimits.maxOldGenerationSizeMb` is the limit only while
 * the process runs without `--max-old-space-size`. With that flag (on the
 * command line or in `NODE_OPTIONS`) the engine applies the flag's value to
 * every thread and ignores the worker's own limit. A lower flag value still
 * ends the worker alone, as its own limit would. A higher one would let the
 * worker grow past the limit it was given: this guard is for that case.
 *
 * The guard is armed only when the worker starts with more heap than its
 * limit allows for. Armed, it measures the old generation at checkpoints
 * (after each parse, after the lint of a batch, after triage, after each
 * file's metrics). Over the limit, it asks for one full collection and
 * measures again, so garbage the engine had no reason to collect yet does not
 * count; still over, it ends the worker with `HEAP_LIMIT_EXIT`, which the
 * main thread reports exactly as a worker the engine ended.
 *
 * Granularity: the limit is checked between steps, not inside one. A single
 * parse, or the rules' pass over one file, can go over the limit before the
 * next checkpoint sees it; the process's own limit still bounds that.
 * Not armed (no flag, or a flag at or below the limit), nothing here runs.
 */
import v8 from 'node:v8';
import vm from 'node:vm';

/** Exit code of a worker this guard ended. */
export const HEAP_LIMIT_EXIT = 70;

const MB = 1024 * 1024;

/**
 * What a worker's total heap limit may exceed its old-generation limit by
 * when the engine honours the limit: the young generation (48 MB at the
 * engine's defaults). More than this, and something raised the limit.
 */
const YOUNG_ALLOWANCE_MB = 64;

/** Used size of the spaces the old-generation limit counts, in MB. */
export function oldGenerationUsedMb(): number {
  let bytes = 0;
  for (const space of v8.getHeapSpaceStatistics()) {
    if (/^(new_|read_only_|shared_)/.test(space.space_name)) continue;
    bytes += space.space_used_size;
  }
  return bytes / MB;
}

type Collector = (options?: { type: 'major'; execution: 'sync'; flavor: 'last-resort' }) => void;

/** This thread's collector once looked up: a function, or null where the engine does not let us reach it. */
let found: Collector | null | undefined;

/**
 * The engine's collector, where it lets us reach it; undefined where it does not.
 *
 * A process started with `--expose-gc` already has it, and nothing is changed
 * then. Otherwise the engine flag is switched on for the one moment it takes
 * to read the function out of a fresh, empty context, and off again: the
 * function stays in this module, and no global of this or any other context
 * is assigned. Looked up once per thread.
 */
function collector(): Collector | undefined {
  if (found !== undefined) return found ?? undefined;
  found = null;
  try {
    const own = (globalThis as { gc?: unknown }).gc;
    if (typeof own === 'function') {
      found = own as Collector;
    } else {
      v8.setFlagsFromString('--expose-gc');
      try {
        const gc = vm.runInNewContext('gc') as unknown;
        if (typeof gc === 'function') found = gc as Collector;
      } finally {
        v8.setFlagsFromString('--no-expose-gc');
      }
    }
  } catch {
    found = null;
  }
  return found ?? undefined;
}

/** One full collection of this thread's heap; false where the engine does not let us ask for it. */
function collect(): boolean {
  try {
    const gc = collector();
    gc?.();
    return gc !== undefined;
  } catch {
    return false;
  }
}

/**
 * Collects this thread's heap and hands the freed memory back to the system.
 * For the main thread, right after it drops everything it parsed and before
 * the analysis worker starts: left alone, the engine keeps those pages mapped
 * while the main thread only waits, beside the worker's own heap.
 *
 * One collection frees the objects but keeps the pages; measured on the
 * largest corpus suite, it took two plain collections and one that the
 * engine treats as a last resort before the pages went back (resident size
 * 1.7 GB -> 0.3 GB, about 0.1 s). Results never depend on this: where the
 * engine does not let us ask, the memory simply stays mapped for longer.
 */
export function releaseMemory(): boolean {
  try {
    const gc = collector();
    if (gc === undefined) return false;
    gc();
    gc();
    gc({ type: 'major', execution: 'sync', flavor: 'last-resort' });
    return true;
  } catch {
    return false;
  }
}

/**
 * The old-generation limit the engine really holds the worker to, in MB.
 *
 * `--max-old-space-size` (in `NODE_OPTIONS` or on the command line; the
 * command line wins, and the last one given wins) applies to every thread. A
 * value below `maxHeapMb` ends the worker at that value, so that value is the
 * one a `worker-died` detail names. No flag, or one at or above `maxHeapMb`:
 * `maxHeapMb` itself (heap guard above).
 */
export function effectiveHeapLimitMb(
  maxHeapMb: number,
  execArgv: readonly string[] = process.execArgv,
  nodeOptions: string | undefined = process.env.NODE_OPTIONS
): number {
  const args = [...(nodeOptions ?? '').split(/\s+/), ...execArgv];
  let flag: number | undefined;
  for (let i = 0; i < args.length; i++) {
    const m = /^--max[-_]old[-_]space[-_]size(?:=(.*))?$/.exec(args[i]);
    if (!m) continue;
    const value = Number(m[1] ?? args[i + 1]);
    if (Number.isInteger(value) && value > 0) flag = value;
  }
  return flag !== undefined && flag < maxHeapMb ? flag : maxHeapMb;
}

export interface HeapGuard {
  /** The engine is not holding the worker to `maxHeapMb`, so the checkpoints do. */
  readonly armed: boolean;
  check(): void;
}

/** `heapSizeLimitMb`, `usedMb` and `onExceeded` are parameters for tests; the defaults are the real ones. */
export function createHeapGuard(
  maxHeapMb: number,
  heapSizeLimitMb: number = v8.getHeapStatistics().heap_size_limit / MB,
  usedMb: () => number = oldGenerationUsedMb,
  onExceeded: () => void = () => process.exit(HEAP_LIMIT_EXIT)
): HeapGuard {
  const armed = heapSizeLimitMb > maxHeapMb + YOUNG_ALLOWANCE_MB;
  return {
    armed,
    check() {
      if (!armed || usedMb() <= maxHeapMb) return;
      // Garbage does not count. Where a collection cannot be asked for, the
      // first reading stands (the stricter of the two).
      if (collect() && usedMb() <= maxHeapMb) return;
      onExceeded();
    },
  };
}

let installed: HeapGuard | undefined;

/** Worker side, once, before the first batch. */
export function installHeapGuard(maxHeapMb: number): HeapGuard {
  installed = createHeapGuard(maxHeapMb);
  return installed;
}

/** Whether this thread has a heap guard at all, armed or not. */
export function heapGuardInstalled(): boolean {
  return installed !== undefined;
}

export function heapGuardArmed(): boolean {
  return installed?.armed === true;
}

/** A checkpoint. A no-op in the main thread, and in a worker the engine already limits. */
export function heapCheckpoint(): void {
  installed?.check();
}

/** `parser` with a checkpoint after each parse. Only used when the guard is armed. */
export function withHeapCheckpoint<P extends { parseForESLint: (...args: never[]) => unknown }>(parser: P): P {
  const guarded = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(parser)) guarded[key] = (parser as Record<string, unknown>)[key];
  guarded.parseForESLint = (...args: never[]): unknown => {
    const result = parser.parseForESLint(...args);
    heapCheckpoint();
    return result;
  };
  return guarded as P;
}
