import fs from 'node:fs';
import path from 'node:path';
import type { SourceReader } from './formatters/report.js';

const MAX_DEPTH = 8;
const MAX_BYTES = 2 * 1024 * 1024;

function readIfFile(p: string): string | undefined {
  try {
    const st = fs.statSync(p);
    if (!st.isFile() || st.size > MAX_BYTES) return undefined;
    return fs.readFileSync(p, 'utf8');
  } catch {
    return undefined;
  }
}

/** Walks `dir` looking for a path that ends with `rel`; skips node_modules and dot dirs. */
function findBySuffix(dir: string, rel: string, depth: number): string | undefined {
  const direct = path.join(dir, rel);
  if (readIfFile(direct) !== undefined) return direct;
  if (depth >= MAX_DEPTH) return undefined;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return undefined;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    if (!e.isDirectory() || e.isSymbolicLink()) continue;
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const hit = findBySuffix(path.join(dir, e.name), rel, depth + 1);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Finding.file is relative to the scored files' common ancestor, which the
 * result does not record. Resolve it against each input path (file inputs:
 * their directory; directory inputs: a bounded search below them). Reads are
 * confined to the input directories, and a finding path with `..` segments
 * is refused.
 */
export function makeSourceReader(inputs: readonly string[], cwd: string): SourceReader {
  const bases = inputs
    .filter((p) => !/[*?{]/.test(p))
    .map((p) => path.resolve(cwd, p))
    .map((abs) => {
      try {
        return fs.statSync(abs).isDirectory() ? abs : path.dirname(abs);
      } catch {
        return undefined;
      }
    })
    .filter((b): b is string => b !== undefined);
  const cache = new Map<string, string | undefined>();
  return (file) => {
    if (cache.has(file)) return cache.get(file);
    let text: string | undefined;
    const segments = file.split(/[/\\]/);
    if (!path.isAbsolute(file) && !segments.includes('..')) {
      for (const base of bases) {
        const hit = findBySuffix(base, file, 0);
        if (hit) {
          text = readIfFile(hit);
          break;
        }
      }
    }
    cache.set(file, text);
    return text;
  };
}
