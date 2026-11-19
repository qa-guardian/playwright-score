import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scorePaths } from '../src/index.js';
import { catalogueRules } from '../src/catalogue/index.js';
import type { ProfileName } from '../src/types.js';

// QAG-287 S3: the per-rule fixture gate (ADR section 6.0 R2).
//
// tests/rule-fixtures.json lists every fixture under tests/fixtures/rules. A TRUE fixture is a
// shape the rule must report, a FALSE fixture a shape it must leave alone. Fixtures are written
// from the Playwright docs, never copied from a corpus repository. A fixture marked `pending`
// names the slice that will make it behave as labelled; until then the test asserts that it
// still does NOT, so a fix that lands without clearing the mark fails here.

interface Cell {
  rule: string;
  form: string;
  class?: string;
  certain?: boolean;
  builtBy?: string;
}
interface Fixture {
  id: string;
  rule: string;
  verdict: 'true' | 'false';
  entry: string;
  dir?: string;
  project?: boolean;
  form?: string;
  tags?: string[];
  pending?: string;
  profile?: string;
  note?: string;
}
interface Manifest {
  version: number;
  cells: Cell[];
  fixtures: Fixture[];
}

function packageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'fixtures'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('package root not found');
}

const root = packageRoot();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'rules');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'tests', 'rule-fixtures.json'), 'utf8')) as Manifest;

/** The old and the current prefix of the scorer's own rules name the same rule. */
const norm = (rule: string): string => rule.replace(/^playwright-score\//, 'pwscore/');
const cellOf = (f: { rule: string; form?: string }): string => `${norm(f.rule)}|${f.form ?? '-'}`;

/** ADR section 4 G10: each non-finding must appear as a FALSE fixture with this tag. */
const G10_TAGS = [
  'g10:route-handler',
  'g10:stored-awaited',
  'g10:promise-all',
  'g10:void',
  'g10:topass-poll',
  'g10:read-reused',
  'g10:literal-tautology',
  'g10:return-position',
  'g10:foreign-expect',
  'g10:api-under-test',
  'g10:custom-object',
];

/** Smallest fixture counts per cell (R2). Certain-candidate cells need 3 + 3, every other cell 1 + 1. */
const MIN_CERTAIN = 3;
const MIN_OTHER = 1;

/** Catalogue rules the runner keeps switched off on purpose; the test below checks that it still does. */
const NOT_ENABLED = ['playwright/require-top-level-describe'];
const isPending = (f: Fixture): boolean => f.pending !== undefined;

function allFiles(dir: string, base = dir): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) out.push(...allFiles(full, base));
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

/** Manifest-only checks: counts, tags, ids, pending marks. Pure, so the test can break a copy of the manifest. */
export function manifestProblems(m: Manifest, enabled: string[]): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const cellKeys = new Set(m.cells.map((c) => cellOf(c)));
  for (const f of m.fixtures) {
    if (ids.has(f.id)) problems.push(`duplicate fixture id ${f.id}`);
    ids.add(f.id);
    if (!cellKeys.has(cellOf(f))) problems.push(`${f.id}: cell ${cellOf(f)} is not in the cell table`);
    if (f.pending !== undefined && !/^(S\d+[a-z]?|unassigned)$/.test(f.pending)) problems.push(`${f.id}: pending must name a slice, got ${f.pending}`);
    const base = path.posix.basename(f.dir ?? f.entry);
    if (!f.project && !base.startsWith(`${f.verdict}-`)) problems.push(`${f.id}: file name must start with ${f.verdict}-`);
  }
  for (const c of m.cells) {
    const key = cellOf(c);
    const here = m.fixtures.filter((f) => cellOf(f) === key);
    // A cell whose rule is built by a later slice is counted with its pending TRUE fixtures: nothing reports it yet.
    const countable = (f: Fixture) => !isPending(f) || (c.builtBy !== undefined && f.pending === c.builtBy);
    const trues = here.filter((f) => f.verdict === 'true' && countable(f));
    const falses = here.filter((f) => f.verdict === 'false' && countable(f));
    const min = c.certain ? MIN_CERTAIN : MIN_OTHER;
    if (trues.length < min) problems.push(`${key}: ${trues.length} TRUE fixtures, needs ${min}`);
    if (falses.length < min) problems.push(`${key}: ${falses.length} FALSE fixtures, needs ${min}`);
    if (c.certain) {
      const tagged = (tag: string) => here.some((f) => f.verdict === 'true' && (f.tags ?? []).includes(tag) && countable(f));
      if (!tagged('js')) problems.push(`${key}: no JS TRUE fixture`);
      // An alias TRUE fixture may be pending (aliased page, S4a); it must exist so the slice has something to flip.
      if (!here.some((f) => f.verdict === 'true' && (f.tags ?? []).includes('alias'))) problems.push(`${key}: no alias TRUE fixture`);
      if (!here.some((f) => f.verdict === 'false' && (f.tags ?? []).includes('js') && countable(f))) problems.push(`${key}: no JS FALSE fixture`);
    }
  }
  const covered = new Set(m.cells.map((c) => norm(c.rule)));
  for (const rule of enabled) if (!covered.has(norm(rule))) problems.push(`enabled rule ${rule} has no cell in the manifest`);
  for (const tag of G10_TAGS) {
    if (!m.fixtures.some((f) => f.verdict === 'false' && (f.tags ?? []).includes(tag))) problems.push(`G10 non-finding ${tag} has no FALSE fixture`);
  }
  return problems;
}

