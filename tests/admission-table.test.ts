import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  Admission,
  collectTopLevelSpecifiers,
  decideAdmission,
  ROUTES,
  type AdmissionFacts,
  type NoRowReason,
  type Route,
  type RowId,
  type Tri,
} from '../src/admission.js';
import { readHead } from '../src/fs-util.js';
import { parentSpecifierList } from './helpers/parent-specifier-list.js';

// QAG-287 S5a.1: the admission decision table, tuple by tuple.
//
// The expectation is written as the table itself (one record per row, one
// set of allowed values per column), not as a second copy of the function's
// branches: a tuple that matches a record has that row; a tuple that matches
// none must come back with a "no row" reason, and the reason is checked
// against the table of combinations that cannot occur.

const TRI: Tri[] = ['yes', 'no', 'unknown'];
const BOOL = [true, false];

type Col<T> = T | 'any';
interface RowSpec {
  row: RowId;
  /** route -> [playwright import, other-framework signal] as the row needs them on that route. */
  on: Partial<Record<Route, [Tri, Tri]>>;
  readError: boolean;
  overCap: boolean;
  nulEarly: Col<boolean>;
  parseError: Col<boolean>;
  outcome: 'not-playwright' | 'other-framework' | 'skip' | 'lint';
  reason?: string;
}

const NOT_EVALUATED: [Tri, Tri] = ['unknown', 'unknown'];
// A Playwright file: a named file, or a match with no other-framework signal
// (and, on route CN, with a Playwright import).
const PLAYWRIGHT_FILE: RowSpec['on'] = {
  E: NOT_EVALUATED,
  G: ['unknown', 'no'],
  D: ['unknown', 'no'],
  CS: ['unknown', 'no'],
  CN: ['yes', 'no'],
};
const OTHER_FRAMEWORK: RowSpec['on'] = { G: ['unknown', 'yes'], D: ['unknown', 'yes'], CS: ['unknown', 'yes'], CN: ['yes', 'yes'] };

const TABLE: RowSpec[] = [
  { row: '01', on: { E: NOT_EVALUATED }, readError: true, overCap: false, nulEarly: false, parseError: false, outcome: 'skip', reason: 'unreadable' },
  { row: '02', on: { G: NOT_EVALUATED, D: NOT_EVALUATED, CS: NOT_EVALUATED }, readError: true, overCap: false, nulEarly: false, parseError: false, outcome: 'skip', reason: 'unreadable' },
  { row: '03', on: { CN: NOT_EVALUATED }, readError: true, overCap: false, nulEarly: false, parseError: false, outcome: 'not-playwright' },
  { row: '04', on: { CN: ['no', 'unknown'] }, readError: false, overCap: false, nulEarly: 'any', parseError: 'any', outcome: 'not-playwright' },
  { row: '05', on: OTHER_FRAMEWORK, readError: false, overCap: false, nulEarly: 'any', parseError: false, outcome: 'other-framework' },
  { row: '06', on: PLAYWRIGHT_FILE, readError: false, overCap: false, nulEarly: true, parseError: false, outcome: 'skip', reason: 'binary' },
  { row: '07', on: PLAYWRIGHT_FILE, readError: false, overCap: false, nulEarly: false, parseError: true, outcome: 'skip', reason: 'parse-error' },
  { row: '08', on: PLAYWRIGHT_FILE, readError: false, overCap: false, nulEarly: false, parseError: false, outcome: 'lint' },
  { row: '09', on: { CN: ['no', 'unknown'] }, readError: false, overCap: true, nulEarly: 'any', parseError: false, outcome: 'not-playwright' },
  { row: '10', on: OTHER_FRAMEWORK, readError: false, overCap: true, nulEarly: 'any', parseError: false, outcome: 'other-framework' },
  { row: '11', on: PLAYWRIGHT_FILE, readError: false, overCap: true, nulEarly: 'any', parseError: false, outcome: 'skip', reason: 'too-large' },
];

function matches(spec: RowSpec, f: AdmissionFacts): boolean {
  const on = spec.on[f.route];
  return (
    on !== undefined &&
    on[0] === f.playwrightImport &&
    on[1] === f.otherFramework &&
    spec.readError === f.readError &&
    spec.overCap === f.overCap &&
    (spec.nulEarly === 'any' || spec.nulEarly === f.nulEarly) &&
    (spec.parseError === 'any' || spec.parseError === f.parseError)
  );
}

