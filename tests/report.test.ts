import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scorePaths } from '../src/index.js';
import { ESLINT_RULE_MAP } from '../src/profiles.js';
import { RULE_COPY } from '../src/rule-copy.js';
import { confidenceOf, CONFIDENCE_LABEL } from '../src/confidence.js';
import { suiteLabel } from '../src/suite-name.js';
import { gradeBandText } from '../src/report-model.js';
import { formatReport, rankTopFindings, escapeHtml } from '../src/formatters/report.js';
import { makeSourceReader } from '../src/report-source.js';
import os from 'node:os';
import { formatText } from '../src/formatters/text.js';
import type { Finding, ScoreResult } from '../src/types.js';

function packageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'bin'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('package root not found');
}
const root = packageRoot();
const fixtures = path.join(root, 'fixtures');
const goldenFile = path.join(root, 'tests', 'golden', 'fixtures-report.html');

function finding(over: Partial<Finding>): Finding {
  return {
    rule: 'playwright/no-wait-for-timeout',
    severity: 'error',
    message: 'm',
    file: 'a.spec.ts',
    line: 1,
    dimension: 'playwrightHygiene',
    ...over,
  };
}

function fakeResult(findings: Finding[]): ScoreResult {
  return {
    scoreVersion: 'v4',
    profile: 'standard',
    score: 61,
    grade: 'D',
    pass: false,
    threshold: 80,
    summary: {
      files: 2, tests: 10, sloc: 100, findings: findings.length, errors: 0, warnings: 0,
      nativeLocators: 0, rawLocators: 0, unassertedTests: 0, unverifiedTests: 0, cleanTests: 4,
    },
    dimensions: { playwrightHygiene: 50, assertions: 70, locators: 60, structure: 90 },
    findings,
  };
}

describe('rule copy', () => {
  it('has an entry (title, why, fix) for every rule in profiles.ts', () => {
    for (const rule of Object.keys(ESLINT_RULE_MAP)) {
      const c = RULE_COPY[rule];
      assert.ok(c, `no plain-English copy for rule ${rule} (add it to src/rule-copy.ts)`);
      assert.ok(c.title && c.why && c.fix, `incomplete copy for ${rule}`);
    }
  });
});

