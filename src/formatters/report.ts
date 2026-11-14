import type { DimensionName, Finding, ScoreResult } from '../types.js';
import { PROFILE_WEIGHTS } from '../profiles.js';
import {
  compareFindings,
  confidenceOf,
  confidenceRank,
  isNeedsCheck,
  severityRank,
  type Confidence,
} from '../confidence.js';
import { copyFor } from '../rule-copy.js';
import { REPORT_CSS } from './report-css.js';

/** Returns the source text of a finding's file (path as in Finding.file), or undefined. */
export type SourceReader = (file: string) => string | undefined;

export interface ReportOptions {
  /** Shown in the header, e.g. "2026-11-14". Injected so output is reproducible. */
  date: string;
  /** Scorer package version. */
  version: string;
  /** Suite name or path shown under the headline. */
  suiteName: string;
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

const DIMENSIONS: ReadonlyArray<{ key: DimensionName; label: string; meaning: string }> = [
  {
    key: 'playwrightHygiene',
    label: 'Hygiene',
    meaning: 'Waits, forced clicks and un-awaited calls: the habits that make tests flake.',
  },
  {
    key: 'assertions',
    label: 'Assertions',
    meaning: 'Whether tests check something real, with assertions that retry.',
  },
  {
    key: 'locators',
    label: 'Locators',
    meaning: 'How many elements are found by role, label or test id instead of CSS or XPath.',
  },
  {
    key: 'structure',
    label: 'Structure',
    meaning: 'Focused or skipped tests, nesting and file size: how maintainable the suite is.',
  },
];

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface RuleGroup {
  rule: string;
  /** Worst severity among the group's findings. */
  severity: Finding['severity'];
  confidence: Confidence;
  /** Tests affected: distinct tests for test-scoped findings, plus one per file for hook/module-scoped ones. */
  testsAffected: number;
  findings: Finding[];
  /** The occurrence shown as the example (first by severity, file, line). */
  example: Finding;
}

function groupByRule(findings: readonly Finding[]): RuleGroup[] {
  const byRule = new Map<string, Finding[]>();
  for (const f of findings) {
    const list = byRule.get(f.rule);
    if (list) list.push(f);
    else byRule.set(f.rule, [f]);
  }
  const groups: RuleGroup[] = [];
  for (const [rule, list] of byRule) {
    const sorted = [...list].sort(compareFindings);
    const tests = new Set<string>();
    for (const f of sorted) {
      tests.add(f.scope === 'test' && f.testKey ? f.testKey : `file:${f.file}`);
    }
    groups.push({
      rule,
      severity: sorted[0]!.severity,
      confidence: confidenceOf(sorted[0]!),
      testsAffected: tests.size,
      findings: sorted,
      example: sorted[0]!,
    });
  }
  return groups;
}

/** Severity, then confidence, then tests affected (desc), then rule id. */
export function compareGroups(a: RuleGroup, b: RuleGroup): number {
  return (
    severityRank(a.severity) - severityRank(b.severity) ||
    confidenceRank(a.confidence) - confidenceRank(b.confidence) ||
    b.testsAffected - a.testsAffected ||
    a.rule.localeCompare(b.rule)
  );
}

/** Up to `max` rule groups for "Top findings". Never includes needs-check findings. */
export function rankTopFindings(findings: readonly Finding[], max = 5): RuleGroup[] {
  const eligible = findings.filter((f) => !isNeedsCheck(f));
  return groupByRule(eligible).sort(compareGroups).slice(0, max);
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
    .map(
      (r) =>
        `<span class="ln${r.hit ? ' hit' : ''}"><i>${r.n}</i>${escapeHtml(r.text) || ' '}</span>`
    )
    .join('');
  return `<pre class="code" aria-label="Code excerpt">${body}</pre>`;
}

function loc(f: Finding): string {
  return f.line ? `${f.file}:${f.line}` : f.file;
}

function plural(n: number, one: string, many = one + 's'): string {
  return `${n} ${n === 1 ? one : many}`;
}

function renderTop(groups: RuleGroup[], readSource?: SourceReader): string {
  if (!groups.length) {
    return '<p class="muted">No scored findings. Nothing to fix here.</p>';
  }
  return groups
    .map((g, i) => {
      const c = copyFor(g.rule);
      const others = g.findings.length - 1;
      return `<article class="finding sev-${g.severity}">
<h3><span class="rank">${i + 1}</span>${escapeHtml(c.title)} <span class="tag ${g.confidence}">${g.confidence} confidence</span></h3>
<p class="where"><code>${escapeHtml(loc(g.example))}</code></p>
${renderExcerpt(g.example, readSource)}
<p class="why">${escapeHtml(c.why)}</p>
<p class="muted">${others > 0 ? `${plural(others, 'other occurrence')}; ${plural(g.testsAffected, 'test')} affected in total.` : 'No other occurrences.'}</p>
</article>`;
    })
    .join('\n');
}

function renderFlake(findings: readonly Finding[]): string {
  const flake = findings.filter((f) => FLAKE_RULES.includes(f.rule) && !isNeedsCheck(f));
  if (!flake.length) return '<p class="muted">No flake-prone patterns found.</p>';
  const counts = new Map<string, number>();
  const files = new Map<string, number>();
  for (const f of flake) {
    counts.set(f.rule, (counts.get(f.rule) ?? 0) + 1);
    files.set(f.file, (files.get(f.file) ?? 0) + 1);
  }
  const rows = FLAKE_RULES.filter((r) => counts.has(r))
    .sort((a, b) => counts.get(b)! - counts.get(a)! || a.localeCompare(b))
    .map((r) => `<tr><td>${escapeHtml(copyFor(r).title)}</td><td class="num">${counts.get(r)}</td></tr>`)
    .join('');
  const worst = [...files.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([file, n]) => `<li><code>${escapeHtml(file)}</code> <span class="muted">${plural(n, 'flake-prone call')}</span></li>`)
    .join('');
  return `<table><thead><tr><th>Pattern</th><th class="num">Count</th></tr></thead><tbody>${rows}</tbody></table>
<p class="sub">Worst files</p><ul class="plain">${worst}</ul>`;
}

function renderNeedsCheck(findings: readonly Finding[]): string {
  const items = findings.filter(isNeedsCheck).sort(compareFindings);
  if (!items.length) return '<p class="muted">Nothing needed a human check.</p>';
  const shown = items.slice(0, 8);
  const rows = shown
    .map(
      (f) =>
        `<li><code>${escapeHtml(loc(f))}</code> ${escapeHtml(copyFor(f.rule).title)}<br><span class="muted">${escapeHtml(f.message)}</span></li>`
    )
    .join('');
  const more = items.length > shown.length ? `<p class="muted">and ${items.length - shown.length} more.</p>` : '';
  return `<p class="note">The scorer could not decide these on its own. They are <strong>not counted in the score</strong>: please look at them yourself.</p><ul class="plain">${rows}</ul>${more}`;
}

const GENERIC_STEPS = [
  'Re-run the score in CI with --threshold so the number cannot slip back unnoticed.',
  'Keep new specs on role, label and test-id locators with web-first assertions.',
  'Review any items under "Needs a human check" by hand.',
];

function nextSteps(groups: RuleGroup[]): string[] {
  const steps: string[] = [];
  for (const g of groups) {
    const fix = copyFor(g.rule).fix;
    if (!steps.includes(fix)) steps.push(fix);
    if (steps.length === 3) break;
  }
  for (const s of GENERIC_STEPS) {
    if (steps.length >= 3) break;
    steps.push(s);
  }
  return steps;
}

export function formatReport(result: ScoreResult, opts: ReportOptions): string {
  const { summary } = result;
  const clean = summary.cleanTests;
  const meaning =
    summary.tests === 0
      ? 'No tests were found.'
      : `${clean} of ${summary.tests} tests are clean.`;
  const top = rankTopFindings(result.findings, 5);
  const weights = PROFILE_WEIGHTS[result.profile] ?? PROFILE_WEIGHTS.standard;

  const bars = DIMENSIONS.map((d) => {
    const v = result.dimensions[d.key] ?? 0;
    const w = weights[d.key];
    return `<div class="dim"><div class="dimhead"><span>${d.label}${w ? ` <span class="muted">weight ${w}</span>` : ''}</span><strong>${v}</strong></div>
<div class="bar" role="img" aria-label="${d.label} ${v} out of 100"><span style="width:${Math.max(0, Math.min(100, v))}%"></span></div>
<p class="muted">${escapeHtml(d.meaning)}</p></div>`;
  }).join('\n');

  const steps = nextSteps(top)
    .map((s) => `<li>${escapeHtml(s)}</li>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Suite report: ${escapeHtml(opts.suiteName)}</title>
<style>${REPORT_CSS}</style>
</head>
<body>
<main>
<header>
<div class="score g-${result.grade}"><span class="big">${result.score}</span><span class="of">/100</span><span class="grade">${result.grade}</span></div>
<div>
<h1>${escapeHtml(meaning)}</h1>
<p class="muted">${result.pass ? 'Passes' : 'Below'} the ${result.threshold} threshold.</p>
<p class="meta"><code>${escapeHtml(opts.suiteName)}</code><br>${plural(summary.tests, 'test')} in ${plural(summary.files, 'file')} · ${escapeHtml(opts.date)} · scorer ${escapeHtml(opts.version)}</p>
</div>
</header>

<section><h2>Score by dimension</h2>
${bars}
</section>

<section><h2>Top findings</h2>
${renderTop(top, opts.readSource)}
</section>

<section><h2>Flake risk</h2>
${renderFlake(result.findings)}
</section>

<section><h2>Needs a human check</h2>
${renderNeedsCheck(result.findings)}
</section>

<section><h2>What to do next</h2>
<ol>${steps}</ol>
</section>

<footer>Generated by @qaguardian/playwright-score ${escapeHtml(opts.version)}. Deterministic: the same files always give the same score.</footer>
</main>
</body>
</html>
`;
}
