import type { Finding, FindingRef } from './types.js';

/** A pointer to one finding: rule, form, file, line and column (QAG-287 S9a). */
export function findingRef(f: Finding): FindingRef {
  return {
    rule: f.rule,
    ...(f.form !== undefined ? { form: f.form } : {}),
    file: f.file,
    ...(f.line !== undefined ? { line: f.line } : {}),
    ...(f.column !== undefined ? { column: f.column } : {}),
  };
}

/** Sorts by file, line, column, rule, then form. */
export function compareRefs(a: FindingRef, b: FindingRef): number {
  const text = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);
  return (
    text(a.file, b.file) ||
    (a.line ?? 0) - (b.line ?? 0) ||
    (a.column ?? 0) - (b.column ?? 0) ||
    text(a.rule, b.rule) ||
    text(a.form ?? '', b.form ?? '')
  );
}
