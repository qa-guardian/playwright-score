import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { RESOLVE_EXTENSIONS, INDEX_FILES, JS_TO_TS_SOURCE } from '../src/module-resolution.js';
import { CLASSIFIER_ROWS, NEUTRAL_STATEMENTS, exportOf, exportTable } from '../src/rules/module-exports.js';
import { PROOF_RULES, REASONS, type N, type ProofRule, type Reason, type ResolveEnv, type Result, type ScopeFile } from '../src/rules/proof.js';
import { prove } from '../src/rules/receiver-proof.js';
import { denotes, parseScopeFile, playwrightTest } from '../src/rules/scope-resolve.js';

// QAG-287 B2.2, layer 1: the unit matrix of the export table, the binding resolver and the receiver proof.
// Files are held in memory. Every row asserts "PROVEN" or the reason code. Invented names throughout:
// `runner` is a local module that builds its own `test` and passes a fake page.

const P = '/p';
const abs = (f: string): string => (f.startsWith('/') ? f : `${P}/${f}`);
type Files = Record<string, string>;
interface Opts {
  /** specifier -> the file the earlier lookup returned for it (undefined: nothing). Relative specifiers are looked up the earlier way by default. */
  legacy?: Record<string, string | undefined>;
  /** file -> a statement type appended to its AST (a node no parser makes today). */
  inject?: Record<string, string>;
}
const seen = new Set<ProofRule>();

function memEnv(files: Files, opts: Opts = {}): ResolveEnv {
  const map = new Map(Object.entries(files).map(([f, text]) => [abs(f), text]));
  const cache = new Map<string, ScopeFile | undefined>();
  const earlier = (from: string, spec: string): string | undefined => {
    if (opts.legacy && spec in opts.legacy) return opts.legacy[spec] === undefined ? undefined : abs(opts.legacy[spec]!);
    if (!spec.startsWith('.')) return undefined;
    const base = path.posix.resolve(path.posix.dirname(from), spec);
    const ext = path.posix.extname(base);
    const swaps = (JS_TO_TS_SOURCE[ext] ?? []).map((e) => base.slice(0, -ext.length) + e);
    return [base, ...swaps, ...RESOLVE_EXTENSIONS.map((e) => base + e), ...INDEX_FILES.map((i) => `${base}/${i}`)].find((c) => map.has(c) && !c.endsWith('.d.ts'));
  };
  return {
    load(file) {
      if (!cache.has(file)) {
        const text = map.get(file);
        const sf = text === undefined ? undefined : parseScopeFile(text, file);
        const extra = opts.inject?.[path.posix.relative(P, file)];
        if (sf && extra) (sf.ast.body as N[]).push({ type: extra });
        cache.set(file, sf);
      }
      return cache.get(file);
    },
    runner: {
      boundaryDir: P,
      isFile: (p) => map.has(p),
      isDir: (p) => [...map.keys()].some((k) => k.startsWith(`${p}/`)),
      readText: (p) => map.get(p),
      realPath: (p) => p,
      legacyResolve: earlier,
    },
  };
}

const verdict = (r: Result<unknown>): string => {
  if (r.ok) for (const rule of r.rules) seen.add(rule);
  return r.ok ? 'PROVEN' : r.reason;
};
const specOf = (files: Files): string => abs(Object.keys(files).find((f) => /(^|\/)a\.spec\.[a-z]+$/.test(f))!);
const ordered = (sf: ScopeFile): N[] => [...sf.parents.keys()].sort((a, b) => a.range[0] - b.range[0] || b.range[1] - a.range[1]);

/** Does the callee of the spec's last top-level call statement denote Playwright's `test`? */
function ask(files: Files, opts: Opts = {}): string {
  const env = memEnv(files, opts);
  const sf = env.load(specOf(files));
  assert.ok(sf, 'the spec parses');
  const calls = (sf.ast.body as N[]).filter((s) => s.type === 'ExpressionStatement' && s.expression?.type === 'CallExpression');
  return verdict(playwrightTest(env, sf, calls[calls.length - 1].expression.callee));
}
/** Is the receiver of the spec's first `waitForSelector` call proven? */
function recv(files: Files, opts: Opts = {}): string {
  const env = memEnv(files, opts);
  const sf = env.load(specOf(files));
  assert.ok(sf, 'the spec parses');
  const call = ordered(sf).find((n) => n.type === 'CallExpression' && n.callee?.type === 'MemberExpression' && n.callee.property?.name === 'waitForSelector');
  assert.ok(call, 'the spec calls waitForSelector');
  return verdict(prove(env, sf, call.callee.object));
}

const PW = '@playwright/test';
const C = (name = 'test'): string => `${name}('t', async ({ page }) => { await page.waitForSelector('#a'); });\n`;
const SPEC = `import { test } from './fixtures';\n${C()}`;
const CSPEC = `const { test } = require('./fixtures');\n${C()}`;
const HB = `import { test as base, expect } from '${PW}';\nimport { fake, other, createRunner } from './runner';\n`;
const CH = `const { test: base, expect } = require('${PW}');\nconst { fake, createRunner } = require('./runner');\n`;
const RUNNER = `export function test(title: string, body: (a: { page: unknown }) => unknown) { return body({ page: {} }); }\nexport const fake = test;\nexport const other = test;\nexport function createRunner() { return { test }; }\n`;
const CRUNNER = `function test(title, body) { return body({ page: {} }); }\nexports.test = test;\nexports.fake = test;\nexports.createRunner = () => ({ test });\n`;
const RE = `export { test } from '${PW}';\n`;
const OWN = `export function test(title: string, body: (a: { page: unknown }) => unknown) { return body({ page: {} }); }\n`;
const STAR = `export * from '${PW}';\n`;
/** An ES fixture module beside the default spec. */
const fx = (body: string, spec = SPEC): Files => ({ 'a.spec.ts': spec, 'fixtures.ts': body, 'runner.ts': RUNNER });
/** A CommonJS fixture module beside a CommonJS spec. */
const cjs = (body: string, spec = CSPEC): Files => ({ 'a.spec.js': spec, 'fixtures.js': body, 'runner.js': CRUNNER });
/** A spec alone (with the local runner beside it). */
const sp = (spec: string, extra: Files = {}, name = 'a.spec.ts'): Files => ({ [name]: spec, 'runner.ts': RUNNER, ...extra });
const paths = (mapping: Record<string, string[]>, more: Record<string, unknown> = {}): string => JSON.stringify({ compilerOptions: { paths: mapping, ...more } });

type Row = [id: string, expect: 'PROVEN' | Reason, files: Files, opts?: Opts];

function table(title: string, rows: Row[], run: (files: Files, opts?: Opts) => string = ask): void {
  describe(title, () => {
    for (const [id, expect, files, opts] of rows) {
      it(`${id}: ${expect}`, () => assert.equal(run(files, opts), expect));
    }
  });
}

const POSITIVE: Record<string, { files: Files; name: string }> = {
  'X1+': { files: fx(RE), name: 'test' },
  'X2+': { files: fx(`${HB}const test = base.extend({});\nexport { test };\n`), name: 'test' },
  'X3+': { files: fx(`${HB}export const test = base.extend({});\n`), name: 'test' },
  'X4+': { files: fx(`${HB}export default base.extend({});\n`, `import test from './fixtures';\n${C()}`), name: 'default' },
  'X5+': { files: fx(STAR), name: 'test' },
  'C-A+': { files: cjs(`${CH}module.exports = { test: base };\n`), name: 'test' },
  'C-B+': { files: cjs(`${CH}exports.test = base;\n`), name: 'test' },
};

