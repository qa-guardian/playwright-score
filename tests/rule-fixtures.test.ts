import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scorePaths } from '../src/index.js';
import { catalogueRules } from '../src/catalogue/index.js';
import { RECEIVER_TIERED_RULES } from '../src/receiver-forms.js';
import type { ProfileName } from '../src/types.js';

// QAG-287 S3: the per-rule fixture gate (ADR section 6.0 R2).
//
// tests/rule-fixtures.json lists every fixture under tests/fixtures/cells, laid out as
// <rule id with / as __>/<form>/[shared/]{true,false}-<name>.<ext> (the layout the evaluator's R2 gate reads;
// a form-less rule uses `-`). A TRUE fixture is a
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
  /** The shape is reported and must never be certain (a `void`-ed expect, S4b): the fixture is judged on the certain tier only. */
  tierAtMost?: 'likely';
  /** The shape is still reported, in this advisory form of the rule (S3c): the fixture is FALSE for its own cell and must be reported in exactly this form. */
  movedTo?: string;
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
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'cells');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'tests', 'rule-fixtures.json'), 'utf8')) as Manifest;
type Pair = { id: string; pending: string | null };
const guard = (JSON.parse(fs.readFileSync(path.join(root, 'tests', 'rule-fixtures.ids.json'), 'utf8')) as { fixtures: Pair[] }).fixtures;
const pairsOf = (fixtures: Fixture[]): Pair[] => fixtures.map((f) => ({ id: f.id, pending: f.pending ?? null }));

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
/** Slices already closed: a fixture cannot wait for them (ADR 0.E E-3). Add a slice here when it lands. */
const LANDED = ['S1', 'S2', 'S3', 'S3b', 'S3c', 'S7c'];
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
    if (f.pending !== undefined && !/^S\d+[a-z]?$/.test(f.pending)) problems.push(`${f.id}: pending must name a slice, got ${f.pending}`);
    if (f.pending !== undefined && LANDED.includes(f.pending)) problems.push(`${f.id}: pending ${f.pending} names a slice that has already landed; remove the mark or name a later slice`);
    const base = path.posix.basename(f.dir ?? f.entry);
    if (!f.project && !base.startsWith(`${f.verdict}-`)) problems.push(`${f.id}: file name must start with ${f.verdict}-`);
    if (!f.project) {
      // The evaluator's R2 gate reads <rule with / as __>/<form>/[shared/]<true|false>-<name>
      const lead = `${f.rule.replace('/', '__')}/${f.form ?? '-'}/`;
      const rest = f.entry.startsWith(lead) ? f.entry.slice(lead.length) : null;
      if (rest === null) problems.push(`${f.id}: entry must live under ${lead}`);
      else if ((f.tags ?? []).includes('shared') !== rest.startsWith('shared/')) problems.push(`${f.id}: a shared fixture lives under ${lead}shared/ and no other fixture does`);
    }
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
      // R2 holds for current behaviour: an alias form must be reported today. A pending alias fixture (S4a, a const alias)
      // is extra, it never stands in for it.
      if (!here.some((f) => f.verdict === 'true' && (f.tags ?? []).includes('alias') && countable(f))) problems.push(`${key}: no alias TRUE fixture that is reported today`);
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

/**
 * The frozen guard: tests/rule-fixtures.ids.json holds the sorted (id, pending) pair of every fixture. The manifest
 * and the disk checks above cannot see a fixture that is removed together with its row and its file, or a pending
 * mark that is added to make a failing fixture pass, so the pairs are pinned here. Adding, removing or re-marking a
 * fixture means changing the guard in the same commit, where a reviewer sees it.
 */
export function guardProblems(pairs: Pair[], guard: Pair[]): string[] {
  const have = new Map(pairs.map((p) => [p.id, p.pending]));
  const frozen = new Map(guard.map((p) => [p.id, p.pending]));
  const problems: string[] = [];
  for (const [id, pending] of frozen) {
    if (!have.has(id)) problems.push(`${id}: frozen in tests/rule-fixtures.ids.json but missing from the manifest`);
    else if (have.get(id) !== pending) problems.push(`${id}: pending mark is ${have.get(id) ?? 'none'} in the manifest but ${pending ?? 'none'} in tests/rule-fixtures.ids.json`);
  }
  for (const id of have.keys()) if (!frozen.has(id)) problems.push(`${id}: in the manifest but not frozen in tests/rule-fixtures.ids.json`);
  return problems;
}

/** R2 counts: only fixtures that run against current behaviour are live; pending ones are reported separately. */
export function r2Counts(fixtures: Fixture[]): { live: { true: number; false: number }; pending: { true: number; false: number } } {
  const n = (pending: boolean, verdict: string) => fixtures.filter((f) => isPending(f) === pending && f.verdict === verdict).length;
  return { live: { true: n(false, 'true'), false: n(false, 'false') }, pending: { true: n(true, 'true'), false: n(true, 'false') } };
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
  const form = expectedForm(f);
  if (wantFires && form && probe.formSeen.length > 0 && !probe.formSeen.includes(form)) {
    return `${f.id}: finding form is ${probe.formSeen.join(',')}, fixture says ${form}`;
  }
  return null;
}

