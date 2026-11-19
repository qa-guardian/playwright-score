import type { RuleRow, Tier } from './types.js';
import { cellStats } from './precision.js';

/** A cell measured below this decided precision is advisory (needs at least MIN_DECIDED decided rows). */
export const ADVISORY_BELOW = 0.7;
export const MIN_DECIDED = 5;

/**
 * Tier of a cell, from its design and the committed precision file.
 *
 * A certain-candidate cell is `certain` only when precision.json records that
 * it passed a release path (`passedPath`). Development rows never qualify a
 * cell, so until the gate writes a path every candidate cell is `likely`; one
 * measured below 70% is advisory.
 */
export function tierOf(row: RuleRow, role: 'spec' | 'shared' = 'spec'): Tier {
  // A shared-file cell is likely until shared-file labels measure it, whatever its design.
  if (role === 'shared') return row.design === 'advisory' || row.design === 'deleting' ? 'advisory' : 'likely';
  switch (row.design) {
    case 'definite':
      return 'certain';
    case 'likely':
      return 'likely';
    case 'advisory':
    case 'deleting':
      return 'advisory';
    case 'candidate': {
      const s = cellStats(row.rule, row.form, 'spec');
      if (s && s.decided >= MIN_DECIDED && s.precision !== null && s.precision < ADVISORY_BELOW) return 'advisory';
      return s?.passedPath ? 'certain' : 'likely';
    }
  }
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
