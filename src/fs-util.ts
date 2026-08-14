import path from 'node:path';

/**
 * Deepest directory that contains every given absolute file path.
 * Used as the ESLint flat-config basePath so linting never silently
 * excludes files that fall outside an unrelated caller cwd.
 */
export function commonAncestorDir(absoluteFiles: string[]): string {
  const dirs = absoluteFiles.map((f) => path.dirname(path.resolve(f)));
  if (dirs.length === 0) return process.cwd();

  let common = dirs[0].split(path.sep);
  for (const dir of dirs.slice(1)) {
    const parts = dir.split(path.sep);
    let i = 0;
    while (i < common.length && i < parts.length && common[i] === parts[i]) {
      i++;
    }
    common = common.slice(0, i);
  }

  const joined = common.join(path.sep);
  return joined || path.sep;
}
