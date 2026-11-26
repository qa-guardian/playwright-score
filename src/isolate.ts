/**
 * The analysis of a run's files (lint, triage, per-file metrics), and the
 * worker thread it runs in.
 *
 * Discovery and classification are finished in the main thread before this
 * module sees a file. The worker is a guard around the analysis only: a file
 * it gives up on (the time limit passed, or the worker ran out of heap or
 * died) was already classified as a Playwright file, is listed in `coverage`
 * and makes the result `partial`. It never moves a file into or out of
 * `skippedFiles`.
 *
 * Results do not depend on the machine: files go to the worker in sorted
 * batches of a fixed size, one batch at a time, and the batch results are
 * merged in batch order, so the output equals the in-process analysis
 * whenever no limit is hit.
 */
import { analysisFiles, createSharedLinter } from './shared-lint.js';
import path from 'node:path';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { dropFindingsOfSkipped, parseErrorFiles } from './coverage.js';
import { createTriage } from './finding-triage.js';
import { commonAncestorDir } from './fs-util.js';
import { HEAP_LIMIT_EXIT, effectiveHeapLimitMb, heapCheckpoint, heapGuardInstalled, installHeapGuard, releaseMemory } from './heap-guard.js';
import { analyzeSource, getTestSpans, type TestSpans } from './metrics.js';
import { clearParseCache, setParseCacheBudget, WORKER_MAX_CACHED_TOKENS } from './parse-cache.js';
import { createModuleResolver, type ImportResolver } from './module-resolution.js';
import { resetRuleCrashes, summarizeRuleCrashes } from './rules/base-plugin.js';
import type { Finding, ProfileName, SkipReason } from './types.js';
import type { FileLinter } from './eslint-runner.js';
import type { ScopeAliases } from './rules/aliased-page-api.js';

/**
 * Default old-generation heap limit of the analysis worker, in MB.
 *
 * ADR section 5.6: max(4096, 2 x the largest peak heap measured at S1-E),
 * rounded up to 512 MB. A source constant on purpose: it is never derived
 * from the host's RAM, so a result under the defaults cannot flip between
 * scored and partial from one machine to the next.
 */
export const DEFAULT_MAX_HEAP_MB = 4608;

/** Lowest heap limit accepted: below this the worker cannot load the lint engine. */
export const MIN_MAX_HEAP_MB = 64;

/**
 * Highest heap limit accepted, in MB (64 GB). A source constant on purpose,
 * never derived from the host. An upper bound is needed because the engine
 * does not refuse an absurd value: from 2^44 MB up it ends the whole calling
 * process instead (no error to catch, no result). 65536 is far below that,
 * and about 14 times the default.
 */
export const MAX_MAX_HEAP_MB = 65536;

/** Files per batch. Fixed, so batch boundaries never depend on the machine. */
export const BATCH_SIZE = 20;

/** Everything the analysis needs. Plain data: it is copied into the worker. */
export interface AnalysisInput {
  /** Files to analyse: absolute, sorted, already classified and read. */
  files: string[];
  /** Absolute path -> source, for every file in `files`. */
  sources: Map<string, string>;
  /** Locally imported dependency files, absolute path -> source. */
  importedFiles: Map<string, string>;
  /** Directory the findings' `file` paths are relative to. */
  filesBase: string;
  importBoundary: string;
  profile: ProfileName;
  cwd: string;
  assertFunctionNamesByFile: Map<string, string[]>;
  testAliasNames: string[];
  /** Shared files to lint (the `shared` option; shared-lint.ts), absolute and sorted. Absent: none. */
  sharedFiles?: string[];
  /** Spec files with a proven alias of Playwright's expect -> the alias names (expect-alias.ts). */
  expectAliasesByFile?: Map<string, string[]>;
  /** Spec files with a proven scope alias -> the names (rules/aliased-page-api.ts). */
  scopeAliasesByFile?: Map<string, ScopeAliases>;
  /** The same two maps for the shared files (shared-lint.ts): their alias lint runs as the specs' does. */
  sharedExpectAliasesByFile?: Map<string, string[]>;
  sharedScopeAliasesByFile?: Map<string, ScopeAliases>;
}