/** Receiver-tiered whatever the list holds: written out, so a fixture of their `unresolved` cell fails if the step or the list drops one. */
const RECEIVER_PINNED_RULES = ['playwright/no-wait-for-navigation', 'playwright/no-element-handle', 'playwright/no-page-pause'];
/** The one rule that may be taken out of RECEIVER_TIERED_RULES; its fixtures follow the list. */
const RECEIVER_OPTIONAL_RULE = 'playwright/no-wait-for-selector';

/**
 * The form a TRUE fixture's finding must carry. A receiver-tiered rule (B2) gives every finding a form, so a fixture
 * of its `-` cell must come back as `-` and not as `unresolved`. Only no-wait-for-selector may be out of
 * RECEIVER_TIERED_RULES: it then has no `unresolved` form and the same shapes are still reported, as `-`.
 */
export function expectedForm(f: Fixture): string | undefined {
  const tiered = RECEIVER_PINNED_RULES.includes(f.rule) || (f.rule === RECEIVER_OPTIONAL_RULE && RECEIVER_TIERED_RULES.includes(f.rule));
  if (f.form === 'unresolved' && !tiered) return '-';
  return tiered && !f.project ? (f.form ?? '-') : f.form;
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
  // A FALSE fixture in a named form is judged on that form only: a finding of another form of the same rule
  // does not make it fire, so a pending fixture can flip when a later slice re-forms the finding.
  const formScoped = f.verdict === 'false' && f.form !== undefined && f.form !== '-';
  const ofCell = result.findings.filter((x) => norm(x.rule) === target && (!formScoped || x.form === f.form || x.form === undefined));
  if (f.tierAtMost && ofCell.length === 0) throw new Error(`${f.id}: a fixture judged on its tier must be reported`);
  if (f.movedTo) {
    const moved = ofCell.filter((x) => x.form === f.movedTo);
    if (moved.length === 0) throw new Error(`${f.id}: the finding must still be reported, with form ${f.movedTo}`);
    if (moved.some((x) => x.tier !== 'advisory')) throw new Error(`${f.id}: a finding of form ${f.movedTo} must be advisory`);
  }
  const mine = f.tierAtMost ? ofCell.filter((x) => x.tier === 'certain') : f.movedTo ? ofCell.filter((x) => x.form !== f.movedTo) : ofCell;
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

  it('matches the frozen list of fixture ids', () => {
    assert.deepEqual(guardProblems(pairsOf(manifest.fixtures), guard), []);
    assert.deepEqual([...guard].sort((a, b) => (a.id < b.id ? -1 : 1)), guard, 'the frozen list is sorted');
  });

  it('counts R2 on live fixtures and reports pending ones separately', () => {
    const c = r2Counts(manifest.fixtures);
    console.log(`R2 fixtures: live ${c.live.true} TRUE / ${c.live.false} FALSE, pending ${c.pending.true} TRUE / ${c.pending.false} FALSE`);
    assert.equal(c.live.true + c.live.false + c.pending.true + c.pending.false, manifest.fixtures.length);
    assert.equal(c.pending.true + c.pending.false, manifest.fixtures.filter(isPending).length);
  });

  it('a pending mark that names a landed slice, or a changed mark, is rejected', () => {
    const live = manifest.fixtures.find((f) => !isPending(f))!;
    const marked = manifest.fixtures.map((f) => (f === live ? { ...f, pending: 'S3' } : f));
    assert.ok(manifestProblems({ ...manifest, fixtures: marked }, []).some((p) => p.includes('already landed')));
    assert.ok(guardProblems(pairsOf(marked), guard).some((p) => p.startsWith(live.id) && p.includes('pending mark')));
    const cleared = manifest.fixtures.map((f) => (isPending(f) ? { ...f, pending: undefined } : f));
    assert.ok(guardProblems(pairsOf(cleared), guard).length > 0, 'clearing a mark without updating the guard is reported');
  });

  it('pending marks only name slices of the plan', () => {
    const pending = new Set(manifest.fixtures.filter(isPending).map((f) => f.pending));
    const known = new Set(['S4a', 'S4b', 'S6b', 'S7a', 'S7b']);
    for (const p of pending) assert.ok(known.has(p as string), `unknown pending slice ${p}`);
  });

  it('keeps the fixture shapes the ADR names as pending, with their slice', () => {
    const want: Array<[string, string]> = [
      ['true-aliased-page', 'S4a'],
      ['true-renamed-expect-const', 'S4b'],
      ['true-helper', 'S6b'],
      ['true-foreach-async', 'S7a'],
      ['true-not-catch-chain', 'S7b'],
    ];
    for (const [prefix, slice] of want) {
      const hit = manifest.fixtures.filter((f) => path.posix.basename(f.dir ?? f.entry).startsWith(prefix) || f.id.split('/')[1]?.startsWith(prefix));
      assert.ok(hit.length > 0, `no fixture named ${prefix}-*`);
      for (const f of hit) assert.equal(f.pending, slice, `${f.id} should be pending ${slice}`);
    }
  });
});

