import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  resolveForRunner,
  realRunnerEnv,
  RUNNER_LOOKUP,
  type RunnerEnv,
  type RunnerResolution,
} from '../src/rules/runner-resolve.js';
import { createModuleResolver, RESOLVE_EXTENSIONS, INDEX_FILES, JS_TO_TS_SOURCE } from '../src/module-resolution.js';

// QAG-287 B2.1: rule R, "which file does the test runner load for this import?".
// Row ids are those of the slice's unit matrix. The env is in memory unless a row says otherwise.

const P = '/p';
const REEXPORT = "export { test, expect } from '@playwright/test';\n";
const OWN = 'export const test = () => {};\n';

interface Opts {
  from?: string;
  legacy?: string;
  boundary?: string;
  real?: (p: string) => string | undefined;
}

/** Files are given relative to /p (or absolute); `legacy` is the file the earlier lookup returns. */
function memEnv(files: Record<string, string>, opts: Opts = {}): RunnerEnv {
  const abs = (f: string): string => (f.startsWith('/') ? f : `${P}/${f}`);
  const map = new Map(Object.entries(files).map(([f, text]) => [abs(f), text]));
  return {
    boundaryDir: opts.boundary ?? P,
    isFile: (p) => map.has(p),
    isDir: (p) => [...map.keys()].some((k) => k.startsWith(`${p}/`)),
    readText: (p) => map.get(p),
    realPath: opts.real ?? ((p) => p),
    legacyResolve: () => (opts.legacy === undefined ? undefined : abs(opts.legacy)),
  };
}

function run(spec: string, files: Record<string, string>, opts: Opts = {}): RunnerResolution {
  const from = opts.from ?? 'a.spec.ts';
  return resolveForRunner(from.startsWith('/') ? from : `${P}/${from}`, spec, memEnv(files, opts));
}

const file = (rel: string): RunnerResolution => ({ kind: 'file', path: rel.startsWith('/') ? rel : `${P}/${rel}` });
const unknown = (reason: string): RunnerResolution => ({ kind: 'unknown', reason }) as RunnerResolution;
const AMBIGUOUS = unknown('ambiguous-module');
const UNRESOLVED = unknown('module-unresolved');
const CONFIG = unknown('runner-config');
const pkg = (spec: string): RunnerResolution => ({ kind: 'package', spec });

const tsconfig = (paths: Record<string, unknown>, more: Record<string, unknown> = {}): string =>
  JSON.stringify({ compilerOptions: { paths, ...more } });
const FX_STAR = tsconfig({ '@fx/*': ['./support/*'] });

// The test's own copy of C(base) and RL(base), built from the exported constant.
const { EXT8, EXT, SWAP } = RUNNER_LOOKUP;
const swapsOf = (base: string): string[] => {
  const key = Object.keys(SWAP).find((k) => base.endsWith(k));
  return key ? SWAP[key].map((o) => base.slice(0, -key.length) + o) : [];
};
const C = (base: string): string[] => [
  ...new Set([base, ...EXT.map((e) => base + e), ...swapsOf(base), `${base}/index`, ...EXT.map((e) => `${base}/index${e}`)]),
];
const RL = (base: string): string[] => {
  const s = swapsOf(base);
  return [base, ...(s.length > 0 ? s : EXT8.map((e) => base + e)), `${base}/index`, ...EXT8.map((e) => `${base}/index${e}`)];
};
const BASE_FORMS = ['', '.js', '.jsx', '.cjs', '.mjs'];

describe('runner-resolve: the lookup constant', () => {
  it('holds every extension, swap and index file of the earlier lookup', () => {
    for (const e of RESOLVE_EXTENSIONS) if (e !== '') assert.ok(EXT.includes(e), e);
    for (const [from, to] of Object.entries(JS_TO_TS_SOURCE)) for (const t of to) assert.ok(SWAP[from]?.includes(t), `${from}->${t}`);
    for (const idx of INDEX_FILES) assert.ok(EXT.includes(idx.slice('index'.length)), idx);
    assert.deepEqual([...EXT8], ['.js', '.ts', '.jsx', '.tsx', '.cjs', '.mjs', '.cts', '.mts']);
    assert.deepEqual(EXT.slice(8), ['.json', '.node']);
    for (const base of ['/p/x', '/p/x.js', '/p/x.cjs']) for (const p of RL(base)) assert.ok(C(base).includes(p), p);
  });
});

