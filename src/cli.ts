#!/usr/bin/env node
/**
 * playwright-score CLI
 */
import fs from 'node:fs';
import path from 'node:path';
import { scorePaths } from './index.js';
import { formatJson } from './formatters/json.js';
import { formatText } from './formatters/text.js';
import { formatMarkdown } from './formatters/markdown.js';
import { formatSarif } from './formatters/sarif.js';
import { formatReport } from './formatters/report.js';
import { makeSourceReader } from './report-source.js';
import { suiteLabel } from './suite-name.js';
import { resolveDotSlashAbsolute } from './fs-util.js';
import { DEFAULT_MAX_HEAP_MB, MAX_MAX_HEAP_MB, MIN_MAX_HEAP_MB } from './isolate.js';
import { limitProblem } from './limits.js';
import type { ProfileName } from './types.js';

function printHelp(): void {
  console.log(`pwscore — deterministic Playwright spec quality score

Usage:
  npx pwscore <dir> [options]
  # the same tool is also published as @qaguardian/playwright-score:
  npx -p @qaguardian/playwright-score pwscore <dir> [options]
  # after npm install -D pwscore (the playwright-score command also works):
  npx pwscore <paths...> [options]

Not affiliated with Microsoft or the Playwright project.

Options:
  --profile <standard>             Scoring profile (default, and only
                                   supported value, as of 2.0.0: standard).
  --threshold <n>                 Pass threshold 0-100 (default: 80)
  --format <text|json|markdown|sarif|report>
                                  Output format (default: text). report is a
                                  self-contained one-page HTML suite report.
  --out, --output <file>          Write report to file
  --name <suite name>             Suite name for the report headline
                                  (default: the directory basename)
  --max-seconds <n>               Time limit for the run. No default: without
                                  it a run is never cut short. Finding the
                                  files always finishes; files not analysed
                                  when the limit passes are skipped.
  --max-heap-mb <n>               Heap limit of the analysis worker
                                  (default: ${DEFAULT_MAX_HEAP_MB}, the same on every machine;
                                  ${MIN_MAX_HEAP_MB} to ${MAX_MAX_HEAP_MB}).
                                  Files in the batch that hits it are skipped.
  --shared                        Also check the shared files the specs import
                                  (page objects, fixtures, helpers). Their
                                  findings are listed and never change the score.
  --version                       Print version
  --help                          Show help

Exit codes:
  0  score >= threshold, every file scored
  1  score < threshold, or partial (a file was skipped: syntax error,
     over 1 MB, binary, unreadable, or a --max-seconds / --max-heap-mb
     limit was hit), or not scored (no files matched, every file skipped,
     or no tests found)
  2  tool error

Website: https://qaguardian.com/open-source/playwright-score
Methodology: METHODOLOGY.md (scoring model v4)
`);
}

