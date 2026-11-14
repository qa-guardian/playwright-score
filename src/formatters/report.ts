import type { Finding, ScoreResult } from '../types.js';
import { PROFILE_WEIGHTS } from '../profiles.js';
import { CONFIDENCE_LABEL, compareFindings, isNeedsCheck } from '../confidence.js';
import { copyFor } from '../rule-copy.js';
import { REPORT_CSS } from './report-css.js';
import {
  DIMENSIONS,
  barText,
  cleanCheckCalls,
  gradeBandText,
  mostAffectedFile,
  notScoredHeadline,
  notScoredState,
  plural,
  rankGroups,
  summaryTop,
  type RuleGroup,
  INCOMPLETE_NOTE,
} from '../report-model.js';

export { rankTopFindings, compareGroups, type RuleGroup } from '../report-model.js';

/** Returns the source text of a finding's file (path as in Finding.file), or undefined. */
export type SourceReader = (file: string) => string | undefined;

export interface ReportOptions {
  /** Shown in the header, e.g. "2026-11-14". Injected so output is reproducible. */
  date: string;
  /** Scorer package version. */
  version: string;
  /** Suite name or path shown under the headline. */
  suiteName: string;
  /** True when --threshold was passed, so the bar reads "your bar" instead of "the default bar". */
  customThreshold?: boolean;
  /** Source lookup for code excerpts; without it the excerpts are omitted. */
  readSource?: SourceReader;
}

/** Rules that make a test flaky rather than merely untidy. */
export const FLAKE_RULES: readonly string[] = [
  'playwright/no-wait-for-timeout',
  'pwscore/no-timer-sleep',
  'playwright/no-networkidle',
  'playwright/no-force-option',
  'playwright/no-wait-for-selector',
  'playwright/missing-playwright-await',
];

const DETAIL_CARDS = 5;

const LEGEND =
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

