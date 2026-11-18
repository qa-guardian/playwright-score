#!/usr/bin/env node
// Publishes the current source tree under one npm name if that name does not
// already have this version. The rewrite of package.json stays in the working
// tree only (the CI checkout is thrown away); the file is restored afterwards
// anyway so a local run leaves no diff.
//
//   node scripts/publish-name.mjs <name> [--dry-run]
//
// --dry-run runs `npm publish --dry-run` (no registry write, no auth needed)
// and skips the "already published" check, so it works before first publish.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const name = process.argv[2];
const dry = process.argv.includes('--dry-run');
if (!name) {
  console.error('usage: publish-name.mjs <name> [--dry-run]');
  process.exit(2);
}
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });

function publish() {
  const original = readFileSync('package.json', 'utf8');
  const version = JSON.parse(original).version;
  try {
    run('node', ['scripts/set-package-name.mjs', name]);
    if (!dry) {
      let published = 'none';
      try {
        published = execFileSync('npm', ['view', `${name}@${version}`, 'version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || 'none';
      } catch {
        /* 404 = not published yet */
      }
      if (published === version) {
        // Never process.exit() inside try: it skips `finally` and leaves package.json renamed.
        console.log(`${name}@${version} is already published, skipping`);
        process.exitCode = 0;
        return;
      }
    }
    run('npm', ['publish', ...(dry ? ['--dry-run'] : [])]);
  } finally {
    writeFileSync('package.json', original);
  }
}

publish();