/** What the analysis says about one file that parsed. */
export interface FileFacts {
  /** Relative to `filesBase`, as findings name it. */
  rel: string;
  sloc: number;
  tests: number;
  native: number;
  raw: number;
  spans: TestSpans;
}

export interface BatchResult {
  /** Lint findings after triage; a file that did not parse keeps only its parse-error finding. */
  lintFindings: Finding[];
  /** Findings of the batch's shared files (shared-lint.ts). Absent when the batch holds none. */
  sharedFindings?: Finding[];
  /** New findings of the shared files' alias lint, not yet checked against the resolver. Absent when there are none. */
  sharedAliasFindings?: Finding[];
  /** New findings of the alias lint (expect-alias.ts), not yet checked against the resolver; not triaged. */
  aliasFindings: Finding[];
  metricFindings: Finding[];
  /** One entry per scored file, in file order. */
  facts: FileFacts[];
  /** Files that did not parse: [absolute path, detail]. */
  parseErrors: Array<[string, string]>;
  /** Contained rule crashes (set by the worker; the in-process path reads the shared log). */
  crashes?: Array<{ rule: string; count: number }>;
}

export interface WorkerSkip {
  file: string;
  reason: Extract<SkipReason, 'deadline' | 'worker-died'>;
  detail: string;
}

/**
 * The clock the time limit reads. Internal test seam (not part of the public
 * API, never a CLI flag): a test replaces `now` to make the limit pass at a
 * chosen checkpoint. `at` names the checkpoint that asks.
 */
export const clock = { now: (_at: string): number => performance.now() };

/** The time limit of one call. It bounds the whole call, from `startTimeLimit` on. */
export interface TimeLimit {
  /** As the caller gave it. Absent: no limit, and the clock is never read. */
  seconds?: number;
  /** Milliseconds until the limit passes; `Infinity` with no limit. */
  msLeft(at: string): number;
  passed(at: string): boolean;
}

export function startTimeLimit(seconds: number | undefined): TimeLimit {
  if (seconds === undefined) return { msLeft: () => Infinity, passed: () => false };
  const deadlineAt = clock.now('start') + seconds * 1000;
  const msLeft = (at: string): number => deadlineAt - clock.now(at);
  return { seconds, msLeft, passed: (at) => msLeft(at) <= 0 };
}

/** The skip entry of a file the time limit left unanalysed. */
export function deadlineSkip(file: string, limit: TimeLimit): WorkerSkip {
  return { file, reason: 'deadline', detail: `time limit ${limit.seconds} s` };
}

export interface IsolateLimits {
  maxHeapMb: number;
  time: TimeLimit;
  /** For tests: called with what each worker reports of itself once it is set up. Not given: the worker reports nothing. */
  onWorkerSetup?: (setup: WorkerSetup) => void;
}

/** What a worker holds after `setUpWorker`, read back from the modules that hold it. */
export interface WorkerSetup {
  /** The parse cache budget of the thread, in tokens. */
  cacheBudget: number;
  /** Whether a heap guard is installed in the thread. */
  heapGuard: boolean;
}

/**
 * What every analysis worker sets up before its first batch: its heap guard,
 * and its own parse cache budget (the main thread's is larger, and a worker
 * left on it holds more trees than its heap limit was measured with).
 */
export function setUpWorker(maxHeapMb: number): void {
  installHeapGuard(maxHeapMb);
  setParseCacheBudget(WORKER_MAX_CACHED_TOKENS);
}

/** The setup of the calling thread, as it is now. */
export function readWorkerSetup(): WorkerSetup {
  const cacheBudget = setParseCacheBudget(0);
  setParseCacheBudget(cacheBudget);
  return { cacheBudget, heapGuard: heapGuardInstalled() };
}

/**
 * The analysis of one list of files. Called once with every file (in
 * process) or once per batch (in the worker); both give the same findings,
 * because the lint base path and the triage knowledge are those of the whole
 * run either way.
 */
