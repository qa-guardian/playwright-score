import ts from 'typescript';
import { BINARY_SNIFF_BYTES, MAX_SOURCE_BYTES, readHead, type HeadRead } from './fs-util.js';
import { looksLikeNonPlaywrightTest } from './metrics.js';
import { importsPlaywrightTestTransitively } from './playwright-config.js';
import type { SkipReason } from './types.js';

/**
 * File admission: which candidate files are Playwright files, and which of
 * those are scored. The order is fixed: classify first, guard second. Whether
 * a file is a Playwright file is decided before a size cap, a NUL byte, a read
 * error or a parse error has a say, and a guard (`coverage.skipped`) only ever
 * applies to a file already classified as a Playwright file.
 */

/**
 * How a file became a candidate. E: a file path the caller named. G: a match
 * of a glob the caller passed. D: a directory scan with the default spec-name
 * pattern. CS: matched through the Playwright config and named like a spec.
 * CN: matched through the config, not named like a spec.
 */
export type Route = 'E' | 'G' | 'D' | 'CS' | 'CN';
export const ROUTES: readonly Route[] = ['E', 'G', 'D', 'CS', 'CN'];
/** `unknown`: not evaluated for this file. */
export type Tri = 'yes' | 'no' | 'unknown';

export interface AdmissionFacts {
  route: Route;
  /** Route CN only: a `@playwright/test` import, direct or through a local module. */
  playwrightImport: Tri;
  /** Another test framework's signal in the head. Never evaluated on route E. */
  otherFramework: Tri;
  readError: boolean;
  overCap: boolean;
  nulEarly: boolean;
  /** Known only after linting; false until then. */
  parseError: boolean;
}

export type RowId = '01' | '02' | '03' | '04' | '05' | '06' | '07' | '08' | '09' | '10' | '11';
/**
 * `not-playwright`: left out, not listed. `other-framework`: listed in
 * `skippedFiles`. `skip`: a Playwright file listed in `coverage.skipped`.
 * `lint`: a Playwright file that is scored.
 */
export type Outcome = 'not-playwright' | 'other-framework' | 'skip' | 'lint';
export type NoRowReason =
  | 'read-error-with-a-fact-that-needs-bytes'
  | 'import-evaluated-off-route-CN'
  | 'import-not-evaluated-on-route-CN'
  | 'signal-evaluated-on-route-E'
  | 'signal-evaluated-without-a-playwright-import'
  | 'signal-not-evaluated'
  | 'over-cap-never-parsed'
  | 'other-framework-never-parsed'
  | 'binary-never-parsed';

export type AdmissionDecision =
  | { row: RowId; outcome: Outcome; reason?: SkipReason }
  | { row: null; noRow: NoRowReason };

const skip = (row: RowId, reason: SkipReason): AdmissionDecision => ({ row, outcome: 'skip', reason });
const noRow = (reason: NoRowReason): AdmissionDecision => ({ row: null, noRow: reason });

/**
 * The admission decision table as a pure function. Every tuple of facts maps
 * to one table row, or to the reason the tuple cannot occur.
 */
export function decideAdmission(f: AdmissionFacts): AdmissionDecision {
  const cn = f.route === 'CN';
  if (f.readError) {
    // No bytes were read, so nothing else is known about the file.
    if (f.overCap || f.nulEarly || f.parseError || f.playwrightImport !== 'unknown' || f.otherFramework !== 'unknown') {
      return noRow('read-error-with-a-fact-that-needs-bytes');
    }
    if (cn) return { row: '03', outcome: 'not-playwright' };
    return skip(f.route === 'E' ? '01' : '02', 'unreadable');
  }
  if (!cn && f.playwrightImport !== 'unknown') return noRow('import-evaluated-off-route-CN');
  if (cn && f.playwrightImport === 'unknown') return noRow('import-not-evaluated-on-route-CN');
  if (f.route === 'E' && f.otherFramework !== 'unknown') return noRow('signal-evaluated-on-route-E');
  if (cn && f.playwrightImport === 'no') {
    // Classification stops here: not a Playwright file, whatever else it holds.
    if (f.otherFramework !== 'unknown') return noRow('signal-evaluated-without-a-playwright-import');
    if (!f.overCap) return { row: '04', outcome: 'not-playwright' };
    return f.parseError ? noRow('over-cap-never-parsed') : { row: '09', outcome: 'not-playwright' };
  }
  if (f.route !== 'E' && f.otherFramework === 'unknown') return noRow('signal-not-evaluated');
  if (f.overCap && f.parseError) return noRow('over-cap-never-parsed');
  if (f.otherFramework === 'yes') {
    if (f.parseError) return noRow('other-framework-never-parsed');
    return { row: f.overCap ? '10' : '05', outcome: 'other-framework' };
  }
  // A Playwright file. Guards, first match wins.
  if (f.overCap) return skip('11', 'too-large');
  if (f.nulEarly) return f.parseError ? noRow('binary-never-parsed') : skip('06', 'binary');
  if (f.parseError) return skip('07', 'parse-error');
  return { row: '08', outcome: 'lint' };
}

function unwrapParens(node: ts.Expression | undefined): ts.Expression | undefined {
  let cur = node;
  while (cur && ts.isParenthesizedExpression(cur)) cur = cur.expression;
  return cur;
}

/** The specifier of `require('x')`: a plain call of the identifier with a quoted, non-empty first argument. */
function requireSpecifier(node: ts.Expression | undefined): string | undefined {
  const call = unwrapParens(node);
  if (!call || !ts.isCallExpression(call) || call.questionDotToken) return undefined;
  const callee = unwrapParens(call.expression);
  if (!callee || !ts.isIdentifier(callee) || callee.text !== 'require') return undefined;
  const arg = unwrapParens(call.arguments[0]);
  return arg && ts.isStringLiteral(arg) && arg.text !== '' ? arg.text : undefined;
}

