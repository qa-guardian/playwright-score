import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scorePaths } from '../src/index.js';
import type { Finding } from '../src/types.js';
import {
  ROWS,
  DOCS_URLS,
  KNOWN_PACKAGES,
  rowFor,
  defaultRow,
  catalogueRules,
  tierOf,
  confidenceOfRow,
  decorateFindings,
} from '../src/catalogue/index.js';
import { ESLINT_RULE_MAP } from '../src/profiles.js';
import { RULE_COPY } from '../src/rule-copy.js';
import { CONFIDENCE_BY_RULE, DEFAULT_CONFIDENCE } from '../src/confidence.js';

// QAG-287 S2: the catalogue is complete, consistent with its evidence, and changes nothing the scorer decides.

function packageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'fixtures'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('package root not found');
}
const root = packageRoot();
const readJson = (rel: string) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const precision = readJson('labels/precision.json') as {
  schema: number;
  cells: Array<{ rule: string; form: string; role: string; tier: string }>;
};
const cellForms = readJson('tests/data/cell-forms.json') as { bc_eligible_cells: string[][]; bc_ineligible_certain_candidate_cells: string[][] };
const legacy = readJson('tests/data/legacy-maps.json') as {
  rules: Record<string, { map: unknown; copy: unknown; conf: string | null }>;
};

/** Rule ids the runner turns on: a rule is enabled when its level is not 'off'. */
function enabledRules(): string[] {
  const src = fs.readFileSync(path.join(root, 'src', 'eslint-runner.ts'), 'utf8');
  const out = new Set<string>();
  for (const m of src.matchAll(/'((?:playwright|pwscore)\/[a-z-]+)':\s*(?:\[\s*)?'(warn|error)'/g)) out.add(m[1]);
  return [...out];
}

describe('QAG-287 S2: catalogue structure', () => {
  it('has a row for every rule the runner enables', () => {
    const enabled = enabledRules();
    assert.ok(enabled.length >= 30, `found only ${enabled.length} enabled rules, the pattern is stale`);
    for (const rule of enabled) assert.ok(defaultRow(rule), `no catalogue row for enabled rule ${rule}`);
  });

  it('has a row for every rule the scorer reports from outside the lint run', () => {
    for (const rule of [
      'metrics/oversized-file',
      'pwscore/eslint-disable-comment',
      'playwright-score/assertion-unverified',
      'playwright-score/parse-error',
      'playwright-score/no-files',
    ]) {
      assert.ok(defaultRow(rule), `no catalogue row for ${rule}`);
    }
  });

  it('has one row per cell and every file under 300 lines', () => {
    const seen = new Set<string>();
    for (const r of ROWS) {
      const key = `${r.rule}|${r.form}`;
      assert.ok(!seen.has(key), `duplicate cell ${key}`);
      seen.add(key);
    }
    const dir = path.join(root, 'src', 'catalogue');
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
      const lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n').length;
      assert.ok(lines < 300, `${f} has ${lines} lines`);
    }
  });

  it('keeps every row of a rule in one family-independent mapping (dimension, severity, report-only)', () => {
    for (const rule of catalogueRules()) {
      const rows = ROWS.filter((r) => r.rule === rule);
      for (const r of rows) {
        assert.equal(r.dimension, rows[0].dimension, `${rule} ${r.form}: dimension`);
        assert.equal(r.severityOverride, rows[0].severityOverride, `${rule} ${r.form}: severity`);
        assert.equal(Boolean(r.reportOnly), Boolean(rows[0].reportOnly), `${rule} ${r.form}: reportOnly`);
        assert.equal(r.label, rows[0].label, `${rule} ${r.form}: label`);
      }
    }
  });

  it('gives every row plain copy with no vendor or tool names', () => {
    for (const r of ROWS) {
      for (const k of ['title', 'what', 'why', 'fix'] as const) {
        assert.ok(r[k].length > 8, `${r.rule} ${r.form}: ${k} is empty`);
        assert.doesNotMatch(r[k], /claude|anthropic|openai|gpt|copilot|\bAI\b|\bLLM\b/i, `${r.rule} ${r.form}: ${k}`);
      }
    }
  });
});