table('X: ESM export shapes', [
  ['X1+', 'PROVEN', POSITIVE['X1+'].files],
  ['X1a', 'PROVEN', fx(`export { test as it } from '${PW}';\n`, `import { it } from './fixtures';\n${C('it')}`)],
  ['X1-1', 'not-a-playwright-export', fx(`export { expect as test } from '${PW}';\n`)],
  ['X1-2', 'local-declaration', fx(`export { test } from './runner';\n`)],
  ['X1-3', 'competing-export', fx(`${RE}export { test } from './runner';\n`)],
  ['X1-4', 'local-declaration', fx(`export type { test } from '${PW}';\nexport * from './runner';\n`)],
  ['X1-5', 'local-declaration', fx(`export { type test } from '${PW}';\nexport * from './runner';\n`)],
  ['X1-6', 'local-declaration', fx(`export { test as 'test' } from '${PW}';\n`)],
  ['X2+', 'PROVEN', POSITIVE['X2+'].files],
  ['X2-4 import type', 'not-a-binding-shape', fx(`import type { test } from '${PW}';\nexport { test };\n`)],
  ['X2-4 type specifier', 'not-a-binding-shape', fx(`import { type test } from '${PW}';\nexport { test };\n`)],
  ['X2-5', 'local-declaration', fx(`${HB}const test = base;\nexport type { test };\nexport * from './runner';\n`)],
  ['X2-1', 'not-a-binding-shape', fx(`${HB}let test = base;\nexport { test };\n`)],
  ['X2-2', 'not-a-binding-shape', fx(`function test() {}\nexport { test };\n`)],
  ['X2-3', 'competing-export', fx(`${HB}const test = base;\nexport { test };\nexport { other as test };\n`)],
  ['X3+', 'PROVEN', POSITIVE['X3+'].files],
  ['X3-1', 'local-declaration', fx(`${HB}export let test = base;\n`)],
  ['X3-2', 'local-declaration', fx(`${HB}export const { test } = createRunner();\n`)],
  ['X3-3', 'local-declaration', fx(`${HB}export const [test] = [fake];\n`)],
  ['X3-4 nested', 'local-declaration', fx(`${HB}export const { a: { test } } = { a: createRunner() };\n`)],
  ['X3-4 rest', 'local-declaration', fx(`${HB}export const { ...test } = createRunner();\n`)],
  ['X3-5', 'not-a-playwright-export', fx(`${HB}export const test = process.env.LEGACY ? fake : base;\n`)],
  ['X3-6', 'not-a-playwright-export', fx(`${HB}export const test = createRunner();\n`)],
  ['X4+', 'PROVEN', POSITIVE['X4+'].files],
  ['X4-1', 'local-declaration', fx(`export default function test() {}\n`, `import test from './fixtures';\n${C()}`)],
  ['X4-2', 'competing-export', fx(`${HB}export { fake as default };\nexport default base;\n`, `import test from './fixtures';\n${C()}`)],
  ['X5+', 'PROVEN', POSITIVE['X5+'].files],
  ['X5-1', 'local-declaration', fx(`${STAR}export function test(title: string, body: Function) { return body({ page: {} }); }\n`)],
  ['X5-2', 'local-declaration', fx(`${STAR}export class test {}\n`)],
  ['X5-3 namespace', 'local-declaration', fx(`${STAR}export namespace test { export const a = 1; }\n`)],
  ['X5-3 enum', 'local-declaration', fx(`${STAR}export enum test { A }\n`)],
  ['X5-3 type', 'local-declaration', fx(`${STAR}export type test = string;\n`)],
  ['X5-3 interface', 'local-declaration', fx(`${STAR}export interface test { a: string }\n`)],
  ['X5-3 declare function', 'local-declaration', fx(`${STAR}export declare function test(): void;\n`)],
  ['X5-4', 'local-declaration', fx(`${STAR}export * as test from './runner';\n`)],
  ['X5-5', 'local-declaration', fx(`${STAR}import r = require('./runner');\nexport import test = r.test;\n`)],
  ['X5-6', 'export-assignment', fx(`${STAR}import { createRunner } from './runner';\nexport = createRunner();\n`)],
  ['X5-7', 'ambiguous-star', fx(`${STAR}export * from './runner';\n`)],
  ['X5-8', 'no-such-export', fx(STAR, `import test from './fixtures';\n${C()}`)],
  ['X5-9', 'not-a-binding-shape', fx(`${STAR}import { fake } from './runner';\nexport { fake as test };\n`)],
  ['X5-10 export node', 'unknown-statement', fx(STAR), { inject: { 'fixtures.ts': 'ExportFutureDeclaration' } }],
  ['X5-10 statement node', 'unknown-statement', fx(STAR), { inject: { 'fixtures.ts': 'FutureStatement' } }],
  ['X5-11', 'PROVEN', fx(`${STAR}export function other() {}\n`)],
  ['X5-12', 'PROVEN', fx(`${STAR}export type * from './runner';\n`)],
  ['X5-13', 'no-such-export', fx(`export type * from '${PW}';\n`)],
  ['X5-14', 'local-declaration', fx(`${STAR}export type * as test from './runner';\n`)],
  ['X5-15', 'local-declaration', fx(`${STAR}export declare const test: unknown;\n`)],
  ['X-chain+', 'PROVEN', sp(`import { test } from './a';\n${C()}`, { 'a.ts': `export * from './b';\n`, 'b.ts': `export * from './c';\n`, 'c.ts': `export * from './d';\n`, 'd.ts': STAR })],
  ['X-chain-1', 'depth', sp(`import { test } from './a';\n${C()}`, { 'a.ts': `export * from './b';\n`, 'b.ts': `export * from './c';\n`, 'c.ts': `export * from './d';\n`, 'd.ts': `export * from './e';\n`, 'e.ts': STAR })],
  ['X-chain-2', 'local-declaration', sp(`import { test } from './a';\n${C()}`, { 'a.ts': `export * from './b';\n`, 'b.ts': `export * from './c';\n${OWN}`, 'c.ts': STAR })],
  ['X-chain-3', 'cycle', sp(`import { test } from './a';\n${C()}`, { 'a.ts': `export * from './b';\n`, 'b.ts': `export * from './a';\n` })],
  ['X-chain-4', 'module-unresolved', sp(`import { test } from './a';\n${C()}`, { 'a.ts': `export * from './missing';\n` })],
  ['X-chain-5', 'PROVEN', fx(STAR, `import * as fx from './fixtures';\n${C('fx.test')}`)],
  ['X-chain-6', 'not-a-binding-shape', fx(`export * as fx from '${PW}';\n`, `import { fx } from './fixtures';\n${C('fx.test')}`)],
]);

