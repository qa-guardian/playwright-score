#!/usr/bin/env node
// Rewrites the "name" field of ./package.json (nothing else) so one source tree
// can be published under both npm names: @qaguardian/playwright-score and
// pwscore. Used by .github/workflows/publish.yml in a throwaway CI checkout and
// by the local dry-run; never commit the rewritten file.
//
//   node scripts/set-package-name.mjs <name>
import { readFileSync, writeFileSync } from 'node:fs';

const ALLOWED = ['@qaguardian/playwright-score', 'pwscore'];
const name = process.argv[2];
if (!ALLOWED.includes(name)) {
  console.error(`usage: set-package-name.mjs <${ALLOWED.join('|')}>`);
  process.exit(2);
}
const raw = readFileSync('package.json', 'utf8');
const pkg = JSON.parse(raw);
pkg.name = name;
writeFileSync('package.json', JSON.stringify(pkg, null, 2) + (raw.endsWith('\n') ? '\n' : ''));
console.log(`package.json name -> ${name}`);