describe('QAG-287 S2: certain-candidate rows and the by-construction path', () => {
  const candidates = ROWS.filter((r) => r.design === 'candidate');

  it('every certain-candidate row rests on the docs and carries a known docs URL', () => {
    // 15 since QAG-287 S7a added pwscore/no-floating-callback-assertion (a BC-eligible cell in cell-forms.json).
    assert.equal(candidates.length, 15);
    for (const r of candidates) {
      assert.equal(r.basis, 'docs', `${r.rule} ${r.form}: basis`);
      assert.ok(r.docs, `${r.rule} ${r.form}: no docs URL`);
      assert.ok(DOCS_URLS.includes(r.docs!), `${r.rule} ${r.form}: ${r.docs} is not in docs-urls.json`);
    }
  });

  it('every docs URL a row carries is in docs-urls.json', () => {
    for (const r of ROWS) if (r.docs) assert.ok(DOCS_URLS.includes(r.docs), `${r.rule} ${r.form}: ${r.docs}`);
  });

  it('every BC-eligible row has a docs sentence and docs-written fixtures (or the slice that writes them)', () => {
    const eligible = ROWS.filter((r) => r.bcEligible);
    assert.ok(eligible.length >= 11);
    for (const r of eligible) {
      assert.ok(r.docsSentence && r.docsSentence.length > 20, `${r.rule} ${r.form}: no docs sentence`);
      const fx = (readJson('tests/rule-fixtures.json') as { fixtures: Array<{ rule: string; form?: string; verdict: string; pending?: string }> }).fixtures;
      const mine = fx.filter((f) => f.rule === r.rule && (f.form ?? '-') === r.form && f.pending === undefined);
      assert.ok(mine.some((f) => f.verdict === 'true') && mine.some((f) => f.verdict === 'false'), `${r.rule} ${r.form}: no docs-written fixtures in tests/rule-fixtures.json`);
    }
  });

  it('only BC-eligible rows carry a docs sentence', () => {
    for (const r of ROWS) if (!r.bcEligible) assert.equal(r.docsSentence, undefined, `${r.rule} ${r.form}`);
  });

  it("agrees with the gate spec's eligibility (cell-forms)", () => {
    const eligible = new Set(cellForms.bc_eligible_cells.filter((c) => c[2] === 'spec').map((c) => `${c[0]}|${c[1]}`));
    const inelig = new Set(cellForms.bc_ineligible_certain_candidate_cells.map((c) => `${c[0]}|${c[1]}`));
    for (const r of ROWS) {
      const key = `${r.rule}|${r.form}`;
      assert.equal(r.bcEligible, eligible.has(key), `${key}: eligibility disagrees with cell-forms.json`);
      if (r.bcEligible) assert.equal(r.design, 'candidate', `${key}: eligible but not a candidate`);
      if (inelig.has(key)) assert.equal(r.design, 'candidate', `${key}: ineligible candidate must still be a candidate`);
    }
    // Every eligible cell whose rule exists today has its row.
    for (const key of eligible) {
      const [rule, form] = key.split('|');
      if (defaultRow(rule)) assert.ok(rowFor(rule, form), `no row for eligible cell ${key}`);
    }
  });
});

describe('QAG-287 F-5: tier follows labels/precision.json', () => {
  const listed = new Map(precision.cells.map((c) => [`${c.rule}|${c.form}|${c.role}`, c.tier]));

  // Restated independently of src/catalogue/tiers.ts.
  const expectedTier = (r: (typeof ROWS)[number]): string => {
    const t = listed.get(`${r.rule}|${r.form}|spec`);
    if (t) return t;
    return r.design === 'advisory' ? 'advisory' : 'likely';
  };

  it('the file is schema 2 and every listed cell has a known tier, role and row', () => {
    assert.equal(precision.schema, 2);
    for (const c of precision.cells) {
      assert.ok(['certain', 'likely', 'advisory'].includes(c.tier), `${c.rule} ${c.form}: tier ${c.tier}`);
      // A 'shared' cell is the evaluator's measurement on shared files (L2): it may only name a cell that runs on them.
      assert.ok(['spec', 'shared'].includes(c.role), `${c.rule} ${c.form}: role ${c.role}`);
      assert.ok(rowFor(c.rule, c.form), `${c.rule} ${c.form}: listed cell has no catalogue row`);
      if (c.role === 'shared') assert.equal(rowFor(c.rule, c.form)?.onShared, true, `${c.rule} ${c.form}: a shared cell of a rule that never runs on a shared file`);
    }
  });

  it('every row has the tier the file gives it, and only listed certain cells are certain', () => {
    for (const r of ROWS) assert.equal(tierOf(r), expectedTier(r), `${r.rule} ${r.form}`);
    const certainRows = ROWS.filter((r) => tierOf(r) === 'certain').map((r) => `${r.rule}|${r.form}`).sort();
    const certainCells = precision.cells.filter((c) => c.tier === 'certain' && c.role === 'spec').map((c) => `${c.rule}|${c.form}`).sort();
    assert.deepEqual(certainRows, certainCells);
  });

  it('confidence is null when the file carries no counts', () => {
    for (const r of ROWS) assert.equal(confidenceOfRow(r), null, `${r.rule} ${r.form}`);
  });

  it('a shared-file cell is never certain without a shared-file measurement', () => {
    const measured = new Set(precision.cells.filter((c) => c.role === 'shared' && c.tier === 'certain').map((c) => `${c.rule}|${c.form}`));
    for (const r of ROWS) if (!measured.has(`${r.rule}|${r.form}`)) assert.notEqual(tierOf(r, 'shared'), 'certain', `${r.rule} ${r.form}`);
  });
});

