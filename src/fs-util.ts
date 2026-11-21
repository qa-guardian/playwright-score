import fs from 'node:fs';
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

/** A source file larger than this is skipped, never read or parsed. */
export const MAX_SOURCE_BYTES = 1024 * 1024;
/** A NUL byte this early marks a file as binary. */
export const BINARY_SNIFF_BYTES = 8 * 1024;

export type SourceRead =
  | { ok: true; source: string }
  | { ok: false; reason: 'too-large' | 'binary' | 'unreadable'; detail: string };

/**
 * Reads one source file for scoring, and never throws. A file over
 * MAX_SOURCE_BYTES, a file with a NUL byte in its first BINARY_SNIFF_BYTES, or
 * a file that cannot be read (a broken or looping link, a directory, a
 * permission error) comes back as a reason instead of a source. `detail` holds
 * a size or an error code only, never a path.
 */
export function readSourceFile(file: string): SourceRead {
  let buf: Buffer;
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return { ok: false, reason: 'unreadable', detail: 'not a regular file' };
    if (st.size > MAX_SOURCE_BYTES) return { ok: false, reason: 'too-large', detail: tooLarge(st.size) };
    buf = fs.readFileSync(file);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    return { ok: false, reason: 'unreadable', detail: typeof code === 'string' ? code : 'read error' };
  }
  // The file can grow between the stat and the read.
  if (buf.length > MAX_SOURCE_BYTES) return { ok: false, reason: 'too-large', detail: tooLarge(buf.length) };
  if (buf.subarray(0, BINARY_SNIFF_BYTES).includes(0)) {
    return { ok: false, reason: 'binary', detail: `NUL byte in the first ${BINARY_SNIFF_BYTES} bytes` };
  }
  return { ok: true, source: buf.toString('utf8') };
}

function tooLarge(bytes: number): string {
  return `${bytes} bytes (limit ${MAX_SOURCE_BYTES})`;
}

/**
 * `.//abs/dir` is what `./` + an absolute path gives (a workflow that writes
 * `./${dir}` with an absolute `dir`). Read literally it points under the
 * current directory. When nothing is there and the absolute path exists, the
 * absolute path is meant.
 */
export function resolveDotSlashAbsolute(input: string, cwd: string = process.cwd()): string {
  const m = /^\.\/+(?=\/)/.exec(input);
  if (!m) return input;
  const absolute = path.normalize(input.slice(m[0].length));
  if (fs.existsSync(path.resolve(cwd, input))) return input;
  return fs.existsSync(absolute) ? absolute : input;
}
