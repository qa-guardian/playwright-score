import { scopeLine } from '../changed-files.js';
import type { ScoreResult } from '../types.js';
import { INCOMPLETE_NOTE, notScoredHeadline, notScoredState, partialNote, plural } from '../report-model.js';
import {
  advisoryLine,
  buildStateLines,
  buildView,
  headlineText,
  needsCheckLine,
  needsCheckReasons,
  NOISE_BUDGET,
  NOT_SCORED_REASON_TEXT,
  outsideTestsLine,
  type ViewGroup,
} from '../report-view.js';
import { DOCS_URLS } from '../catalogue/table.js';

export interface MarkdownOptions {
  /** `--advice`: also list advisory findings and the reasons for findings not decided automatically. */
  advice?: boolean;
}

/** Make a value safe inside a Markdown table cell: no pipe or newline can end the cell or row. */
export function escapeCell(v: unknown): string {
  return String(v).replace(/\|/g, '\\|').replace(/\r?\n|\r/g, ' ');
}

/** Inline code that no backtick in the value can close early. */
function code(v: string): string {
  const s = escapeCell(v);
  return s.includes('`') ? `\`\` ${s} \`\`` : `\`${s}\``;
}

const SECTION: Record<string, string> = {
  certain: '### Certain issues',
  likely: '### Worth a look',
  advisory: '### Advisory',
};

function groupLine(g: ViewGroup): string {
  // Only a URL from the committed list becomes a link (spec text never does).
  const title = g.docs && DOCS_URLS.includes(g.docs) ? `[${escapeCell(g.title)}](${g.docs})` : escapeCell(g.title);
  const where = g.shown.map((f) => code(f.line ? `${f.file}:${f.line}` : f.file)).join(', ');
  const more = g.more > 0 ? ` and ${g.more} more` : '';
  const fix = g.tier === 'certain' ? ` Fix: ${escapeCell(g.fix)}` : '';
  return `- **${title}**: ${g.findings.length} in ${plural(g.testsAffected, 'test')}. ${where}${more}.${fix}`;
}

/**
 * The PR comment. Line 1 is the headline, line 2 the score; then the status
 * lines and at most NOISE_BUDGET.markdownGroups groups by tier.
 */
export function formatMarkdown(result: ScoreResult, opts: MarkdownOptions = {}): string {
  const state = notScoredState(result);
  const view = buildView(result, { advice: opts.advice, maxGroups: NOISE_BUDGET.markdownGroups });
  const lines: string[] = [];
  if (result.scope?.empty) {
    return [`**Nothing to score**`, '', `> ${escapeCell(scopeLine(result.scope))}`].join('\n');
  }
  if (state) {
    lines.push(`**${escapeCell(notScoredHeadline(result).headline)}**`);
    const reason = result.reason ? NOT_SCORED_REASON_TEXT[result.reason] ?? result.reason : undefined;
    lines.push(`Not scored${reason ? `: ${reason}` : ''} · playwright-score \`${result.scoreVersion}\``);
  } else {
    lines.push(`**${escapeCell(headlineText(result))}**`);
    lines.push(
      `Score **${result.score}/100 (${result.grade})** · ${result.pass ? 'PASS' : 'FAIL'} · profile \`${result.profile}\` · threshold ${result.threshold} · playwright-score \`${result.scoreVersion}\``
    );
  }
  const status = [result.scope ? scopeLine(result.scope) : undefined, partialNote(result), ...buildStateLines(view), result.ruleCrashes?.length ? INCOMPLETE_NOTE : undefined].filter(
    (l): l is string => !!l
  );
  if (status.length) {
    lines.push('');
    for (const l of status) lines.push(escapeCell(l));
  }

  let tier = '';
  for (const g of view.groups) {
    if (g.tier !== tier) {
      tier = g.tier;
      lines.push('');
      lines.push(SECTION[g.tier] ?? `### ${g.tier}`);
      lines.push('');
    }
    lines.push(groupLine(g));
  }
  if (view.moreGroups > 0) {
    lines.push('');
    lines.push(`And ${plural(view.moreGroups, 'more issue type')} (${plural(view.moreGroupFindings, 'finding')}). Every finding: \`--format json\`.`);
  }

  const tail = [outsideTestsLine(result), needsCheckLine(view), advisoryLine(view)].filter((l): l is string => !!l);
  if (tail.length) lines.push('');
  for (const l of tail) {
    lines.push(escapeCell(l));
    if (l === needsCheckLine(view) && view.advice) {
      const reasons = needsCheckReasons(view, NOISE_BUDGET.markdownGroups);
      lines.push('');
      for (const r of reasons.lines) lines.push(`- ${code(r)}`);
      if (reasons.more > 0) lines.push(`- and ${reasons.more} more`);
      lines.push('');
    }
  }

  if (result.skippedFiles?.length) {
    lines.push('');
    lines.push(
      `<details><summary>Skipped — looks like a non-Playwright test (Jest/Vitest/RTL/Cypress) (${result.skippedFiles.length})</summary>`
    );
    lines.push('');
    for (const f of result.skippedFiles) lines.push(`- ${code(f)}`);
    lines.push('');
    lines.push('</details>');
  }

  if (result.configWarnings?.length) {
    lines.push('');
    lines.push('#### Config warnings');
    lines.push('');
    for (const w of result.configWarnings) lines.push(`- ${escapeCell(w)}`);
  }

  return lines.join('\n');
}