/** The "combinations with no row" table: why a tuple that matches no row cannot occur. */
function expectedNoRow(f: AdmissionFacts): NoRowReason {
  // No bytes were read: nothing that needs bytes can be known.
  if (f.readError) return 'read-error-with-a-fact-that-needs-bytes';
  // The Playwright import is a route-CN question, and is always answered there.
  if (f.route !== 'CN' && f.playwrightImport !== 'unknown') return 'import-evaluated-off-route-CN';
  if (f.route === 'CN' && f.playwrightImport === 'unknown') return 'import-not-evaluated-on-route-CN';
  // The signal is never evaluated for a named file,
  if (f.route === 'E' && f.otherFramework !== 'unknown') return 'signal-evaluated-on-route-E';
  // nor for a config match without a Playwright import (classification stops there),
  if (f.route === 'CN' && f.playwrightImport === 'no') {
    return f.otherFramework !== 'unknown' ? 'signal-evaluated-without-a-playwright-import' : 'over-cap-never-parsed';
  }
  // and always for every other match.
  if (f.otherFramework === 'unknown' && f.route !== 'E') return 'signal-not-evaluated';
  // What is left has a parse error on a file that is never parsed.
  assert.equal(f.parseError, true, JSON.stringify(f));
  if (f.overCap) return 'over-cap-never-parsed';
  if (f.otherFramework === 'yes') return 'other-framework-never-parsed';
  return 'binary-never-parsed';
}

function allTuples(): AdmissionFacts[] {
  const out: AdmissionFacts[] = [];
  for (const route of ROUTES)
    for (const playwrightImport of TRI)
      for (const otherFramework of TRI)
        for (const readError of BOOL)
          for (const overCap of BOOL)
            for (const nulEarly of BOOL)
              for (const parseError of BOOL) out.push({ route, playwrightImport, otherFramework, readError, overCap, nulEarly, parseError });
  return out;
}