describe('confidence and ranking', () => {
  it('maps the hand-checked tiers and treats non-locator report-only findings as needs-check', () => {
    assert.equal(confidenceOf(finding({ rule: 'playwright/no-networkidle' })), 'high');
    assert.equal(confidenceOf(finding({ rule: 'playwright/no-force-option' })), 'medium');
    assert.equal(
      confidenceOf(finding({ rule: 'playwright/expect-expect', dimension: 'assertions', reportOnly: true })),
      'needs-check'
    );
    // locator rules are report-only because the ratio owns their score: ordinary findings
    assert.equal(
      confidenceOf(finding({ rule: 'playwright/no-raw-locators', dimension: 'locators', reportOnly: true })),
      'medium'
    );
  });

  it('ranks by severity, then confidence, then tests affected', () => {
    const findings: Finding[] = [
      // warning, high
      finding({ rule: 'playwright/no-page-pause', severity: 'warning' }),
      // error, medium, 1 test
      finding({ rule: 'playwright/no-force-option', testKey: 'a#0', scope: 'test' }),
      // error, medium, 3 tests
      finding({ rule: 'playwright/no-wait-for-selector', testKey: 'a#0', scope: 'test' }),
      finding({ rule: 'playwright/no-wait-for-selector', testKey: 'a#1', scope: 'test', line: 2 }),
      finding({ rule: 'playwright/no-wait-for-selector', testKey: 'a#2', scope: 'test', line: 3 }),
      // error, high, 1 test
      finding({ rule: 'playwright/missing-playwright-await', testKey: 'a#0', scope: 'test' }),
    ];
    const order = rankTopFindings(findings).map((g) => g.rule);
    assert.deepEqual(order, [
      'playwright/missing-playwright-await',
      'playwright/no-wait-for-selector',
      'playwright/no-force-option',
      'playwright/no-page-pause',
    ]);
  });

  it('never puts a needs-check finding in Top findings, and caps at 5', () => {
    const findings: Finding[] = [
      finding({ rule: 'playwright/expect-expect', dimension: 'assertions', reportOnly: true }),
      ...['playwright/no-networkidle', 'playwright/no-page-pause', 'playwright/no-focused-test',
        'playwright/no-force-option', 'playwright/no-wait-for-selector', 'pwscore/no-timer-sleep',
      ].map((rule) => finding({ rule })),
    ];
    const top = rankTopFindings(findings);
    assert.equal(top.length, 5);
    assert.ok(!top.some((g) => g.rule === 'playwright/expect-expect'));
  });

  it('groups the terminal output by rule, worst first, with a per-rule cap and relative paths', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      finding({ rule: 'playwright/no-force-option', file: `dir/sub/f${i}.spec.ts`, line: i + 1, testKey: `t${i}`, scope: 'test' })
    );
    const r = fakeResult([
      ...many,
      finding({ rule: 'playwright/no-networkidle', file: '/abs/leak/z.spec.ts', line: 9 }),
      finding({ rule: 'playwright/no-force-option', severity: 'warning', file: 'a.spec.ts' }),
    ]);
    const text = formatText(r, { suiteName: 'my/suite', version: '9.9.9' });
    const lines = text.split('\n');
    assert.match(lines[0]!, /^my\/suite {2}· {2}10 tests in 2 files$/);
    assert.match(lines[1]!, /^Score 61\/100 \(D\) {2}· {2}FAIL \(bar 80\) {2}· {2}4 tests have no issues$/);
    assert.match(lines[2]!, /^Reliability 50 · Checks 70 · Resilience to UI changes 60 · Maintainability 90$/);
    // networkidle is high confidence, so it leads; the force rule has 13 findings in one group
    const idle = text.indexOf('Waiting for the network to go quiet');
    const force = text.indexOf('Click forced past a blocking element');
    assert.ok(idle > 0 && idle < force, 'worst group first');
    assert.match(text, /13 in 13 tests {3}Likely|13 in \d+ tests {3}Likely/);
    assert.equal((text.match(/dir\/sub\/f\d+\.spec\.ts/g) ?? []).length, 3, 'three locations per rule');
    assert.ok(text.includes('+ 10 more'));
    assert.ok(!text.includes('/abs/leak'), 'an absolute path must never reach the terminal');
    assert.ok(text.includes('leak/z.spec.ts:9'));
    assert.ok(!/playwrightHygiene|\[error\]/.test(text));
    assert.ok(text.trimEnd().split('\n').slice(-2)[0]!.startsWith('Score 61/100 (D)'), 'verdict repeats at the bottom');
    assert.ok(text.includes('playwright-score 9.9.9 (rules v4)'));
  });

  it('caps terminal groups at 10 and says how to see the rest', () => {
    const rules = Object.keys(RULE_COPY).filter((x) => x !== 'playwright-score/assertion-unverified').slice(0, 14);
    const text = formatText(fakeResult(rules.map((rule) => finding({ rule }))));
    assert.ok(text.includes('+ 4 more issue types. Full list: npx pwscore <path> --format report --out report.html'));
    assert.equal(text.split('\n').filter((l) => /^ {1,2}\d+\. /.test(l)).length, 10);
  });
});

describe('report escaping', () => {
  it('escapes HTML in source excerpts, paths, suite name and messages (spec files are untrusted)', () => {
    const evil = '<script>alert(1)</script>';
    const r = fakeResult([
      finding({ file: `e2e/<img src=x onerror=1>.spec.ts`, line: 2, message: evil }),
      finding({ rule: 'playwright/expect-expect', dimension: 'assertions', reportOnly: true, message: evil, file: 'b.spec.ts' }),
    ]);
    const html = formatReport(r, {
      date: '2026-01-01',
      version: '0.0.0',
      suiteName: '"><script>x</script>',
      readSource: () => `line1\nawait page.waitForTimeout(1); // ${evil}\nline3`,
    });
    assert.ok(!html.includes('<script'), 'raw <script> leaked into the report');
    assert.ok(!html.includes('<img'), 'raw <img> leaked into the report');
    assert.ok(html.includes(escapeHtml(evil)));
    assert.ok(html.includes('class="ln hit"'));
    assert.ok(!html.includes('<script') && html.includes('&quot;&gt;&lt;script&gt;x&lt;/script&gt;'), 'suite name is escaped');
  });
});

