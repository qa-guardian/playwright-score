#!/usr/bin/env node
// Copies the catalogue's data files next to the compiled catalogue, so the
// code can read them with fs at run time:
//   src/catalogue/*.json   -> <outDir>/catalogue/
//   labels/precision.json  -> <outDir>/catalogue/precision.json
// Usage: node scripts/copy-catalogue-data.mjs <outDir>   (dist, or dist-tests/src)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.argv[2];
if (!outDir) {
  console.error('usage: copy-catalogue-data.mjs <outDir>');
  process.exit(2);
}
const dest = path.resolve(root, outDir, 'catalogue');
fs.mkdirSync(dest, { recursive: true });
const srcDir = path.join(root, 'src', 'catalogue');
for (const name of fs.readdirSync(srcDir)) {
  if (name.endsWith('.json')) fs.copyFileSync(path.join(srcDir, name), path.join(dest, name));
}
fs.copyFileSync(path.join(root, 'labels', 'precision.json'), path.join(dest, 'precision.json'));