describe('QAG-287 S5a.1 admission decision table', () => {
  it('every tuple of route x import x signal x read error x over cap x NUL x parse error maps to its row or to a no-row reason', () => {
    const tuples = allTuples();
    assert.equal(tuples.length, 5 * 3 * 3 * 2 * 2 * 2 * 2);
    const perRow: Record<string, number> = {};
    const perNoRow: Record<string, number> = {};
    for (const f of tuples) {
      const rows = TABLE.filter((spec) => matches(spec, f));
      assert.ok(rows.length <= 1, `two rows for ${JSON.stringify(f)}`);
      const got = decideAdmission(f);
      if (rows.length === 1) {
        const want = rows[0];
        assert.deepEqual(
          got,
          { row: want.row, outcome: want.outcome, ...(want.reason ? { reason: want.reason } : {}) },
          JSON.stringify(f)
        );
        perRow[want.row] = (perRow[want.row] ?? 0) + 1;
      } else {
        const want = expectedNoRow(f);
        assert.deepEqual(got, { row: null, noRow: want }, JSON.stringify(f));
        perNoRow[want] = (perNoRow[want] ?? 0) + 1;
      }
    }
    // Pinned counts: 52 tuples have a row, 668 cannot occur.
    assert.deepEqual(perRow, { '01': 1, '02': 3, '03': 1, '04': 4, '05': 8, '06': 5, '07': 5, '08': 5, '09': 2, '10': 8, '11': 10 });
    assert.deepEqual(perNoRow, {
      'read-error-with-a-fact-that-needs-bytes': 355,
      'import-evaluated-off-route-CN': 192,
      'import-not-evaluated-on-route-CN': 24,
      'signal-evaluated-on-route-E': 16,
      'signal-evaluated-without-a-playwright-import': 16,
      'signal-not-evaluated': 32,
      'over-cap-never-parsed': 20,
      'other-framework-never-parsed': 8,
      'binary-never-parsed': 5,
    });
    if (process.env.ADMISSION_TABLE_COUNTS) {
      console.log(`ADMISSION-TABLE tuples=${tuples.length} rows=${JSON.stringify(perRow)} noRow=${JSON.stringify(perNoRow)}`);
    }
  });

  it('a guard reason only ever goes with a Playwright file, and one reason per file: unreadable > too-large > binary > parse-error', () => {
    for (const f of allTuples()) {
      const d = decideAdmission(f);
      if (d.row === null) continue;
      assert.equal(d.reason !== undefined, d.outcome === 'skip', JSON.stringify(f));
      if (d.outcome !== 'skip') continue;
      const want = f.readError ? 'unreadable' : f.overCap ? 'too-large' : f.nulEarly ? 'binary' : 'parse-error';
      assert.equal(d.reason, want, JSON.stringify(f));
    }
  });

  it('row 01: an injected read error on a named file is a Playwright file skipped as unreadable', () => {
    const admission = new Admission(() => ({ ok: false, code: 'EACCES' }));
    assert.deepEqual(admission.admit('/nowhere/orders.ts', 'E'), {
      decision: { row: '01', outcome: 'skip', reason: 'unreadable' },
      detail: 'EACCES',
    });
    // The same read error on a config match that is not named like a spec: row 03, left out.
    assert.equal(admission.keepsConfigMatch('/nowhere/data.ts', '/nowhere'), false);
    assert.deepEqual(admission.admit('/nowhere/data.ts', 'CN').decision, { row: '03', outcome: 'not-playwright' });
    assert.deepEqual(admission.admit('/nowhere/orders.spec.ts', 'D').decision, { row: '02', outcome: 'skip', reason: 'unreadable' });
  });

  it('each file is read once per run, whatever the number of questions asked about it', () => {
    let reads = 0;
    const admission = new Admission(() => {
      reads++;
      return { ok: true, text: `import { test } from '@playwright/test';\n`, overCap: false, nulEarly: false, size: 40 };
    });
    assert.equal(admission.keepsConfigMatch('/repo/tests/flows.ts', '/repo'), true);
    assert.deepEqual(admission.admit('/repo/tests/flows.ts', 'CN').decision, { row: '08', outcome: 'lint' });
    assert.equal(reads, 1);
  });
});

const tmpDirs: string[] = [];
after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

describe('QAG-287 S5a.1 the bounded read', () => {
  it('a FIFO is not opened: not-a-regular-file, without blocking', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-fifo-'));
    tmpDirs.push(dir);
    const fifo = path.join(dir, 'orders.spec.ts');
    execFileSync('mkfifo', [fifo]);
    const started = Date.now();
    assert.deepEqual(readHead(fifo), { ok: false, code: 'not-a-regular-file' });
    // A link to the FIFO is followed by the stat, and is not opened either.
    const link = path.join(dir, 'link.spec.ts');
    fs.symlinkSync(fifo, link);
    assert.deepEqual(readHead(link), { ok: false, code: 'not-a-regular-file' });
    assert.deepEqual(readHead(dir), { ok: false, code: 'not-a-regular-file' });
    assert.ok(Date.now() - started < 5000);
    assert.deepEqual(readHead(path.join(dir, 'missing.spec.ts')), { ok: false, code: 'ENOENT' });
  });
});

// The collector against a copy of the parent helper's list-building loop
// (tests/helpers/parent-specifier-list.ts): equal as ordered lists.
interface Case {
  name: string;
  source: string;
  file?: string;
  want: string[];
  /** The strict parser may reject this source; then there is nothing to compare. */
  strictMayReject?: true;
}