describe('report golden (fixtures/)', () => {
  it('matches the checked-in golden file (UPDATE_GOLDEN=1 regenerates it)', async () => {
    const result = await scorePaths({ paths: [fixtures], cwd: root });
    const html = formatReport(result, {
      date: '2026-11-14',
      version: '0.0.0-test',
      suiteName: 'fixtures',
      readSource: makeSourceReader([fixtures], root, result.baseDir),
    });
    if (process.env.UPDATE_GOLDEN === '1') {
      fs.mkdirSync(path.dirname(goldenFile), { recursive: true });
      fs.writeFileSync(goldenFile, html, 'utf8');
    }
    assert.equal(html, fs.readFileSync(goldenFile, 'utf8'));
    assert.ok(result.baseDir, 'scorePaths should record baseDir');
    assert.ok(!html.includes(result.baseDir!), 'local absolute path leaked into the report');
    // Code excerpts show customer source, which may contain URL strings; only markup outside them can link out.
    const markup = html.replace(/<pre class="code"[\s\S]*?<\/pre>/g, '');
    assert.ok(!markup.includes('http://') && !markup.includes('https://'), 'report must have no external links');
    assert.ok(!/<script|<link|@import|url\(/i.test(html), 'report must be self-contained');
  });
});

describe('report robustness (QAG-288 slice 1b)', () => {
  const opts = { date: '2026-01-01', version: '0.0.0', suiteName: 's' };

  it('renders a rule with no copy entry using a generic title instead of throwing', () => {
    const html = formatReport(fakeResult([finding({ rule: 'pwscore/not-written-yet' })]), opts);
    assert.ok(html.includes('Other quality issue'));
  });

  it('shows the unverified count in the headline area', () => {
    const r = fakeResult([]);
    r.summary.unverifiedTests = 3;
    assert.ok(formatReport(r, opts).includes('3 tests are not decided automatically and are left out of the score: a person should look.'));
    r.summary.unverifiedTests = 0;
    assert.ok(!formatReport(r, opts).includes('left out of the score.'));
  });

  it('tiers assertion-unverified as needs-check', () => {
    const f = finding({ rule: 'playwright-score/assertion-unverified', dimension: 'assertions', severity: 'info', reportOnly: true });
    assert.equal(confidenceOf(f), 'needs-check');
  });

  it('reads excerpts from baseDir, not the first suffix match, and refuses escapes', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pwscore-src-'));
    try {
      fs.mkdirSync(path.join(tmp, 'a', 'e2e'), { recursive: true });
      fs.mkdirSync(path.join(tmp, 'z', 'e2e'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'a', 'e2e', 'x.spec.ts'), 'WRONG');
      fs.writeFileSync(path.join(tmp, 'z', 'e2e', 'x.spec.ts'), 'RIGHT');
      fs.writeFileSync(path.join(tmp, 'secret.txt'), 'SECRET');
      const base = path.join(tmp, 'z');
      const read = makeSourceReader([tmp], tmp, base);
      assert.equal(read('e2e/x.spec.ts'), 'RIGHT');
      assert.equal(read('../secret.txt'), undefined);
      assert.equal(read(path.join(tmp, 'secret.txt')), undefined);
      assert.equal(makeSourceReader([tmp], tmp)('e2e/x.spec.ts'), 'WRONG', 'fallback search still works without baseDir');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('baseDir and --name (QAG-288)', () => {
  it('keeps baseDir in memory but never in json, sarif, markdown, text or report output', async () => {
    const root = packageRoot();
    const result = await scorePaths({ paths: [path.join(root, 'fixtures', 'gold.spec.ts')] });
    assert.ok(result.baseDir && path.isAbsolute(result.baseDir), 'baseDir stays on the in-memory result');
    const { formatJson } = await import('../src/formatters/json.js');
    const { formatMarkdown } = await import('../src/formatters/markdown.js');
    const { formatSarif } = await import('../src/formatters/sarif.js');
    const outputs = {
      json: formatJson(result),
      markdown: formatMarkdown(result),
      sarif: formatSarif(result),
      text: formatText(result),
      report: formatReport(result, {
        date: '2026-01-01',
        version: 'x',
        suiteName: 'suite',
        readSource: makeSourceReader([path.join(root, 'fixtures')], process.cwd(), result.baseDir),
      }),
    };
    for (const [k, v] of Object.entries(outputs)) {
      assert.ok(!v.includes(result.baseDir!), `${k} output leaks baseDir`);
    }
    assert.ok(!('baseDir' in JSON.parse(outputs.json)));
  });

  it('--name sets the report headline; a file keeps its basename', async () => {
    const { execFile } = await import('node:child_process');
    const run = (extra: string[]) =>
      new Promise<string>((resolve, reject) =>
        execFile(
          process.execPath,
          [path.join(packageRoot(), 'dist', 'cli.js'), path.join(packageRoot(), 'fixtures', 'gold.spec.ts'), '--format', 'report', ...extra],
          { maxBuffer: 10_000_000 },
          (err, stdout) => (stdout ? resolve(stdout) : reject(err))
        )
      );
    assert.match(await run(['--name', 'My Suite']), /<p class="suite">My Suite<\/p>/);
    assert.match(await run([]), /<p class="suite">gold\.spec\.ts<\/p>/);
  });
});

describe('report polish (QAG-288 slice 3b)', () => {
  const opts = { date: '2026-11-14', version: '2.3.0', suiteName: 'acme/e2e-tests/playwright' };
  const five = ['playwright/no-networkidle', 'playwright/no-wait-for-timeout', 'playwright/no-page-pause', 'playwright/no-focused-test', 'playwright/missing-playwright-await'];
  const html = formatReport(
    fakeResult(five.map((rule, i) => finding({ rule, file: `e2e/f${i}.spec.ts`, line: 3 }))),
    { ...opts, readSource: () => 'a\nb\nawait page.waitForTimeout(1);\nc' }
  );
  const summary = html.slice(html.indexOf('<section class="summary">'), html.indexOf('<section class="details">'));
  const details = html.slice(html.indexOf('<section class="details">'));

  it('splits into a Summary and a Details part; the summary has three findings and no code', () => {
    assert.ok(summary && details.includes('<h2>Details</h2>'));
    assert.equal((summary.match(/<li class="top">/g) ?? []).length, 3);
    assert.ok(!summary.includes('<pre'), 'no code excerpt in the summary');
    assert.ok(details.includes('<pre class="code"'), 'excerpts live in Details');
    assert.equal((details.match(/<article class="finding/g) ?? []).length, 5);
    assert.ok(summary.includes('<h2>Score by area</h2>') && summary.includes('<h2>What to do next</h2>'));
    assert.match(html, /\.details\{break-before:page\}/);
    assert.ok(!html.includes('Flake risk'), 'the duplicate flake table is gone');
    assert.ok(summary.includes('Definite: the code does this for certain.'));
  });

  it('explains the score and uses plain labels', () => {
    assert.match(html, /<p class="explain">A weighted average of four areas below\. D means 60-69; C starts at 70\. Below the default bar of 80\.<\/p>/);
    assert.ok(html.includes('tests have no issues.'));
    assert.ok(!html.includes('are clean'));
    assert.ok(html.includes('<span class="sr-only">Score 61 out of 100, grade D. </span>'));
    assert.ok(html.includes('Resilience to UI changes') && html.includes('40% of score'));
    assert.equal(gradeBandText('B', true), 'B means 80-89; A is 90 and up.');
    assert.equal(gradeBandText('A', true), 'A means 90-100.');
    assert.equal(gradeBandText('F', false), 'F means below 60; D starts at 60.');
    assert.match(formatReport(fakeResult([]), { ...opts, customThreshold: true }), /Below your bar of 80\./);
  });

  it('labels confidence Definite / Likely / Not decided automatically with neutral tags', () => {
    assert.deepEqual(CONFIDENCE_LABEL, { high: 'Definite', medium: 'Likely', 'needs-check': 'Not decided automatically' });
    assert.ok(summary.includes('<span class="tag">Definite</span>'));
    assert.ok(!/high confidence|medium confidence/.test(html));
    assert.ok(!/\.tag\.(high|medium)/.test(html), 'no green/amber tag colours');
    const likely = formatReport(fakeResult([finding({ rule: 'playwright/no-force-option' })]), opts);
    assert.ok(likely.includes('<span class="tag">Likely</span>'));
  });

  it('shows the most affected file on each top finding', () => {
    const r = fakeResult([
      finding({ file: 'dir/a.spec.ts', line: 4 }),
      finding({ file: 'dir/b.spec.ts', line: 7 }),
      finding({ file: 'dir/b.spec.ts', line: 9 }),
    ]);
    assert.match(formatReport(r, opts), /3 places in 2 tests\. Most in <code>b\.spec\.ts<\/code> \(line 7\)\./);
  });

  it('shows "Not scored" for a syntax error and hides the zero bars and test count', () => {
    const r = fakeResult([
      finding({ rule: 'playwright-score/parse-error', file: 'bad.spec.ts', line: 5, severity: 'error' }),
      finding({ rule: 'playwright/expect-expect', dimension: 'assertions' }),
    ]);
    r.score = 0; r.grade = 'F'; r.summary.tests = 0; r.summary.files = 49;
    r.dimensions = { playwrightHygiene: 0, assertions: 0, locators: 0, structure: 0 };
    const h = formatReport(r, opts);
    assert.ok(h.includes('1 file has a syntax error, so this suite could not be scored.'));
    assert.ok(h.includes('Not scored') && h.includes('<span class="big">--</span>'));
    assert.ok(!h.includes('Score by area') && !h.includes('class="bar"'));
    assert.ok(!/0\/100|>F</.test(h) && !h.includes('0 tests') && h.includes('49 files'));
    assert.ok(!h.includes('weighted average'));
    const t = formatText(r, { suiteName: 's' });
    assert.ok(t.includes('Not scored: 1 file has a syntax error.') && !t.includes('0/100') && !t.includes('0 tests'));
  });

  it('shows "Not scored" and nothing else for a suite with no tests', () => {
    const r = fakeResult([]);
    r.summary.tests = 0; r.summary.cleanTests = 0;
    const h = formatReport(r, opts);
    assert.ok(h.includes('No Playwright tests were found.') && h.includes('Not scored'));
    assert.ok(!/<h2>/.test(h), 'no sections');
    assert.ok(h.includes('<footer>'));
  });

  it('uses "can", not "will", and never "proves" in rule copy', () => {
    for (const [rule, c] of Object.entries(RULE_COPY)) {
      assert.ok(!/\bwill\b|\bproves?\b/i.test(c.why + c.fix), `overclaim in ${rule}`);
    }
    assert.ok(RULE_COPY['playwright/no-networkidle']!.why.includes('can time out at random'));
  });

  it('falls back to the last path segments for a generic suite folder, never the home dir or absolute path', () => {
    assert.equal(suiteLabel('/w/mattermost/e2e-tests/playwright', true, '/nohome'), 'mattermost/e2e-tests/playwright');
    assert.equal(suiteLabel('/w/acme/web-app', true, '/nohome'), 'acme/web-app');
    assert.equal(suiteLabel('/w/acme/web-app/a.spec.ts', false), 'a.spec.ts');
    assert.equal(suiteLabel('/home/u/playwright', true, '/home/u'), 'playwright');
    assert.equal(suiteLabel('/home/u/proj/playwright', true, '/home/u'), 'proj/playwright');
  });

  it('never leaks a user name, whatever $HOME says (QAG-287 fix round 2)', () => {
    for (const home of ['/root', '/nohome', '']) {
      assert.equal(suiteLabel('/tmp/home/alice/e2e', true, home), 'e2e');
      assert.equal(suiteLabel('/home/alice/e2e', true, home), 'e2e');
      assert.equal(suiteLabel('/Users/alice/proj/e2e', true, home), 'proj/e2e');
      assert.equal(suiteLabel('/Users/alice', true, home), 'Playwright suite');
      assert.equal(suiteLabel('/home/alice', true, home), 'Playwright suite');
    }
    assert.equal(suiteLabel('/root', true, '/root'), 'Playwright suite');
    assert.equal(suiteLabel('/root/proj/e2e', true, '/root'), 'proj/e2e');
    assert.equal(suiteLabel('/w/acme/web-app', true, '/root'), 'acme/web-app');
  });
});
