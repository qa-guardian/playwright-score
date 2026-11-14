import os from 'node:os';
import path from 'node:path';

/** Folder names that say nothing about whose suite this is. */
const GENERIC_NAMES = new Set(['playwright', 'e2e', 'e2e-tests', 'tests', 'test', 'specs', 'spec', 'src']);

/**
 * Label for one scored path, used when --name is absent. A file keeps its
 * basename. A folder gets its own name plus parents: three segments when the
 * name is generic ("mattermost/e2e-tests/playwright"), two otherwise. Never
 * reaches above the home directory or the filesystem root, so the label does
 * not carry a user name or an absolute path.
 */
export function suiteLabel(p: string, isDir: boolean, home: string = os.homedir()): string {
  const abs = path.resolve(p);
  const base = path.basename(abs) || p;
  if (!isDir) return base;
  const want = GENERIC_NAMES.has(base.toLowerCase()) ? 3 : 2;
  const parts = [base];
  let cur = abs;
  while (parts.length < want) {
    const parent = path.dirname(cur);
    if (parent === cur || parent === home || parent === path.dirname(home)) break;
    const name = path.basename(parent);
    if (!name) break;
    parts.unshift(name);
    cur = parent;
  }
  return parts.join('/');
}