// Deliberately never process.exit() right after a console.log/console.error
// — for a large enough write (verified against a real suite: a JSON report
// with 1000+ findings, ~370KB) stdout to a pipe (not a TTY) is asynchronous,
// and process.exit() can terminate the process before the OS has drained
// the write, silently truncating the output exactly at the pipe buffer
// size (64KB on macOS/Linux). Setting process.exitCode and returning lets
// Node exit naturally once pending I/O actually completes, which is the
// standard fix for this class of bug.
async function packageVersion(): Promise<string> {
  try {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    return (require('../package.json') as { version?: string }).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

// Never an absolute local path: see suite-name.ts.
function suiteName(paths: string[]): string {
  const names = paths.slice(0, 2).map((p) => {
    let isDir = false;
    try {
      isDir = fs.statSync(p).isDirectory();
    } catch {
      /* missing path: scorePaths reports it */
    }
    return suiteLabel(p, isDir);
  });
  return names.join(', ') + (paths.length > 2 ? ` and ${paths.length - 2} more` : '');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--version') || args.includes('-v')) {
    try {
      const { createRequire } = await import('node:module');
      const require = createRequire(import.meta.url);
      const pkg = require('../package.json') as { version?: string };
      console.log(pkg.version ?? '0.0.0');
    } catch {
      console.log('0.1.8');
    }
    process.exitCode = 0;
    return;
  }
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exitCode = args.length === 0 ? 2 : 0;
    return;
  }

  let profile: ProfileName = 'standard';
  let threshold: number | undefined;
  type Format = 'text' | 'json' | 'markdown' | 'sarif' | 'report';
  let format: Format = 'text';
  let out: string | undefined;
  let name: string | undefined;
  let maxSeconds: number | undefined;
  let maxHeapMb: number | undefined;
  let shared = false;
  const paths: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--profile') {
      const p = args[++i];
      if (p === 'guardian') {
        console.error(
          'Profile "guardian" is no longer public — it was QA Guardian\'s internal house-rules layer, never official Playwright doctrine, and doesn\'t belong in a general-purpose tool. See CHANGELOG.md. Use --profile standard.'
        );
        process.exitCode = 2;
        return;
      }
      if (p === 'strict') {
        console.error(
          'Profile "strict" was removed in 2.0.0 — the four gameability checks it used to count on top of "standard" (timer-sleep sleeps, coordinate clicks, trivial assertions, soft-assertion-only tests) are now scored under "standard" directly, so a separate stricter profile has nothing left to gate. See CHANGELOG.md. Use --profile standard.'
        );
        process.exitCode = 2;
        return;
      }
      if (p !== 'standard') {
        console.error(`Invalid profile: ${p}`);
        process.exitCode = 2;
        return;
      }
      profile = p as ProfileName;
    } else if (a === '--threshold') {
      threshold = Number(args[++i]);
      if (Number.isNaN(threshold) || threshold < 0 || threshold > 100) {
        console.error('threshold must be 0-100');
        process.exitCode = 2;
        return;
      }
    } else if (a === '--format') {
      const f = args[++i];
      if (f !== 'text' && f !== 'json' && f !== 'markdown' && f !== 'sarif' && f !== 'report') {
        console.error(`Invalid format: ${f}`);
        process.exitCode = 2;
        return;
      }
      format = f;
    } else if (a === '--out' || a === '--output') {
      out = args[++i];
    } else if (a === '--name') {
      name = args[++i];
      if (!name) {
        console.error('--name requires a value');
        process.exitCode = 2;
        return;
      }
    } else if (a === '--max-seconds') {
      maxSeconds = Number(args[++i]);
      const problem = limitProblem('maxSeconds', maxSeconds);
      if (problem !== undefined) {
        console.error(`--max-seconds ${problem}`);
        process.exitCode = 2;
        return;
      }
    } else if (a === '--max-heap-mb') {
      maxHeapMb = Number(args[++i]);
      const problem = limitProblem('maxHeapMb', maxHeapMb);
      if (problem !== undefined) {
        console.error(`--max-heap-mb ${problem}`);
        process.exitCode = 2;
        return;
      }
    } else if (a === '--shared') {
      shared = true;
    } else if (a === '--version' || a === '-v') {
      continue;
    } else if (a.startsWith('-')) {
      console.error(`Unknown option: ${a}`);
      process.exitCode = 2;
      return;
    } else {
      paths.push(resolveDotSlashAbsolute(a));
    }
  }

  if (paths.length === 0) {
    console.error('At least one path is required');
    process.exitCode = 2;
    return;
  }

  try {
    const result = await scorePaths({ paths, profile, threshold, maxSeconds, maxHeapMb, shared });
    for (const c of result.ruleCrashes ?? []) {
      console.error(`warning: rule ${c.rule} crashed on ${c.count} node(s); results may be incomplete`);
    }
    let body: string;
    switch (format) {
      case 'json':
        body = formatJson(result);
        break;
      case 'markdown':
        body = formatMarkdown(result);
        break;
      case 'sarif':
        body = formatSarif(result);
        break;
      case 'report':
        body = formatReport(result, {
          date: new Date().toISOString().slice(0, 10),
          version: await packageVersion(),
          suiteName: name ?? suiteName(paths),
          customThreshold: threshold !== undefined,
          readSource: makeSourceReader(paths, process.cwd(), result.baseDir),
        });
        break;
      default:
        body = formatText(result, {
          suiteName: name ?? suiteName(paths),
          version: await packageVersion(),
          customThreshold: threshold !== undefined,
        });
    }

    if (out) {
      fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
      fs.writeFileSync(out, body + '\n', 'utf8');
    } else {
      console.log(body);
    }

    process.exitCode = result.pass ? 0 : 1;
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 2;
  }
}

main();