function scriptKindFor(file: string): ts.ScriptKind {
  if (/\.tsx$/.test(file)) return ts.ScriptKind.TSX;
  if (/\.jsx$/.test(file)) return ts.ScriptKind.JSX;
  if (/\.(js|mjs|cjs)$/.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/**
 * Module specifiers of the top-level statements of `head`, read with an
 * error-tolerant parser so that a head cut off by the size cap still gives
 * its complete statements. The list is the one importsPlaywrightTestTransitively
 * builds for a source it can parse: every top-level `require` (a whole
 * expression statement, or the whole initialiser of a declarator in a
 * variable statement that is not exported) in statement order, then every
 * `import ... from` / `import '...'` / `export ... from` in statement order.
 * Nothing nested counts. With `overCap`, a statement that reaches the end of
 * the head is left out: the cap may have cut its specifier short.
 */
export function collectTopLevelSpecifiers(file: string, head: string, overCap: boolean): string[] {
  const sf = ts.createSourceFile(file, head, ts.ScriptTarget.Latest, false, scriptKindFor(file));
  const requires: string[] = [];
  const imports: string[] = [];
  for (const stmt of sf.statements) {
    if (overCap && stmt.end >= head.length) continue;
    if (ts.isExpressionStatement(stmt)) {
      const spec = requireSpecifier(stmt.expression);
      if (spec !== undefined) requires.push(spec);
    } else if (ts.isVariableStatement(stmt)) {
      if (stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
      for (const decl of stmt.declarationList.declarations) {
        const spec = requireSpecifier(decl.initializer);
        if (spec !== undefined) requires.push(spec);
      }
    } else if (ts.isImportDeclaration(stmt) || ts.isExportDeclaration(stmt)) {
      const spec = stmt.moduleSpecifier;
      if (spec && ts.isStringLiteral(spec)) imports.push(spec.text);
    }
  }
  return [...requires, ...imports];
}

/**
 * Route CN: whether a config-matched file that is not named like a spec
 * imports `@playwright/test`, directly or through a local module. At or under
 * the cap this is the helper's own answer on the whole file. Over the cap the
 * helper's strict parser cannot read a cut-off head, so the head's top-level
 * specifiers go through the same helper as a list of `require` lines.
 */
function hasPlaywrightImport(file: string, read: HeadRead & { ok: true }, boundaryDir: string): boolean {
  if (!read.overCap) return importsPlaywrightTestTransitively(file, read.text, boundaryDir);
  const specifiers = collectTopLevelSpecifiers(file, read.text, true);
  if (specifiers.length === 0) return false;
  const synthetic = specifiers.map((s) => `require(${JSON.stringify(s)});`).join('\n');
  return importsPlaywrightTestTransitively(file, synthetic, boundaryDir);
}

export interface Admitted {
  decision: AdmissionDecision & { row: RowId };
  /** The whole source, for a file that goes on to linting (row 08; row 07 is known later). */
  source?: string;
  /** For a skipped file: a size or an error code, never a path. */
  detail?: string;
}

/**
 * Admission for one run: reads each candidate once (the head is cached by
 * path) and maps what it found through decideAdmission. `read` is a seam for
 * tests (an injected read error).
 */
export class Admission {
  private readonly heads = new Map<string, HeadRead>();
  private readonly imports = new Map<string, boolean>();

  constructor(private readonly read: (file: string) => HeadRead = readHead) {}

  private head(file: string): HeadRead {
    let h = this.heads.get(file);
    if (!h) this.heads.set(file, (h = this.read(file)));
    return h;
  }

  /**
   * Site A (discovery, route CN): false when the file is not a Playwright
   * file (rows 03, 04, 09) and is left out of the candidate set.
   */
  keepsConfigMatch(file: string, boundaryDir: string): boolean {
    const h = this.head(file);
    const has = h.ok && hasPlaywrightImport(file, h, boundaryDir);
    this.imports.set(file, has);
    return has;
  }

  /** Site B: the decision for a candidate that discovery kept, or a named file. */
  admit(file: string, route: Route): Admitted {
    const h = this.head(file);
    if (!h.ok) {
      const decision = decideAdmission({ ...NO_FACTS, route, readError: true });
      return { decision: decision as Admitted['decision'], detail: h.code };
    }
    const hasImport = route === 'CN' ? (this.imports.get(file) ?? false) : undefined;
    const signalEvaluated = route !== 'E' && hasImport !== false;
    const decision = decideAdmission({
      route,
      playwrightImport: hasImport === undefined ? 'unknown' : hasImport ? 'yes' : 'no',
      otherFramework: !signalEvaluated ? 'unknown' : looksLikeNonPlaywrightTest(h.text) ? 'yes' : 'no',
      readError: false,
      overCap: h.overCap,
      nulEarly: h.nulEarly,
      parseError: false,
    }) as Admitted['decision'];
    if (decision.outcome === 'lint') return { decision, source: h.text };
    if (decision.reason === 'too-large') return { decision, detail: `${h.size} bytes (limit ${MAX_SOURCE_BYTES})` };
    if (decision.reason === 'binary') return { decision, detail: `NUL byte in the first ${BINARY_SNIFF_BYTES} bytes` };
    return { decision };
  }
}

const NO_FACTS: Omit<AdmissionFacts, 'route'> = {
  playwrightImport: 'unknown',
  otherFramework: 'unknown',
  readError: false,
  overCap: false,
  nulEarly: false,
  parseError: false,
};