describe('runner-resolve: step R2, the file lookup', () => {
  it('R2-1: ./fixtures.js with fixtures.ts and fixtures.jsx is ambiguous', () => {
    assert.deepEqual(run('./fixtures.js', { 'fixtures.ts': REEXPORT, 'fixtures.jsx': OWN }, { legacy: 'fixtures.ts' }), AMBIGUOUS);
  });
  it('R2-1c: ./fixtures.js with only fixtures.ts is that file', () => {
    assert.deepEqual(run('./fixtures.js', { 'fixtures.ts': REEXPORT }, { legacy: 'fixtures.ts' }), file('fixtures.ts'));
  });
  it('R2-2: ./fixtures with fixtures/index.ts and fixtures.cjs is ambiguous', () => {
    assert.deepEqual(run('./fixtures', { 'fixtures/index.ts': REEXPORT, 'fixtures.cjs': OWN }, { legacy: 'fixtures/index.ts' }), AMBIGUOUS);
  });
  it('R2-3: a directory with a package.json is ambiguous', () => {
    const files = { 'lib/index.ts': REEXPORT, 'lib/package.json': '{"main":"fake.js"}' };
    assert.deepEqual(run('./lib', files, { legacy: 'lib/index.ts' }), AMBIGUOUS);
  });
  it('R2-3c: the directory without a manifest, and ./lib/index with it, are the index file', () => {
    assert.deepEqual(run('./lib', { 'lib/index.ts': REEXPORT }, { legacy: 'lib/index.ts' }), file('lib/index.ts'));
    const files = { 'lib/index.ts': REEXPORT, 'lib/package.json': '{"main":"fake.js"}' };
    assert.deepEqual(run('./lib/index', files, { legacy: 'lib/index.ts' }), file('lib/index.ts'));
  });
  it('R2-4: ./fixtures with fixtures/index.ts and fixtures.json is ambiguous', () => {
    assert.deepEqual(run('./fixtures', { 'fixtures/index.ts': REEXPORT, 'fixtures.json': '{}' }, { legacy: 'fixtures/index.ts' }), AMBIGUOUS);
  });
  it('R2-5: nothing on disk is module-unresolved', () => {
    assert.deepEqual(run('./fixtures', {}), UNRESOLVED);
  });
  it('R2-6: one existing file the earlier lookup does not return is ambiguous', () => {
    assert.deepEqual(run('./fixtures.js', { 'fixtures.jsx': OWN }), AMBIGUOUS);
    assert.deepEqual(run('./fixtures', { 'fixtures/index.cjs': OWN }), AMBIGUOUS);
    assert.deepEqual(run('./fixtures', { 'fixtures.ts': REEXPORT }, { legacy: 'other.ts' }), AMBIGUOUS);
  });
  it('R2-7: fixtures/index.ts beside a file named fixtures/index is ambiguous', () => {
    assert.deepEqual(run('./fixtures', { 'fixtures/index.ts': REEXPORT, 'fixtures/index': OWN }, { legacy: 'fixtures/index.ts' }), AMBIGUOUS);
  });
  it('R2-G: every pair of candidates is ambiguous; every single candidate is that file', () => {
    let pairs = 0;
    for (const form of BASE_FORMS) {
      const cands = C(`${P}/fixtures${form}`);
      for (let i = 0; i < cands.length; i++) {
        const one = run(`./fixtures${form}`, { [cands[i]]: REEXPORT }, { legacy: cands[i] });
        assert.deepEqual(one, file(cands[i]), `${form} ${cands[i]}`);
        for (let j = i + 1; j < cands.length; j++) {
          const two = run(`./fixtures${form}`, { [cands[i]]: REEXPORT, [cands[j]]: OWN }, { legacy: cands[i] });
          assert.deepEqual(two, AMBIGUOUS, `${form} ${cands[i]} + ${cands[j]}`);
          pairs++;
        }
      }
    }
    assert.ok(pairs > 1000, String(pairs));
  });
});