/** Disk checks: every entry exists and every file on disk belongs to a fixture. Pure over file lists. */
export function diskProblems(fixtures: Fixture[], onDisk: string[]): string[] {
  const problems: string[] = [];
  const owned = new Set<string>();
  for (const f of fixtures) {
    const dir = f.dir ?? undefined;
    const prefix = dir ? `${dir}/` : f.entry;
    const mine = onDisk.filter((p) => (dir ? p.startsWith(prefix) : p === prefix));
    if (mine.length === 0) problems.push(`${f.id}: no file on disk for ${dir ?? f.entry}`);
    for (const p of mine) owned.add(p);
  }
  for (const p of onDisk) if (!owned.has(p)) problems.push(`${p}: file on disk is not listed in rule-fixtures.json`);
  return problems;
}

type Probe = { fires: boolean; formSeen: string[] };

/** What a fixture's behaviour says about its label. Returns a problem string or null. Pure. */
export function judge(f: Fixture, probe: Probe & { parseError: boolean }): string | null {
  const wantFires = f.verdict === 'true';
  const target = norm(f.rule);
  if (probe.parseError && target !== 'pwscore/parse-error') return `${f.id}: the file does not parse, so the result says nothing about ${target}`;
  if (isPending(f)) {
    // pending: the shape must still behave the OLD way, so the slice that fixes it has to clear the mark
    if (probe.fires === wantFires) return `${f.id}: marked pending ${f.pending} but it now behaves as labelled; remove the pending mark`;
    return null;
  }
  if (probe.fires !== wantFires) return `${f.id}: ${wantFires ? 'expected a finding' : 'expected no finding'} for ${target} and got ${probe.fires ? 'one' : 'none'}`;
  if (wantFires && f.form && probe.formSeen.length > 0 && !probe.formSeen.includes(f.form)) {
    return `${f.id}: finding form is ${probe.formSeen.join(',')}, fixture says ${f.form}`;
  }
  return null;
}

async function probeFixture(f: Fixture): Promise<Probe & { parseError: boolean; unexpectedNoFiles: boolean }> {
  const target = norm(f.rule);
  const cwd = f.project && f.dir ? path.join(fixtureRoot, f.dir) : fixtureRoot;
  const result = await scorePaths({
    paths: [path.join(fixtureRoot, f.entry)],
    profile: (f.profile as ProfileName | undefined) ?? 'standard',
    threshold: 0,
    cwd,
  });
  const mine = result.findings.filter((x) => norm(x.rule) === target);
  return {
    fires: mine.length > 0,
    formSeen: mine.map((x) => x.form).filter((x): x is string => typeof x === 'string'),
    parseError: result.findings.some((x) => norm(x.rule) === 'pwscore/parse-error'),
    unexpectedNoFiles: target !== 'pwscore/no-files' && result.findings.some((x) => norm(x.rule) === 'pwscore/no-files'),
  };
}

function enabledCatalogueRules(): string[] {
  return catalogueRules().filter((r) => !NOT_ENABLED.includes(r));
}

