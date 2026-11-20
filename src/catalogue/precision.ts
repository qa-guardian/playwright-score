import type { CellStats, Tier, VerdictCounts } from './types.js';
import { readCatalogueJson } from './data.js';

/**
 * The tier of every precision cell, committed as labels/precision.json. The
 * evaluator writes it; nothing in the scorer decides which cells are certain.
 * A cell may also carry verdict counts (an earlier schema did); they are read
 * when present and never required.
 */
interface PrecisionFile {
  schema: number;
  cells: Array<{ rule: string; form: string; role: string; tier: Tier } & Partial<CellStats>>;
}

export const EMPTY_COUNTS: VerdictCounts = { TRUE: 0, FALSE: 0, DEBATABLE: 0 };

type Cell = PrecisionFile['cells'][number];
let loaded: { file: PrecisionFile; byKey: Map<string, Cell> } | undefined;

export function cellKey(rule: string, form: string, role: 'spec' | 'shared' = 'spec'): string {
  return `${rule}|${form}|${role}`;
}

function load(): NonNullable<typeof loaded> {
  if (loaded) return loaded;
  const file = readCatalogueJson<PrecisionFile>('precision.json');
  const byKey = new Map<string, Cell>();
  for (const c of file.cells) byKey.set(cellKey(c.rule, c.form, c.role as 'spec' | 'shared'), c);
  loaded = { file, byKey };
  return loaded;
}

export function precisionFile(): PrecisionFile {
  return load().file;
}

/** Verdict counts for one cell, or undefined when the file carries none for it. */
export function cellStats(rule: string, form: string, role: 'spec' | 'shared' = 'spec'): CellStats | undefined {
  const c = load().byKey.get(cellKey(rule, form, role));
  return c && c.decided !== undefined && c.precision !== undefined && c.wilsonLow !== undefined ? (c as CellStats) : undefined;
}

/** The tier the file gives one cell, or undefined when the cell is not listed. */
export function cellTier(rule: string, form: string, role: 'spec' | 'shared' = 'spec'): Tier | undefined {
  return load().byKey.get(cellKey(rule, form, role))?.tier;
}
