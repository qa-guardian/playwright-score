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
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const name = process.argv[2];
const dry = process.argv.includes('--dry-run');
if (!name) {
  console.error('usage: publish-name.mjs <name> [--dry-run]');
  process.exit(2);
}

let child = null;
// Async (not execFileSync) so a SIGINT/SIGTERM handler can run while `npm publish` is in flight.
const run = (cmd, args) =>
  new Promise((resolve, reject) => {
    child = spawn(cmd, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      child = null;
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited with ${signal ?? code}`));
    });
  });

async function publish() {
  const original = readFileSync('package.json', 'utf8');
  const version = JSON.parse(original).version;
  const restore = () => writeFileSync('package.json', original);
  // An interrupted local run must not leave package.json renamed (a default
  // SIGINT/SIGTERM kills node without running `finally`).
  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
    process.on(signal, () => {
      child?.kill(signal);
      restore();
      process.exit(code);
    });
  }
  try {
    await run('node', ['scripts/set-package-name.mjs', name]);
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
    await run('npm', ['publish', ...(dry ? ['--dry-run'] : [])]);
  } finally {
    restore();
  }
}

publish().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
