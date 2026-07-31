import type { ScoreResult } from '../types.js';

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
    lines.push(`| ${k} | ${v} |`);
  }
  lines.push('');
  lines.push(
    `Files: ${result.summary.files} · Tests: ${result.summary.tests} · SLOC: ${result.summary.sloc} · Findings: ${result.summary.findings}`
  );
  if (result.findings.length) {
    lines.push('');
    lines.push('## Findings');
    lines.push('');
    for (const f of result.findings.slice(0, 40)) {
      const loc = f.line ? `:${f.line}` : '';
      lines.push(`- **${f.severity}** \`${f.rule}\` \`${f.file}${loc}\` — ${f.message}`);
    }
  }
  return lines.join('\n');
}
