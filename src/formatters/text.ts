import type { ScoreResult } from '../types.js';
import { CONFIDENCE_LABEL, compareFindings, isNeedsCheck, needsCheckIntro } from '../confidence.js';
import { copyFor } from '../rule-copy.js';
import {
  DIMENSIONS,
  notScoredHeadline,
  notScoredState,
  partialNote,
  plural,
  rankGroups,
  INCOMPLETE_NOTE,
} from '../report-model.js';

export interface TextOptions {
  suiteName?: string;
  version?: string;
  customThreshold?: boolean;
}

/** Groups shown, and locations shown per group; the rest collapse into "+N more". */
const MAX_GROUPS = 10;
const MAX_LOCATIONS = 3;
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

export function formatText(result: ScoreResult, opts: TextOptions = {}): string {
  const { summary } = result;
  const state = notScoredState(result);
  const lines: string[] = [];
  const counts = state
    ? plural(result.coverage?.filesFound ?? summary.files, 'file')
    : `${plural(summary.tests, 'test')} in ${plural(summary.files, 'file')}`;
  lines.push(opts.suiteName ? `${opts.suiteName}  ·  ${counts}` : counts);
  if (state) {
    lines.push(`Not scored: ${notScoredHeadline(result).headline.replace(/, so this suite could not be scored\.$/, '')}.`);
    const first = result.findings.find((f) => f.rule === 'playwright-score/parse-error');
    if (first && state === 'parse-error') lines.push(`  ${shortPath(first.file, first.line)}`);
    lines.push(notScoredHeadline(result).line);
  } else {
    const clean = summary.cleanTests;
    lines.push(
      `Score ${result.score}/100 (${result.grade})  ·  ${result.pass ? 'PASS' : 'FAIL'} (${opts.customThreshold ? 'your bar' : 'bar'} ${result.threshold})  ·  ${clean} ${clean === 1 ? 'test has' : 'tests have'} no issues`
    );
    lines.push(
      DIMENSIONS.filter((d) => result.dimensions[d.key] !== undefined)
        .map((d) => `${d.label} ${result.dimensions[d.key]}`)
        .join(' · ')
    );
  }

  const partial = partialNote(result);
  if (partial) lines.push(partial);

  // 'no-tests' hard-fail findings carry the absolute working directory as their file.
  const groups = state === 'no-tests' ? [] : rankGroups(result.findings);
  if (groups.length) {
    lines.push('');
    lines.push('Top issues (worst first)');
    groups.slice(0, MAX_GROUPS).forEach((g, i) => {
      const where = `${g.findings.length} in ${plural(g.testsAffected, 'test')}`;
      lines.push(` ${i + 1}. ${copyFor(g.rule).title}   ${where}   ${CONFIDENCE_LABEL[g.confidence]}`);
      for (const f of g.findings.slice(0, MAX_LOCATIONS)) lines.push(`    ${shortPath(f.file, f.line)}`);
      if (g.findings.length > MAX_LOCATIONS) lines.push(`    + ${g.findings.length - MAX_LOCATIONS} more`);
    });
    if (groups.length > MAX_GROUPS) {
      lines.push(
        ` + ${plural(groups.length - MAX_GROUPS, 'more issue type')}. Full list: npx pwscore <path> --format report --out report.html`
      );
    }
  }

  const human = result.findings.filter(isNeedsCheck).sort(compareFindings);
  if (human.length && !state) {
    const files = [...new Set(human.map((f) => f.file))];
    lines.push('');
    lines.push(
      needsCheckIntro(human).helpers
        ? `Not decided automatically (not in the score): ${plural(human.length, 'test')} in ${plural(files.length, 'file')} ${human.length === 1 ? 'relies' : 'rely'} on helpers we could not read. A person should look.`
        : `Not decided automatically (not in the score): ${plural(human.length, 'finding')} in ${plural(files.length, 'file')}, information only. A person should look.`
    );
    for (const f of files.slice(0, 5)) lines.push(`    ${shortPath(f)}`);
    if (files.length > 5) lines.push(`    + ${files.length - 5} more`);
  }

  if (result.ruleCrashes?.length) {
    lines.push('');
    lines.push(INCOMPLETE_NOTE);
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

  if (result.configWarnings?.length) {
    lines.push('');
    lines.push('Config warnings:');
    for (const w of result.configWarnings) {
      lines.push(`  ${w}`);
    }
  }

  lines.push('');
  if (!state) lines.push(`Score ${result.score}/100 (${result.grade})  ·  ${result.pass ? 'PASS' : 'FAIL'}`);
  lines.push(
    `${opts.version ? `QA Guardian playwright-score ${opts.version} (rules ${result.scoreVersion})` : `QA Guardian playwright-score (rules ${result.scoreVersion})`}`
  );
  return lines.join('\n');
}