describe('QAG-287 S3: fixture manifest', () => {
  it('the rules it leaves out are switched off in the runner', () => {
    const src = fs.readFileSync(path.join(root, 'src', 'eslint-runner.ts'), 'utf8');
    for (const r of NOT_ENABLED) assert.ok(!new RegExp(`'${r}':\\s*(\\[\\s*)?'(warn|error)'`).test(src), `${r} is enabled now: give it fixtures`);
  });

  it('meets the R2 counts, covers every enabled rule and every G10 non-finding', () => {
    const problems = manifestProblems(manifest, enabledCatalogueRules());
    assert.deepEqual(problems, []);
  });

  it('lists every fixture file and every file it lists exists', () => {
    assert.deepEqual(diskProblems(manifest.fixtures, allFiles(fixtureRoot)), []);
  });

  it('pending marks only name slices of the plan', () => {
    const pending = new Set(manifest.fixtures.filter(isPending).map((f) => f.pending));
    const known = new Set(['S3b', 'S3c', 'S4a', 'S4b', 'S6b', 'S7a', 'S7b', 'S7c', 'unassigned']);
    for (const p of pending) assert.ok(known.has(p as string), `unknown pending slice ${p}`);
  });

  it('keeps the fixture shapes the ADR names as pending, with their slice', () => {
    const want: Array<[string, string]> = [
      ['true-aliased-page', 'S4a'],
      ['true-renamed-expect-const', 'S4b'],
      ['false-chai-expect', 'S4b'],
      ['true-helper', 'S6b'],
      ['true-foreach-async', 'S7a'],
      ['true-read-url', 'S7c'],
      ['true-read-count', 'S7c'],
      ['false-read-reused-guard', 'S3b'],
      ['false-api-under-test', 'S3c'],
    ];
    for (const [prefix, slice] of want) {
      const hit = manifest.fixtures.filter((f) => path.posix.basename(f.dir ?? f.entry).startsWith(prefix) || f.id.split('/')[1]?.startsWith(prefix));
      assert.ok(hit.length > 0, `no fixture named ${prefix}-*`);
      for (const f of hit) assert.equal(f.pending, slice, `${f.id} should be pending ${slice}`);
    }
  });
});

describe('QAG-287 S3: the gate fails when a fixture goes missing or flips', () => {
  const certain = manifest.cells.find((c) => c.certain && c.rule === 'pwscore/no-weak-assertion')!;
  const rows = (verdict: string) => manifest.fixtures.filter((f) => cellOf(f) === cellOf(certain) && f.verdict === verdict && !isPending(f));

  it('a removed TRUE fixture row leaves its file unlisted', () => {
    const gone = rows('true')[0];
    const rest = manifest.fixtures.filter((f) => f !== gone);
    assert.ok(diskProblems(rest, allFiles(fixtureRoot)).some((p) => p.includes(gone.entry)));
  });

  it('a removed FALSE fixture file leaves its row without a file', () => {
    const gone = rows('false')[0];
    const files = allFiles(fixtureRoot).filter((p) => p !== gone.entry);
    assert.ok(diskProblems(manifest.fixtures, files).some((p) => p.startsWith(gone.id)));
  });

  it('removing fixtures from a cell until it is below the bar is reported', () => {
    const keepTrue = rows('true').slice(0, MIN_CERTAIN - 1);
    const dropped = new Set(rows('true').filter((f) => !keepTrue.includes(f)));
    const m = { ...manifest, fixtures: manifest.fixtures.filter((f) => !dropped.has(f)) };
    assert.ok(manifestProblems(m, enabledCatalogueRules()).some((p) => p.includes('TRUE fixtures, needs')));
    const keepFalse = rows('false').slice(0, MIN_CERTAIN - 1);
    const droppedF = new Set(rows('false').filter((f) => !keepFalse.includes(f)));
    const m2 = { ...manifest, fixtures: manifest.fixtures.filter((f) => !droppedF.has(f)) };
    assert.ok(manifestProblems(m2, enabledCatalogueRules()).some((p) => p.includes('FALSE fixtures, needs')));
  });

  it('a flipped label is reported either way, and a stale pending mark is reported', () => {
    const f: Fixture = { id: 'x/true-a', rule: 'pwscore/no-weak-assertion', verdict: 'true', entry: 'x/true-a.ts' };
    assert.equal(judge(f, { fires: true, formSeen: [], parseError: false }), null);
    assert.match(judge({ ...f, verdict: 'false' }, { fires: true, formSeen: [], parseError: false }) ?? '', /expected no finding/);
    assert.match(judge(f, { fires: false, formSeen: [], parseError: false }) ?? '', /expected a finding/);
    assert.match(judge({ ...f, pending: 'S4a' }, { fires: true, formSeen: [], parseError: false }) ?? '', /remove the pending mark/);
    assert.equal(judge({ ...f, pending: 'S4a' }, { fires: false, formSeen: [], parseError: false }), null);
    assert.match(judge(f, { fires: true, formSeen: [], parseError: true }) ?? '', /does not parse/);
  });
});

describe('QAG-287 S3: every fixture behaves as labelled', () => {
  for (const f of manifest.fixtures) {
    const title = `${f.id}${f.pending ? ` [pending ${f.pending}]` : ''}`;
    it(title, async () => {
      const probe = await probeFixture(f);
      assert.equal(probe.unexpectedNoFiles, false, `${f.id}: the scorer found no spec file at ${f.entry}`);
      const problem = judge(f, probe);
      assert.equal(problem, null, problem ?? '');
    });
  }
});
