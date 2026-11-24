import { PROFILE_WEIGHTS } from '../../src/profiles.js';
import type { ScoreResult } from '../../src/types.js';

/**
 * QAG-287 S9a: since score model v5 only certain findings (and, once measured, unasserted
 * tests) charge the score. The four dimensions keep the v4 model and its values, for
 * information; this is the v4 number they add up to (the weighted sum `computeScore` makes),
 * so the tests that pinned a v4 score keep guarding what feeds the dimensions.
 */
export function v4Weighted(r: Pick<ScoreResult, 'dimensions'>): number {
  let score = 0;
  for (const [dim, weight] of Object.entries(PROFILE_WEIGHTS.standard)) {
    score += ((weight ?? 0) / 100) * r.dimensions[dim as keyof ScoreResult['dimensions']];
  }
  return Math.round(score);
}
