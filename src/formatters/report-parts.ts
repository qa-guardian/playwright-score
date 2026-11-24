import type { Finding, ScoreResult } from '../types.js';
import { CONFIDENCE_LABEL, compareFindings, isNeedsCheck, needsCheckIntro } from '../confidence.js';
import { copyFor } from '../rule-copy.js';
import { DIMENSIONS, cleanCheckCalls, mostAffectedFile, plural, type RuleGroup } from '../report-model.js';

/** Building blocks of the HTML report (report.ts puts them together). */
/** Returns the source text of a finding's file (path as in Finding.file), or undefined. */
export type SourceReader = (file: string) => string | undefined;

/** Rules that make a test flaky rather than merely untidy. */
export const FLAKE_RULES: readonly string[] = [
  'playwright/no-wait-for-timeout',
  'pwscore/no-timer-sleep',
  'playwright/no-networkidle',
  'playwright/no-force-option',
  'playwright/no-wait-for-selector',
  'playwright/missing-playwright-await',
];

export const DETAIL_CARDS = 5;

export const LEGEND =
  'Definite: the code does this for certain. Likely: usually a problem, but there are legitimate uses. None of these are confirmed bugs in your product; they are patterns that make bugs easier to miss or tests less reliable.';

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function longDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const mon = m ? MONTHS[Number(m[2]) - 1] : undefined;
  return m && mon ? `${Number(m[3])} ${mon} ${m[1]}` : iso;
}

function excerpt(source: string, line: number): Array<{ n: number; text: string; hit: boolean }> {
  const lines = source.split(/\r?\n/);
  if (line < 1 || line > lines.length) return [];
  const from = Math.max(1, line - 3);
  const to = Math.min(lines.length, line + 3);
  const out: Array<{ n: number; text: string; hit: boolean }> = [];
  for (let n = from; n <= to; n++) {
    let text = (lines[n - 1] ?? '').replace(/\t/g, '  ');
    if (text.length > 140) text = text.slice(0, 137) + '...';
    out.push({ n, text, hit: n === line });
  }
  return out;
}

function renderExcerpt(f: Finding, readSource?: SourceReader): string {
  if (!f.line || !readSource) return '';
  const src = readSource(f.file);
  if (src === undefined) return '';
  const rows = excerpt(src, f.line);
  if (!rows.length) return '';
  const body = rows
    .map((r) =>
      r.hit
        ? `<span class="ln hit"><i>&#9656;${r.n}</i><span class="sr-only">flagged line: </span>${escapeHtml(r.text) || ' '}</span>`
        : `<span class="ln"><i>${r.n}</i>${escapeHtml(r.text) || ' '}</span>`
    )
    .join('');
  return `<pre class="code" aria-label="Code excerpt">${body}</pre>`;
}

function loc(f: Finding): string {
  return f.line ? `${f.file}:${f.line}` : f.file;
}

function baseName(p: string): string {
  return p.split(/[/\\]/).pop() || p;
}

function tag(g: RuleGroup): string {
  return `<span class="tag">${CONFIDENCE_LABEL[g.confidence]}</span>`;
}

export function renderTop3(groups: RuleGroup[]): string {
  const items = groups
    .map((g, i) => {
      const c = copyFor(g.rule);
      const most = mostAffectedFile(g);
      const places = `${plural(g.findings.length, 'place')} in ${plural(g.testsAffected, 'test')}`;
      const where = `<code>${escapeHtml(baseName(most.file))}</code>${most.line ? ` (line ${most.line})` : ''}`;
      const sameFile = most.count === g.findings.length;
      const count =
        g.findings.length === 1
          ? `${places}: ${where}.`
          : `${places}. ${sameFile ? 'All in' : 'Most in'} ${where}.`;
      return `<li class="top"><span class="rank" aria-hidden="true">${i + 1}</span>
<div><h3>${escapeHtml(c.title)} ${tag(g)}</h3>
<p class="count">${count}</p>
<p class="why">${escapeHtml(c.why)}</p></div></li>`;
    })
    .join('\n');
  return `<ol class="top3" role="list">\n${items}\n</ol>`;
}

export function renderDetailCards(groups: RuleGroup[], readSource?: SourceReader): string {
  return groups
    .map((g, i) => {
      const c = copyFor(g.rule);
      const others = g.findings.length - 1;
      return `<article class="finding sev-${g.severity}">
<h3><span class="rank" aria-hidden="true">${i + 1}</span>${escapeHtml(c.title)} ${tag(g)}</h3>
<p class="where"><code>${escapeHtml(loc(g.example))}</code></p>
${renderExcerpt(g.example, readSource)}
<p class="why">${escapeHtml(c.why)}</p>
<p class="muted">${others > 0 ? `${plural(g.findings.length, 'occurrence')} across ${plural(g.testsAffected, 'test')}.` : 'One occurrence.'}</p>
</article>`;
    })
    .join('\n');
}

