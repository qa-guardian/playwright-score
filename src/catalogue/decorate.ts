import fs from 'node:fs';
import path from 'node:path';
import type { Finding } from '../types.js';
import type { Evidence, RuleRow } from './types.js';
import { defaultRow, rowFor, rowsOf } from './table.js';
import { confidenceOfRow, tierOf } from './tiers.js';
import { cellPassedPath } from './precision.js';

const MAX_EXCERPT = 240;

/** Row for a finding. A rule the table does not know gets a neutral advisory row. */
const UNKNOWN_ROW: RuleRow = {
  rule: '(unknown)',
  form: '-',
  family: 'maintainability',
  design: 'advisory',
  basis: 'convention',
  bcEligible: false,
  title: 'Other quality issue',
  what: 'A pattern this scorer reports but does not describe.',
  why: 'This pattern often makes tests less reliable.',
  fix: 'Review the flagged lines and simplify them.',
  dimension: 'playwrightHygiene',
  label: 'medium',
};

/** Copy for a finding of a multi-form rule whose form could not be decided. */
const UNDECIDED_COPY = {
  title: 'Pattern that needs a manual check',
  what: 'This scorer could not tell which kind of pattern this is.',
  why: 'What it means depends on the kind, so no claim is made.',
  fix: 'Read the flagged line and check it by hand.',
};

/**
 * Row for a finding, and whether its form is undecided. A rule with more than
 * one form whose finding carries no form is undecided: the finding is never
 * given the first row's form.
 */
function rowOf(f: Finding): { row: RuleRow; undecided: boolean; familyKnown: boolean } {
  const known = defaultRow(f.rule);
  if (!known) return { row: UNKNOWN_ROW, undecided: false, familyKnown: true };
  if (f.form !== undefined) return { row: rowFor(f.rule, f.form) ?? known, undecided: false, familyKnown: true };
  const rows = rowsOf(f.rule);
  if (rows.length <= 1) return { row: known, undecided: false, familyKnown: true };
  const sameFamily = rows.every((r) => r.family === known.family);
  const row: RuleRow = sameFamily ? { ...known } : { ...known, family: 'maintainability', ...UNDECIDED_COPY };
  return { row, undecided: true, familyKnown: sameFamily };
}

/** The source line a finding points at, trimmed and capped. Empty when it cannot be read. */
function excerptOf(lines: string[] | undefined, line: number | undefined): string {
  if (!lines || line === undefined || line < 1 || line > lines.length) return '';
  const text = lines[line - 1].replace(/\s+$/, '').replace(/^\s+/, '');
  return text.length > MAX_EXCERPT ? `${text.slice(0, MAX_EXCERPT - 3)}...` : text;
}

/**
 * Adds the catalogue fields to every finding, in place: form, tier, family,
 * basis, docs, title, what, why, fix, excerpt, evidence, confidence and
 * quotable. Only adds keys; no existing key is changed, so the score, the
 * grade and every earlier field are untouched.
 *
 * `baseDir` is the directory the findings' `file` paths are relative to; it is
 * used to read the excerpt line and is never written into a finding.
 */
export function decorateFindings(findings: Finding[], baseDir: string | undefined): void {
  const sources = new Map<string, string[] | undefined>();
  const linesOf = (file: string): string[] | undefined => {
    if (!baseDir) return undefined;
    const abs = path.resolve(baseDir, file);
    if (sources.has(abs)) return sources.get(abs);
    let lines: string[] | undefined;
    try {
      lines = fs.readFileSync(abs, 'utf8').split(/\r\n|\r|\n/);
    } catch {
      lines = undefined;
    }
    sources.set(abs, lines);
    return lines;
  };
  for (const f of findings) {
    const { row, undecided, familyKnown } = rowOf(f);
    const evidence: Evidence = f.evidence ?? 'name';
    if (!undecided) f.form = f.form ?? row.form;
    f.tier = undecided ? 'needs-check' : tierOf(row);
    if (familyKnown) f.family = row.family;
    f.basis = row.basis;
    if (row.docs) f.docs = row.docs;
    f.title = row.title;
    f.what = row.what;
    f.why = row.why;
    f.fix = row.fix;
    f.excerpt = f.line !== undefined && f.line > 0 ? excerptOf(linesOf(f.file), f.line) : '';
    f.evidence = evidence;
    f.confidence = undecided ? null : confidenceOfRow(row);
    f.quotable = isQuotable(f);
  }
}

/**
 * Whether a finding may be quoted: it is certain, and its cell's release path in the committed
 * precision file is M (measured). A BC (by construction), likely, advisory or needs-check
 * finding never is.
 */
export function isQuotable(f: Finding): boolean {
  if (f.tier !== 'certain' || f.form === undefined) return false;
  return cellPassedPath(f.rule, f.form, f.scope === 'shared' ? 'shared' : 'spec') === 'M';
}

/** Sets `quotable` on every finding from its final tier (a later step may lower a tier). */
export function settleQuotable(findings: Finding[]): void {
  for (const f of findings) f.quotable = isQuotable(f);
}
