import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scorePaths } from '../src/index.js';
import { decorateFindings } from '../src/catalogue/decorate.js';
import { foreignExpectRows } from '../src/catalogue/foreign-expect.js';
import { DOCS_URLS } from '../src/catalogue/table.js';
import { EXCERPT_LINE_CAP, EXCERPT_MAX_LINES, excerptAt } from '../src/excerpt.js';
import { buildView, headlineText, NOISE_BUDGET } from '../src/report-view.js';
import { formatText } from '../src/formatters/text.js';
import { formatMarkdown } from '../src/formatters/markdown.js';
import { formatReport } from '../src/formatters/report.js';
import { formatSarif } from '../src/formatters/sarif.js';
import { formatJson } from '../src/formatters/json.js';
import type { Finding, ScoreResult, TestStateEntry } from '../src/types.js';

function packageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'bin'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('package root not found');
}
const root = packageRoot();
const R11 = ['title', 'what', 'why', 'fix', 'excerpt', 'tier', 'confidence', 'basis', 'evidence', 'form'] as const;

function f(over: Partial<Finding>): Finding {
  return { rule: 'playwright/no-wait-for-timeout', severity: 'error', message: 'm', file: 'a.spec.ts', line: 1, dimension: 'playwrightHygiene', tier: 'likely', ...over };
}

function result(findings: Finding[], over: Partial<ScoreResult> = {}): ScoreResult {
  return {
    scoreVersion: 'v5',
    profile: 'standard',
    score: 90,
    grade: 'A',
    pass: true,
    threshold: 0,
    summary: { files: 1, tests: 10, sloc: 10, findings: findings.length, errors: 0, warnings: 0, nativeLocators: 0, rawLocators: 0, unassertedTests: 0, unverifiedTests: 0, cleanTests: 10 },
    dimensions: { playwrightHygiene: 90, assertions: 90, locators: 90, structure: 90 },
    findings,
    status: 'scored',
    ...over,
  } as ScoreResult;
}

const report = (r: ScoreResult, advice = false): string => formatReport(r, { date: '2026-11-24', version: 't', suiteName: 's', advice });

/** `n` single-finding likely groups, each its own rule, each in its own file. */
const groups = (n: number, tier: Finding['tier'] = 'likely'): Finding[] =>
  Array.from({ length: n }, (_, i) => f({ rule: `r/rule-${String(i).padStart(2, '0')}`, file: `f${i}.spec.ts`, tier, title: `Title ${i}` }));

