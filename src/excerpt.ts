/**
 * The `excerpt` of a finding (QAG-287 S10a): 1 to 5 source lines at the
 * finding, taken from text the run already read (no file is read here).
 *
 * Rule, deterministic:
 * - the first line is the finding's line;
 * - while the brackets ( [ { opened so far are not closed again, the next line
 *   is added, up to EXCERPT_MAX_LINES lines in all (strings, template literals
 *   and comments are skipped when counting);
 * - trailing whitespace is removed and the indentation the lines share is cut;
 * - a line longer than EXCERPT_LINE_CAP characters is cut to that length, the
 *   last three being "...";
 * - lines are joined with "\n". A finding without a line, or with a line the
 *   text does not have, gets "".
 */
export const EXCERPT_MAX_LINES = 5;
export const EXCERPT_LINE_CAP = 160;

/** Bracket depth change of one line, carrying an open template literal over to the next line. */
function depthOf(line: string, inTemplate: boolean): { delta: number; inTemplate: boolean } {
  let delta = 0;
  let quote: string | undefined = inTemplate ? '`' : undefined;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = undefined;
      continue;
    }
    if (c === '/' && line[i + 1] === '/') break;
    if (c === '/' && line[i + 1] === '*') {
      const end = line.indexOf('*/', i + 2);
      if (end < 0) break;
      i = end + 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '(' || c === '[' || c === '{') delta++;
    else if (c === ')' || c === ']' || c === '}') delta--;
  }
  return { delta, inTemplate: quote === '`' };
}

function cap(line: string): string {
  return line.length > EXCERPT_LINE_CAP ? `${line.slice(0, EXCERPT_LINE_CAP - 3)}...` : line;
}

/** The excerpt for `line` (1-based) of a file already split into lines. */
export function excerptAt(lines: readonly string[] | undefined, line: number | undefined): string {
  if (!lines || line === undefined || !Number.isInteger(line) || line < 1 || line > lines.length) return '';
  const picked: string[] = [];
  let depth = 0;
  let inTemplate = false;
  for (let n = line; n <= lines.length && picked.length < EXCERPT_MAX_LINES; n++) {
    const text = lines[n - 1]!.replace(/\s+$/, '');
    picked.push(text);
    const d = depthOf(text, inTemplate);
    depth += d.delta;
    inTemplate = d.inTemplate;
    if (depth <= 0 && !inTemplate) break;
  }
  const indents = picked.filter((l) => l.trim() !== '').map((l) => /^\s*/.exec(l)![0].length);
  const cut = indents.length ? Math.min(...indents) : 0;
  return picked.map((l) => cap(l.slice(cut))).join('\n');
}

/** Splits a source text into lines the way excerptAt counts them. */
export function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}
