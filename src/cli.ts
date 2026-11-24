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
import { optionsHelp, parseArgs } from './cli-args.js';

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
${optionsHelp()}

Exit codes:
  0  pass: status scored (or partial with --allow-partial), nothing
     named by --fail-on found, and score >= --threshold when given
  1  not pass, including a partial result without --allow-partial
     (a file was skipped: syntax error, over 1 MB, binary, unreadable,
     or a --max-seconds / --max-heap-mb limit was hit) and every
     not-scored result (no files matched, every file skipped, or no
     counted tests)
  2  tool or usage error (an unknown option or --fail-on value, or
     "none" combined with another --fail-on value)

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

  const parsed = parseArgs(args);
  if ('error' in parsed) {
    console.error(parsed.error);
    process.exitCode = 2;
    return;
  }
  const { paths, profile, threshold, format, out, name, maxSeconds, maxHeapMb, failOn, allowPartial, advice } = parsed.options;

  try {
    const result = await scorePaths({ paths, profile, threshold, maxSeconds, maxHeapMb, failOn, allowPartial, advice });
    for (const c of result.ruleCrashes ?? []) {
      console.error(`warning: rule ${c.rule} crashed on ${c.count} node(s); results may be incomplete`);
    }
    let body: string;
    switch (format) {
      case 'json':
        body = formatJson(result);
        break;
      case 'markdown':
        body = formatMarkdown(result, { advice });
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
          advice,
          readSource: makeSourceReader(paths, process.cwd(), result.baseDir),
        });
        break;
      default:
        body = formatText(result, {
          suiteName: name ?? suiteName(paths),
          version: await packageVersion(),
          customThreshold: threshold !== undefined,
          advice,
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