export function createAnalyzer(
  input: AnalysisInput,
  moduleResolver: ImportResolver = createModuleResolver(input.importBoundary)
): (files: string[]) => Promise<BatchResult> {
  const { filesBase, sources, importedFiles, importBoundary, testAliasNames } = input;
  const triage = createTriage({ filesBase, sources, importedFiles, importBoundary, moduleResolver });
  const basePath = input.files.length > 0 ? commonAncestorDir(input.files) : undefined;
  const relOf = (file: string): string => path.relative(filesBase, file) || path.basename(file);

  // Built on first use (with a worker, the main thread never loads the lint
  // engine) and reused for every later batch: the config is the whole run's.
  let linter: Promise<FileLinter> | undefined;
  const getLinter = (): Promise<FileLinter> => {
    linter ??= import('./eslint-runner.js').then((m) =>
      m.createLinter(
        {
          profile: input.profile,
          cwd: input.cwd,
          reportBase: filesBase,
          assertFunctionNamesByFile: input.assertFunctionNamesByFile,
          testAliasNames,
          expectAliasesByFile: input.expectAliasesByFile,
          scopeAliasesByFile: input.scopeAliasesByFile,
          basePath,
        },
        input.files
      )
    );
    return linter;
  };

  const lintShared = createSharedLinter(input, moduleResolver);

  return async (batch) => {
    // A batch may hold shared files (the `shared` option): they are linted with their own rule list, after the specs.
    const { files, shared } = lintShared.split(batch);
    const lintWith = files.length === 0 ? undefined : await getLinter();
    const linted = lintWith ? await lintWith(files) : [];
    // The alias lint's own findings skip the triage: whether their expect is one is the resolver's call (expect-alias.ts).
    const added = lintWith ? await lintWith.aliasPass(files, linted) : [];
    heapCheckpoint();
    const lint = triage(linted);
    heapCheckpoint();
    // A file that is not valid JS/TS keeps its parse-error finding and nothing else.
    const unparsed = parseErrorFiles(lint);
    const result: BatchResult = {
      lintFindings: dropFindingsOfSkipped(lint, new Set(unparsed.keys())),
      aliasFindings: dropFindingsOfSkipped(added, new Set(unparsed.keys())),
      metricFindings: [],
      facts: [],
      parseErrors: [],
    };
    for (const file of files) {
      const rel = relOf(file);
      const detail = unparsed.get(rel);
      if (detail !== undefined) {
        result.parseErrors.push([file, detail]);
        continue;
      }
      const source = sources.get(file) ?? '';
      // Parsed under the absolute path, as the lint filter and triage parsed it: one parse serves all.
      const m = analyzeSource(source, rel, testAliasNames, file);
      result.metricFindings.push(...m.findings);
      const spans = getTestSpans(source, file, testAliasNames);
      // The syntax tree's test declarations are the test count: they are the
      // attribution targets, and each gets one test state (test-states.ts).
      // A parse error was skipped above, so a file whose tree shows no test
      // declares none. No text count: `\btest\s*\(` also matches a function
      // named `test` (a fake runner) or `/re/.test(s)`, and such a "test"
      // had no state while summary.tests counted it.
      const tests = spans.tests.length;
      result.facts.push({ rel, sloc: m.sloc, tests, native: m.locators.native, raw: m.locators.raw, spans });
      heapCheckpoint();
    }
    if (shared.length > 0) {
      const s = await lintShared(shared);
      result.sharedFindings = s.findings;
      if (s.aliasFindings.length > 0) result.sharedAliasFindings = s.aliasFindings;
      result.parseErrors.push(...s.parseErrors);
      heapCheckpoint();
    }
    return result;
  };
}

/** `files` (already sorted) cut into consecutive batches of `size`. */
export function toBatches(files: readonly string[], size = BATCH_SIZE): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < files.length; i += size) out.push(files.slice(i, i + size));
  return out;
}

const WORKER_MARK = 'pwscoreAnalysisWorker';

