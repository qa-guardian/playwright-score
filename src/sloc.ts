/**
 * Count source lines of code: exclude blank and pure-comment lines.
 */
export function countSloc(source: string): number {
  const lines = source.split(/\r?\n/);
  let sloc = 0;
  let inBlockComment = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (inBlockComment) {
      if (trimmed.includes('*/')) {
        inBlockComment = false;
        const after = trimmed.slice(trimmed.indexOf('*/') + 2).trim();
        if (after && !after.startsWith('//')) sloc++;
      }
      continue;
    }

    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) {
        inBlockComment = true;
        continue;
      }
      // single-line block comment /* ... */
      const after = trimmed.replace(/\/\*.*?\*\//g, '').trim();
      if (!after || after.startsWith('//')) continue;
      sloc++;
      continue;
    }

    if (trimmed.startsWith('//')) continue;

    sloc++;
  }

  return Math.max(sloc, 1);
}
