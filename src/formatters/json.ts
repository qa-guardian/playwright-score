import type { ScoreResult } from '../types.js';

export function formatJson(result: ScoreResult): string {
  return JSON.stringify(result, null, 2);
}
