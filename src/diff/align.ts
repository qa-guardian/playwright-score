/**
 * Lines two scored sides up before they are compared (QAG-289). Pure.
 *
 * A side is keyed by paths relative to its own root, so a git ref (measured from the folder the command
 * runs in) and a directory given as `e2e` can name the same file `e2e/x.spec.ts` and `x.spec.ts`. When
 * the sides share no file name, the leading folder that makes them overlap is stripped from the longer
 * side. Then a file that was moved is matched to its old name by the set of tests it holds.
 */
import { testId, type SideData, type SideFinding, type SideTest } from './side.js';

export function rekey(side: SideData, rename: (file: string) => string): SideData {
  const files = new Map([...side.files].map(([f, v]) => [rename(f), v] as const));
  const tests = new Map<string, SideTest>();
  for (const t of side.tests.values()) {
    const file = rename(t.file);
    tests.set(testId(file, t.titlePath), { ...t, file });
  }
  const findings: SideFinding[] = side.findings.map((f) => ({ ...f, file: rename(f.file) }));
  return { ...side, files, tests, findings, skippedFiles: new Set([...(side.skippedFiles ?? [])].map(rename)) };
}

const names = (s: SideData): string[] => [...s.files.keys()];

/** The folder prefix to strip from `long` so its files meet `short`'s; undefined when none is clear. */
function strippable(short: string[], long: string[]): string | undefined {
  const byBase = new Map<string, string[]>();
  for (const f of short) {
    const b = f.slice(f.lastIndexOf('/') + 1);
    byBase.set(b, [...(byBase.get(b) ?? []), f]);
  }
  const votes = new Map<string, number>();
  for (const l of long) {
    for (const s of byBase.get(l.slice(l.lastIndexOf('/') + 1)) ?? []) {
      if (l.length > s.length && l.endsWith('/' + s)) {
        const prefix = l.slice(0, l.length - s.length);
        votes.set(prefix, (votes.get(prefix) ?? 0) + 1);
      }
    }
  }
  let best: string | undefined;
  let bestN = 0;
  let tie = false;
  const have = new Set(short);
  for (const prefix of votes.keys()) {
    const n = long.filter((l) => l.startsWith(prefix) && have.has(l.slice(prefix.length))).length;
    if (n > bestN) {
      best = prefix;
      bestN = n;
      tie = false;
    } else if (n === bestN && n > 0) tie = true;
  }
  return tie ? undefined : best;
}

export function alignPaths(base: SideData, head: SideData): { base: SideData; head: SideData; warnings: string[] } {
  const b = names(base);
  const h = names(head);
  if (b.length === 0 || h.length === 0) return { base, head, warnings: [] };
  const hs = new Set(h);
  if (b.some((f) => hs.has(f))) return { base, head, warnings: [] };
  const stripHead = strippable(b, h);
  const stripBase = stripHead === undefined ? strippable(h, b) : undefined;
  const cut = (prefix: string) => (f: string): string => (f.startsWith(prefix) ? f.slice(prefix.length) : f);
  if (stripHead !== undefined) return { base, head: rekey(head, cut(stripHead)), warnings: [] };
  if (stripBase !== undefined) return { base: rekey(base, cut(stripBase)), head, warnings: [] };
  return {
    base,
    head,
    warnings: ['the two sides share no file path, so every finding reads as new; check that both sides are measured from the same folder (see --path)'],
  };
}

/** `[from, to]` for each base-only file whose tests are exactly those of one head-only file. Precision first: any doubt matches nothing. */
export function matchRenames(base: SideData, head: SideData): Array<{ from: string; to: string }> {
  const signature = (s: SideData, file: string): string => {
    const keys: string[] = [];
    for (const t of s.tests.values()) if (t.file === file) keys.push(t.titlePath.join('\u0000'));
    return keys.length === 0 ? '' : keys.sort().join('\u0001');
  };
  const group = (s: SideData, files: string[]): Map<string, string[]> => {
    const out = new Map<string, string[]>();
    for (const f of files) {
      const sig = signature(s, f);
      if (sig !== '') out.set(sig, [...(out.get(sig) ?? []), f]);
    }
    return out;
  };
  const baseOnly = group(base, names(base).filter((f) => !head.files.has(f)));
  const headOnly = group(head, names(head).filter((f) => !base.files.has(f) && !(base.skippedFiles?.has(f) ?? false)));
  const out: Array<{ from: string; to: string }> = [];
  for (const [sig, to] of headOnly) {
    const from = baseOnly.get(sig);
    if (to.length === 1 && from?.length === 1) out.push({ from: from[0]!, to: to[0]! });
  }
  return out.sort((x, y) => (x.to < y.to ? -1 : x.to > y.to ? 1 : 0));
}
