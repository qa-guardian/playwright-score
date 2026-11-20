import type { RuleRow, Tier } from './types.js';
import { cellStats, cellTier } from './precision.js';

/** Decided rows a cell needs before its Wilson bound is shown, when the file carries counts. */
export const MIN_DECIDED = 5;

/**
 * Tier of a cell. The committed precision file decides: a listed cell has the
 * tier the file gives it. A cell the file does not list is likely, or advisory
 * when its design says so; it is never certain.
 */
export function tierOf(row: RuleRow, role: 'spec' | 'shared' = 'spec'): Tier {
  const listed = cellTier(row.rule, row.form, role);
  if (listed) return listed;
  return row.design === 'advisory' || row.design === 'deleting' ? 'advisory' : 'likely';
}

/**
 * Lower end of the 95% Wilson interval of the cell's decided precision,
 * rounded to two places. Null when fewer than MIN_DECIDED rows were decided.
 */
export function confidenceOfRow(row: RuleRow): number | null {
  const s = cellStats(row.rule, row.form, 'spec');
  if (!s || s.decided < MIN_DECIDED || s.wilsonLow === null) return null;
  return Math.round(s.wilsonLow * 100) / 100;
}
