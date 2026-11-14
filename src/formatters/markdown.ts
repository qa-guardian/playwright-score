import type { ScoreResult } from '../types.js';
import { INCOMPLETE_NOTE, notScoredState } from '../report-model.js';
import { sortFindings } from '../confidence.js';

/** Make a value safe inside a Markdown table cell: no pipe or newline can end the cell or row. */
export function escapeCell(v: unknown): string {
  return String(v).replace(/\|/g, '\\|').replace(/\r?\n|\r/g, ' ');
}

export function formatMarkdown(result: ScoreResult): string {
  const lines: string[] = [];
  lines.push(`# Playwright Spec Score (\`${result.scoreVersion}\`)`);
  lines.push('');
  lines.push(
    `**${result.score}/100 (${result.grade})** — ${result.pass ? 'PASS' : 'FAIL'} · profile \`${result.profile}\` · threshold ${result.threshold}`
  );
  lines.push('');
  lines.push('| Dimension | Score |');
  lines.push('|---|---|');
  for (const [k, v] of Object.entries(result.dimensions)) {
    if (v === undefined) continue;
    lines.push(`| ${escapeCell(k)} | ${escapeCell(v)} |`);
  }
  lines.push('');
  lines.push(
    `Files: ${result.summary.files} · Tests: ${result.summary.tests} · SLOC: ${result.summary.sloc} · Findings: ${result.summary.findings}` +
      (result.summary.unverifiedTests ? ` · Unverified assertions: ${result.summary.unverifiedTests}` : '')
  );
  if (result.ruleCrashes?.length) {
    lines.push('');
    lines.push(INCOMPLETE_NOTE);
  }
  // 'no-tests' hard-fail findings carry the absolute working directory as their file.
  if (result.findings.length && notScoredState(result) !== 'no-tests') {
    lines.push('');
    lines.push('## Findings');
    lines.push('');
    for (const f of sortFindings(result.findings).slice(0, 40)) {
      const loc = f.line ? `:${f.line}` : '';
      lines.push(`- **${f.severity}** \`${f.rule}\` \`${escapeCell(f.file)}${loc}\` — ${escapeCell(f.message)}`);
    }
  }

  if (result.skippedFiles?.length) {
    lines.push('');
    lines.push(
      `<details><summary>Skipped — looks like a non-Playwright test (Jest/Vitest/RTL/Cypress) (${result.skippedFiles.length})</summary>`
    );
    lines.push('');
    for (const f of result.skippedFiles) {
      lines.push(`- \`${f}\``);
    }
    lines.push('');
    lines.push('</details>');
  }

  if (result.configWarnings?.length) {
    lines.push('');
    lines.push('## Config warnings');
    lines.push('');
    for (const w of result.configWarnings) {
      lines.push(`- ${w}`);
    }
  }

  return lines.join('\n');
}