describe('QAG-287 S6c: a (rule, form, shared) cell is certain only with an L2 measurement', () => {
  // Shared linting is on by default (S6c), so every shared finding reaches the output. Its tier may be certain
  // only where labels/precision.json lists the cell with role 'shared' and tier certain (the evaluator's L2
  // measurement on shared files). The spec cell's tier never carries over. Restated independently of tiers.ts.
  type Cell = { rule: string; form: string; role: string; tier: string };
  const measuredIn = (cells: Cell[]): Set<string> =>
    new Set(cells.filter((c) => c.role === 'shared' && c.tier === 'certain').map((c) => `${c.rule}|${c.form}`));
  /** The `rule|form` cells a tier function makes certain on a shared file without a measurement in `cells`. */
  const unmeasuredCertain = (keys: string[], tier: (key: string) => string | undefined, cells: Cell[]): string[] => {
    const measured = measuredIn(cells);
    return keys.filter((k) => tier(k) === 'certain' && !measured.has(k)).sort();
  };

  const sharedRules = [...new Set(ROWS.filter((r) => r.onShared).map((r) => r.rule))];
  const UNLISTED = '(a form the catalogue does not list)';
  // Every form a shared finding can carry: each catalogue row of a rule that runs on shared files, no form
  // (a multi-form rule whose form was not decided), and a form the catalogue does not list.
  const sharedForms: Array<{ rule: string; form: string | undefined }> = sharedRules.flatMap((rule) => [
    ...ROWS.filter((r) => r.rule === rule).map((r) => ({ rule, form: r.form as string | undefined })),
    { rule, form: undefined },
    { rule, form: UNLISTED },
  ]);
  /** A shared finding of that rule and form after decorateFindings (the path every real shared finding takes). */
  const decorated = (x: { rule: string; form: string | undefined }): Finding => {
    const f: Finding = {
      rule: x.rule,
      severity: 'warning',
      message: 'm',
      file: 'helpers.ts',
      line: 1,
      dimension: 'playwrightHygiene',
      scope: 'shared',
      usedBy: ['a.spec.ts'],
    };
    if (x.form !== undefined) f.form = x.form;
    decorateFindings([f], undefined);
    return f;
  };
  /** The cell a decorated finding sits in: its own form once decorated (an undecided one has none). */
  const cellOf = (f: Finding): string => `${f.rule}|${f.form ?? '(undecided)'}`;

  it('covers every rule the catalogue runs on shared files, and the three measured spec cells among them', () => {
    assert.ok(sharedRules.length >= 13, sharedRules.join(' '));
    const specCertain = precision.cells.filter((c) => c.role === 'spec' && c.tier === 'certain').map((c) => c.rule);
    assert.ok(specCertain.length > 0 && specCertain.every((r) => sharedRules.includes(r)), specCertain.join(' '));
  });

  it('no catalogue row is certain on a shared file without a measurement', () => {
    const byKey = new Map(ROWS.map((r) => [`${r.rule}|${r.form}`, r]));
    assert.deepEqual(unmeasuredCertain([...byKey.keys()], (k) => tierOf(byKey.get(k)!, 'shared'), precision.cells), []);
  });

  it('no shared finding is certain without a measurement, whatever form it carries', () => {
    const found = sharedForms.map(decorated);
    assert.equal(found.length, sharedForms.length);
    const tiers = new Map<string, string | undefined>();
    for (const f of found) if (tiers.get(cellOf(f)) !== 'certain') tiers.set(cellOf(f), f.tier);
    assert.ok(tiers.has(`playwright/no-wait-for-timeout|${UNLISTED}`) && [...tiers.keys()].some((k) => k.endsWith('|(undecided)')));
    assert.deepEqual(unmeasuredCertain([...tiers.keys()], (k) => tiers.get(k), precision.cells), []);
    // And no shared finding carries the spec cell's measured precision.
    for (const f of found) assert.equal(f.confidence, null, cellOf(f));
  });

  it('the check fails on a shared tier taken from the spec cell, and passes once that cell is measured', () => {
    const specTier = new Map(precision.cells.filter((c) => c.role === 'spec').map((c) => [`${c.rule}|${c.form}`, c.tier]));
    const keys = ROWS.map((r) => `${r.rule}|${r.form}`);
    const inherited = (k: string) => specTier.get(k);
    const flagged = unmeasuredCertain(keys, inherited, precision.cells);
    assert.deepEqual(flagged, precision.cells.filter((c) => c.role === 'spec' && c.tier === 'certain').map((c) => `${c.rule}|${c.form}`).sort());
    const measured: Cell[] = [...precision.cells, ...flagged.map((k) => ({ rule: k.split('|')[0], form: k.split('|')[1], role: 'shared', tier: 'certain' }))];
    assert.deepEqual(unmeasuredCertain(keys, inherited, measured), []);
    // A shared cell listed as likely is no measurement of certainty.
    const likely: Cell[] = [...precision.cells, ...flagged.map((k) => ({ rule: k.split('|')[0], form: k.split('|')[1], role: 'shared', tier: 'likely' }))];
    assert.deepEqual(unmeasuredCertain(keys, inherited, likely), flagged);
  });
});

