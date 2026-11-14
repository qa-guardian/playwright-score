import os from 'node:os';
import path from 'node:path';

/** Folder names that say nothing about whose suite this is. */
const GENERIC_NAMES = new Set(['playwright', 'e2e', 'e2e-tests', 'tests', 'test', 'specs', 'spec', 'src']);

const NEUTRAL = 'Playwright suite';
const HOME_PARENTS = new Set(['home', 'users']);

/**
 * Label for one scored path, used when --name is absent. A file keeps its
 * basename. A folder gets its own name plus parents: three segments when the
 * name is generic ("mattermost/e2e-tests/playwright"), two otherwise. Never
 * reaches the user-name segment of a home directory or anything above it:
 * the walk stops under any `home`/`Users` segment (wherever it sits, so
 * `/tmp/home/alice/e2e` is safe even if $HOME says otherwise) and under the
 * current home directory. A folder that is itself a home directory gets a
 * neutral label.
 */
export function suiteLabel(p: string, isDir: boolean, home: string = os.homedir()): string {
  const abs = path.resolve(p);
  const base = path.basename(abs) || p;
  if (!isDir) return base;
  const segs = abs.split(path.sep).filter(Boolean);
  // First segment index the label may use.
  let min = 0;
  segs.forEach((seg, k) => {
    if (HOME_PARENTS.has(seg.toLowerCase())) min = Math.max(min, k + 2);
  });
  const homeSegs = path.resolve(home || path.sep).split(path.sep).filter(Boolean);
  if (homeSegs.length > 0 && homeSegs.every((seg, k) => segs[k] === seg)) min = Math.max(min, homeSegs.length);
  if (segs.length <= min) return NEUTRAL;
  const want = GENERIC_NAMES.has(base.toLowerCase()) ? 3 : 2;
  return segs.slice(Math.max(min, segs.length - want)).join('/');
}