describe('QAG-287 S3c: the api-under-test fixtures are live', () => {
  const FIVE = ['playwright/no-networkidle', 'playwright/no-wait-for-selector', 'playwright/no-wait-for-navigation', 'playwright/no-element-handle', 'playwright/no-page-pause'];
  const PROJECTS = ['engine-named-package', 'lockfile-link-only'];

  it('each of the five rules has, per Playwright project, a FALSE fixture of its own cell that moves and a TRUE fixture of the api-under-test cell', () => {
    for (const rule of FIVE) {
      for (const project of PROJECTS) {
        const here = manifest.fixtures.filter((f) => f.rule === rule && f.dir === `_projects/${project}`);
        const gone = here.filter((f) => f.verdict === 'false' && f.form === undefined);
        assert.equal(gone.length, 1, `${rule} ${project}`);
        assert.deepEqual([gone[0].pending, gone[0].movedTo, (gone[0].tags ?? []).includes('g10:api-under-test')], [undefined, 'api-under-test', true], gone[0].id);
        assert.equal(here.filter((f) => f.verdict === 'true' && f.form === 'api-under-test' && !isPending(f)).length, 1, `${rule} ${project}`);
      }
      const customer = manifest.fixtures.filter((f) => f.rule === rule && f.dir === '_projects/customer-registry-deps' && !isPending(f));
      assert.deepEqual(customer.map((f) => `${f.verdict}:${f.form}`).sort(), ['false:api-under-test', 'true:-'], rule);
    }
    assert.equal(manifest.fixtures.filter((f) => f.pending === 'S3c').length, 0);
  });

  it('every project has a TS and a JS spec', () => {
    for (const project of [...PROJECTS, 'customer-registry-deps', 'engine-unresolved-receiver']) {
      const files = allFiles(path.join(fixtureRoot, '_projects', project, 'tests'));
      assert.ok(files.some((p) => p.endsWith('.ts')) && files.some((p) => p.endsWith('.js')), project);
    }
  });

  it('a fixture whose finding moves fails when the finding is dropped, keeps its form, or is not advisory', async () => {
    const moved = manifest.fixtures.find((f) => f.movedTo === 'api-under-test' && f.rule === 'playwright/no-page-pause')!;
    assert.equal(judge(moved, await probeFixture(moved)), null);
    await assert.rejects(probeFixture({ ...moved, movedTo: 'no-such-form' }), /must still be reported/);
    const customer = { ...moved, entry: '_projects/customer-registry-deps/tests', dir: '_projects/customer-registry-deps' };
    await assert.rejects(probeFixture(customer), /must still be reported/, 'in a customer project the finding keeps form -');
    assert.equal((await probeFixture({ ...customer, movedTo: undefined })).fires, true);
  });

  it('precedence: the api-under-test fixture over an unproven receiver is reported as api-under-test only', async () => {
    const f = manifest.fixtures.find((x) => x.id === 'no-page-pause/api-under-test-true-over-unresolved-receiver')!;
    const probe = await probeFixture(f);
    assert.deepEqual([...new Set(probe.formSeen)], ['api-under-test']);
    assert.equal(probe.formSeen.length, 2, 'the TS and the JS spec');
    // The same files in a directory with no Playwright manifest: the receiver is not proven, so the form is unresolved.
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-s3c-'));
    try {
      fs.cpSync(path.join(fixtureRoot, f.entry), path.join(copy, 'tests'), { recursive: true });
      const result = await scorePaths({ paths: [path.join(copy, 'tests')], profile: 'standard', threshold: 0, cwd: copy });
      assert.deepEqual(result.findings.filter((x) => x.rule === f.rule).map((x) => x.form), ['unresolved', 'unresolved']);
    } finally {
      fs.rmSync(copy, { recursive: true, force: true });
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

  it('removing one TRUE and one FALSE fixture completely, row and file, still fails', () => {
    const t = rows('true')[0];
    const f = rows('false')[0];
    const rest = manifest.fixtures.filter((x) => x !== t && x !== f);
    const files = allFiles(fixtureRoot).filter((p) => p !== t.entry && p !== f.entry);
    assert.deepEqual(diskProblems(rest, files), [], 'row and file together leave the disk check clean');
    const problems = guardProblems(pairsOf(rest), guard);
    assert.ok(problems.some((p) => p.startsWith(t.id)), 'the TRUE removal is reported');
    assert.ok(problems.some((p) => p.startsWith(f.id)), 'the FALSE removal is reported');
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

  it('a FALSE fixture in a named form ignores findings of another form', async () => {
    const t = manifest.fixtures.find((x) => x.id === 'valid-expect/true-bare-expect')!;
    assert.equal((await probeFixture({ ...t, verdict: 'false' })).fires, true, 'same form: counted');
    assert.equal((await probeFixture({ ...t, verdict: 'false', form: 'other' })).fires, false, 'other form: not counted');
    assert.equal((await probeFixture({ ...t, verdict: 'false', form: '-' })).fires, true, 'form - counts every finding');
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
