import type { ScoreResult } from '../types.js';
import { notScoredHeadline, notScoredState, partialNote, plural, INCOMPLETE_NOTE } from '../report-model.js';
import {
  advisoryLine,
  buildStateLines,
  buildView,
  headlineText,
  needsCheckLine,
  needsCheckReasons,
  NOT_SCORED_REASON_TEXT,
  outsideTestsLine,
  type ViewGroup,
} from '../report-view.js';

export interface TextOptions {
  suiteName?: string;
  version?: string;
  customThreshold?: boolean;
  /** `--advice`: also list advisory findings and the reasons for findings not decided automatically. */
  advice?: boolean;
}

const MAX_PATH = 100;

/** Relative path, shortened in the middle to MAX_PATH. An absolute path never gets through. */
function shortPath(file: string, line?: number): string {
  let p = file.replace(/\\/g, '/');
  if (p.startsWith('/') || /^[A-Za-z]:\//.test(p)) p = p.split('/').filter(Boolean).slice(-3).join('/');
  const suffix = line ? `:${line}` : '';
  const budget = MAX_PATH - suffix.length;
  if (p.length > budget) {
    const tail = p.split('/').pop() ?? p;
    const keep = Math.max(10, budget - tail.length - 5);
    p = tail.length >= budget ? '...' + tail.slice(-(budget - 3)) : `${p.slice(0, keep)}/.../${tail}`;
  }
  return p + suffix;
}

const SECTION: Record<string, string> = {
  certain: 'Certain issues',
  likely: 'Worth a look',
  advisory: 'Advisory',
};

function groupLines(g: ViewGroup, i: number): string[] {
  const where = g.shown.map((f) => shortPath(f.file, f.line)).join('  ');
  const lines = [
    ` ${i + 1}. ${g.title}   ${g.findings.length} in ${plural(g.testsAffected, 'test')}`,
    `    ${where}${g.more > 0 ? `${where ? '  ' : ''}+ ${g.more} more` : ''}`,
  ];
  // The fix is spelled out for certain groups; a likely or advisory group keeps to two lines.
  if (g.tier === 'certain') lines.push(`    Fix: ${g.fix}`);
  return lines;
}

/**
 * Terminal output. Line 1 is the headline (report-view.ts headlineText), line 2
 * the score or the not-scored reason, then the status lines, then the groups by
 * tier inside the noise budget.
 */
export function formatText(result: ScoreResult, opts: TextOptions = {}): string {
  const { summary } = result;
  const state = notScoredState(result);
  const view = buildView(result, { advice: opts.advice });
  const lines: string[] = [];
  const suite = opts.suiteName ? `  ·  ${opts.suiteName}` : '';
  if (state) {
    lines.push(notScoredHeadline(result).headline);
    const reason = result.reason ? NOT_SCORED_REASON_TEXT[result.reason] ?? result.reason : undefined;
    lines.push(`Not scored${reason ? `: ${reason}` : ''}${suite}  ·  ${plural(result.coverage?.filesFound ?? summary.files, 'file')}`);
    lines.push(notScoredHeadline(result).line);
  } else {
    lines.push(headlineText(result));
    const bar = result.threshold > 0 || opts.customThreshold ? ` (${opts.customThreshold ? 'your bar' : 'bar'} ${result.threshold})` : '';
    lines.push(`Score ${result.score}/100 (${result.grade})  ·  ${result.pass ? 'PASS' : 'FAIL'}${bar}${suite}  ·  ${plural(summary.files, 'file')}`);
  }

  const partial = partialNote(result);
  if (partial) lines.push(partial);
  lines.push(...buildStateLines(view));
  if (result.ruleCrashes?.length) lines.push(INCOMPLETE_NOTE);

  let tier = '';
  view.groups.forEach((g, i) => {
    if (g.tier !== tier) {
      tier = g.tier;
      lines.push('');
      lines.push(SECTION[g.tier] ?? g.tier);
    }
    lines.push(...groupLines(g, i));
  });
  if (view.moreGroups > 0) {
    lines.push(
      ` + ${plural(view.moreGroups, 'more issue type')} (${plural(view.moreGroupFindings, 'finding')}). Every finding: --format json`
    );
  }

  const tail = [outsideTestsLine(result), needsCheckLine(view), advisoryLine(view)].filter((l): l is string => !!l);
  if (tail.length) {
    lines.push('');
    for (const l of tail) {
      lines.push(l);
      if (l === needsCheckLine(view) && view.advice) {
        const reasons = needsCheckReasons(view);
        for (const r of reasons.lines) lines.push(`    ${r}`);
        if (reasons.more > 0) lines.push(`    + ${reasons.more} more`);
      }
    }
  }

  if (result.skippedFiles?.length) {
    lines.push('');
    lines.push(`Skipped (looks like a non-Playwright test — Jest/Vitest/RTL/Cypress — ${result.skippedFiles.length}):`);
    for (const f of result.skippedFiles.slice(0, 20)) lines.push(`  ${f}`);
    if (result.skippedFiles.length > 20) lines.push(`  … and ${result.skippedFiles.length - 20} more`);
  }

  if (result.configWarnings?.length) {
    lines.push('');
    lines.push('Config warnings:');
    for (const w of result.configWarnings) lines.push(`  ${w}`);
  }

  lines.push('');
  lines.push(
    opts.version
      ? `QA Guardian playwright-score ${opts.version} (rules ${result.scoreVersion})`
      : `QA Guardian playwright-score (rules ${result.scoreVersion})`
  );
  return lines.join('\n');
}
