/**
 * Proof results (QAG-287 B2.2): the one constructor of a positive result, the
 * closed list of proof rules and the closed list of "not proven" reasons.
 *
 * Everything the binding resolver, the export table and the receiver proof
 * return is either `proven(...)` or `notProven(...)`. A shape that no proof
 * rule names is "not proven"; nothing is ever read as "not Playwright".
 */
import type { RunnerEnv } from './runner-resolve.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type N = { type: string; [k: string]: any };

/**
 * Every rule that can create a positive result. `proven` is called once for each, and nowhere else.
 *  R       rule R hands the specifier to the package lookup (the leaf of every proof of an export)
 *  V1-V5   what a name denotes inside one file
 *  X1-X7   what a local module exports
 *  T       a type name bound by an import
 *  B1-B3   Playwright's `test`, `.extend(...)` of it, `mergeTests(...)` of such objects
 *  B4-B5   `.extend(...)` or `.configure(...)` of Playwright's `expect`, `mergeExpects(...)` of such objects
 *  E1-E3   a receiver: fixture, type annotation, factory
 */
export const PROOF_RULES = ['R', 'V1', 'V2', 'V3', 'V4', 'V5', 'X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'X7', 'T', 'B1', 'B2', 'B3', 'B4', 'B5', 'E1', 'E2', 'E3'] as const;
export type ProofRule = (typeof PROOF_RULES)[number];

/** Why something is not proven. Internal: never written to a finding or to any output. */
export const REASONS = [
  'depth', 'cycle', 'steps', 'module-unresolved', 'module-unreadable', 'ambiguous-module', 'runner-config', 'package-aliased',
  'reflection', 'unknown-statement', 'export-assignment', 'unreadable-pattern', 'mixed-module', 'cjs-shape', 'cjs-default',
  'competing-export', 'local-declaration', 'ambiguous-star', 'no-such-export', 'namespace-of-local-module',
  'not-a-binding-shape', 'multiple-definitions', 'global-or-undeclared', 'type-needs-import', 'not-a-playwright-export',
  'receiver-shape', 'binding-written', 'class-member', 'no-reported-call', 'internal-error',
] as const;
export type Reason = (typeof REASONS)[number];

export interface Proven<T> {
  ok: true;
  value: T;
  /** Every proof rule the result went through. */
  rules: readonly ProofRule[];
}
export interface NotProven {
  ok: false;
  reason: Reason;
  /** File and line of the import, export or declaration at which the proof stopped. */
  at: { file: string; line: number };
}
export type Result<T> = Proven<T> | NotProven;

/** The one constructor of a positive result. `from` holds the rules of the results it rests on. */
export function proven<T>(rule: ProofRule, value: T, ...from: Array<readonly ProofRule[]>): Proven<T> {
  return { ok: true, value, rules: [...new Set<ProofRule>([...from.flat(), rule])] };
}

export function notProven(reason: Reason, file: string, node?: N | null): NotProven {
  const line = node?.loc?.start?.line;
  return { ok: false, reason, at: { file, line: typeof line === 'number' ? line : 0 } };
}

/** An export of a package: outcome 1 (`playwright: true`) or outcome 2 of the resolver's interface. */
export interface PackageExport {
  package: string;
  name: string;
  playwright: boolean;
}

/** One parsed file with its scope analysis. `context` is the part of an ESLint rule context that `resolveConstInit` reads. */
export interface ScopeFile {
  file: string;
  ast: N;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context: any;
  parents: Map<N, N | undefined>;
}

/** Where other files come from. `load` returns undefined for a file that cannot be read or parsed; `runner` is rule R's view of the tree. */
export interface ResolveEnv {
  load(file: string): ScopeFile | undefined;
  runner: RunnerEnv;
}

/** Local modules followed from the spec file. */
export const MAX_FILE_DEPTH = 4;
/** Expression steps followed inside one file. */
export const MAX_STEPS = 12;

/** Packages that export Playwright's `test`. */
const TEST_PACKAGE = /^(@playwright\/test|playwright\/test|@playwright\/experimental-ct-[a-z0-9-]+)$/;
/** The Playwright package list: packages that export Playwright's `test`, its `Page` and `Frame` types or its browser launchers. */
const PLAYWRIGHT_PACKAGE = /^(@playwright\/test|playwright\/test|@playwright\/experimental-ct-[a-z0-9-]+|playwright|playwright-core|playwright-chromium|playwright-firefox|playwright-webkit)$/;
/** Test packages whose default export is `test` (measured on 1.57.0: a default import of either lists the test). Other test packages are not on it: not measured, so not proven. */
const DEFAULT_IS_TEST = /^(@playwright\/test|playwright\/test)$/;

export const isPlaywrightPackage = (pkg: string): boolean => PLAYWRIGHT_PACKAGE.test(pkg);
export const isTestPackage = (pkg: string): boolean => TEST_PACKAGE.test(pkg);
/** B1: the export `test` of a test package (or `default`, where the package's default export is `test`). */
export const isTestExport = (e: PackageExport): boolean =>
  e.playwright && TEST_PACKAGE.test(e.package) && (e.name === 'test' || (e.name === 'default' && DEFAULT_IS_TEST.test(e.package)));

/** The export `expect` of a test package. */
export const isExpectExport = (e: PackageExport): boolean => e.playwright && TEST_PACKAGE.test(e.package) && e.name === 'expect';
/** `mergeExpects` of the two packages that are documented to export it. */
export const isMergeExpects = (e: PackageExport): boolean => e.playwright && DEFAULT_IS_TEST.test(e.package) && e.name === 'mergeExpects';

/** How far a question is followed, and how an expression inside a followed module is read. */
export interface Walk {
  /** Local modules this question may follow (MAX_FILE_DEPTH for `test`; 0 for launchers and types, as before). */
  maxDepth: number;
  /** (file, export name) pairs being read: no proof through a cycle. */
  stack: string[];
  /** Reads an expression of a followed module, at the depth of that module. */
  value(sf: ScopeFile, node: N | undefined, depth: number, via: readonly ProofRule[]): Result<PackageExport>;
}