table('C: CommonJS shapes', [
  ['C-A+', 'PROVEN', POSITIVE['C-A+'].files],
  ['C-A+2', 'PROVEN', cjs(`const { test, expect } = require('${PW}');\nmodule.exports = { test, expect };\n`)],
  ['C-A-1', 'cjs-shape', cjs(`${CH}module.exports = { test: base };\nmodule.exports = createRunner();\n`)],
  ['C-A-2', 'cjs-shape', cjs(`${CH}module.exports = createRunner();\n`)],
  ['C-A-3 spread first', 'cjs-shape', cjs(`${CH}module.exports = { ...require('./runner'), test: base };\n`)],
  ['C-A-3 spread last', 'cjs-shape', cjs(`${CH}module.exports = { test: base, ...fake };\n`)],
  ['C-A-4', 'cjs-shape', cjs(`${CH}const k = 'test';\nmodule.exports = { [k]: fake, test: base };\n`)],
  ['C-A-5 two keys', 'competing-export', cjs(`${CH}module.exports = { test: base, test: fake };\n`)],
  ['C-A-5 string key', 'competing-export', cjs(`${CH}module.exports = { test: base, 'test': fake };\n`)],
  ['C-A-6 getter', 'cjs-shape', cjs(`${CH}module.exports = { get test() { return fake; } };\n`)],
  ['C-A-6 method', 'cjs-shape', cjs(`${CH}module.exports = { test() {} };\n`)],
  ['C-A-7', 'cjs-shape', cjs(`${CH}exports.test = base;\nmodule.exports = { __proto__: require('./runner') };\n`)],
  ['C-A-7 literal alone', 'cjs-shape', cjs(`${CH}module.exports = { test: base, __proto__: require('./runner') };\n`)],
  ['C-A-8', 'cjs-shape', cjs(`${CH}module.exports = { test: base };\nmodule.exports.test = fake;\n`)],
  ['C-A-9', 'cjs-shape', cjs(`${CH}module.exports = { test: base };\nObject.assign(module.exports, require('./runner'));\n`)],
  ['C-A-10', 'cjs-shape', cjs(`${CH}module.exports = { test: base };\nif (process.env.X) module.exports = createRunner();\n`)],
  ['C-A-11', 'cjs-shape', cjs(`${CH}module.exports = { test: base };\nfunction later() { module.exports.test = fake; }\n`)],
  ['C-A-12', 'cjs-shape', cjs(`${CH}module.exports = exports = { test: base };\n`)],
  ['C-A-13', 'cjs-shape', cjs(`${CH}module.exports = { test: base };\nconst m = module;\nm.exports = createRunner();\n`)],
  ['C-A-14', 'PROVEN', cjs(`${CH}module.exports = { test: base };\nfunction local() { const exports = 1; const module = { exports }; return module.exports; }\n`)],
  ['C-B+', 'PROVEN', POSITIVE['C-B+'].files],
  ['C-B+2', 'PROVEN', cjs(`${CH}module.exports.test = base;\nexports.expect = expect;\n`)],
  ['C-B-1', 'competing-export', cjs(`${CH}exports.test = base;\nexports.test = fake;\n`)],
  ['C-B-2 literal key', 'cjs-shape', cjs(`${CH}exports['test'] = base;\n`)],
  ['C-B-2 computed key', 'cjs-shape', cjs(`${CH}const k = 'test';\nexports.test = base;\nexports[k] = fake;\n`)],
  ['C-B-3 this in a loop', 'cjs-shape', cjs(`${CH}exports.test = base;\nfor (const k of ['test']) this[k] = require('./runner')[k];\n`)],
  ['C-B-3 this', 'cjs-shape', cjs(`${CH}exports.test = base;\nthis.test = fake;\n`)],
  ['C-B-4', 'cjs-shape', cjs(`${CH}exports.test = exports.other = base;\n`)],
  ['C-B-5', 'cjs-shape', cjs(`${CH}exports.test ||= base;\n`)],
  ['C-B-6', 'cjs-default', { 'a.spec.ts': `import test from './fixtures';\n${C()}`, 'fixtures.js': `${CH}exports.test = base;\n`, 'runner.js': CRUNNER }],
  ['C-M-1', 'mixed-module', fx(`${HB}export const test = base;\nmodule.exports.test = fake;\n`)],
  ['C-R-1 eval', 'reflection', fx(`${HB}export const test = base.extend({});\ndeclare const code: string;\neval(code);\n`)],
  ['C-R-1 with', 'reflection', { 'a.spec.cjs': CSPEC.replace('./fixtures', './fixtures.cjs'), 'fixtures.cjs': `${CH.replace('./runner', './runner.cjs')}exports.test = base;\nwith (fake) { length; }\n`, 'runner.cjs': CRUNNER }],
  ['C-R-1 control: a property named eval', 'PROVEN', fx(`${HB}export const test = base.extend({});\nexport const tools = { eval: 1 }.eval;\n`)],
]);

const aliasFx = { 'tsconfig.json': paths({ '@fx/*': ['./support/*'] }) };
const fake = (file = 'support/fake.ts'): Files => ({ [file]: OWN });
const V1 = `import { test } from '${PW}';\n${C()}`;

