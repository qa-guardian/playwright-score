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
  --profile <standard|guardian>   Scoring profile (default: standard)
  --threshold <n>                 Pass threshold 0-100 (default: 80 standard / 75 guardian)
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

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--version') || args.includes('-v')) {
    try {
      const { createRequire } = await import('node:module');
      const require = createRequire(import.meta.url);
      const pkg = require('../package.json') as { version?: string };
      console.log(pkg.version ?? '0.0.0');
    } catch {
      console.log('0.1.3');
    }
    process.exit(0);
  }
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(args.length === 0 ? 2 : 0);
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
      profile = args[++i] as ProfileName;
      if (profile !== 'standard' && profile !== 'guardian') {
        console.error(`Invalid profile: ${profile}`);
        process.exit(2);
      }
    } else if (a === '--threshold') {
      threshold = Number(args[++i]);
      if (Number.isNaN(threshold) || threshold < 0 || threshold > 100) {
        console.error('threshold must be 0-100');
        process.exit(2);
      }
    } else if (a === '--format') {
      const f = args[++i];
      if (f !== 'text' && f !== 'json' && f !== 'markdown' && f !== 'sarif') {
        console.error(`Invalid format: ${f}`);
        process.exit(2);
      }
      format = f;
    } else if (a === '--out') {
      out = args[++i];
    } else if (a === '--version' || a === '-v') {
      continue;
    } else if (a.startsWith('-')) {
      console.error(`Unknown option: ${a}`);
      process.exit(2);
    } else {
      paths.push(a);
    }
  }

  if (paths.length === 0) {
    console.error('At least one path is required');
    process.exit(2);
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

    process.exit(result.pass ? 0 : 1);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(2);
  }
}

main();
