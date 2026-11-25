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

/** A source file larger than this is skipped: only its first bytes are read, and it is never parsed whole. */
export const MAX_SOURCE_BYTES = 1024 * 1024;
/** A NUL byte this early marks a file as binary. */
export const BINARY_SNIFF_BYTES = 8 * 1024;

/**
 * What one bounded read of a candidate file found. Facts and the head only:
 * whether the file is a Playwright file, and whether it is skipped, is decided
 * in admission.ts.
 */
export type HeadRead =
  | { ok: false; code: string }
  | {
      ok: true;
      /** The first min(size, MAX_SOURCE_BYTES) bytes as UTF-8: the whole file when `overCap` is false. */
      text: string;
      overCap: boolean;
      /** A NUL byte in the first BINARY_SNIFF_BYTES. */
      nulEarly: boolean;
      /** Size in bytes (from the stat when the file is over the cap). */
      size: number;
    };

let headBuffer: Buffer | undefined;

/**
 * Reads at most MAX_SOURCE_BYTES + 1 bytes of a file, and never throws. The
 * extra byte is how a file over the cap is told from one exactly at it. A path
 * that is not a regular file after links are followed (a FIFO, a socket, a
 * device, a directory) is never opened, since opening a FIFO blocks for ever;
 * it comes back as the code `not-a-regular-file`. Any other failure comes
 * back as its error code (`ENOENT`, `ELOOP`, `EACCES`, ...), never a path.
 */
export function readHead(file: string): HeadRead {
  let fd: number | undefined;
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return { ok: false, code: 'not-a-regular-file' };
    fd = fs.openSync(file, 'r');
    const buf = (headBuffer ??= Buffer.allocUnsafe(MAX_SOURCE_BYTES + 1));
    let n = 0;
    while (n < buf.length) {
      const got = fs.readSync(fd, buf, n, buf.length - n, null);
      if (got === 0) break;
      n += got;
    }
    const overCap = n > MAX_SOURCE_BYTES;
    const head = buf.subarray(0, Math.min(n, MAX_SOURCE_BYTES));
    return {
      ok: true,
      text: head.toString('utf8'),
      overCap,
      nulEarly: head.subarray(0, BINARY_SNIFF_BYTES).includes(0),
      size: overCap ? Math.max(st.size, n) : n,
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    return { ok: false, code: typeof code === 'string' ? code : 'read-error' };
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // nothing to release
      }
    }
  }
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

/**
 * How the no-files finding names a path the caller gave, never showing where
 * it lies outside the working directory (QAG-287 FIX1 R2). A relative path is
 * shown as given, an absolute one relative to `cwd` with `/` separators. When
 * that form leaves `cwd` (`..`), is still absolute (Windows, another drive),
 * or is `./` in front of an absolute path (`.//abs/path`), only its last
 * segment is shown. `p` is `path.win32` in tests.
 */
export function noFilesPathLabel(typed: string, cwd: string, p: typeof path = path): string {
  const shown = p.isAbsolute(typed) ? p.relative(cwd, typed) : typed;
  const bare = shown.replace(p.sep === '\\' ? /^(?:\.[\\/])+/ : /^(?:\.\/)+/, '');
  const norm = p.normalize(bare || '.');
  if (p.parse(bare).root !== '' || norm.split(p.sep)[0] === '..') return p.basename(norm) || '(outside the working directory)';
  return p.isAbsolute(typed) ? shown.split(p.sep).join('/') || '.' : typed;
}