table('V, B: bindings in the spec file, and which file a specifier leads to', [
  ['V1+', 'PROVEN', sp(V1)],
  ['V1+ js', 'PROVEN', sp(V1, {}, 'a.spec.js')],
  ['V1a renamed', 'PROVEN', sp(`import { test as it } from '${PW}';\n${C('it')}`)],
  ['V1a namespace', 'PROVEN', sp(`import * as pw from '${PW}';\n${C('pw.test')}`)],
  ['V1-1', 'package-aliased', sp(V1, { 'tsconfig.json': paths({ [PW]: ['./support/fake.ts'] }), ...fake() }), { legacy: { [PW]: 'support/fake.ts' } }],
  ['V1-1c', 'PROVEN', sp(V1, { 'tsconfig.json': paths({ '@fx/*': ['./support/*'] }), ...fake() })],
  ['V1-2 some-runner', 'not-a-playwright-export', sp(`import { test } from 'some-runner';\n${C()}`)],
  ['V1-2 chai', 'not-a-playwright-export', sp(`import { test } from 'chai';\n${C()}`)],
  ['V1-2 node:test', 'not-a-playwright-export', sp(`import { test } from 'node:test';\n${C()}`)],
  ['V1-4', 'global-or-undeclared', sp(C())],
  ['V1-5 js spec', 'ambiguous-module', { 'a.spec.js': CSPEC, 'fixtures.js': CRUNNER, 'fixtures.ts': RE }],
  ['V1-5 ts spec', 'ambiguous-module', { 'a.spec.ts': SPEC, 'fixtures.ts': OWN, 'fixtures.js': `exports.test = require('${PW}').test;\n` }],
  ['V1-5c', 'PROVEN', { 'a.spec.js': CSPEC, 'fixtures.js': `const { test } = require('${PW}');\nexports.test = test;\n`, 'fixtures.d.ts': `export declare const test: unknown;\n` }],
  ['V1-7 import type', 'not-a-binding-shape', sp(`import type { test } from '${PW}';\n${C()}`)],
  ['V1-7 type specifier', 'not-a-binding-shape', sp(`import { type test } from '${PW}';\n${C()}`)],
  ['V1-7 type namespace', 'not-a-binding-shape', sp(`import type * as pw from '${PW}';\n${C('pw.test')}`)],
  ['V1-8', 'ambiguous-module', sp(`import { test } from './lib';\n${C()}`, { 'lib/index.ts': RE, 'lib/package.json': '{"main":"fake.js"}', 'lib/fake.js': CRUNNER })],
  ['V1-8c no manifest', 'PROVEN', sp(`import { test } from './lib';\n${C()}`, { 'lib/index.ts': RE })],
  ['V1-8c the index file named', 'PROVEN', sp(`import { test } from './lib/index';\n${C()}`, { 'lib/index.ts': RE, 'lib/package.json': '{"main":"fake.js"}', 'lib/fake.js': CRUNNER })],
  ['V1-9 alias to a directory with a manifest', 'ambiguous-module', sp(`import { test } from '@fx/lib';\n${C()}`, { ...aliasFx, 'support/lib/index.ts': RE, 'support/lib/package.json': '{"main":"fake.js"}' }), { legacy: { '@fx/lib': 'support/lib/index.ts' } }],
  ['V1-9 alias with two candidate files', 'ambiguous-module', sp(`import { test } from '@fx/fixtures';\n${C()}`, { ...aliasFx, 'support/fixtures.ts': RE, 'support/fixtures.js': CRUNNER }), { legacy: { '@fx/fixtures': 'support/fixtures.ts' } }],
  ['V1-9c', 'PROVEN', sp(`import { test } from '@fx/fixtures';\n${C()}`, { ...aliasFx, 'support/fixtures.ts': RE }), { legacy: { '@fx/fixtures': 'support/fixtures.ts' } }],
  ['V1-10', 'ambiguous-module', sp(`import { test } from '@acme/fixtures';\n${C()}`, { 'package.json': '{"workspaces":["packages/*"]}', 'packages/fixtures/package.json': '{"name":"@acme/fixtures","exports":{".":{"types":"./src/index.ts","default":"./dist/fake.js"}}}', 'packages/fixtures/src/index.ts': RE, 'packages/fixtures/dist/fake.js': CRUNNER }), { legacy: { '@acme/fixtures': 'packages/fixtures/src/index.ts' } }],
  ['V1-11 file beside directory', 'ambiguous-module', sp(SPEC, { 'fixtures.ts': RE, 'fixtures/index.ts': OWN })],
  ['V1-11 two index files', 'ambiguous-module', sp(SPEC, { 'fixtures/index.ts': RE, 'fixtures/index.cjs': CRUNNER })],
  ['RD-1', 'ambiguous-module', sp(`import { test } from './fixtures.js';\n${C()}`, { 'fixtures.ts': RE, 'fixtures.jsx': OWN })],
  ['RD-1c', 'PROVEN', sp(`import { test } from './fixtures.js';\n${C()}`, { 'fixtures.ts': RE })],
  ['RD-2', 'runner-config', sp(`import { test } from '@fx/fixtures';\n${C()}`, { ...aliasFx, 'support/fixtures.ts': RE }, 'a.spec.js'), { legacy: { '@fx/fixtures': 'support/fixtures.ts' } }],
  ['RD-2c', 'PROVEN', sp(`import { test } from '@fx/fixtures';\n${C()}`, { 'tsconfig.json': paths({ '@fx/*': ['./support/*'] }, { allowJs: true }), 'support/fixtures.ts': RE }, 'a.spec.js'), { legacy: { '@fx/fixtures': 'support/fixtures.ts' } }],
  ['RD-3', 'ambiguous-module', { 'tests/a.spec.ts': `import { test } from '@fx/fixtures';\n${C()}`, 'tests/jsconfig.json': paths({ '@fx/*': ['./own/*'] }), 'tests/own/fixtures.ts': OWN, ...aliasFx, 'support/fixtures.ts': RE }, { legacy: { '@fx/fixtures': 'support/fixtures.ts' } }],
  ['RD-4', 'package-aliased', sp(V1, { 'tsconfig.json': '{"extends":"configs/base.json"}', 'configs/base.json': paths({ [PW]: ['../support/fake.ts'] }), ...fake() })],
  ['RD-5', 'package-aliased', sp(V1, { 'tsconfig.json': '{"files":[],"references":[{"path":"./tsconfig.app.json"}]}', 'tsconfig.app.json': paths({ [PW]: ['./support/fake.ts'] }), ...fake() })],
  ['RD-6 three levels', 'package-aliased', sp(V1, { 'tsconfig.json': '{"extends":"./one.json"}', 'one.json': '{"extends":"./two.json"}', 'two.json': '{"extends":"./three.json"}', 'three.json': paths({ [PW]: ['./support/fake.ts'] }), ...fake() })],
  ['RD-6 extends array', 'package-aliased', sp(V1, { 'tsconfig.json': '{"extends":["./one.json","./two.json"]}', 'one.json': paths({ [PW]: ['./support/fake.ts'] }), 'two.json': '{"compilerOptions":{"strict":true}}', ...fake() })],
  ['RD-7', 'ambiguous-module', sp(`import { test } from '@fx/fixtures';\n${C()}`, { 'configs/parent.json': JSON.stringify({ compilerOptions: { baseUrl: '../real', paths: { '@fx/*': ['fx/*'] } } }), 'tsconfig.json': '{"extends":"./configs/parent.json","compilerOptions":{"baseUrl":"./fake"}}', 'real/fx/fixtures.ts': RE, 'fake/fx/fixtures.ts': OWN }), { legacy: { '@fx/fixtures': 'real/fx/fixtures.ts' } }],
  ['RD-8', 'ambiguous-module', sp(`import { test } from '@fx/fixtures';\n${C()}`, { 'tsconfig.json': paths({ '@fx/fixtures': ['./support/fixtures.ts', './support/own.ts'] }), 'support/fixtures.ts': RE, 'support/own.ts': OWN }), { legacy: { '@fx/fixtures': 'support/fixtures.ts' } }],
  ['RD-9', 'package-aliased', sp(`const { test } = require('${PW}');\n${C()}`, { 'jsconfig.json': paths({ [PW]: ['./support/fake.js'] }), 'support/fake.js': CRUNNER }, 'a.spec.js')],
  ['RD-9 control', 'PROVEN', sp(`const { test } = require('${PW}');\n${C()}`, { 'jsconfig.json': '{"compilerOptions":{"checkJs":true}}', 'support/fake.js': CRUNNER }, 'a.spec.js')],
  ['RD-10', 'runner-config', sp(V1, { 'tsconfig.json': `{ compilerOptions: { paths: { '${PW}': ['./support/fake.ts'] } } }`, ...fake() })],
  ['RD-11', 'ambiguous-module', sp(`import { test } from '@/fixtures';\n${C()}`, { 'tsconfig.json': '{"files":[],"references":[{"path":"./tsconfig.app.json"}]}', 'tsconfig.app.json': paths({ '@/*': ['./src/*'] }), 'src/fixtures.ts': RE })],
  ['RD-12 hash name', 'module-unresolved', sp(`import { test } from '#fixtures';\n${C()}`, { 'fixtures.ts': RE })],
  ['RD-12 absolute path', 'module-unresolved', sp(`import { test } from '/p/fixtures';\n${C()}`, { 'fixtures.ts': RE })],
  ['RD-13', 'runner-config', sp(`import { test } from '@fx/fixtures.js';\n${C()}`, { ...aliasFx, 'support/fixtures.js.ts': RE }), { legacy: { '@fx/fixtures.js': 'support/fixtures.js.ts' } }],
  ['RD-13c', 'PROVEN', sp(`import { test } from '@fx/fixtures.js';\n${C()}`, { ...aliasFx, 'support/fixtures.ts': RE }), { legacy: { '@fx/fixtures.js': 'support/fixtures.ts' } }],
  ['V1-6 local function', 'not-a-binding-shape', sp(`function test(title: string, body: Function) { return body({ page: {} }); }\n${C()}`)],
  ['V1-6 shadowed in an inner scope', 'multiple-definitions', sp(`import { test } from '${PW}';\nfunction test(title: string, body: Function) { return body({ page: {} }); }\n${C()}`)],
  ['V2+', 'PROVEN', sp(`import { test } from '${PW}';\nconst it = test;\n${C('it')}`)],
  ['V2-1', 'not-a-binding-shape', sp(`import { test } from '${PW}';\nimport { other } from './runner';\nlet it = test;\nit = other;\n${C('it')}`)],
  ['V3+', 'PROVEN', sp(`const { test } = require('${PW}');\n${C()}`, {}, 'a.spec.js')],
  ['V3-1 default', 'not-a-binding-shape', sp(`const other = () => {};\nconst { test = other } = require('${PW}');\n${C()}`, {}, 'a.spec.js')],
  ['V3-1 rest', 'not-a-binding-shape', sp(`const { ...test } = require('${PW}');\n${C()}`, {}, 'a.spec.js')],
  ['V3-1 let', 'not-a-binding-shape', sp(`let { test } = require('${PW}');\n${C()}`, {}, 'a.spec.js')],
  ['V3-1 nested', 'not-a-binding-shape', sp(`const { a: { test } } = require('${PW}');\n${C()}`, {}, 'a.spec.js')],
  ['V4-1', 'not-a-binding-shape', sp(`const require = makeRequire();\nconst { test } = require('${PW}');\n${C()}`, {}, 'a.spec.js')],
  ['V4 two arguments', 'not-a-binding-shape', sp(`const { test } = require('${PW}', 1);\n${C()}`, {}, 'a.spec.js')],
  ['V5+', 'PROVEN', sp(`const pw = require('${PW}');\n${C('pw.test')}`, {}, 'a.spec.js')],
  ['V5-1 literal key', 'not-a-binding-shape', sp(`const pw = require('${PW}');\n${C("pw['test']")}`, {}, 'a.spec.js')],
  ['V5-1 computed key', 'not-a-binding-shape', sp(`const pw = require('${PW}');\nconst k = 'test';\n${C('pw[k]')}`, {}, 'a.spec.js')],
  ['B2+', 'PROVEN', sp(`import { test as base } from '${PW}';\nconst test = base.extend({ cart: async ({ page }, use) => { await use(page); } });\n${C()}`)],
  ['B2-1', 'not-a-binding-shape', sp(`import { other } from './runner';\nconst test = (other as any).extend({});\n${C()}`)],
  ['B3+', 'PROVEN', sp(`import { test as base, mergeTests } from '${PW}';\nconst a = base.extend({});\nconst b = base.extend({});\nconst test = mergeTests(a, b);\n${C()}`)],
  ['B3-1 one argument is not proven', 'not-a-binding-shape', sp(`import { test as base, mergeTests } from '${PW}';\nimport { fake } from './runner';\nconst a = base.extend({});\nconst test = mergeTests(a, fake as any);\n${C()}`)],
  ['B3-1 spread', 'not-a-playwright-export', sp(`import { test as base, mergeTests } from '${PW}';\nconst list = [base];\nconst test = mergeTests(...list);\n${C()}`)],
  ['B3-1 no argument', 'not-a-playwright-export', sp(`import { mergeTests } from '${PW}';\nconst test = (mergeTests as any)();\n${C()}`)],
  ['B3-1 a local mergeTests', 'not-a-playwright-export', sp(`import { test as base } from '${PW}';\nfunction mergeTests(...a: unknown[]) { return a[0] as typeof base; }\nconst test = mergeTests(base);\n${C()}`)],
  ['B3-1 mergeTests re-exported by a local file', 'not-a-playwright-export', sp(`import { test as base } from '${PW}';\nimport { mergeTests } from './fixtures';\nconst test = mergeTests(base);\n${C()}`, { 'fixtures.ts': `export { mergeTests } from '${PW}';\n` })],
  ['A2-pin-1', 'PROVEN', sp(`import { test as base } from '${PW}';\nimport { fake } from './runner';\nconst test = base.extend({ page: async ({}, use) => { await use(fake as any); } });\n${C()}`)],
  ['A2-pin-2', 'PROVEN', sp(`import { test } from '${PW}';\nimport { fake } from './runner';\ntest.use({ page: async ({}, use) => { await use(fake as any); } });\n${C()}`)],
  ['default export of @playwright/test', 'PROVEN', sp(`import test from '${PW}';\n${C()}`)],
  ['default export of a component-testing package', 'not-a-playwright-export', sp(`import test from '@playwright/experimental-ct-react';\n${C()}`)],
]);