export function flakeFilesLine(findings: readonly Finding[]): string {
  const files = new Map<string, number>();
  for (const f of findings) {
    if (FLAKE_RULES.includes(f.rule) && !isNeedsCheck(f)) files.set(f.file, (files.get(f.file) ?? 0) + 1);
  }
  if (!files.size) return '';
  const worst = [...files.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([file, n]) => `<code>${escapeHtml(file)}</code> (${n})`)
    .join(', ');
  return `<p class="muted">Most flake-prone files: ${worst}.</p>`;
}

export function renderNeedsCheck(findings: readonly Finding[]): string {
  const items = findings.filter(isNeedsCheck).sort(compareFindings);
  if (!items.length) return '';
  const byFile = new Map<string, Finding[]>();
  for (const f of items) {
    const list = byFile.get(f.file);
    if (list) list.push(f);
    else byFile.set(f.file, [f]);
  }
  const files = [...byFile.entries()];
  const shown = files.slice(0, 6);
  const rows = shown
    .map(([file, list]) => {
      const lines = list.filter((f) => f.line).map((f) => f.line).join(', ');
      const calls = cleanCheckCalls(list[0]!.message);
      const unverified = list.every((f) => f.rule === 'playwright-score/assertion-unverified');
      const what = !unverified
        ? [...new Set(list.map((f) => copyFor(f.rule).title))].join('; ') + '.'
        : calls
          ? `Calls ${calls} from a helper we could not read.`
          : 'Its checks could not be seen.';
      return `<li><code>${escapeHtml(file)}</code> <span class="muted">${plural(list.length, 'test')}${lines ? `, line${list.length === 1 ? '' : 's'} ${escapeHtml(lines)}` : ''}</span><br><span class="muted">${escapeHtml(what)}</span></li>`;
    })
    .join('');
  const hidden = items.length - shown.reduce((n, [, l]) => n + l.length, 0);
  const more = hidden > 0 ? `<p class="muted">and ${plural(hidden, 'more test')} in ${plural(files.length - shown.length, 'other file')}.</p>` : '';
  const intro = needsCheckIntro(items).helpers
    ? `${plural(items.length, 'test')} ${items.length === 1 ? 'relies' : 'rely'} on helpers we could not read (page objects, fixtures or imported functions). The checks probably live there, but the score cannot see them, so ${items.length === 1 ? 'this test is' : 'these tests are'} left out of the score. Ask someone to confirm each helper really checks the page.`
    : `${plural(items.length, 'finding')} ${items.length === 1 ? 'is' : 'are'} information only: ${items.length === 1 ? 'it points' : 'they point'} at something worth a look, but the score cannot tell whether ${items.length === 1 ? 'it is' : 'they are'} a real problem, so ${items.length === 1 ? 'it is' : 'they are'} left out of the score. Ask someone to review each one.`;
  return `<h3 id="human-check">Not decided automatically</h3>
<p class="note">${intro}</p><ul class="plain">${rows}</ul>${more}`;
}

const GENERIC_STEPS = [
  'Re-run the score in CI with --threshold so the number cannot slip back unnoticed.',
  'Keep new specs on role, label and test-id locators with web-first assertions.',
  'Look at any items under "Not decided automatically" by hand.',
];

export function nextSteps(groups: RuleGroup[], extra: string[] = []): string[] {
  const steps: string[] = [];
  const fixes = groups.map((g) => copyFor(g.rule).fix).filter((f, i, a) => a.indexOf(f) === i);
  const maxFromFindings = 3 - Math.min(extra.length, 2);
  for (const fix of fixes.slice(0, maxFromFindings)) steps.push(fix);
  for (const e of extra) {
    if (steps.length < 3) steps.push(e);
  }
  for (const s of GENERIC_STEPS) {
    if (steps.length >= 3) break;
    steps.push(s);
  }
  return steps;
}

export function renderBars(result: ScoreResult): string {
  const bars = DIMENSIONS.map((d) => {
    const v = result.dimensions[d.key] ?? 0;
    return `<div class="dim" title="${escapeHtml(d.meaning)}"><div class="dimhead"><span>${d.label}</span><strong>${v}</strong></div>
<div class="bar" role="img" aria-label="${d.label} ${v} out of 100"><span style="width:${Math.max(0, Math.min(100, v))}%"></span></div>
<p class="muted sr-only">${escapeHtml(d.meaning)}</p></div>`;
  }).join('\n');
  return `<h2>Score by area</h2>\n<div class="dims">\n${bars}\n</div>`;
}