describe('runner-resolve: step R3, the config mapping', () => {
  const R31 = { 'tsconfig.json': tsconfig({ '@fx/fixtures': ['./support/fixtures.ts'] }), 'support/fixtures.ts': REEXPORT };
  const LEG = { legacy: 'support/fixtures.ts' };

  it('R3-1: a .js importer and no allowJs is runner-config', () => {
    assert.deepEqual(run('@fx/fixtures', R31, { ...LEG, from: 'a.spec.js' }), CONFIG);
  });
  it('R3-1c: the same with allowJs is the file', () => {
    const files = { ...R31, 'tsconfig.json': tsconfig({ '@fx/fixtures': ['./support/fixtures.ts'] }, { allowJs: true }) };
    assert.deepEqual(run('@fx/fixtures', files, { ...LEG, from: 'a.spec.js' }), file('support/fixtures.ts'));
  });
  it('R3-2: the gate reads the importer extension as the runner does', () => {
    for (const ext of ['.mts', '.cts', '.mjs', '.jsx']) assert.deepEqual(run('@fx/fixtures', R31, { ...LEG, from: `a.spec${ext}` }), CONFIG, ext);
    assert.deepEqual(run('@fx/fixtures', R31, { ...LEG, from: 'a.spec.tsx' }), file('support/fixtures.ts'));
    assert.deepEqual(run('@fx/fixtures', R31, LEG), file('support/fixtures.ts'));
  });
  it('R3-3: a nearer jsconfig.json that maps to another file is ambiguous', () => {
    const files = {
      'tests/jsconfig.json': tsconfig({ '@fx/fixtures': ['../support/runner.ts'] }),
      'tsconfig.json': tsconfig({ '@fx/fixtures': ['./support/fixtures.ts'] }),
      'support/fixtures.ts': REEXPORT,
      'support/runner.ts': OWN,
    };
    assert.deepEqual(run('@fx/fixtures', files, { ...LEG, from: 'tests/a.spec.ts' }), AMBIGUOUS);
  });
  it('R3-3b: tsconfig.json and jsconfig.json in one directory, mapping to two files, is ambiguous', () => {
    const files = {
      'tsconfig.json': tsconfig({ '@fx/fixtures': ['./support/fixtures.ts'] }),
      'jsconfig.json': tsconfig({ '@fx/fixtures': ['./support/runner.ts'] }),
      'support/fixtures.ts': REEXPORT,
      'support/runner.ts': OWN,
    };
    assert.deepEqual(run('@fx/fixtures', files, LEG), AMBIGUOUS);
  });
  it('R3-3c: both config files mapping to the same file is that file', () => {
    assert.deepEqual(run('@fx/fixtures', { ...R31, 'jsconfig.json': R31['tsconfig.json'] }, LEG), file('support/fixtures.ts'));
  });
  it('R3-3d: one of two config files not mapping the file is runner-config', () => {
    assert.deepEqual(run('@fx/fixtures', { ...R31, 'jsconfig.json': '{}' }, LEG), CONFIG);
  });
  it('R3-4: an extends with no leading dot is followed', () => {
    const files = {
      'tsconfig.json': '{"extends": "configs/base.json"}',
      'configs/base.json': tsconfig({ '@playwright/test': ['../support/fake.ts'] }),
      'support/fake.ts': OWN,
    };
    assert.deepEqual(run('@playwright/test', files), AMBIGUOUS);
  });
  it('R3-5: references are loaded', () => {
    const files = {
      'tsconfig.json': '{"files": [], "references": [{"path": "./tsconfig.app.json"}]}',
      'tsconfig.app.json': tsconfig({ '@playwright/test': ['./support/fake.ts'] }),
      'support/fake.ts': OWN,
    };
    assert.deepEqual(run('@playwright/test', files), AMBIGUOUS);
  });
  it('R3-6: extends is followed to any depth, and as an array', () => {
    const deep = {
      'tsconfig.json': '{"extends": "./l1.json"}',
      'l1.json': '{"extends": "./l2"}',
      'l2.json': '{"extends": "./l3.json"}',
      'l3.json': tsconfig({ '@playwright/test': ['./support/fake.ts'] }),
      'support/fake.ts': OWN,
    };
    assert.deepEqual(run('@playwright/test', deep), AMBIGUOUS);
    const arr = {
      'tsconfig.json': '{"extends": ["./maps.json", "./plain.json"]}',
      'maps.json': tsconfig({ '@playwright/test': ['./support/fake.ts'] }),
      'plain.json': '{"compilerOptions": {"strict": true}}',
      'support/fake.ts': OWN,
    };
    assert.deepEqual(run('@playwright/test', arr), AMBIGUOUS);
  });
  it('R3-7: a child baseUrl moves the base of inherited paths', () => {
    const files = {
      'configs/parent.json': tsconfig({ '@fx/*': ['fx/*'] }, { baseUrl: '../real' }),
      'tsconfig.json': '{"extends": "./configs/parent.json", "compilerOptions": {"baseUrl": "./fake"}}',
      'real/fx/fixtures.ts': REEXPORT,
      'fake/fx/fixtures.ts': OWN,
    };
    assert.deepEqual(run('@fx/fixtures', files, { legacy: 'real/fx/fixtures.ts' }), AMBIGUOUS);
    assert.deepEqual(run('@fx/fixtures', files, { legacy: 'fake/fx/fixtures.ts' }), file('fake/fx/fixtures.ts'));
  });
  it('R3-7c: paths with a baseUrl resolve against the baseUrl', () => {
    const files = { 'tsconfig.json': tsconfig({ '@fx/*': ['fx/*'] }, { baseUrl: './src' }), 'src/fx/fixtures.ts': REEXPORT };
    assert.deepEqual(run('@fx/fixtures', files, { legacy: 'src/fx/fixtures.ts' }), file('src/fx/fixtures.ts'));
  });
  it('R3-8: two existing values of one key are ambiguous', () => {
    const files = {
      'tsconfig.json': tsconfig({ '@fx/fixtures': ['./support/fixtures.ts', './support/runner.ts'] }),
      'support/fixtures.ts': REEXPORT,
      'support/runner.ts': OWN,
    };
    assert.deepEqual(run('@fx/fixtures', files, LEG), AMBIGUOUS);
  });
  it('R3-9: two matching keys with existing targets are ambiguous', () => {
    const files = {
      'tsconfig.json': tsconfig({ '@fx/fixtures': ['./missing.ts'], '@fx/*': ['../fake/*'] }, { baseUrl: './real' }),
      'real/@fx/fixtures.ts': REEXPORT,
      'fake/fixtures.ts': OWN,
    };
    assert.deepEqual(run('@fx/fixtures', files, { legacy: 'real/@fx/fixtures.ts' }), AMBIGUOUS);
  });
  it('R3-10: a config only JSON5 can read is runner-config (parseLenientJson cannot read it)', () => {
    const files = {
      'tsconfig.json': "{ compilerOptions: { paths: { '@playwright/test': ['./support/fake.ts'] } } }",
      'support/fake.ts': OWN,
    };
    assert.deepEqual(run('@playwright/test', files, { legacy: 'support/fake.ts' }), CONFIG);
  });
  it('R3-11: a referenced config with allowJs mapping to another file is ambiguous', () => {
    const files = {
      'tsconfig.json': JSON.stringify({
        compilerOptions: { paths: { '@fx/fixtures': ['./support/fixtures.ts'] } },
        references: [{ path: './tsconfig.js.json' }],
      }),
      'tsconfig.js.json': tsconfig({ '@fx/fixtures': ['./support/runner.js'] }, { allowJs: true }),
      'support/fixtures.ts': REEXPORT,
      'support/runner.js': OWN,
    };
    assert.deepEqual(run('@fx/fixtures', files, { ...LEG, from: 'a.spec.js' }), AMBIGUOUS);
  });
  it('R3-12: a project with only jsconfig.json; control without a mapping', () => {
    const files = { 'jsconfig.json': tsconfig({ '@playwright/test': ['./support/fake.js'] }), 'support/fake.js': OWN };
    assert.deepEqual(run('@playwright/test', files, { from: 'a.spec.js' }), AMBIGUOUS);
    assert.deepEqual(run('@playwright/test', { 'jsconfig.json': '{}' }, { from: 'a.spec.js' }), pkg('@playwright/test'));
  });
  it('R3-12c: jsconfig.json has allowJs unless it says otherwise', () => {
    const files = { 'jsconfig.json': tsconfig({ '@fx/fixtures': ['./support/fixtures.js'] }), 'support/fixtures.js': REEXPORT };
    const opts = { from: 'a.spec.js', legacy: 'support/fixtures.js' };
    assert.deepEqual(run('@fx/fixtures', files, opts), file('support/fixtures.js'));
    const off = { ...files, 'jsconfig.json': tsconfig({ '@fx/fixtures': ['./support/fixtures.js'] }, { allowJs: false }) };
    assert.deepEqual(run('@fx/fixtures', off, opts), CONFIG);
  });
  it('R3-13: a builtin is never mapped', () => {
    const files = { 'tsconfig.json': tsconfig({ 'node:test': ['./support/fake.ts'], fs: ['./support/fake.ts'] }), 'support/fake.ts': OWN };
    assert.deepEqual(run('node:test', files), { kind: 'builtin', spec: 'node:test' });
    assert.deepEqual(run('fs', files), { kind: 'builtin', spec: 'fs' });
  });
  it('R3-14: #names, absolute paths and URL schemes are module-unresolved', () => {
    for (const spec of ['#fixtures', '/p/fixtures.ts', 'data:text/javascript,x', 'file:///p/fixtures.ts']) {
      assert.deepEqual(run(spec, { 'fixtures.ts': REEXPORT }, { legacy: 'fixtures.ts' }), UNRESOLVED, spec);
    }
  });
  it('R3-15: a file only a referenced config maps is not a new proof', () => {
    const files = {
      'tsconfig.json': '{"files": [], "references": [{"path": "./tsconfig.app.json"}]}',
      'tsconfig.app.json': tsconfig({ '@/*': ['./src/*'] }),
      'src/fixtures.ts': REEXPORT,
    };
    assert.deepEqual(run('@/fixtures', files), AMBIGUOUS);
  });
  it('R3-16: no config, or a config with no paths and no baseUrl, is a package', () => {
    assert.deepEqual(run('some-runner', {}), pkg('some-runner'));
    assert.deepEqual(run('some-runner', { 'tsconfig.json': '{"compilerOptions": {"strict": true}}' }), pkg('some-runner'));
  });
  it('R3-17: an alias whose target is a directory with a manifest is ambiguous', () => {
    const files = { 'tsconfig.json': tsconfig({ '@fx/lib': ['./lib'] }), 'lib/index.ts': REEXPORT, 'lib/package.json': '{}' };
    assert.deepEqual(run('@fx/lib', files, { legacy: 'lib/index.ts' }), AMBIGUOUS);
  });
  it('R3-18: baseUrl with no paths maps every name', () => {
    const files = { 'tsconfig.json': '{"compilerOptions": {"baseUrl": "."}}', 'support/fixtures.ts': REEXPORT };
    assert.deepEqual(run('support/fixtures', files, LEG), file('support/fixtures.ts'));
  });
  it('R3-19: a workspace package (no config maps it, the earlier lookup returns a file) is ambiguous', () => {
    assert.deepEqual(run('@ws/fixtures', { 'packages/fixtures/index.ts': REEXPORT }, { legacy: 'packages/fixtures/index.ts' }), AMBIGUOUS);
  });
  it('R3-20: a preset under node_modules is read; a cycle does not throw', () => {
    const files = {
      'tsconfig.json': '{"extends": "@fx/tsconfig/base.json"}',
      'node_modules/@fx/tsconfig/base.json': tsconfig({ '@playwright/test': ['../../../support/fake.ts'] }),
      'support/fake.ts': OWN,
    };
    assert.deepEqual(run('@playwright/test', files), AMBIGUOUS);
    const cycle = { 'tsconfig.json': '{"extends": "./b.json"}', 'b.json': '{"extends": "./tsconfig.json"}' };
    assert.deepEqual(run('some-runner', cycle), pkg('some-runner'));
  });
  it('R3-21: a field of the wrong type is runner-config', () => {
    const faults: Record<string, string> = {
      'paths is a string': '{"compilerOptions": {"paths": "x"}}',
      'a value list holds a number': '{"compilerOptions": {"paths": {"@fx/fixtures": [1]}}}',
      'values is not a list': '{"compilerOptions": {"paths": {"@fx/fixtures": "./support/fixtures.ts"}}}',
      'extends holds a number': '{"extends": [1]}',
      'references is an object': '{"references": {"path": "./x.json"}}',
      'a reference path is not a string': '{"references": [{"path": 1}]}',
      'a key with two stars': '{"compilerOptions": {"paths": {"@*/*": ["./support/*"]}}}',
      'the file is a list': '[]',
      'baseUrl is a number': '{"compilerOptions": {"baseUrl": 1}}',
      'compilerOptions is a list': '{"compilerOptions": []}',
    };
    for (const [name, text] of Object.entries(faults)) {
      assert.deepEqual(run('@fx/fixtures', { 'tsconfig.json': text, 'support/fixtures.ts': REEXPORT }, LEG), CONFIG, name);
    }
  });
  it('R3-22: the superset finds a file the runner list does not hold: runner-config', () => {
    const files = { 'tsconfig.json': FX_STAR, 'support/fixtures.js.ts': REEXPORT };
    assert.deepEqual(run('@fx/fixtures.js', files, { legacy: 'support/fixtures.js.ts' }), CONFIG);
  });
  it('R3-22b: .json and base + .ts after a .cjs base are not in the runner list', () => {
    assert.deepEqual(run('@fx/data', { 'tsconfig.json': FX_STAR, 'support/data.json': '{}' }, { legacy: 'support/data.json' }), CONFIG);
    const files = { 'tsconfig.json': FX_STAR, 'support/fixtures.cjs.ts': REEXPORT };
    assert.deepEqual(run('@fx/fixtures.cjs', files, { legacy: 'support/fixtures.cjs.ts' }), CONFIG);
  });
  it('R3-22c: controls the runner list holds', () => {
    assert.deepEqual(run('@fx/fixtures.js', { 'tsconfig.json': FX_STAR, 'support/fixtures.ts': REEXPORT }, LEG), file('support/fixtures.ts'));
    const files = { 'tsconfig.json': FX_STAR, 'support/fx/index.ts': REEXPORT };
    assert.deepEqual(run('@fx/fx', files, { legacy: 'support/fx/index.ts' }), file('support/fx/index.ts'));
  });
  it('R3-22d: a mapped directory with index.ts and a file named index is ambiguous', () => {
    const files = { 'tsconfig.json': FX_STAR, 'support/fx/index.ts': REEXPORT, 'support/fx/index': OWN };
    assert.deepEqual(run('@fx/fx', files, { legacy: 'support/fx/index.ts' }), AMBIGUOUS);
  });
  it('R3-G2: a single mapped candidate is the file exactly when the runner list holds it', () => {
    let inList = 0;
    let outOfList = 0;
    for (const form of BASE_FORMS) {
      const base = `${P}/support/fixtures${form}`;
      const list = new Set(RL(base));
      for (const p of C(base)) {
        const got = run(`@fx/fixtures${form}`, { 'tsconfig.json': FX_STAR, [p]: REEXPORT }, { legacy: p });
        assert.deepEqual(got, list.has(p) ? file(p) : CONFIG, `${form} ${p}`);
        if (list.has(p)) inList++;
        else outOfList++;
      }
    }
    assert.ok(inList > 50 && outOfList > 20, `${inList} ${outOfList}`);
  });
  it('R3-23: the key match and the star replacement are the runner expressions', () => {
    const a = { 'tsconfig.json': tsconfig({ 'ab*ba': ['./support/x*.ts'] }), 'support/x.ts': REEXPORT };
    assert.deepEqual(run('aba', a, { legacy: 'support/x.ts' }), file('support/x.ts'));
    const b = { 'tsconfig.json': FX_STAR, 'support/$&.ts': REEXPORT };
    assert.deepEqual(run('@fx/$&', b, { legacy: 'support/$&.ts' }), AMBIGUOUS);
  });
});