/** The longest delay a timer takes (2^31 - 1 ms, about 24.8 days); Node turns a longer one into 1 ms. */
export const MAX_TIMER_MS = 2 ** 31 - 1;
/** How long a worker noted as dead may take to emit 'exit' once the time limit has passed. */
export const DEATH_GRACE_MS = 2000;

type WorkerEnd = { kind: 'finished' } | { kind: 'deadline' } | { kind: 'died'; detail: string; heap: boolean };

function deathEnd(error: unknown, maxHeapMb: number): WorkerEnd {
  const e = error as { code?: unknown; name?: unknown } | undefined;
  if (e?.code === 'ERR_WORKER_OUT_OF_MEMORY') return { kind: 'died', detail: `heap limit ${maxHeapMb} MB`, heap: true };
  // Never the message: it can carry a local path.
  const detail = typeof e?.name === 'string' && /^[A-Za-z]+$/.test(e.name) ? `worker error (${e.name})` : 'worker error';
  return { kind: 'died', detail, heap: false };
}

/**
 * Runs the analysis in a worker thread, batch by batch.
 *
 * - The time limit passes (it is checked before each batch, and a timer stops
 *   a batch in flight; a worker already noted as dead is left to its 'exit',
 *   for at most DEATH_GRACE_MS after the limit): the worker is stopped, and the batch in flight and
 *   every later one are skipped with `deadline`.
 * - The worker runs out of heap: the batch in flight and every later one are
 *   skipped with `worker-died` (QAG-287 FIX1: a fresh worker per batch under
 *   the same limit only died again, batch after batch).
 * - The worker dies of any other error: the batch it had as its first is
 *   skipped with `worker-died`, and a fresh worker takes the later ones. A
 *   batch sent after a result was read is handed to the fresh worker as its
 *   first batch (the death may have come before it was received), and is
 *   skipped only if it kills that worker too.
 *
 * Batches that came back before either event are kept.
 */
