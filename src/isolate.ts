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
import { HEAP_LIMIT_EXIT, effectiveHeapLimitMb, heapCheckpoint, installHeapGuard, releaseMemory } from './heap-guard.js';
import { analyzeSource, getTestSpans, type TestSpans } from './metrics.js';
import { clearParseCache, setParseCacheBudget, WORKER_MAX_CACHED_TOKENS } from './parse-cache.js';
import { createModuleResolver, type ImportResolver } from './module-resolution.js';
import { resetRuleCrashes, summarizeRuleCrashes } from './rules/base-plugin.js';
import type { Finding, ProfileName, SkipReason } from './types.js';

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
  let linter: Promise<(files: string[]) => Promise<Finding[]>> | undefined;
  const lintFiles = async (files: string[]): Promise<Finding[]> => {
    linter ??= import('./eslint-runner.js').then((m) =>
      m.createLinter(
        {
          profile: input.profile,
          cwd: input.cwd,
          reportBase: filesBase,
          assertFunctionNamesByFile: input.assertFunctionNamesByFile,
          testAliasNames,
          basePath,
        },
        input.files
      )
    );
    return (await linter)(files);
  };

  const lintShared = createSharedLinter(input, moduleResolver);

  return async (batch) => {
    // A batch may hold shared files (the `shared` option): they are linted with their own rule list, after the specs.
    const { files, shared } = lintShared.split(batch);
    const linted = files.length === 0 ? [] : await lintFiles(files);
    heapCheckpoint();
    const lint = triage(linted);
    heapCheckpoint();
    // A file that is not valid JS/TS keeps its parse-error finding and nothing else.
    const unparsed = parseErrorFiles(lint);
    const result: BatchResult = {
      lintFindings: dropFindingsOfSkipped(lint, new Set(unparsed.keys())),
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
      // AST spans are the authoritative test count (they are also the
      // attribution targets); the regex count is the fallback for a file
      // whose syntax tree shows no test declaration.
      const tests = spans.tests.length > 0 ? spans.tests.length : m.tests;
      result.facts.push({ rel, sloc: m.sloc, tests, native: m.locators.native, raw: m.locators.raw, spans });
      heapCheckpoint();
    }
    if (shared.length > 0) {
      const s = await lintShared(shared);
      result.sharedFindings = s.findings;
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

type WorkerEnd = { kind: 'finished' } | { kind: 'deadline' } | { kind: 'died'; detail: string };

function deathDetail(error: unknown, maxHeapMb: number): string {
  const e = error as { code?: unknown; name?: unknown } | undefined;
  if (e?.code === 'ERR_WORKER_OUT_OF_MEMORY') return `heap limit ${maxHeapMb} MB`;
  // Never the message: it can carry a local path.
  return typeof e?.name === 'string' && /^[A-Za-z]+$/.test(e.name) ? `worker error (${e.name})` : 'worker error';
}

/**
 * Runs the analysis in a worker thread, batch by batch.
 *
 * - The time limit passes (it is checked before each batch, and a timer stops
 *   a batch in flight): the worker is stopped, and the batch in flight and
 *   every later one are skipped with `deadline`.
 * - The worker dies (out of heap, or any other error): the batch in flight
 *   is skipped with `worker-died`, and a fresh worker takes the later ones.
 *
 * Batches that came back before either event are kept.
 */
export async function analyzeIsolated(
  input: AnalysisInput,
  limits: IsolateLimits
): Promise<{ batches: BatchResult[]; skipped: WorkerSkip[] }> {
  // The worker parses for itself: the trees the main thread parsed before the
  // analysis are dropped here and their memory is handed back, so they are
  // not held beside the worker's (heap-guard.ts, releaseMemory).
  if (clearParseCache() > 0) releaseMemory();
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
        workerData: { [WORKER_MARK]: true, input, maxHeapMb: limits.maxHeapMb },
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
        const onTimer = (): void => (time.passed('timer') ? settle({ kind: 'deadline' }) : arm());
        timer = setTimeout(onTimer, Math.min(Math.max(0, left), MAX_TIMER_MS));
      };
      arm();
      worker.on('message', (result: BatchResult) => {
        if (settled) return;
        done.push(result);
        next++;
        if (next >= batches.length) settle({ kind: 'finished' });
        else if (time.passed(`batch:${next}`)) settle({ kind: 'deadline' });
        else worker.postMessage(batches[next]);
      });
      worker.on('error', (error) => settle({ kind: 'died', detail: deathDetail(error, heapLimitMb) }));
      // HEAP_LIMIT_EXIT: the worker's own heap guard ended it (heap-guard.ts).
      worker.on('exit', (code) =>
        settle({ kind: 'died', detail: code === HEAP_LIMIT_EXIT ? `heap limit ${heapLimitMb} MB` : 'worker error' })
      );
      worker.postMessage(batches[next]);
    });

  while (next < batches.length) {
    const end: WorkerEnd = time.passed(`batch:${next}`) ? { kind: 'deadline' } : await runWorker();
    if (end.kind === 'deadline') {
      for (; next < batches.length; next++) skipped.push(...batches[next].map((file) => deadlineSkip(file, time)));
    } else if (end.kind === 'died') {
      // Only the dead worker's batch: a later batch may need less, so each gets its own fresh worker.
      for (const file of batches[next++]) skipped.push({ file, reason: 'worker-died', detail: end.detail });
    }
  }
  return { batches: done, skipped };
}

/** Worker side: one batch in, one result out. */
function serve(): void {
  const { input, maxHeapMb } = workerData as { input: AnalysisInput; maxHeapMb: number };
  installHeapGuard(maxHeapMb);
  setParseCacheBudget(WORKER_MAX_CACHED_TOKENS);
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