describe('runner-resolve: steps R5 and R7', () => {
  it('R5-1: an importer under node_modules is module-unresolved', () => {
    const files = { 'node_modules/x/fixtures.ts': REEXPORT };
    assert.deepEqual(run('./fixtures', files, { from: 'node_modules/x/index.js', legacy: 'node_modules/x/fixtures.ts' }), UNRESOLVED);
  });
  it('R5-1b: a file under node_modules is never followed', () => {
    const files = { 'tsconfig.json': tsconfig({ '@fx/fixtures': ['./node_modules/fx/index.ts'] }), 'node_modules/fx/index.ts': REEXPORT };
    assert.deepEqual(run('@fx/fixtures', files, { legacy: 'node_modules/fx/index.ts' }), UNRESOLVED);
    assert.deepEqual(run('../out/fixtures', { '/out/fixtures.ts': REEXPORT }, { legacy: '/out/fixtures.ts' }), UNRESOLVED);
  });
  it('R7-1: a file that is a link is not followed', () => {
    const real = (p: string): string => (p === '/p/e2e/fixtures.ts' ? '/p/shared/fixtures.ts' : p);
    const files = { 'e2e/fixtures.ts': "export * from './base';\n", 'e2e/base.ts': REEXPORT, 'shared/base.ts': OWN };
    assert.deepEqual(run('./fixtures', files, { from: 'e2e/a.spec.ts', legacy: 'e2e/fixtures.ts', real }), AMBIGUOUS);
    assert.deepEqual(run('./fixtures', files, { from: 'e2e/a.spec.ts', legacy: 'e2e/fixtures.ts' }), file('e2e/fixtures.ts'));
  });
  it('R7-2: a mapped file below a linked directory is not followed', () => {
    const real = (p: string): string => (p.startsWith('/p/support') ? p.replace('/p/support', '/p/shared/support') : p);
    const files = { 'tsconfig.json': FX_STAR, 'support/fixtures.ts': "export * from '../base';\n" };
    assert.deepEqual(run('@fx/fixtures', files, { legacy: 'support/fixtures.ts', real }), AMBIGUOUS);
  });
  it('R7-3: an importer that is a link, or a path that cannot be resolved, is ambiguous', () => {
    const files = { 'e2e/fixtures.ts': REEXPORT };
    const opts = { from: 'e2e/a.spec.ts', legacy: 'e2e/fixtures.ts' };
    const link = (p: string): string => (p === '/p/e2e/a.spec.ts' ? '/p/shared/a.spec.ts' : p);
    assert.deepEqual(run('./fixtures', files, { ...opts, real: link }), AMBIGUOUS);
    assert.deepEqual(run('./fixtures', files, { ...opts, real: (p) => (p === '/p/e2e/a.spec.ts' ? undefined : p) }), AMBIGUOUS);
    assert.deepEqual(run('./fixtures', files, { ...opts, real: (p) => (p === '/p/e2e/fixtures.ts' ? undefined : p) }), AMBIGUOUS);
    assert.deepEqual(run('./fixtures', files, { ...opts, real: (p) => (p === P ? undefined : p) }), AMBIGUOUS);
    assert.deepEqual(run('./fixtures', files, opts), file('e2e/fixtures.ts'));
  });
  it('R7-4: a boundary reached through a linked directory still proves', () => {
    const real = (p: string): string => p.replace(/^\/wl(?=\/|$)/, '/w');
    const got = run('./fixtures', { '/wl/fixtures.ts': REEXPORT }, { from: '/wl/a.spec.ts', boundary: '/wl', legacy: '/wl/fixtures.ts', real });
    assert.deepEqual(got, file('/wl/fixtures.ts'));
  });
});