const CASES: Case[] = [
  // C1: top-level statements only.
  {
    name: 'C1 nothing inside a block, a function, a namespace or a declare module body',
    source: `function load() { require('./in-fn'); const a = require('./in-fn-2'); }
if (process.env.CI) { require('./in-block'); }
namespace Tools { const b = require('./in-ns'); }
declare module 'm' { import c from './in-declare'; }
{ require('./in-bare-block'); }
const fn = () => require('./in-arrow');
`,
    want: [],
  },
  // C2: require as a whole expression statement or a whole initialiser; export excludes.
  {
    name: 'C2 const, let, var and a bare statement',
    source: `const a = require('./a');\nlet b = require('./b');\nvar c = require('./c');\nrequire('./d');\n`,
    want: ['./a', './b', './c', './d'],
  },
  { name: 'C2 export const is not counted', source: `export const x = require('./a');\n`, want: [] },
  { name: 'C2 declare const is counted', source: `declare const x = require('./d');\n`, want: ['./d'] },
  {
    name: 'C2 declare const with two declarators, then an import',
    source: `declare const p = require('@playwright/test'), q = require('./q');\nimport './i';\n`,
    want: ['@playwright/test', './q', './i'],
  },
  { name: 'C2 export declare const is not counted', source: `export declare const x = require('./e');\n`, want: [] },
  { name: 'C2 using is counted', source: `using u = require('./u');\n`, want: ['./u'] },
  { name: 'C2 await using is counted', source: `await using w = require('./w');\n`, want: ['./w'], strictMayReject: true },
  { name: 'C2 parentheses around the call', source: `(require('./p'));\nconst k = (require('./k'));\n`, want: ['./p', './k'] },
  { name: 'C2 two declarators in one statement', source: `const a = require('./a'), b = 1, c = require('./c');\n`, want: ['./a', './c'] },
  { name: 'C2 a destructuring declarator', source: `const { test, expect } = require('./fixtures');\n`, want: ['./fixtures'] },
  // C3: the shape of the call.
  { name: 'C3 a template literal as a statement', source: 'require(`./a`);\n', want: [] },
  { name: 'C3 a template literal as an initialiser', source: 'const x = require(`./a`);\n', want: [] },
  { name: 'C3 parentheses around the callee', source: `(require)('./a');\n`, want: ['./a'] },
  { name: 'C3 parentheses around the argument', source: `require(('./a'));\n`, want: ['./a'] },
  { name: 'C3 parentheses around the callee in an initialiser', source: `const x = (require)('./a');\n`, want: ['./a'] },
  { name: 'C3 an optional call', source: `require?.('./o');\n`, want: [] },
  { name: 'C3 a member of the result', source: `require('./m').x;\nconst y = require('./m2').y;\n`, want: [] },
  { name: 'C3 a cast of the result', source: `require('./s') as any;\nconst z = require('./s2') as any;\n`, want: [] },
  { name: 'C3 a non-null assertion on the result', source: `const z = require('./n')!;\n`, want: [] },
  { name: 'C3 an awaited call', source: `await require('./w');\nconst v = await require('./w2');\n`, want: [] },
  { name: 'C3 an empty string', source: `require('');\nconst e = require('');\n`, want: [] },
  { name: 'C3 another callee', source: `load('./a');\nmodule.require('./b');\nconst c = requireFresh('./c');\n`, want: [] },
  { name: 'C3 a non-literal argument', source: `const name = './a';\nrequire(name);\nrequire('./a' + name);\n`, want: [] },
  // C4: import and export forms.
  {
    name: 'C4 type imports and exports, export star',
    source: `import type { T } from './t';\nexport type { U } from './u';\nexport * as n from './n';\nexport * from './all';\n`,
    want: ['./t', './u', './n', './all'],
  },
  {
    name: 'C4 default, named, namespace and side-effect imports, named re-export',
    source: `import a from './a';\nimport { b } from './b';\nimport * as c from './c';\nimport './d';\nexport { e } from './e';\n`,
    want: ['./a', './b', './c', './d', './e'],
  },
  { name: 'C4 import equals', source: `import x = require('./e');\n`, want: [] },
  { name: 'C4 export import', source: `export import y = require('./f');\n`, want: [], strictMayReject: true },
  { name: 'C4 export default', source: `export default require('./g');\n`, want: [] },
  { name: 'C4 export assignment', source: `export = require('./h');\n`, file: 'a.cts', want: [] },
  { name: 'C4 dynamic import', source: `import('./dyn');\nconst later = import('./dyn2');\nawait import('./dyn3');\n`, want: [] },
  { name: 'C4 a local export has no specifier', source: `const a = 1;\nexport { a };\nexport const b = 2;\n`, want: [] },
  // C5: order.
  {
    name: 'C5 every require first, then every import and export, each in statement order',
    source: `import './i1';\nconst a = require('./r1');\nexport * from './e1';\nrequire('./r2');\nimport z from './i2';\n`,
    want: ['./r1', './r2', './i1', './e1', './i2'],
  },
  // C7: script kind from the extension.
  { name: 'C7 .cjs with an import declaration and a require', file: 'a.cjs', source: `import x from './i';\nconst y = require('./r');\n`, want: ['./r', './i'] },
  {
    name: 'C7 .tsx with JSX',
    file: 'a.tsx',
    source: `import { test } from './fixtures';\nconst view = <Panel title="require('./in-jsx')">from './text'</Panel>;\nconst h = require('./h');\n`,
    want: ['./h', './fixtures'],
  },
  { name: 'C7 .jsx with JSX', file: 'a.jsx', source: `import React from './react-shim';\nexport const el = <div>import './x'</div>;\n`, want: ['./react-shim'] },
  { name: 'C7 .js', file: 'a.js', source: `const { test } = require('./fixtures');\nrequire('./setup');\n`, want: ['./fixtures', './setup'] },
  { name: 'C7 .mjs', file: 'a.mjs', source: `import { test } from './fixtures.mjs';\n`, want: ['./fixtures.mjs'] },
  { name: 'C7 .ts with an angle-bracket cast', file: 'a.ts', source: `const v = <any>require('./cast');\nimport './i';\n`, want: ['./i'] },
  { name: 'C7 .mts and .cts', file: 'a.mts', source: `import { test } from './fixtures.mjs';\nconst c = require('./c');\n`, want: ['./c', './fixtures.mjs'] },
  // Import text that is not an import.
  {
    name: 'import text in a comment, a string, a template literal, a nested function and a dynamic import',
    source: `// import { test } from '@playwright/test';
/* const x = require('./in-comment'); */
const s = "import y from './in-string'";
const t = \`require('./in-template') from './assets'\`;
function f() { return require('./nested'); }
const lazy = () => import('./dynamic');
`,
    want: [],
  },
  { name: 'a non-relative package', source: `import { describe } from 'vitest';\nconst p = require('@playwright/test');\n`, want: ['@playwright/test', 'vitest'] },
];

