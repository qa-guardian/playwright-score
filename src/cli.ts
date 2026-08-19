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
import type { ProfileName } from './types.js';

function printHelp(): void {
  console.log(`@qaguardian/playwright-score — deterministic Playwright spec quality score (sqs-v1)

Usage:
  npx -p @qaguardian/playwright-score playwright-score <paths...> [options]
  # after npm install -D @qaguardian/playwright-score:
  npx playwright-score <paths...> [options]

Options:
  --profile <standard>            Scoring profile (default, and only: standard)
  --threshold <n>                 Pass threshold 0-100 (default: 80)
  --format <text|json|markdown|sarif>  Output format (default: text)
  --out <file>                    Write report to file
  --version                       Print version
  --help                          Show help

Exit codes:
  0  score >= threshold
  1  score < threshold (or no files matched)
  2  tool error

Website: https://qaguardian.com/open-source/playwright-score
Methodology: METHODOLOGY.md (sqs-v1)
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
  type Format = 'text' | 'json' | 'markdown' | 'sarif';
  let format: Format = 'text';
  let out: string | undefined;
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
      if (f !== 'text' && f !== 'json' && f !== 'markdown' && f !== 'sarif') {
        console.error(`Invalid format: ${f}`);
        process.exitCode = 2;
        return;
      }
      format = f;
    } else if (a === '--out') {
      out = args[++i];
    } else if (a === '--version' || a === '-v') {
      continue;
    } else if (a.startsWith('-')) {
      console.error(`Unknown option: ${a}`);
      process.exitCode = 2;
      return;
    } else {
      paths.push(a);
    }
  }

  if (paths.length === 0) {
    console.error('At least one path is required');
    process.exitCode = 2;
    return;
  }

  try {
    const result = await scorePaths({ paths, profile, threshold });
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
      default:
        body = formatText(result);
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
