#!/usr/bin/env node
// Generates labels/precision.json: hand-checked verdict counts per precision
// cell (rule, form, file role). Nothing in the output is typed by hand.
//
// A labelled row is counted only when the build that produced --run still
// reports that finding (same rule, same file, same line); a row whose finding
// has gone is not evidence about the current rules. Verdict TRUE-CLEAN counts
// as TRUE.
//
// Usage:
//   node scripts/build-precision.mjs \
//     --handcheck DIR            part-*.tsv and verdict-*.tsv (in-sample rows)
//     --manifest FILE --run DIR  corpus manifest and a corpus run (<key>.json per suite)
//     --heldout-labels FILE --heldout-manifest FILE --heldout-run DIR   (held-out v1)
//     --out labels/precision.json
//
// The form of a row is the `form` of the matching finding when the run has
// one, otherwise it is inferred from the finding's message with the same rules
// the evaluator used for builds that predate the catalogue.
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), [])
);
for (const k of ['handcheck', 'manifest', 'run', 'heldout-labels', 'heldout-manifest', 'heldout-run', 'out']) {
  if (!args[k]) {
    console.error(`missing --${k}`);
    process.exit(2);
  }
}

/** Tab-separated values with double-quote quoting (as Python's csv module reads them). */
function parseTsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let atStart = true;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && atStart) {
      quoted = true;
      atStart = false;
    } else if (c === '\t') {
      row.push(field);
      field = '';
      atStart = true;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      atStart = true;
    } else {
      field += c;
      atStart = false;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  const header = rows.shift();
  return rows.filter((r) => r.length > 1 || r[0] !== '').map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}
const readTsv = (f) => parseTsv(fs.readFileSync(f, 'utf8'));

const normRule = (r) => (r.startsWith('playwright-score/') ? `pwscore/${r.split('/')[1]}` : r);

function loadManifest(file) {
  const byKey = new Map();
  const bySuite = new Map();
  for (const m of readTsv(file)) {
    const key = `${path.basename(m.clone_path.replace(/\/+$/, ''))}__${m.suite_dir.replaceAll('/', '_')}`;
    bySuite.set(`${m.repo} ${m.suite_dir}`, key);
    byKey.set(key, m);
  }
  return bySuite;
}

const runCache = new Map();
function loadRun(dir, key) {
  const p = path.join(dir, `${key}.json`);
  if (runCache.has(p)) return runCache.get(p);
  let d = null;
  try {
    d = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    d = null;
  }
  if (runCache.size > 8) runCache.delete(runCache.keys().next().value);
  runCache.set(p, d);
  return d;
}

function inferForm(f) {
  if (f.form) return f.form;
  const r = normRule(f.rule);
  const msg = f.message ?? '';
  if (r === 'playwright/missing-playwright-await') {
    const m = /^'([^']*)' must be awaited/.exec(msg);
    if (m) {
      const n = m[1];
      return n.startsWith('to') || n.startsWith('expect') || n === 'test.step' || n === 'step' ? 'assertion' : 'action';
    }
    return 'assertion';
  }
  if (r === 'playwright/valid-expect') return msg.includes('corresponding matcher') || msg.includes('Matchers must be called') ? 'matcherless' : 'other';
  if (r === 'playwright/prefer-web-first-assertions') return 'read-direct';
  if (r === 'pwscore/no-trivial-assertion') return 'literal';
  return '-';
}

/** The finding a labelled row points at: same rule and file (longest matching path wins) and the same line. */
function matchFinding(d, rule, file, line) {
  const cands = d.findings.filter((f) => {
    if (normRule(f.rule) !== rule) return false;
    return file === f.file || file.endsWith(`/${f.file}`) || f.file.endsWith(`/${file}`);
  });
  if (!cands.length) return undefined;
  const top = Math.max(...cands.map((f) => f.file.length));
  return cands.filter((f) => f.file.length === top).find((f) => f.line === line);
}

const cells = new Map();
const inputs = {};
function count(pool, row, f) {
  const verdict = row.verdict.split('-')[0];
  if (!['TRUE', 'FALSE', 'DEBATABLE'].includes(verdict)) return false;
  const rule = f.rule;
  const key = `${rule}|${inferForm(f)}|spec`;
  if (!cells.has(key)) {
    const z = () => ({ TRUE: 0, FALSE: 0, DEBATABLE: 0 });
    cells.set(key, { rule, form: inferForm(f), role: 'spec', inSample: z(), heldoutV1: z() });
  }
  cells.get(key)[pool][verdict]++;
  return true;
}

// In-sample rows.
{
  const dir = args.handcheck;
  const part = new Map();
  const verdict = new Map();
  for (const f of fs.readdirSync(dir).sort()) {
    if (f.startsWith('part-')) for (const r of readTsv(path.join(dir, f))) part.set(r.id, r);
    if (f.startsWith('verdict-')) for (const r of readTsv(path.join(dir, f))) verdict.set(r.id, r);
  }
  const suites = loadManifest(args.manifest);
  let rows = 0;
  let emitted = 0;
  for (const [id, v] of [...verdict].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const p = part.get(id);
    if (!p) continue;
    rows++;
    const key = suites.get(p.suite);
    const d = key ? loadRun(args.run, key) : null;
    if (!d || !d.findings) continue;
    const f = matchFinding(d, normRule(p.rule), p.absolute_file, Number(p.line));
    if (f && count('inSample', v, f)) emitted++;
  }
  inputs.inSample = { rows, emitted };
}

// Held-out v1 rows.
{
  const suites = loadManifest(args['heldout-manifest']);
  let rows = 0;
  let emitted = 0;
  for (const r of readTsv(args['heldout-labels'])) {
    rows++;
    const key = suites.get(`${r.repo} ${r.suite_dir}`);
    const d = key ? loadRun(args['heldout-run'], key) : null;
    if (!d || !d.findings) continue;
    const f = matchFinding(d, normRule(r.rule), r.file, Number(r.line));
    if (f && count('heldoutV1', r, f)) emitted++;
  }
  inputs.heldoutV1 = { rows, emitted };
}

function wilsonLow(k, n, z = 1.96) {
  if (!n) return null;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return Math.max(0, c - h);
}
const round = (x) => (x === null ? null : Math.round(x * 10000) / 10000);

const out = [...cells.values()]
  .sort((a, b) => (a.rule + a.form < b.rule + b.form ? -1 : 1))
  .map((c) => {
    const trueRows = c.inSample.TRUE + c.heldoutV1.TRUE;
    const falseRows = c.inSample.FALSE + c.heldoutV1.FALSE;
    const decided = trueRows + falseRows;
    return {
      rule: c.rule,
      form: c.form,
      role: c.role,
      inSample: c.inSample,
      heldoutV1: c.heldoutV1,
      decided,
      trueRows,
      precision: decided ? round(trueRows / decided) : null,
      wilsonLow: round(wilsonLow(trueRows, decided)),
    };
  });

fs.writeFileSync(
  args.out,
  `${JSON.stringify(
    {
      schema: 1,
      generatedBy: 'scripts/build-precision.mjs',
      stage: 'interim: development rows only (hand-checked in-sample rows and held-out v1); regenerated from the fresh labels later',
      counting: 'a row counts only when the build behind --run still reports that finding; TRUE-CLEAN counts as TRUE; precision = TRUE / (TRUE + FALSE)',
      inputs,
      cells: out,
    },
    null,
    1
  )}\n`
);
console.log(JSON.stringify(inputs), `${out.length} cells`);
