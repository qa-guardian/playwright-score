import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeScore,
  locatorsScore,
  gradeFromScore,
  applyPerRuleCap,
  penaltyDimensionScore,
  SQS_V1,
} from '../src/score-engine.js';
import type { Finding } from '../src/types.js';
import { countSloc } from '../src/sloc.js';

describe('sqs-v1 constants', () => {
  it('exposes frozen version and constants', () => {
    assert.equal(SQS_V1.scoreVersion, 'sqs-v1');
    assert.equal(SQS_V1.K, 0.4);
    assert.equal(SQS_V1.SLOT_DIVISOR, 25);
    assert.equal(SQS_V1.MIN_SLOTS, 4);
    assert.equal(SQS_V1.MAX_FINDINGS_PER_RULE_PER_FILE, 3);
  });
});

describe('locatorsScore', () => {
  it('returns 100 when no locators', () => {
    assert.equal(locatorsScore(0, 0), 100);
  });
  it('computes native ratio', () => {
    assert.equal(locatorsScore(2, 8), 20);
    assert.equal(locatorsScore(10, 0), 100);
  });
});

describe('gradeFromScore', () => {
  it('maps bands', () => {
    assert.equal(gradeFromScore(95), 'A');
    assert.equal(gradeFromScore(80), 'B');
    assert.equal(gradeFromScore(70), 'C');
    assert.equal(gradeFromScore(60), 'D');
    assert.equal(gradeFromScore(10), 'F');
  });
});

describe('applyPerRuleCap', () => {
  it('caps to 3 per file+rule for penalties', () => {
    const findings: Finding[] = Array.from({ length: 10 }, (_, i) => ({
      rule: 'playwright/no-wait-for-timeout',
      severity: 'error' as const,
      message: 'x',
      file: '/a.spec.ts',
      line: i + 1,
      dimension: 'playwrightHygiene' as const,
    }));
    assert.equal(applyPerRuleCap(findings).length, 3);
  });

  it('skips reportOnly findings', () => {
    const findings: Finding[] = [
      {
        rule: 'playwright/no-raw-locators',
        severity: 'warning',
        message: 'x',
        file: '/a.spec.ts',
        dimension: 'locators',
        reportOnly: true,
      },
    ];
    assert.equal(applyPerRuleCap(findings).length, 0);
  });
});

describe('penaltyDimensionScore worked examples', () => {
  it('tiny file 1 error → ~90 hygiene', () => {
    const findings: Finding[] = [
      {
        rule: 'playwright/no-wait-for-timeout',
        severity: 'error',
        message: 'wait',
        file: '/t.spec.ts',
        dimension: 'playwrightHygiene',
      },
    ];
    // slots = max(20/25, 4) = 4; load = 1/4 = 0.25; 100*e^(-0.1) ≈ 90.5
    const score = penaltyDimensionScore(findings, 'playwrightHygiene', 20);
    assert.ok(score >= 88 && score <= 92, `expected ~90 got ${score}`);
  });

  it('20 same warnings cap → high score on large file', () => {
    const findings: Finding[] = Array.from({ length: 20 }, (_, i) => ({
      rule: 'playwright/no-skipped-test',
      severity: 'warning' as const,
      message: 'skip',
      file: '/big.spec.ts',
      line: i + 1,
      dimension: 'structure' as const,
    }));
    const score = penaltyDimensionScore(findings, 'structure', 500);
    assert.ok(score >= 95, `expected high score with cap, got ${score}`);
  });
});

describe('countSloc', () => {
  it('strips blanks and comments', () => {
    const src = `
// header
/* block
   comment */

const x = 1;

// trailing
`;
    assert.equal(countSloc(src), 1);
  });
});

describe('computeScore clean', () => {
  it('perfect input scores 100', () => {
    const result = computeScore({
      profile: 'standard',
      threshold: 80,
      findings: [],
      sloc: 15,
      files: 1,
      tests: 1,
      nativeLocators: 5,
      rawLocators: 0,
    });
    assert.equal(result.score, 100);
    assert.equal(result.grade, 'A');
    assert.equal(result.pass, true);
    assert.equal(result.scoreVersion, 'sqs-v1');
  });

  it('is deterministic', () => {
    const input = {
      profile: 'standard' as const,
      threshold: 80,
      findings: [
        {
          rule: 'playwright/no-wait-for-timeout',
          severity: 'error' as const,
          message: 'x',
          file: '/a.ts',
          dimension: 'playwrightHygiene' as const,
        },
      ],
      sloc: 40,
      files: 1,
      tests: 1,
      nativeLocators: 3,
      rawLocators: 1,
    };
    const a = computeScore(input);
    const b = computeScore(input);
    assert.deepEqual(a, b);
  });
});
