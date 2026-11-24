import fs from 'node:fs';
import path from 'node:path';
import { ROWS, rowFor } from './catalogue/table.js';
import { parseErrorFiles } from './coverage.js';
import { applyExpectBinding, FOREIGN_EXPECT_FORM } from './expect-binding.js';
import { createTriage } from './finding-triage.js';
import { commonAncestorDir } from './fs-util.js';
import type { ImportResolver } from './module-resolution.js';
import { applyReceiverForms, type ReceiverContext } from './receiver-forms.js';
import type { SharedFiles } from './shared-files.js';
import type { Finding, ProfileName } from './types.js';

/**
 * Shared-file linting (the `shared` option, CLI `--shared`).
 *
 * The shared files of a run (shared-files.ts: the Playwright-bound files the
 * specs reach through imports, minus specs and declaration files) are linted
 * with the rules that hold outside a test body. Which rules those are is a
 * property of the catalogue: a cell marked `onShared`. Rules about test
 * structure (focused or skipped tests, describe nesting, a test without an
 * assertion) carry no mark and never run on a shared file.
 *
 * A shared finding is listed with `scope: 'shared'` and `usedBy`, the specs
 * that reach its file. It is never part of the score. Without the option
 * nothing in this module runs, and a result is what it was before.
 *
 * The shared files go through the same analysis as the specs: the same sorted
 * batches, the same worker with its heap and time limits, the same parse
 * cache. A shared file cut off by a limit is a skipped file like any other.
 */

/** Rule ids with at least one `onShared` cell, in catalogue order. */
export function sharedRuleIds(): string[] {
  return [...new Set(ROWS.filter((r) => r.onShared).map((r) => r.rule))];
}

/** The entries of a lint config's `rules` that run on shared files: the second config block. */
export function sharedRules<T>(rules: Readonly<Record<string, T>>): Record<string, T> {
  const ids = new Set(sharedRuleIds());
  return Object.fromEntries(Object.entries(rules).filter(([rule]) => ids.has(rule)));
}

/**
 * Whether a finding in a shared file is listed: its rule has an `onShared`
 * cell and, once its form is known, that cell is one. An assertion proven to
 * come from another library is never listed.
 */
export function listedOnShared(f: Pick<Finding, 'rule' | 'form'>): boolean {
  if (f.form === FOREIGN_EXPECT_FORM) return false;
  if (f.form === undefined) return ROWS.some((r) => r.rule === f.rule && r.onShared);
  return rowFor(f.rule, f.form)?.onShared === true;
}

/** Every file the analysis is given: the specs, and with the `shared` option the shared files, in one sorted list. */
export function analysisFiles(input: { files: string[]; sharedFiles?: string[] }): string[] {
  if (!input.sharedFiles || input.sharedFiles.length === 0) return input.files;
  return [...input.files, ...input.sharedFiles].sort();
}

export interface SharedLintPlan {
  /** Shared files to lint, absolute, sorted. */
  files: string[];
  /** Source of each shared file, by absolute path. */
  sources: Map<string, string>;
  /** Shared file -> the specs that reach it, both relative to the run's base directory; the specs are sorted. */
  usedBy: Map<string, string[]>;
}

/**
 * What a run with the `shared` option lints. `graph` is the closure and the
 * edges the shared set was computed from; `specs` are the run's spec files.
 */
export function planSharedLint(
  shared: SharedFiles | undefined,
  graph: { closure: ReadonlyMap<string, string>; edges: ReadonlyMap<string, readonly string[]> } | undefined,
  specs: readonly string[],
  baseDir: string
): SharedLintPlan {
  const rel = (abs: string): string => path.relative(baseDir, abs) || path.basename(abs);
  const files = shared?.linted ?? [];
  const wanted = new Set(files);
  const reachedBy = new Map<string, string[]>(files.map((f) => [f, []]));
  for (const spec of [...specs].sort()) {
    const seen = new Set<string>([spec]);
    const queue = [spec];
    for (let i = 0; i < queue.length; i++) {
      for (const dep of graph?.edges.get(queue[i]) ?? []) {
        if (seen.has(dep)) continue;
        seen.add(dep);
        queue.push(dep);
        if (wanted.has(dep)) reachedBy.get(dep)!.push(rel(spec));
      }
    }
  }
  const sources = new Map<string, string>();
  for (const f of files) {
    const source = graph?.closure.get(f);
    if (source !== undefined) sources.set(f, source);
  }
  return {
    files: [...files],
    sources,
    usedBy: new Map(files.map((f) => [rel(f), reachedBy.get(f)!.sort()])),
  };
}