export async function analyzeIsolated(
  input: AnalysisInput,
  limits: IsolateLimits
): Promise<{ batches: BatchResult[]; skipped: WorkerSkip[] }> {
  // The worker parses for itself: the trees the main thread parsed before the
  // analysis are dropped here and their memory is handed back, so they are
  // not held beside the worker's (heap-guard.ts, releaseMemory). QAG-287 FIX1:
  // always, since the cache may already be empty while the alias finders'
  // trees are still garbage on the heap.
  clearParseCache();
  releaseMemory();
  const batches = toBatches(analysisFiles(input));
  const done: BatchResult[] = [];
  const skipped: WorkerSkip[] = [];
  const { time } = limits;
  // What a worker out of heap is reported with: the limit the engine really held it to.
  const heapLimitMb = effectiveHeapLimitMb(limits.maxHeapMb);

  let next = 0;
  /** One worker: batches from `next` on, until all are done, the worker dies or the time limit passes. */
  const runWorker = (): Promise<WorkerEnd> =>
    new Promise((resolve) => {
      const worker = new Worker(new URL(import.meta.url), {
        workerData: { [WORKER_MARK]: true, input, maxHeapMb: limits.maxHeapMb, reportSetup: limits.onWorkerSetup !== undefined },
        resourceLimits: { maxOldGenerationSizeMb: limits.maxHeapMb },
      });
      let settled = false;
      let timer: NodeJS.Timeout | undefined;
      const settle = (end: WorkerEnd): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        worker.removeAllListeners();
        worker.on('error', () => undefined); // a late error of a worker being stopped is not ours to report
        void worker.terminate().then(() => resolve(end), () => resolve(end));
      };
      // One timer holds at most MAX_TIMER_MS, so a longer limit is waited for
      // in parts: when the timer fires, the clock says whether the limit passed.
      const arm = (): void => {
        const left = time.msLeft('timer');
        if (left === Infinity) return;
        // A worker whose death is noted is not stopped here: 'exit' is certain to follow,
        // and settling now would drop the results Node still delivers before it.
        const onTimer = (): void => {
          if (settled) return;
          if (!time.passed('timer')) arm();
          else if (!death) settle({ kind: 'deadline' });
          // Node runs a worker's JS exit work before it reports its error, so only native teardown
          // is left in this window and 'exit' is not expected to stall. Should it, the limit still
          // ends the call: after a grace period the death settles as if 'exit' had come.
          else timer = setTimeout(() => finishDeath(undefined), DEATH_GRACE_MS);
        };
        timer = setTimeout(onTimer, Math.min(Math.max(0, left), MAX_TIMER_MS));
      };
      arm();
      // An uncaught error comes on the worker's internal port, so 'error' can
      // be emitted before messages the worker posted earlier (a batch result,
      // its setup report). Node delivers those before 'exit', so a death is
      // only noted here and settled on 'exit' (QAG-287 FIX1 R1).
      let death: WorkerEnd | undefined;
      let inFlight = true;
      // The batch in flight was posted after a result of this worker was read, so a death
      // cannot be told apart from one that came before the batch was received.
      let sentAfterResult = false;
      worker.on('message', (result: BatchResult | { setup: WorkerSetup }) => {
        if (settled) return;
        if ('setup' in result) return limits.onWorkerSetup?.(result.setup);
        done.push(result);
        next++;
        inFlight = false;
        if (next >= batches.length) settle({ kind: 'finished' });
        else if (time.passed(`batch:${next}`)) settle({ kind: 'deadline' });
        else if (!death) {
          worker.postMessage(batches[next]);
          inFlight = true;
          sentAfterResult = true;
        }
      });
      worker.on('error', (error) => {
        death ??= deathEnd(error, heapLimitMb);
      });
      // HEAP_LIMIT_EXIT: the worker's own heap guard ended it (heap-guard.ts).
      const finishDeath = (code: number | undefined): void => {
        const end: WorkerEnd =
          code === HEAP_LIMIT_EXIT ? { kind: 'died', detail: `heap limit ${heapLimitMb} MB`, heap: true } : (death ?? { kind: 'died', detail: 'worker error', heap: false });
        // Died of an error between batches, or with a batch that was sent after its last result was
        // read: that batch is not charged to the death, a fresh worker takes it as its first batch.
        // If it kills that worker too, it is the batch in flight there and is skipped (no loop).
        settle(end.kind === 'died' && !end.heap && (!inFlight || sentAfterResult) ? { kind: 'finished' } : end);
      };
      worker.on('exit', finishDeath);
      worker.postMessage(batches[next]);
    });

  while (next < batches.length) {
    const end: WorkerEnd = time.passed(`batch:${next}`) ? { kind: 'deadline' } : await runWorker();
    if (end.kind === 'deadline') {
      for (; next < batches.length; next++) skipped.push(...batches[next].map((file) => deadlineSkip(file, time)));
    } else if (end.kind === 'died') {
      // Out of heap: stop here, every later batch is skipped with the same detail (QAG-287 FIX1).
      // Any other death: only the dead worker's batch, and a fresh worker takes the later ones.
      const last = end.heap ? batches.length : next + 1;
      for (; next < last; next++) for (const file of batches[next]) skipped.push({ file, reason: 'worker-died', detail: end.detail });
    }
  }
  return { batches: done, skipped };
}

/** Worker side: one batch in, one result out. */
function serve(): void {
  const { input, maxHeapMb, reportSetup } = workerData as { input: AnalysisInput; maxHeapMb: number; reportSetup?: boolean };
  setUpWorker(maxHeapMb);
  if (reportSetup) parentPort!.postMessage({ setup: readWorkerSetup() });
  const analyze = createAnalyzer(input);
  parentPort!.on('message', (files: string[]) => {
    resetRuleCrashes();
    // A rejection is left unhandled on purpose: it ends the worker, and the
    // main thread skips the batch as `worker-died`.
    void analyze(files).then((result) => {
      parentPort!.postMessage({ ...result, crashes: summarizeRuleCrashes() });
    });
  });
}

if (!isMainThread && parentPort && (workerData as Record<string, unknown> | null)?.[WORKER_MARK] === true) serve();
