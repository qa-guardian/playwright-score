import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scorePaths } from '../src/index.js';
import { ESLINT_RULE_MAP } from '../src/profiles.js';
import { RULE_COPY } from '../src/rule-copy.js';
import { confidenceOf, sortFindings } from '../src/confidence.js';
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

  it('sorts the flat text output by severity then confidence', () => {
    const r = fakeResult([
      finding({ rule: 'playwright/no-force-option', severity: 'warning', file: 'a.spec.ts' }),
      finding({ rule: 'playwright/no-force-option', severity: 'error', file: 'z.spec.ts' }),
      finding({ rule: 'playwright/no-networkidle', severity: 'error', file: 'z.spec.ts', line: 9 }),
    ]);
    const sorted = sortFindings(r.findings).map((f) => `${f.severity}:${f.rule}`);
    assert.deepEqual(sorted, [
      'error:playwright/no-networkidle',
      'error:playwright/no-force-option',
      'warning:playwright/no-force-option',
    ]);
    const text = formatText(r);
    assert.ok(text.indexOf('no-networkidle') < text.indexOf('[warning]'));
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
    assert.ok(!html.includes('http://') && !html.includes('https://'), 'report must have no external links');
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
    assert.ok(formatReport(r, opts).includes('3 tests need a human check, not counted in the score.'));
    r.summary.unverifiedTests = 0;
    assert.ok(!formatReport(r, opts).includes('human check, not counted'));
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