export interface SharedLintInput {
  sharedFiles?: string[];
  importedFiles: Map<string, string>;
  filesBase: string;
  importBoundary: string;
  profile: ProfileName;
  cwd: string;
  testAliasNames: string[];
}

export interface SharedLinter {
  (files: string[]): Promise<{ findings: Finding[]; parseErrors: Array<[string, string]> }>;
  /** A batch cut into its spec files and its shared files. Without shared files the batch itself is returned. */
  split(batch: string[]): { files: string[]; shared: string[] };
}

/**
 * Analysis side (the worker, or the calling thread with `isolate: false`):
 * lints shared files with the shared rule list. The engine is built on first
 * use and reused for every batch.
 */
export function createSharedLinter(input: SharedLintInput, moduleResolver?: ImportResolver): SharedLinter {
  const all = input.sharedFiles ?? [];
  const set = new Set(all);
  const listed = new Set(sharedRuleIds());
  let linter: Promise<(files: string[]) => Promise<Finding[]>> | undefined;
  let triage: ((findings: Finding[]) => Finding[]) | undefined;
  const sourcesOf = (): Map<string, string> => {
    const sources = new Map<string, string>();
    for (const f of all) {
      let source = input.importedFiles.get(f);
      if (source === undefined) {
        try {
          source = fs.readFileSync(f, 'utf8');
        } catch {
          continue;
        }
      }
      sources.set(f, source);
    }
    return sources;
  };

  const run = async (files: string[]): Promise<{ findings: Finding[]; parseErrors: Array<[string, string]> }> => {
    linter ??= import('./eslint-runner.js').then((m) =>
      m.createLinter(
        {
          profile: input.profile,
          cwd: input.cwd,
          reportBase: input.filesBase,
          testAliasNames: input.testAliasNames,
          basePath: commonAncestorDir(all),
          shared: true,
        },
        all
      )
    );
    const raw = await (await linter)(files);
    // A shared file that is not valid JS/TS is a skipped file; it adds no finding.
    const unparsed = parseErrorFiles(raw);
    const kept = raw.filter((f) => listed.has(f.rule) && !unparsed.has(f.file));
    // The triage that tells a helper named `...Expect(` from a real expect() (finding-triage.ts).
    triage ??= createTriage({
      filesBase: input.filesBase,
      sources: sourcesOf(),
      importedFiles: input.importedFiles,
      importBoundary: input.importBoundary,
      moduleResolver,
    });
    return {
      findings: triage(kept),
      parseErrors: [...unparsed].map(([relFile, detail]) => [path.resolve(input.filesBase, relFile), detail] as [string, string]),
    };
  };
  return Object.assign(run, {
    split: (batch: string[]) =>
      set.size === 0 ? { files: batch, shared: [] } : { files: batch.filter((f) => !set.has(f)), shared: batch.filter((f) => set.has(f)) },
  });
}

/**
 * Main-thread side: the shared findings that are listed. The receiver step
 * and the expect binding run on them as they do on spec findings, with the
 * shared files as the text that was checked. A finding whose cell is not
 * `onShared` once its form is known, or whose file was skipped, is left out.
 */
export function finishSharedFindings(
  findings: Finding[],
  plan: SharedLintPlan,
  ctx: ReceiverContext,
  isSkipped: (absFile: string) => boolean
): Finding[] {
  const live = findings.filter((f) => !isSkipped(path.resolve(ctx.filesBase, f.file)));
  if (live.length === 0) return live;
  const shared: ReceiverContext = { ...ctx, sources: new Map([...ctx.sources, ...plan.sources]) };
  applyReceiverForms(live, shared);
  applyExpectBinding(live, shared);
  return live.filter(listedOnShared);
}