describe('QAG-287 S5a.1 the specifier collector equals the strict helper list', () => {
  for (const c of CASES) {
    it(c.name, () => {
      const file = c.file ?? 'a.ts';
      const mine = collectTopLevelSpecifiers(file, c.source, false);
      assert.deepEqual(mine, c.want);
      const parent = parentSpecifierList(file, c.source);
      if (parent === undefined) {
        assert.ok(c.strictMayReject, `the strict parser rejected a source it must accept: ${c.source}`);
        return;
      }
      assert.deepEqual(mine, parent);
    });
  }

  it('the strict parser rejects these sources, so there is nothing to compare', () => {
    for (const source of [`declare let x = require('./a');`, `declare var x = require('./a');`, `declare const x: any = require('./a');`]) {
      assert.equal(parentSpecifierList('a.ts', source), undefined, source);
    }
  });

  it('C6: over the cap, a statement that reaches the end of the head is not counted', () => {
    const over = (head: string, file = 'a.ts'): string[] => collectTopLevelSpecifiers(file, head, true);
    const data = `export const rows = [\n${"  'row',\n".repeat(50)}];\n`;
    assert.deepEqual(over(`${data}import x from './fo`), []);
    assert.deepEqual(over(`${data}import { test } from '@playwright/te`), []);
    assert.deepEqual(over(`${data}const x = require('./fo`, 'a.js'), []);
    // A complete declaration whose last byte is the last byte of the head.
    assert.deepEqual(over(`${data}import x from './foo';`), []);
    // A complete declaration, then a statement the cap cuts.
    assert.deepEqual(over(`import './fixtures';\ndescribe('list', () => { it('rows', () => {}); });\nexport const more = [\n  'a',\n  'b`), ['./fixtures']);
    assert.deepEqual(over(`const { test } = require('./fixtures');\n${data}export const tail = [`, 'a.cjs'), ['./fixtures']);
    // Under the cap nothing is cut, so the last statement counts.
    assert.deepEqual(collectTopLevelSpecifiers('a.ts', `${data}import x from './foo';`, false), ['./foo']);
  });
});