describe('S10a R11 fields and excerpt', () => {
  it('every finding on the fixtures carries all ten R11 fields, every docs URL is listed, excerpts are 1-5 capped lines', async () => {
    const r = await scorePaths({ paths: [path.join(root, 'fixtures')] });
    assert.ok(r.findings.length > 20);
    for (const x of r.findings) {
      for (const k of R11) assert.ok(k in x && (x[k] !== undefined || k === 'confidence'), `${x.rule} ${x.file}:${x.line} lacks ${k}`);
      if (x.docs !== undefined) assert.ok(DOCS_URLS.includes(x.docs), `${x.docs} not in docs-urls.json`);
      const lines = x.excerpt!.split('\n');
      if (x.line) assert.ok(lines.length >= 1 && lines.length <= EXCERPT_MAX_LINES, `${x.rule}: ${lines.length} lines`);
      for (const l of lines) assert.ok(l.length <= EXCERPT_LINE_CAP);
    }
    const sarif = JSON.parse(formatSarif(r));
    for (const rule of sarif.runs[0].tool.driver.rules) if (rule.helpUri) assert.ok(DOCS_URLS.includes(rule.helpUri), rule.helpUri);
    assert.ok(sarif.runs[0].tool.driver.rules.some((x: { helpUri?: string }) => x.helpUri));
  });

  it('excerptAt: the line, plus lines while brackets stay open, at most 5, dedented and capped', () => {
    const src = ['  await expect(', '    page.locator("a(")', '  ).toBeVisible();', 'next();'];
    assert.equal(excerptAt(src, 1), 'await expect(\n  page.locator("a(")\n).toBeVisible();');
    assert.equal(excerptAt(src, 4), 'next();');
    assert.equal(excerptAt(['f({', 'a,', 'b,', 'c,', 'd,', 'e,', '});'], 1).split('\n').length, 5);
    assert.equal(excerptAt(['x // (', 'y'], 1), 'x // (');
    const long = 'x'.repeat(300);
    assert.equal(excerptAt([long], 1), 'x'.repeat(EXCERPT_LINE_CAP - 3) + '...');
    assert.equal(excerptAt(['a'], 0), '');
    assert.equal(excerptAt(['a'], 2), '');
    assert.equal(excerptAt(undefined, 1), '');
  });

  it('a synthetic finding on a non-spec helper file gets every R11 field and an excerpt from the run texts, never from disk', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's10a-helper-'));
    const helper = path.join(dir, 'pages', 'login.ts');
    fs.mkdirSync(path.dirname(helper));
    const text = 'export async function login(page) {\n  await page.waitForTimeout(500);\n}\n';
    fs.writeFileSync(helper, text);
    const shared = f({ file: 'pages/login.ts', line: 2, scope: 'shared', usedBy: ['a.spec.ts'], tier: undefined, form: undefined });
    decorateFindings([shared], dir, new Map([[helper, text]]));
    for (const k of R11) assert.ok(k in shared, k);
    assert.equal(shared.excerpt, 'await page.waitForTimeout(500);');
    // The same file on disk but not in the run texts: no read, empty excerpt.
    const unread = f({ file: 'pages/login.ts', line: 2, scope: 'shared', tier: undefined, form: undefined });
    decorateFindings([unread], dir, new Map());
    assert.equal(unread.excerpt, '');
    assert.ok(unread.title && unread.fix);
  });

  it('the run passes its texts on: a pwscore/unasserted finding added by the test states has its excerpt', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's10a-run-'));
    fs.writeFileSync(path.join(dir, 'a.spec.ts'), "import { test } from '@playwright/test';\ntest('t', async ({ page }) => {\n  await page.goto('/');\n});\n");
    const r = await scorePaths({ paths: [dir] });
    const u = r.findings.find((x) => x.rule === 'pwscore/unasserted');
    assert.ok(u, 'unasserted finding');
    assert.equal(u!.excerpt, "test('t', async ({ page }) => {\n  await page.goto('/');\n});");
  });
});

describe('S10a noise budget (AC-8)', () => {
  it('locations per group: 3 shown at the edge, the 4th becomes "+ 1 more"', () => {
    const three = Array.from({ length: 3 }, (_, i) => f({ line: i + 1, file: `g${i}.spec.ts` }));
    assert.equal(buildView(result(three)).groups[0]!.more, 0);
    const four = Array.from({ length: 4 }, (_, i) => f({ line: i + 1, file: `g${i}.spec.ts` }));
    const g = buildView(result(four)).groups[0]!;
    assert.equal(g.shown.length, NOISE_BUDGET.perGroup);
    assert.equal(g.more, 1);
    assert.match(formatText(result(four)), /\+ 1 more/);
  });

  it('locations per file: 5 shown across groups, the 6th from the same file is counted, not shown', () => {
    const five = groups(5).map((x) => ({ ...x, file: 'one.spec.ts' }));
    assert.ok(buildView(result(five)).groups.every((g) => g.shown.length === 1));
    const six = groups(6).map((x) => ({ ...x, file: 'one.spec.ts' }));
    const v = buildView(result(six));
    assert.equal(v.groups.reduce((n, g) => n + g.shown.length, 0), NOISE_BUDGET.perFile);
    assert.equal(v.groups[5]!.more, 1);
  });

  it('groups per run: 15 shown, the 16th becomes "1 more issue type"; JSON keeps every finding', () => {
    assert.equal(buildView(result(groups(15))).moreGroups, 0);
    assert.doesNotMatch(formatText(result(groups(15))), /more issue type/);
    const r16 = result(groups(16));
    assert.equal(buildView(r16).groups.length, NOISE_BUDGET.groups);
    assert.match(formatText(r16), /\+ 1 more issue type \(1 finding\)/);
    assert.equal(JSON.parse(formatJson(r16)).findings.length, 16);
    assert.equal(JSON.parse(formatSarif(r16)).runs[0].results.length, 16);
  });

  it('groups in the markdown comment: 10 shown, the 11th becomes "And 1 more issue type"', () => {
    assert.doesNotMatch(formatMarkdown(result(groups(10))), /more issue type/);
    const md = formatMarkdown(result(groups(11)));
    assert.match(md, /And 1 more issue type/);
    assert.equal((md.match(/^- \*\*/gm) ?? []).length, NOISE_BUDGET.markdownGroups);
  });
});

