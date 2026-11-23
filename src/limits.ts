import { MAX_MAX_HEAP_MB, MIN_MAX_HEAP_MB } from './isolate.js';

/**
 * The one check of the two run limits, shared by the library (`scorePaths`)
 * and the CLI, so that neither accepts a value the other refuses.
 *
 * A heap limit below `MIN_MAX_HEAP_MB` is refused rather than tried: under a
 * few MB the engine cannot start a worker at all and ends the whole calling
 * process, with no error to catch and no result. A limit above
 * `MAX_MAX_HEAP_MB` is refused for the same reason: an absurdly large value
 * (2^44 MB or more) ends the calling process in the same way.
 */
export type LimitName = 'maxSeconds' | 'maxHeapMb';

/** What is wrong with a limit's value, or `undefined` when it is usable. `undefined` (no limit given) is usable. */
export function limitProblem(name: LimitName, value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (name === 'maxSeconds') {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? undefined : 'must be a number above 0';
  }
  return typeof value === 'number' && Number.isInteger(value) && value >= MIN_MAX_HEAP_MB && value <= MAX_MAX_HEAP_MB
    ? undefined
    : `must be a whole number from ${MIN_MAX_HEAP_MB} to ${MAX_MAX_HEAP_MB}`;
}

/** Throws a `RangeError` for a limit that is not usable. Called before any file is looked at. */
export function assertLimits(limits: { maxSeconds?: unknown; maxHeapMb?: unknown }): void {
  for (const name of ['maxSeconds', 'maxHeapMb'] as const) {
    const problem = limitProblem(name, limits[name]);
    if (problem !== undefined) throw new RangeError(`${name} ${problem}`);
  }
}