const T = (head: string, annotation: string): Files => sp(`${head}declare let p: any;\nasync function open(target: ${annotation}) { await target.waitForSelector('#a'); }\n`);
const inTest = (body: string, head = `import { test } from '${PW}';\n`): Files => sp(`${head}${body}`);

table('T, E: types and receivers', [
  ['T+ import type', 'PROVEN', T(`import type { Page } from '${PW}';\n`, 'Page')],
  ['T+ renamed', 'PROVEN', T(`import { Page as PwPage } from '${PW}';\n`, 'PwPage')],
  ['T+ namespace', 'PROVEN', T(`import * as pw from 'playwright';\n`, 'pw.Frame')],
  ['T+ import type query', 'PROVEN', T('', `import('playwright').Page`)],
  ['T-1', 'type-needs-import', sp(`import type { Page } from 'other-lib';\nfunction outer() { const { Page } = require('playwright'); return async function open(p: Page) { await p.waitForSelector('#a'); }; }\n`)],
  ['T-2 type parameter', 'type-needs-import', sp(`import type { Page as PwPage } from '${PW}';\nasync function open<Page extends { waitForSelector(s: string): Promise<void> }>(p: Page) { await p.waitForSelector('#a'); }\n`)],
  ['T-2 interface', 'type-needs-import', T(`interface Page { waitForSelector(s: string): Promise<void> }\n`, 'Page')],
  ['T-2 type alias', 'type-needs-import', T(`type Page = { waitForSelector(s: string): Promise<void> };\n`, 'Page')],
  ['T-2 class', 'type-needs-import', T(`class Page { async waitForSelector(s: string) {} }\n`, 'Page')],
  ['T-2 import plus interface', 'multiple-definitions', T(`import type { Page } from '${PW}';\ninterface Page { extra: string }\n`, 'Page')],
  ['T-3 another package', 'not-a-playwright-export', T(`import type { Page } from 'puppeteer';\n`, 'Page')],
  ['T-3 type arguments', 'not-a-playwright-export', T(`import type { Page } from '${PW}';\n`, 'Page<string>')],
  ['T-3 another type of the package', 'not-a-playwright-export', T(`import type { Locator } from '${PW}';\n`, 'Locator')],
  ['T aliased package', 'package-aliased', { ...T(`import type { Page } from '${PW}';\n`, 'Page'), 'tsconfig.json': paths({ [PW]: ['./support/fake.ts'] }), ...fake() }],
  ['T-4 computed member', 'class-member', sp(`import type { Page } from '${PW}';\nconst k = 'page';\nclass Cart { page: Page; [k]: unknown; async open() { await this.page.waitForSelector('#a'); } }\n`)],
  ['T-4 declared twice', 'class-member', sp(`import type { Page } from '${PW}';\nclass Cart { page: Page; page: Page; async open() { await this.page.waitForSelector('#a'); } }\n`)],
  ['T-4 control', 'PROVEN', sp(`import type { Page } from '${PW}';\nclass Cart { page: Page; static [Symbol.iterator]: unknown; constructor(private readonly other: Page) {} async open() { await this.page.waitForSelector('#a'); } }\n`)],
  ['E1+ test', 'PROVEN', inTest(C())],
  ['V1-3', 'not-a-binding-shape', inTest(`function suite(test: any) { test('t', async ({ page }: any) => { await page.waitForSelector('#a'); }); }\n`, `import { test as base } from '${PW}';\n`)],
  ['E1+ hook', 'PROVEN', inTest(`test.beforeEach(async ({ page }) => { await page.waitForSelector('#a'); });\n`)],
  ['E1+ step', 'PROVEN', inTest(`test('t', async ({ page }) => { await test.step('s', async () => { await page.waitForSelector('#a'); }); });\n`)],
  ['E1+ rename', 'PROVEN', inTest(`test('t', async ({ page: p }) => { await p.waitForSelector('#a'); });\n`)],
  ['E1-alias', 'PROVEN', inTest(`test('t', async ({ page }) => { const p = page; await p.waitForSelector('#a'); });\n`)],
  ['E1-1 reassigned', 'binding-written', inTest(`test('t', async ({ page }) => { page = other; await page.waitForSelector('#a'); });\n`, `import { test } from '${PW}';\ndeclare const other: any;\n`)],
  ['E1-1 default', 'binding-written', inTest(`test('t', async ({ page = other }) => { await page.waitForSelector('#a'); });\n`, `import { test } from '${PW}';\ndeclare const other: any;\n`)],
  ['E1-1 nested', 'receiver-shape', inTest(`test('t', async ({ fx: { page } }: any) => { await page.waitForSelector('#a'); });\n`)],
  ['E1-1 second parameter', 'receiver-shape', inTest(`test('t', async (info: any, { page }: any) => { await page.waitForSelector('#a'); });\n`)],
  ['E1-2 describe', 'not-a-binding-shape', inTest(`test.describe('d', ({ page }: any) => { page.waitForSelector('#a'); });\n`)],
  ['E1-2 fixture of extend', 'receiver-shape', inTest(`test.extend({ cart: async ({ page }, use) => { await page.waitForSelector('#a'); await use(1); } });\n`)],
  ['E1-2 another runner', 'not-a-playwright-export', inTest(`it('t', async ({ page }: any) => { await page.waitForSelector('#a'); });\n`, `import { it } from 'some-runner';\n`)],
  ['E1 through a local module that builds its own test', 'local-declaration', inTest(C(), `import { test } from './runner';\n`)],
  ['E2+ module-level let', 'PROVEN', inTest(`let page: Page;\ntest.beforeAll(async ({ browser }) => { page = await browser.newPage(); });\ntest('t', async () => { await page.waitForSelector('#a'); });\n`, `import { test, type Page } from '${PW}';\n`)],
  ['E2+ class field', 'PROVEN', sp(`import type { Page } from '${PW}';\nclass Cart { readonly page: Page; constructor(page: Page) { this.page = page; } async open() { await this.page.waitForSelector('#a'); } }\n`)],
  ['E2+ parameter property', 'PROVEN', sp(`import type { Page } from '${PW}';\nclass Cart { constructor(private readonly page: Page) {} async open() { await this.page.waitForSelector('#a'); } }\n`)],
  ['E2 untyped parameter', 'receiver-shape', sp(`async function open(page) { await page.waitForSelector('#a'); }\n`, {}, 'a.spec.js')],
  ['E3+ context.newPage', 'PROVEN', inTest(`test('t', async ({ context }) => { const tab = await context.newPage(); await tab.waitForSelector('#a'); });\n`)],
  ['E3+ firstWindow', 'PROVEN', inTest(`test('t', async () => { const app = await electron.launch({ args: ['main.js'] }); const win = await app.firstWindow(); await win.waitForSelector('#a'); });\n`, `import { test, _electron as electron } from '${PW}';\n`)],
  ['E3+ launcher chain in JS', 'PROVEN', sp(`const { chromium } = require('playwright');\n(async () => { const browser = await chromium.launch(); const tab = await browser.newPage(); await tab.waitForSelector('#a'); })();\n`, {}, 'a.spec.js')],
  ['E3+ popup', 'PROVEN', inTest(`test('t', async ({ page }) => { const popup = await page.waitForEvent('popup'); await popup.waitForSelector('#a'); });\n`)],
  ['E3+ list item', 'PROVEN', inTest(`test('t', async ({ context }) => { await context.pages()[0].waitForSelector('#a'); });\n`)],
  ['E3+ default import of a launcher package', 'PROVEN', sp(`import pw from 'playwright';\n(async () => { const browser = await pw.chromium.launch(); const tab = await browser.newPage(); await tab.waitForSelector('#a'); })();\n`)],
  ['E3-1 another launcher helper', 'receiver-shape', sp(`import { launch } from './legacy-browser';\n(async () => { const browser = await launch(); const tab = await browser.newPage(); await tab.waitForSelector('#a'); })();\n`, { 'legacy-browser.ts': `import puppeteer from 'puppeteer';\nexport const launch = () => puppeteer.launch();\n` })],
  ['E3-1 launcher re-exported by a local file', 'receiver-shape', sp(`import { chromium } from './browsers';\n(async () => { const browser = await chromium.launch(); const tab = await browser.newPage(); await tab.waitForSelector('#a'); })();\n`, { 'browsers.ts': `export { chromium } from 'playwright';\n` })],
  ['E3-1 launcher of another package', 'receiver-shape', sp(`import { chromium } from 'other-browsers';\n(async () => { const browser = await chromium.launch(); const tab = await browser.newPage(); await tab.waitForSelector('#a'); })();\n`)],
  ['E3-1 launcher package aliased by a config', 'receiver-shape', sp(`import { chromium } from 'playwright';\n(async () => { const browser = await chromium.launch(); const tab = await browser.newPage(); await tab.waitForSelector('#a'); })();\n`, { 'tsconfig.json': paths({ playwright: ['./support/fake.ts'] }), ...fake() })],
  ['E3-1 wrong event', 'receiver-shape', inTest(`test('t', async ({ page }) => { const popup = await page.waitForEvent('download'); await popup.waitForSelector('#a'); });\n`)],
  ['E3-1 two writes of different kinds', 'binding-written', inTest(`test('t', async ({ page, context }) => { let tab = await context.newPage(); tab = page.mainFrame(); await tab.waitForSelector('#a'); });\n`)],
  ['E3-1 a write that is not a factory call', 'binding-written', inTest(`test('t', async ({ context }) => { let tab = await context.newPage(); tab = other; await tab.waitForSelector('#a'); });\n`, `import { test } from '${PW}';\ndeclare const other: any;\n`)],
], recv);