describe('S10a views per tier', () => {
  const fe = foreignExpectRows[0]!;
  const advisoryFindings = (): Finding[] => {
    const foreign = f({ rule: fe.rule, form: 'foreign-expect', tier: undefined, file: 'b.spec.ts', line: 3 });
    const api = f({ rule: 'pwscore/api-under-test', form: 'api-call', tier: 'advisory', title: 'API call under test', file: 'c.spec.ts', line: 4 });
    decorateFindings([foreign], undefined);
    return [foreign, api];
  };

  it('advisory findings (foreign-expect and a synthetic api-under-test) are hidden by tier without --advice and shown with it', () => {
    const adv = advisoryFindings();
    assert.equal(adv[0]!.tier, 'advisory');
    const r = result([f({ tier: 'certain', title: 'Fixed wait', file: 'a.spec.ts' }), ...adv]);
    for (const [name, out, outAdvice] of [
      ['text', formatText(r), formatText(r, { advice: true })],
      ['markdown', formatMarkdown(r), formatMarkdown(r, { advice: true })],
      ['report', report(r), report(r, true)],
    ] as const) {
      assert.ok(!out.includes('c.spec.ts') && !out.includes('b.spec.ts'), `${name} hides advisory`);
      assert.match(out, /Advisory: 2 findings hidden\. Run with --advice to show them\./, name);
      assert.ok(outAdvice.includes('c.spec.ts') && outAdvice.includes('b.spec.ts'), `${name} shows advisory with --advice`);
    }
    const levels = JSON.parse(formatSarif(r)).runs[0].results.map((x: { level: string }) => x.level);
    assert.deepEqual(levels, ['error', 'note', 'note']);
  });

  it('certain is the first section, likely is "Worth a look"; SARIF certain=error, likely=warning, needs-check=note', () => {
    const r = result([f({ tier: 'likely', rule: 'r/l', title: 'L' }), f({ tier: 'certain', rule: 'r/c', title: 'C' }), f({ tier: 'needs-check', rule: 'r/n', message: 'helper could not be read', file: 'n.spec.ts', line: 7 })]);
    const t = formatText(r);
    assert.ok(t.indexOf('Certain issues') < t.indexOf('Worth a look'));
    assert.match(t, /Not decided automatically: 1 finding in 1 file, run with --advice for the reasons\./);
    assert.ok(!t.includes('helper could not be read'));
    assert.match(formatText(r, { advice: true }), /n\.spec\.ts:7: helper could not be read/);
    assert.deepEqual(JSON.parse(formatSarif(r)).runs[0].results.map((x: { level: string }) => x.level), ['warning', 'error', 'note']);
  });

  it('build-state findings stay visible through the status lines, whatever the budget', () => {
    const parse = f({ rule: 'playwright-score/parse-error', tier: 'likely', file: 'broken.spec.ts', line: 9 });
    const r = result([...groups(20), parse], { status: 'partial', coverage: { filesFound: 21, filesScored: 20, testsCounted: 10, skipped: [{ file: 'broken.spec.ts', reason: 'parse-error' }] } });
    const t = formatText(r);
    assert.match(t, /Syntax error \(1 file, not scored\): broken\.spec\.ts:9\./);
    assert.match(t, /Partial: 1 of 21 files skipped/);
    assert.match(formatMarkdown(r), /Syntax error \(1 file, not scored\): broken\.spec\.ts:9\./);
  });

  it('not-scored names its reason; the outside-any-test list is shown', () => {
    const ns = result([], { status: 'not-scored', reason: 'no-counted-tests', summary: { ...result([]).summary, tests: 0 } });
    const lines = formatText(ns).split('\n');
    assert.match(lines[1]!, /^Not scored: no test could be counted/);
    assert.match(formatMarkdown(ns), /Not scored: no test could be counted/);
    const r = result([f({ tier: 'certain', line: 2 })], { outsideTests: [{ rule: 'playwright/no-wait-for-timeout', file: 'a.spec.ts', line: 2 }] });
    assert.match(formatText(r), /Outside any test \(they charge no test\): 1 certain finding: a\.spec\.ts:2\./);
  });
});