describe('runner-resolve: the real file system (realRunnerEnv)', () => {
  function tree(build: (dir: string) => void, check: (dir: string, env: RunnerEnv) => void): void {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-runner-'));
    try {
      const write = (rel: string, text: string): void => {
        fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
        fs.writeFileSync(path.join(dir, rel), text);
      };
      write('a.spec.ts', "import { test } from './fixtures.js';\n");
      write('fixtures.ts', REEXPORT);
      write('support/fixtures.ts', REEXPORT);
      write('shared/fake.jsx', OWN);
      write('shared/fake.js', OWN);
      write('tsconfig.json', FX_STAR);
      build(dir);
      check(dir, realRunnerEnv(dir, createModuleResolver(dir)));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  const spec = (dir: string): string => path.join(dir, 'a.spec.ts');

  it('controls: without a link each import is its file', () => {
    tree(
      () => {},
      (dir, env) => {
        assert.deepEqual(resolveForRunner(spec(dir), './fixtures.js', env), { kind: 'file', path: path.join(dir, 'fixtures.ts') });
        assert.deepEqual(resolveForRunner(spec(dir), '@fx/fixtures', env), { kind: 'file', path: path.join(dir, 'support/fixtures.ts') });
        assert.deepEqual(resolveForRunner(spec(dir), '@playwright/test', env), pkg('@playwright/test'));
        assert.deepEqual(resolveForRunner(spec(dir), 'node:fs', env), { kind: 'builtin', spec: 'node:fs' });
      }
    );
  });
  it('RE-1: fixtures.jsx that is a link to a fake counts as a candidate', () => {
    tree(
      (dir) => fs.symlinkSync('shared/fake.jsx', path.join(dir, 'fixtures.jsx')),
      (dir, env) => assert.deepEqual(resolveForRunner(spec(dir), './fixtures.js', env), AMBIGUOUS)
    );
  });
  it('RE-2: a mapped support/fixtures.js that is a link to a fake counts as a candidate', () => {
    tree(
      (dir) => fs.symlinkSync('../shared/fake.js', path.join(dir, 'support/fixtures.js')),
      (dir, env) => assert.deepEqual(resolveForRunner(spec(dir), '@fx/fixtures', env), AMBIGUOUS)
    );
  });
  it('a config file that is a link is found and read', () => {
    tree(
      (dir) => {
        fs.rmSync(path.join(dir, 'tsconfig.json'));
        fs.writeFileSync(path.join(dir, 'shared/tsconfig.real.json'), tsconfig({ '@fx/*': ['./fake/*'] }));
        fs.symlinkSync('shared/tsconfig.real.json', path.join(dir, 'tsconfig.json'));
      },
      (dir, env) => assert.deepEqual(resolveForRunner(spec(dir), '@fx/fixtures', env), pkg('@fx/fixtures'))
    );
  });
});

describe('runner-resolve: pinned limits', () => {
  it('A7-pin-4: config above the scanned tree is not read', () => {
    const files = { '/p/tsconfig.json': tsconfig({ '@playwright/test': ['./support/fake.ts'] }), '/p/support/fake.ts': OWN };
    assert.deepEqual(run('@playwright/test', files, { from: '/p/suite/a.spec.ts', boundary: '/p/suite' }), pkg('@playwright/test'));
  });
  it('A7-pin-5: preset not installed contributes nothing', () => {
    assert.deepEqual(run('@playwright/test', { 'tsconfig.json': '{"extends": "@fx/tsconfig/base.json"}' }), pkg('@playwright/test'));
  });
  it('A8-pin: file-name case is matched exactly', () => {
    assert.deepEqual(run('./fixtures.js', { 'fixtures.ts': REEXPORT, 'fixtures.JSX': OWN }, { legacy: 'fixtures.ts' }), file('fixtures.ts'));
  });
});

describe('runner-resolve: fuzz', () => {
  it('never throws, whatever the specifier and the config files hold', () => {
    let seed = 20261121;
    const rnd = (n: number): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
      return (seed >>> 8) % n; // the low bits of this generator repeat quickly
    };
    const pick = <T>(xs: T[]): T => xs[rnd(xs.length)];
    const atoms: unknown[] = [null, 1, true, '', '*', './x', '../x', '@fx/*', 'a*b*c', [], {}, ['*'], ['./support/*', 2], './tsconfig.json', './b.json'];
    const value = (depth: number): unknown => {
      if (depth > 2 || rnd(3) === 0) return pick(atoms);
      const keys = ['extends', 'references', 'compilerOptions', 'paths', 'baseUrl', 'allowJs', 'path', '@fx/*', '*', 'x'];
      const out: Record<string, unknown> = {};
      for (let i = rnd(4); i > 0; i--) out[pick(keys)] = rnd(4) === 0 ? [value(depth + 1), value(depth + 1)] : value(depth + 1);
      return out;
    };
    const specs = ['', '.', '..', './', './x', '../x', '@fx/x', '@fx/', 'x', '*', '#x', '/x', 'node:fs', 'fs', 'a:b', '$&', '@fx/$&', './x.js', './support/x', 'x/../../y', '\0'];
    const kinds = new Set<string>();
    for (let i = 0; i < 3000; i++) {
      const text = (): string => (rnd(6) === 0 ? '{ not json' : JSON.stringify(value(0)));
      const files: Record<string, string> = { 'x.ts': '', 'support/x.ts': '', 'x/index.ts': '' };
      for (const name of ['tsconfig.json', 'jsconfig.json', 'b.json', 'sub/tsconfig.json', 'x/package.json']) if (rnd(2) === 0) files[name] = text();
      const env = memEnv(files, { legacy: rnd(2) === 0 ? 'x.ts' : undefined });
      if (rnd(20) === 0) env.legacyResolve = () => { throw new Error('boom'); };
      if (rnd(20) === 0) env.readText = () => { throw new Error('boom'); };
      const from = pick(['/p/a.spec.ts', '/p/sub/a.spec.js', '/p/node_modules/a.js', '/elsewhere/a.ts', '']);
      const got = resolveForRunner(from, pick(specs), env);
      assert.ok(['file', 'package', 'builtin', 'unknown'].includes(got.kind));
      kinds.add(got.kind === 'unknown' ? got.reason : got.kind);
    }
    for (const k of ['file', 'package', 'builtin', 'module-unresolved', 'ambiguous-module', 'runner-config', 'internal-error']) {
      assert.ok(kinds.has(k), `fuzz never produced ${k}`);
    }
  });
});