describe('outcome 2: another package\'s export', () => {
  for (const pkg of ['some-runner', 'chai', 'node:test']) {
    it(`V1-2: test imported from ${pkg} is that package's export, not a Playwright one`, () => {
      const files = sp(`import { test } from '${pkg}';\n${C()}`);
      const env = memEnv(files);
      const sf = env.load(specOf(files))!;
      const r = denotes(env, sf, (sf.ast.body as N[])[1].expression.callee);
      assert.ok(r.ok);
      assert.deepEqual(r.value, { package: pkg, name: 'test', playwright: false });
    });
  }
  it('outcome 1: a Playwright package export, by name', () => {
    const files = sp(`import { expect } from '${PW}';\nexpect(1);\n`);
    const env = memEnv(files);
    const sf = env.load(specOf(files))!;
    const r = denotes(env, sf, (sf.ast.body as N[])[1].expression.callee);
    assert.ok(r.ok);
    assert.deepEqual(r.value, { package: PW, name: 'expect', playwright: true });
  });
  it('outcome 3 names the file and line at which the proof stopped', () => {
    const files = fx(`${STAR}\nexport function test() {}\n`);
    const env = memEnv(files);
    const sf = env.load(specOf(files))!;
    const r = playwrightTest(env, sf, (sf.ast.body as N[])[1].expression.callee);
    assert.ok(!r.ok);
    assert.deepEqual([r.reason, r.at], ['local-declaration', { file: '/p/fixtures.ts', line: 3 }]);
  });
  it('every reason is on the closed list', () => assert.equal(new Set(REASONS).size, 30));
});

