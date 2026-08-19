import type { ScoreResult } from '../types.js';

export function formatText(result: ScoreResult): string {
  const lines: string[] = [];
  lines.push(
    `Playwright Spec Score ${result.scoreVersion} · profile=${result.profile}`
  );
  lines.push(
    `Score: ${result.score}/100 (${result.grade}) · ${result.pass ? 'PASS' : 'FAIL'} (threshold ${result.threshold})`
  );
  lines.push('');
  lines.push('Dimensions:');
  for (const [k, v] of Object.entries(result.dimensions)) {
    if (v === undefined) continue;
    lines.push(`  ${k}: ${v}`);
  }
  lines.push('');
  lines.push(
    `Summary: files=${result.summary.files} tests=${result.summary.tests} sloc=${result.summary.sloc} ` +
      `findings=${result.summary.findings} (errors=${result.summary.errors} warnings=${result.summary.warnings}) ` +
      `locators native/raw=${result.summary.nativeLocators}/${result.summary.rawLocators}`
  );

  if (result.findings.length) {
    lines.push('');
    lines.push('Findings:');
    for (const f of result.findings.slice(0, 50)) {
      const loc = f.line ? `:${f.line}` : '';
      lines.push(
        `  [${f.severity}] ${f.rule} ${pathBasename(f.file)}${loc} — ${f.message}`
      );
    }
    if (result.findings.length > 50) {
      lines.push(`  … and ${result.findings.length - 50} more`);
    }
  }

  if (result.skippedFiles?.length) {
    lines.push('');
    lines.push(
      `Skipped (looks like a non-Playwright test — Jest/Vitest/RTL/Cypress — ${result.skippedFiles.length}):`
    );
    for (const f of result.skippedFiles.slice(0, 20)) {
      lines.push(`  ${f}`);
    }
    if (result.skippedFiles.length > 20) {
      lines.push(`  … and ${result.skippedFiles.length - 20} more`);
    }
  }

  return lines.join('\n');
}

function pathBasename(p: string): string {
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1] ?? p;
}