describe('QAG-287 S2: the catalogue replaces the hand-kept maps without changing them', () => {
  it('ESLINT_RULE_MAP equals the snapshot', () => {
    const expected = Object.fromEntries(Object.entries(legacy.rules).filter(([, v]) => v.map).map(([k, v]) => [k, v.map]));
    assert.deepEqual(ESLINT_RULE_MAP, expected);
  });

  it('RULE_COPY equals the snapshot', () => {
    const expected = Object.fromEntries(Object.entries(legacy.rules).filter(([, v]) => v.copy).map(([k, v]) => [k, v.copy]));
    assert.deepEqual(RULE_COPY, expected);
  });

  it('the display confidence of every rule equals the snapshot (default medium)', () => {
    for (const [rule, v] of Object.entries(legacy.rules)) {
      assert.equal(CONFIDENCE_BY_RULE[rule] ?? DEFAULT_CONFIDENCE, v.conf ?? DEFAULT_CONFIDENCE, rule);
    }
  });

  it('known-packages lists the assertion libraries and some non-asserting packages', () => {
    for (const p of ['assert', 'node:assert', 'chai', 'vitest', '@jest/globals']) assert.ok(KNOWN_PACKAGES.assertion.includes(p), p);
    for (const p of ['@faker-js/faker', 'dotenv', 'dayjs', 'uuid', 'axios']) assert.ok(KNOWN_PACKAGES.nonAsserting.includes(p), p);
  });
});

describe('QAG-287 S2: decorateFindings only adds keys', () => {
  it('leaves every existing key as it was and adds the catalogue fields', () => {
    // A rule with one shape: decorateFindings gives its form-less finding the form of its only row.
    const f: Finding = {
      rule: 'playwright/no-wait-for-timeout',
      severity: 'error',
      message: 'm',
      file: 'a.spec.ts',
      line: 3,
      column: 1,
      dimension: 'playwrightHygiene',
      reportOnly: undefined,
      scope: 'test',
      testKey: 'a.spec.ts#0',
    };
    const before = JSON.parse(JSON.stringify(f));
    decorateFindings([f], undefined);
    for (const [k, v] of Object.entries(before)) assert.deepEqual((f as unknown as Record<string, unknown>)[k], v, k);
    assert.equal(f.tier, 'likely', 'the file lists no-wait-for-timeout as likely');
    assert.equal(f.family, 'flake-risk');
    assert.equal(f.form, '-');
    assert.equal(f.basis, 'docs');
    assert.equal(f.evidence, 'name');
    assert.equal(f.quotable, false);
    assert.equal(f.excerpt, '');
    assert.ok(f.docs && DOCS_URLS.includes(f.docs));
  });

  it('gives an unknown rule a neutral advisory row', () => {
    const f: Finding = { rule: 'x/unknown', severity: 'info', message: 'm', file: 'a.ts', dimension: 'structure' };
    decorateFindings([f], undefined);
    assert.equal(f.tier, 'advisory');
    assert.equal(f.family, 'maintainability');
    assert.ok(f.title && f.what && f.why && f.fix);
  });
});