// G: the generated cross-product. One sample per classifier row; a row with no sample fails the suite.
/** Statements that fall under each row and contribute to `name` (or to nothing: the neutral rows). */
const SAMPLES: Record<(typeof CLASSIFIER_ROWS)[number], (name: string) => { src?: string; inject?: string; same: boolean } | undefined> = {
  'type-export-specifiers': (n) => ({ src: `export type { test as ${n} } from './runner';\n`, same: true }),
  'type-specifier': (n) => ({ src: `export { type test as ${n} } from './runner';\n`, same: true }),
  'string-name-specifier': (n) => ({ src: `export { test as '${n}' } from './runner';\n`, same: true }),
  'declare-declaration': (n) => (n === 'default' ? undefined : { src: `export declare const ${n}: unknown;\n`, same: true }),
  'type-star-as': (n) => ({ src: `export type * as ${n} from './runner';\n`, same: true }),
  'type-star': () => ({ src: `export type * from './runner';\n`, same: false }),
  reexport: (n) => ({ src: `export { test as ${n} } from './runner';\n`, same: true }),
  'local-specifier': (n) => ({ src: `import { fake as f9 } from './runner';\nexport { f9 as ${n} };\n`, same: true }),
  'variable-const-init': (n) => (n === 'default' ? undefined : { src: `export const ${n} = 1;\n`, same: true }),
  'variable-other': (n) => (n === 'default' ? undefined : { src: `export let ${n} = 1;\n`, same: true }),
  'variable-pattern': (n) => (n === 'default' ? undefined : { src: `export const { ${n} } = { ${n}: 1 };\n`, same: true }),
  'other-declaration': (n) => (n === 'default' ? undefined : { src: `export function ${n}() {}\n`, same: true }),
  'default-expression': (n) => ({ src: `import { fake as f8 } from './runner';\nexport default f8;\n`, same: n === 'default' }),
  'default-declaration': (n) => ({ src: `export default function () {}\n`, same: n === 'default' }),
  'star-as': (n) => ({ src: `export * as ${n} from './runner';\n`, same: true }),
  star: () => ({ src: `export * from './runner';\n`, same: false }),
  'export-assignment': () => ({ src: `export = {};\n`, same: true }),
  'namespace-export': () => ({ src: `export as namespace someGlobal;\n`, same: true }),
  'export-import-equals': (n) => (n === 'default' ? undefined : { src: `import r9 = require('./runner');\nexport import ${n} = r9.test;\n`, same: true }),
  neutral: () => ({ src: `const unrelated9 = 1;\nfunction helper9() { return unrelated9; }\n`, same: false }),
  unknown: () => ({ inject: 'FutureStatement', same: true }),
};

describe('G: every classifier row appended to every positive module', () => {
  it('every classifier row has a sample', () => assert.deepEqual(Object.keys(SAMPLES).sort(), [...CLASSIFIER_ROWS].sort()));
  for (const [id, pos] of Object.entries(POSITIVE)) {
    const module = Object.keys(pos.files).find((f) => f.startsWith('fixtures'))!;
    const esm = module.endsWith('.ts');
    it(`${id} alone is proven`, () => assert.equal(ask(pos.files), 'PROVEN'));
    for (const row of CLASSIFIER_ROWS) {
      const sample = SAMPLES[row](pos.name);
      if (!sample) continue;
      // An export statement in a CommonJS module mixes the two kinds; a star is consulted only when the name has no contribution.
      const exportsSomething = row !== 'neutral' && row !== 'unknown';
      const blocks = sample.same || (row === 'star' && id === 'X5+') || (!esm && exportsSomething);
      it(`${id} + ${row}: ${blocks ? 'not proven' : 'still proven'}`, () => {
        const files = { ...pos.files, [module]: pos.files[module] + (sample.src ?? '') };
        const opts = sample.inject ? { inject: { [module]: sample.inject } } : {};
        const env = memEnv(files, opts);
        assert.ok(exportTable(env.load(abs(module))!).rows.includes(row), `the sample falls under row ${row}`);
        const got = ask(files, opts);
        if (blocks) assert.notEqual(got, 'PROVEN');
        else assert.equal(got, 'PROVEN');
      });
    }
    it(`${id} + another name, a neutral statement, a type-only star: still proven`, () => {
      const more = esm ? `export function other9() {}\nexport type * from './runner';\nif (process.env.X) { console.log(1); }\n` : `function other9() {}\nif (process.env.X) { console.log(1); }\n`;
      assert.equal(ask({ ...pos.files, [module]: pos.files[module] + more }), 'PROVEN');
    });
  }
  it('every neutral statement type is on the closed list, and a statement type that is not on it makes the table opaque', () => {
    const src = `import a from 'a';\nvar b = 1;\nfunction c() {}\nclass D {}\nb;\nif (b) {}\nfor (;;) { break; }\nfor (const k in {}) {}\nfor (const k of []) {}\nwhile (b) {}\ndo {} while (b);\nswitch (b) {}\ntry {} catch {}\n{}\n;\nl: for (;;) { break l; }\ntype T = string;\ninterface I {}\nenum E {}\nnamespace NS {}\ndeclare function f(): void;\nimport r = require('r');\ndebugger;\n`;
    const sf = parseScopeFile(src, '/p/m.ts')!;
    const types = new Set((sf.ast.body as N[]).map((s) => s.type));
    for (const t of types) assert.ok(NEUTRAL_STATEMENTS.has(t), t);
    assert.equal(exportTable(sf).kind, 'none');
    for (const t of ['FutureStatement', 'ExportFutureDeclaration', 'Program', '']) {
      const other = parseScopeFile(src, '/p/m.ts')!;
      (other.ast.body as N[]).push({ type: t });
      assert.deepEqual([exportTable(other).kind, exportTable(other).reason], ['opaque', 'unknown-statement'], t);
    }
  });
});

