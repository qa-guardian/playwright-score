import type { ScoreResult } from '../types.js';

export function formatJson(result: ScoreResult): string {
  // baseDir is an absolute local path used only by the report's excerpt
  // reader; it must never reach a shareable artifact.
  const { baseDir: _baseDir, ...shareable } = result;
  return JSON.stringify(shareable, null, 2);
}
