import type { ScoreResult } from '../types.js';
import { REPORT_CSS } from './report-css.js';
import { scopeLine } from '../changed-files.js';
import {
  barText,
  gradeBandText,
  notScoredHeadline,
  notScoredState,
  partialNote,
  plural,
  rankGroups,
  summaryTop,
  INCOMPLETE_NOTE,
} from '../report-model.js';
import { advisoryLine, buildView, needsCheckLine, viewTier } from '../report-view.js';
import {
  DETAIL_CARDS,
  LEGEND,
  escapeHtml,
  flakeFilesLine,
  longDate,
  nextSteps,
  renderBars,
  renderDetailCards,
  renderNeedsCheck,
  renderTop3,
  type SourceReader,
} from './report-parts.js';

export { escapeHtml, FLAKE_RULES, type SourceReader } from './report-parts.js';

export { rankTopFindings, compareGroups, type RuleGroup } from '../report-model.js';


export interface ReportOptions {
  /** Shown in the header, e.g. "2026-11-14". Injected so output is reproducible. */
  date: string;
  /** Scorer package version. */
  version: string;
  /** Suite name or path shown under the headline. */
  suiteName: string;
  /** True when --threshold was passed, so the bar reads "your bar" instead of "the default bar". */
  customThreshold?: boolean;
  /** `--advice`: also show advisory findings and the reasons for findings not decided automatically. */
  advice?: boolean;
  /** Source lookup for code excerpts; without it the excerpts are omitted. */
  readSource?: SourceReader;
}



export function formatReport(result: ScoreResult, opts: ReportOptions): string {
  const { summary } = result;
  const state = notScoredState(result);
  const clean = summary.cleanTests;
  // QAG-287 S10a: advisory findings are hidden without --advice (by tier, never by form name).
  const view = buildView(result, { advice: opts.advice });
  const listed = result.findings.filter((f) => opts.advice === true || viewTier(f) !== 'advisory');
  const all = rankGroups(listed);
  const top = summaryTop(all, result.dimensions);
  const detail = [...new Set([...top, ...all.slice(0, DETAIL_CARDS)])];
  const humanItems = view.needsCheck;
  const humanHtml = opts.advice === true ? renderNeedsCheck(result.findings) : '';

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
    explain = `The share of the counted tests with no confirmed issue; the areas below are for information. ${gradeBandText(result.grade, result.pass)}${result.status === 'partial' || (result.threshold === 0 && opts.customThreshold !== true) ? '' : ` ${barText(result.threshold, opts.customThreshold === true, result.score >= result.threshold)}`}`;
    scoreBox = `<div class="score g-${result.grade}" aria-hidden="true"><span class="big">${result.score}</span><span class="of">/100</span><span class="grade">${result.grade}</span></div>`;
  }
  const srScore = state ? '' : `<span class="sr-only">Score ${result.score} out of 100, grade ${result.grade}. </span>`;

  const needsLine = state ? undefined : needsCheckLine(view);
  const humanLine = needsLine
    ? `\n<p class="check">${humanHtml ? '<a href="#human-check">' : ''}${escapeHtml(needsLine)}${humanHtml ? '</a>' : ''}</p>`
    : '';
  const advisoryText = state ? undefined : advisoryLine(view);
  const advisoryHtml = advisoryText ? `\n<p class="check">${escapeHtml(advisoryText)}</p>` : '';
  const crashLine = result.ruleCrashes?.length ? `\n<p class="check">${escapeHtml(INCOMPLETE_NOTE)}</p>` : '';
  const partial = partialNote(result);
  const scopeHtml = result.scope ? `\n<p class="check">${escapeHtml(scopeLine(result.scope))}</p>` : '';
  const partialLine = partial ? `\n<p class="check">${escapeHtml(partial)}</p>` : '';
  const meta = state
    ? plural(result.coverage?.filesFound ?? summary.files, 'file')
    : `${plural(summary.tests, 'test')} in ${plural(summary.files, 'file')}`;

  const header = `<header>
<p class="eyebrow">Playwright suite score</p>
<p class="suite">${escapeHtml(opts.suiteName)}</p>
<div class="hd">
${scoreBox}
<div>
<h1>${srScore}${escapeHtml(headline)}</h1>
<p class="explain">${escapeHtml(explain)}</p>${humanLine}${advisoryHtml}${scopeHtml}${crashLine}${partialLine}
<p class="meta">${meta} · scored ${escapeHtml(longDate(opts.date))}</p>
</div>
</div>
</header>`;

  const footer = `<footer>Scored by QA Guardian playwright-score ${escapeHtml(opts.version)} (rules ${escapeHtml(result.scoreVersion)}) on ${escapeHtml(opts.date)}. Static analysis of the test code: the same files always give the same score. Nothing was run against your product. Run it yourself: <code>npx pwscore &lt;dir&gt;</code> (also published as @qaguardian/playwright-score).</footer>`;

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
    extraSteps.push('Have someone confirm that the tests under "Not decided automatically" really assert, since the score cannot tell.');
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
${flakeFilesLine(listed)}
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