describe('G modifiers: a type-only or declared form of the statement that carries the proof', () => {
  const TYPE_BASE = `import type { test as base } from '${PW}';\n`;
  const TYPE_SPEC_BASE = `import { type test as base } from '${PW}';\n`;
  const D = `import test from './fixtures';\n${C()}`;
  const rows: Array<[string, Reason, Files]> = [
    ['X1+ exportKind type on the declaration', 'local-declaration', fx(`export type { test } from '${PW}';\n`)],
    ['X1+ exportKind type on the specifier', 'local-declaration', fx(`export { type test } from '${PW}';\n`)],
    ['X1+ string-literal exported name', 'local-declaration', fx(`export { test as 'test' } from '${PW}';\n`)],
    ['X2+ exportKind type on the declaration', 'local-declaration', fx(`${HB}const test = base.extend({});\nexport type { test };\n`)],
    ['X2+ exportKind type on the specifier', 'local-declaration', fx(`${HB}const test = base.extend({});\nexport { type test };\n`)],
    ['X2+ string-literal exported name', 'local-declaration', fx(`${HB}const test = base.extend({});\nexport { test as 'test' };\n`)],
    ['X2+ importKind type on the import declaration', 'not-a-binding-shape', fx(`${TYPE_BASE}const test = base.extend({});\nexport { test };\n`)],
    ['X2+ importKind type on the import specifier', 'not-a-binding-shape', fx(`${TYPE_SPEC_BASE}const test = base.extend({});\nexport { test };\n`)],
    ['X3+ declare on the declaration', 'local-declaration', fx(`${HB}export declare const test: typeof base;\n`)],
    ['X3+ importKind type on the import declaration', 'not-a-binding-shape', fx(`${TYPE_BASE}export const test = base.extend({});\n`)],
    ['X3+ importKind type on the import specifier', 'not-a-binding-shape', fx(`${TYPE_SPEC_BASE}export const test = base.extend({});\n`)],
    ['X4+ importKind type on the import declaration', 'not-a-binding-shape', fx(`${TYPE_BASE}export default base.extend({});\n`, D)],
    ['X4+ importKind type on the import specifier', 'not-a-binding-shape', fx(`${TYPE_SPEC_BASE}export default base.extend({});\n`, D)],
    ['X5+ exportKind type on the star', 'no-such-export', fx(`export type * from '${PW}';\n`)],
  ];
  for (const [id, expect, files] of rows) it(`${id}: ${expect}`, () => assert.equal(ask(files), expect));
});

describe('the walk', () => {
  it('a proof result is not cached across entry points: the same module is proven from depth 1 and not from depth 5', () => {
    const files = sp(`import { test } from './a';\n${C()}`, { 'a.ts': `export * from './b';\n`, 'b.ts': `export * from './c';\n`, 'c.ts': `export * from './d';\n`, 'd.ts': `export * from './e';\n`, 'e.ts': STAR, 'near.spec.ts': `import { test } from './e';\n${C()}` });
    const env = memEnv(files);
    const far = env.load(abs('a.spec.ts'))!;
    const near = env.load(abs('near.spec.ts'))!;
    const callee = (sf: ScopeFile): N => (sf.ast.body as N[])[1].expression.callee;
    assert.equal(verdict(playwrightTest(env, far, callee(far))), 'depth');
    assert.equal(verdict(playwrightTest(env, near, callee(near))), 'PROVEN');
    assert.equal(verdict(playwrightTest(env, far, callee(far))), 'depth');
  });
  it('an expression chain over the step cap is not proven', () => {
    const chain = Array.from({ length: 16 }, (_, i) => `const t${i + 1} = t${i};\n`).join('');
    assert.equal(ask(sp(`import { test as t0 } from '${PW}';\n${chain}${C('t16')}`)), 'steps');
    const short = Array.from({ length: 5 }, (_, i) => `const t${i + 1} = t${i};\n`).join('');
    assert.equal(ask(sp(`import { test as t0 } from '${PW}';\n${short}${C('t5')}`)), 'PROVEN');
  });
  it('a module that cannot be read or parsed is not proven', () => {
    assert.equal(ask(fx(`export { test from ;;\n`)), 'module-unreadable');
  });
  it('PROOF_RULES: the rule ids seen in positive results over the whole matrix are exactly the list', () => {
    assert.deepEqual([...seen].sort(), [...PROOF_RULES].sort());
  });
});

describe('fuzz: the export-table builder and the walk never throw', () => {
  let seed = 20261122;
  const rnd = (n: number): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  const TYPES = ['ExportNamedDeclaration', 'ExportDefaultDeclaration', 'ExportAllDeclaration', 'TSExportAssignment', 'TSNamespaceExportDeclaration', 'TSImportEqualsDeclaration', 'ExpressionStatement', 'VariableDeclaration', 'FutureStatement', 'Identifier', 'ObjectPattern', 'Property', 'Literal', 'AssignmentExpression', 'MemberExpression', 'ThisExpression', 'WithStatement'];
  const garbage = (depth: number): unknown => {
    const k = rnd(12);
    if (depth > 3 || k === 0) return [null, undefined, 0, 'test', true, {}, []][rnd(7)];
    if (k === 1) return Array.from({ length: rnd(4) }, () => garbage(depth + 1));
    const node: Record<string, unknown> = { type: TYPES[rnd(TYPES.length)] };
    for (const key of ['declaration', 'specifiers', 'source', 'exported', 'local', 'exportKind', 'declare', 'declarations', 'id', 'init', 'kind', 'expression', 'left', 'right', 'operator', 'object', 'property', 'computed', 'name', 'value', 'properties', 'elements', 'argument', 'isExport']) {
      if (rnd(3) === 0) node[key] = rnd(4) === 0 ? ['type', 'const', '=', 'test', 'exports', 'module', true][rnd(7)] : garbage(depth + 1);
    }
    return node;
  };
  it('random statement lists and garbage nodes give a table, and the export is not proven', () => {
    for (let i = 0; i < 400; i++) {
      const files = fx('export const placeholder = 1;\n');
      const env = memEnv(files);
      const sf = env.load(abs('fixtures.ts'))!;
      (sf.ast as N).body = Array.from({ length: rnd(6) }, () => garbage(0));
      let table;
      assert.doesNotThrow(() => { table = exportTable(sf); });
      assert.ok(table);
      const walk = { maxDepth: 4, stack: [], value: (f: ScopeFile, n: N | undefined) => playwrightTest(env, f, n) };
      let r: Result<unknown> | undefined;
      assert.doesNotThrow(() => { try { r = exportOf(env, abs('fixtures.ts'), 'test', 1, walk, []); } catch (e) { if (!(e instanceof TypeError)) throw e; r = { ok: false, reason: 'internal-error', at: { file: '', line: 0 } }; } });
      assert.equal(r?.ok, false, JSON.stringify(sf.ast.body).slice(0, 300));
    }
  });
});