function longDate(iso: string): string {
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

function renderTop3(groups: RuleGroup[]): string {
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

function renderDetailCards(groups: RuleGroup[], readSource?: SourceReader): string {
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

function flakeFilesLine(findings: readonly Finding[]): string {
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

function renderNeedsCheck(findings: readonly Finding[]): string {
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
      const what = calls
        ? `Calls ${calls} from a helper we could not read.`
        : 'Its checks could not be seen.';
      return `<li><code>${escapeHtml(file)}</code> <span class="muted">${plural(list.length, 'test')}${lines ? `, line${list.length === 1 ? '' : 's'} ${escapeHtml(lines)}` : ''}</span><br><span class="muted">${escapeHtml(what)}</span></li>`;
    })
    .join('');
  const hidden = items.length - shown.reduce((n, [, l]) => n + l.length, 0);
  const more = hidden > 0 ? `<p class="muted">and ${plural(hidden, 'more test')} in ${plural(files.length - shown.length, 'other file')}.</p>` : '';
  return `<h3 id="human-check">Needs a human check</h3>
<p class="note">${plural(items.length, 'test')} ${items.length === 1 ? 'relies' : 'rely'} on helpers we could not read (page objects, fixtures or imported functions). The checks probably live there, but the score cannot see them, so ${items.length === 1 ? 'this test is' : 'these tests are'} left out of the score. Ask someone to confirm each helper really checks the page.</p><ul class="plain">${rows}</ul>${more}`;
}

const GENERIC_STEPS = [
  'Re-run the score in CI with --threshold so the number cannot slip back unnoticed.',
  'Keep new specs on role, label and test-id locators with web-first assertions.',
  'Review any items under "Needs a human check" by hand.',
];

function nextSteps(groups: RuleGroup[], extra: string[] = []): string[] {
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

function renderBars(result: ScoreResult): string {
  const weights = PROFILE_WEIGHTS[result.profile] ?? PROFILE_WEIGHTS.standard;
  const bars = DIMENSIONS.map((d) => {
    const v = result.dimensions[d.key] ?? 0;
    const w = weights[d.key];
    return `<div class="dim" title="${escapeHtml(d.meaning)}"><div class="dimhead"><span>${d.label}${w ? ` <span class="muted">${w}% of score</span>` : ''}</span><strong>${v}</strong></div>
<div class="bar" role="img" aria-label="${d.label} ${v} out of 100"><span style="width:${Math.max(0, Math.min(100, v))}%"></span></div>
<p class="muted sr-only">${escapeHtml(d.meaning)}</p></div>`;
  }).join('\n');
  return `<h2>Score by area</h2>\n<div class="dims">\n${bars}\n</div>`;
}

export function formatReport(result: ScoreResult, opts: ReportOptions): string {
  const { summary } = result;
  const state = notScoredState(result);
  const clean = summary.cleanTests;
  const all = rankGroups(result.findings);
  const top = summaryTop(all, result.dimensions);
  const detail = [...new Set([...top, ...all.slice(0, DETAIL_CARDS)])];
  const humanItems = result.findings.filter(isNeedsCheck);
  const humanHtml = renderNeedsCheck(result.findings);

  let headline: string;
  let explain: string;
  let scoreBox: string;
  if (state) {
    const ns = notScoredHeadline(result);
    headline = ns.headline;
    explain = ns.line;
    scoreBox = `<div class="score notscored" role="img" aria-label="Not scored"><span class="big">--</span><span class="grade">Not scored</span></div>`;
  } else {
    headline = `${clean} of ${summary.tests} ${summary.tests === 1 ? 'test has' : 'tests have'} no issues.`;
    explain = `A weighted average of four areas below. ${gradeBandText(result.grade, result.pass)} ${barText(result.threshold, opts.customThreshold === true, result.pass)}`;
    scoreBox = `<div class="score g-${result.grade}" aria-hidden="true"><span class="big">${result.score}</span><span class="of">/100</span><span class="grade">${result.grade}</span></div>`;
  }
  const srScore = state ? '' : `<span class="sr-only">Score ${result.score} out of 100, grade ${result.grade}. </span>`;

  const humanCount = summary.unverifiedTests;
  const humanLine =
    humanCount > 0 && !state
      ? `\n<p class="check">${humanItems.length ? '<a href="#human-check">' : ''}${plural(humanCount, 'test')} ${humanCount === 1 ? 'needs' : 'need'} a human check and ${humanCount === 1 ? 'is' : 'are'} left out of the score.${humanItems.length ? '</a>' : ''}</p>`
      : '';
  const crashLine = result.ruleCrashes?.length ? `\n<p class="check">${escapeHtml(INCOMPLETE_NOTE)}</p>` : '';
  const meta = state
    ? plural(summary.files, 'file')
    : `${plural(summary.tests, 'test')} in ${plural(summary.files, 'file')}`;

  const header = `<header>
<p class="eyebrow">Playwright suite score</p>
<p class="suite">${escapeHtml(opts.suiteName)}</p>
<div class="hd">
${scoreBox}
<div>
<h1>${srScore}${escapeHtml(headline)}</h1>
<p class="explain">${escapeHtml(explain)}</p>${humanLine}${crashLine}
<p class="meta">${meta} · scored ${escapeHtml(longDate(opts.date))}</p>
</div>
</div>
</header>`;

  const footer = `<footer>Scored by QA Guardian playwright-score ${escapeHtml(opts.version)} (rules ${escapeHtml(result.scoreVersion)}) on ${escapeHtml(opts.date)}. Static analysis of the test code: the same files always give the same score. Nothing was run against your product.</footer>`;

  const head = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Playwright suite score: ${escapeHtml(opts.suiteName)}</title>
<style>${REPORT_CSS}</style>
</head>
<body>
<main>
`;
  if (state === 'no-tests') {
    return `${head}<section class="summary">\n${header}\n</section>\n${footer}\n</main>\n</body>\n</html>\n`;
  }

  const clearSuite = all.length === 0 && humanItems.length === 0 && !state;
  const topHtml = all.length
    ? `<h2>${top.length > 1 ? `Top ${top.length} to fix` : 'Fix first'}</h2>\n<p class="muted legend">${escapeHtml(LEGEND)}</p>\n${renderTop3(top)}`
    : '<h2>Issues</h2>\n<p>No issues found. Keep it that way by adding the score to CI with --threshold.</p>';

  const extraSteps: string[] = [];
  if (humanItems.length) {
    extraSteps.push('Have someone confirm that the tests under "Needs a human check" really assert, since the score cannot tell.');
  }
  if ((result.dimensions.locators ?? 100) < 75 && !top.some((g) => g.dimension === 'locators')) {
    extraSteps.push('Move CSS and XPath selectors to role, label or test-id locators, starting with the busiest page objects.');
  }
  const steps = nextSteps(top, extraSteps)
    .map((s) => `<li>${escapeHtml(s)}</li>`)
    .join('');
  const nextHtml = clearSuite ? '' : `\n<h2>What to do next</h2>\n<ol>${steps}</ol>`;

  const moreTypes = all.length - detail.length;
  const detailsHtml =
    detail.length || humanHtml
      ? `<section class="details">
<h2>Details</h2>
${flakeFilesLine(result.findings)}
${renderDetailCards(detail, opts.readSource)}
${moreTypes > 0 ? `<p class="muted">${plural(moreTypes, 'more issue type')} not shown. Use --format json for every occurrence.</p>` : ''}
${humanHtml}
</section>
`
      : '';

  return `${head}<section class="summary">
${header}
${state ? '' : renderBars(result)}
${topHtml}${nextHtml}
</section>
${detailsHtml}${footer}
</main>
</body>
</html>
`;
}