describe('S10a headline', () => {
  const st = (i: number, state: TestStateEntry['state'], chargedBy?: TestStateEntry['chargedBy']): TestStateEntry => ({
    file: 'a.spec.ts',
    testKey: `a.spec.ts#${i}`,
    line: i + 1,
    state,
    ...(chargedBy ? { chargedBy } : {}),
  });

  it('the ADR example shape, with the score on line 2', () => {
    const pr = f({ tier: 'certain', family: 'passes-regardless', rule: 'r/pr', line: 1 });
    const fl = f({ tier: 'certain', family: 'flake-risk', rule: 'r/fl', line: 2 });
    const ref = (x: Finding) => [{ rule: x.rule, form: x.form, file: x.file, line: x.line, column: x.column }];
    const states = [st(0, 'issue', ref(pr)), st(1, 'issue', ref(fl)), st(2, 'unasserted'), st(3, 'clean'), st(4, 'clean')];
    const sh1 = f({ scope: 'shared', tier: 'certain', quotable: true, file: 'pages/p.ts', usedBy: ['a.spec.ts', 'b.spec.ts'] });
    const sh2 = f({ scope: 'shared', tier: 'certain', quotable: true, file: 'pages/q.ts', usedBy: ['b.spec.ts', 'c.spec.ts'] });
    const shLikely = f({ scope: 'shared', tier: 'likely', file: 'pages/r.ts', usedBy: ['d.spec.ts'] });
    const shBc = f({ scope: 'shared', tier: 'certain', quotable: false, file: 'pages/s.ts', usedBy: ['e.spec.ts'] });
    const r = result([pr, fl, sh1, sh2, shLikely, shBc], { testStates: states, summary: { ...result([]).summary, tests: 5 } });
    const want = '5 tests. 3 have no certain issue. 1 would pass whatever the app does. 1 has flake risk. 1 has no assertion. 2 certain issues in shared code (used by 3 spec files).';
    assert.equal(headlineText(r), want);
    const lines = formatText(r).split('\n');
    assert.equal(lines[0], want);
    assert.match(lines[1]!, /^Score 90\/100 \(A\)/);
    const md = formatMarkdown(r).split('\n');
    assert.equal(md[0], `**${want}**`);
    assert.match(md[1]!, /^Score \*\*90\/100 \(A\)\*\*/);
    // The likely shared finding shows only under "Worth a look".
    assert.ok(formatText(r).split('Worth a look')[1]!.includes('pages/r.ts'));
  });

  it('leaves out every clause whose count is 0', () => {
    const r = result([], { testStates: [st(0, 'clean'), st(1, 'clean')], summary: { ...result([]).summary, tests: 2 } });
    assert.equal(headlineText(r), '2 tests. 2 have no certain issue.');
    const pr = f({ tier: 'certain', family: 'passes-regardless' });
    const all = result([pr], { testStates: [st(0, 'issue', [{ rule: pr.rule, file: pr.file, line: pr.line }])], summary: { ...result([]).summary, tests: 1 } });
    assert.equal(headlineText(all), '1 test. 1 would pass whatever the app does.');
    assert.equal(headlineText(result([], { summary: { ...result([]).summary, tests: 3 } })), '3 tests.');
  });
});