async function scoreSource(body: string, name = 'temp.spec.ts') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-cat-'));
  try {
    fs.writeFileSync(path.join(dir, name), body);
    return await scorePaths({ paths: [path.join(dir, name)], profile: 'standard', threshold: 0, cwd: dir });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('QAG-287 S2: a multi-form rule whose form cannot be decided', () => {
  const unawaited = (): Finding => ({
    rule: 'playwright/missing-playwright-await',
    severity: 'error',
    message: 'm',
    file: 'a.spec.ts',
    line: 99,
    column: 1,
    dimension: 'structure',
  });

  it('keeps the form undetermined, takes no row family and is needs-check', () => {
    const f = unawaited();
    decorateFindings([f], undefined);
    assert.equal(f.form, undefined);
    assert.equal(f.tier, 'needs-check');
    assert.equal(f.family, undefined);
    assert.equal(f.confidence, null);
    assert.ok(f.title && f.what && f.why && f.fix);
  });

  it('a decided form still takes its own row', () => {
    const f = { ...unawaited(), form: 'action' };
    decorateFindings([f], undefined);
    assert.equal(f.form, 'action');
    assert.equal(f.family, 'flake-risk');
  });
});

describe('QAG-287 S2: findings from a real run', () => {
  const SPEC = `import { test, expect } from '@playwright/test';

test('mix', async ({ page }) => {
  await page.goto('/');
  expect(page.locator('h1')).toBeVisible();
  page.waitForResponse('/next');
  expect(page);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  const n = await page.locator('li').count();
  expect(n).toBeGreaterThanOrEqual(0);
});
`;

  it('every finding carries the catalogue fields and a form that has a row', async () => {
    const r = await scoreSource(SPEC);
    assert.ok(r.findings.length >= 5);
    for (const f of r.findings) {
      if (f.form === undefined) {
        assert.equal(f.tier, 'needs-check', `${f.rule}: no form but tier ${f.tier}`);
        assert.ok(ROWS.filter((r) => r.rule === f.rule).length > 1, `${f.rule}: single-form rule without a form`);
      } else {
        assert.ok(rowFor(f.rule, f.form), `${f.rule}: form ${f.form} has no row`);
      }
      for (const k of ['title', 'what', 'why', 'fix', 'excerpt', 'tier', 'confidence', 'basis', 'evidence'] as const) {
        assert.ok(k in f, `${f.rule}: missing ${k}`);
      }
      assert.ok(['certain', 'likely', 'needs-check', 'advisory'].includes(f.tier!), f.rule);
      assert.equal(f.quotable, false);
      assert.ok(f.confidence === null || (typeof f.confidence === 'number' && f.confidence >= 0 && f.confidence <= 1), f.rule);
    }
  });

  it('decides missing-await form from the reported node', async () => {
    const r = await scoreSource(SPEC);
    const aw = r.findings.filter((f) => f.rule === 'playwright/missing-playwright-await');
    const byLine = (line: number) => aw.find((f) => f.line === line)?.form;
    assert.equal(byLine(5), 'assertion');
    assert.equal(byLine(6), 'action');
  });

  it('decides valid-expect form from the message id, and takes the excerpt from the source line', async () => {
    const r = await scoreSource(SPEC);
    const v = r.findings.find((f) => f.rule === 'playwright/valid-expect' && f.line === 7);
    assert.equal(v?.form, 'matcherless');
    assert.equal(v?.excerpt, 'expect(page);');
    assert.equal(v?.tier, 'likely');
    assert.equal(v?.family, 'passes-regardless');
  });

  it('a plain finding carries form "-"', async () => {
    const r = await scoreSource(SPEC);
    const n = r.findings.find((f) => f.rule === 'playwright/no-networkidle');
    assert.equal(n?.form, '-');
    assert.equal(n?.tier, 'likely');
    const listed = precision.cells.find((c) => c.rule === 'playwright/no-wait-for-timeout' && c.form === '-' && c.role === 'spec');
    assert.ok(listed, 'the file lists no-wait-for-timeout');
    assert.equal(r.findings.find((f) => f.rule === 'playwright/no-wait-for-timeout')?.tier, listed.tier, 'a listed cell has the tier the file gives it');
  });

});
