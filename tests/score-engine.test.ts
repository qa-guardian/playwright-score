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
import { commonAncestorDir } from '../src/fs-util.js';
import {
  countLocators,
  findLocalAssertionHelperNames,
  looksLikeNonPlaywrightTest,
} from '../src/metrics.js';
import { collectLocallyImportedFiles } from '../src/import-graph.js';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

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

describe('commonAncestorDir', () => {
  it('returns the dirname for a single file', () => {
    const result = commonAncestorDir(['/repo/tests/a.spec.ts']);
    assert.equal(result, path.resolve('/repo/tests'));
  });

  it('finds the shared parent across sibling directories', () => {
    const result = commonAncestorDir([
      '/repo/tests/a/one.spec.ts',
      '/repo/tests/b/two.spec.ts',
    ]);
    assert.equal(result, path.resolve('/repo/tests'));
  });

  it('does not falsely match on a partial directory-name prefix', () => {
    // /repo/tests-extra must not be treated as under /repo/tests
    const result = commonAncestorDir([
      '/repo/tests/one.spec.ts',
      '/repo/tests-extra/two.spec.ts',
    ]);
    assert.equal(result, path.resolve('/repo'));
  });
});

describe('countLocators (AST-based)', () => {
  it('counts raw locators regardless of receiver (regression: regex only matched literal page/frame)', () => {
    const source = `
      class MyPage {
        get container() { return this.page.locator('.container'); }
        async submit() {
          const cell = this.container.locator('.row').locator('.cell');
          await cell.click();
        }
      }
    `;
    // this.page.locator(...) + this.container.locator(...) + chained .locator(...)
    const result = countLocators(source);
    assert.equal(result.raw, 3, `expected 3 raw locators, got ${result.raw}`);
    assert.equal(result.native, 0);
  });

  it('counts native locator methods regardless of receiver', () => {
    const source = `
      test('x', async ({ page }) => {
        await this.helper.getByRole('button').click();
        await page.getByLabel('name').fill('x');
      });
    `;
    const result = countLocators(source);
    assert.equal(result.native, 2);
    assert.equal(result.raw, 0);
  });

  it('returns zero counts (not a throw) for unparseable source', () => {
    const result = countLocators('this is not { valid js (((');
    assert.deepEqual(result, { native: 0, raw: 0 });
  });

  it('parses JSX in .tsx component-test files (regression: JSX disabled by default silently zeroed every count)', () => {
    const source = `
      test('counter increments', async ({ mount }) => {
        const component = await mount(<Counter />);
        await component.getByRole('button').click();
      });
    `;
    // Without file, JSX is off and this source fails to parse — falls back
    // to {0,0} rather than throwing.
    assert.deepEqual(countLocators(source), { native: 0, raw: 0 });
    // With a .tsx file, JSX must be enabled so the real call is counted.
    const result = countLocators(source, 'Counter.spec.tsx');
    assert.equal(result.native, 1, `expected 1 native locator, got ${result.native}`);
  });

  it('counts legacy page.click(selector)-style calls as raw (regression: classic anti-pattern was invisible to the ratio)', () => {
    const source = `
      page.click('#foo');
      page.dblclick('#bar');
      page.hover('#baz');
      page.check('#qux');
      page.uncheck('#quux');
      page.tap('#corge');
      page.focus('#grault');
    `;
    assert.equal(countLocators(source).raw, 7);
  });

  it('does not count locator.click()/locator.fill(value) (no selector argument) as raw', () => {
    const source = `
      await locator.click();
      await locator.fill('some value');
      await locator.click({ force: true });
    `;
    const result = countLocators(source);
    assert.equal(result.raw, 0, `expected 0 raw, got ${result.raw}`);
  });
});

describe('looksLikeNonPlaywrightTest', () => {
  it('does not flag a direct @playwright/test import', () => {
    assert.equal(
      looksLikeNonPlaywrightTest(`import { test, expect } from '@playwright/test';`),
      false
    );
  });

  it('does not flag a custom fixtures wrapper with an arbitrarily-named fixture (regression: real-world false negative)', () => {
    // test/expect re-exported from a local module (base.extend()) is a
    // very common real-world pattern, and the fixture the test destructures
    // can be named anything — not necessarily page/context/browser/request.
    // Verified against real production specs: an earlier "positively
    // detect Playwright" version of this check silently skipped 18 of 19
    // genuine specs in one real suite because their tests destructured a
    // custom fixture (e.g. `bomPage`) instead of the stock ones.
    assert.equal(
      looksLikeNonPlaywrightTest(
        `import { test, expect } from '../../src/shared/fixtures';\ntest('x', async ({ bomPage }, testInfo) => {});`
      ),
      false
    );
  });

  it('flags a plain Vitest unit test', () => {
    assert.ok(
      looksLikeNonPlaywrightTest(
        `import { describe, it, expect } from 'vitest';\ndescribe('add', () => { it('works', () => { expect(1).toBe(1); }); });`
      )
    );
  });

  it('flags a React Testing Library component test', () => {
    assert.ok(
      looksLikeNonPlaywrightTest(
        `import { render, screen } from '@testing-library/react';\ntest('x', () => { render(<Foo />); expect(screen.getByRole('button')).toBeInTheDocument(); });`
      )
    );
  });
});

describe('findLocalAssertionHelperNames', () => {
  it('finds a function declaration whose body contains expect(...)', () => {
    const source = `
      async function audit(page, path) {
        expect(true).toBe(true);
      }
    `;
    assert.deepEqual(findLocalAssertionHelperNames(source), ['audit']);
  });

  it('finds a const-bound arrow function whose body contains expect.poll(...)', () => {
    const source = `
      const checkFlashMessageVisibility = async (page, message) => {
        await expect.poll(() => page.isVisible(message)).toBe(true);
      };
    `;
    assert.deepEqual(findLocalAssertionHelperNames(source), ['checkFlashMessageVisibility']);
  });

  it('does not include a helper with no expect call in its body', () => {
    const source = `
      async function goToSettings(page) {
        await page.goto('/settings');
      }
    `;
    assert.deepEqual(findLocalAssertionHelperNames(source), []);
  });

  it('returns an empty list (not a throw) for unparseable source', () => {
    assert.deepEqual(findLocalAssertionHelperNames('this is not { valid js (((') , []);
  });
});

describe('collectLocallyImportedFiles', () => {
  function tmpDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-import-graph-'));
  }

  it('follows a relative import up out of a sibling tests/ dir into pages/ (regression: n8n-style POM was invisible to the locator ratio)', () => {
    const root = tmpDir();
    try {
      fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
      fs.mkdirSync(path.join(root, 'pages'), { recursive: true });
      const specFile = path.join(root, 'tests', 'canvas.spec.ts');
      const pageFile = path.join(root, 'pages', 'CanvasPage.ts');
      fs.writeFileSync(
        specFile,
        `import { CanvasPage } from '../pages/CanvasPage';\nexport const x = CanvasPage;\n`
      );
      fs.writeFileSync(
        pageFile,
        `export class CanvasPage {\n  addNode() { return this.page.getByTestId('add-node'); }\n}\n`
      );
      const sources = new Map([[specFile, fs.readFileSync(specFile, 'utf8')]]);
      const result = collectLocallyImportedFiles(sources, root);
      assert.ok(result.has(pageFile), `expected CanvasPage.ts to be discovered: ${[...result.keys()]}`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('never resolves outside the given boundary directory', () => {
    const root = tmpDir();
    try {
      fs.mkdirSync(path.join(root, 'inside', 'tests'), { recursive: true });
      fs.mkdirSync(path.join(root, 'outside'), { recursive: true });
      const specFile = path.join(root, 'inside', 'tests', 'x.spec.ts');
      fs.writeFileSync(specFile, `import { y } from '../../outside/y';\nexport const z = y;\n`);
      fs.writeFileSync(path.join(root, 'outside', 'y.ts'), `export const y = 1;\n`);
      const sources = new Map([[specFile, fs.readFileSync(specFile, 'utf8')]]);
      // Boundary is `inside/`, not `root` — the import climbs out of it.
      const result = collectLocallyImportedFiles(sources, path.join(root, 'inside'));
      assert.equal(result.size, 0, `expected nothing resolved outside the boundary: ${[...result.keys()]}`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('ignores bare/package import specifiers (never treated as local files)', () => {
    const root = tmpDir();
    try {
      const specFile = path.join(root, 'x.spec.ts');
      fs.writeFileSync(
        specFile,
        `import { test } from '@playwright/test';\nimport { helper } from 'some-package';\ntest('x', () => {});\n`
      );
      const sources = new Map([[specFile, fs.readFileSync(specFile, 'utf8')]]);
      const result = collectLocallyImportedFiles(sources, root);
      assert.equal(result.size, 0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('is cycle-safe (two files importing each other does not hang or throw)', () => {
    const root = tmpDir();
    try {
      const specFile = path.join(root, 'x.spec.ts');
      const aFile = path.join(root, 'a.ts');
      const bFile = path.join(root, 'b.ts');
      fs.writeFileSync(specFile, `import { a } from './a';\nexport const x = a;\n`);
      fs.writeFileSync(aFile, `import { b } from './b';\nexport const a = b;\n`);
      fs.writeFileSync(bFile, `import { a } from './a';\nexport const b = a;\n`);
      const sources = new Map([[specFile, fs.readFileSync(specFile, 'utf8')]]);
      const result = collectLocallyImportedFiles(sources, root);
      assert.equal(result.size, 2);
      assert.ok(result.has(aFile) && result.has(bFile));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('never includes a file already present in the input spec sources', () => {
    const root = tmpDir();
    try {
      const specA = path.join(root, 'a.spec.ts');
      const specB = path.join(root, 'b.spec.ts');
      fs.writeFileSync(specA, `import { b } from './b.spec';\nexport const a = b;\n`);
      fs.writeFileSync(specB, `export const b = 1;\n`);
      const sources = new Map([
        [specA, fs.readFileSync(specA, 'utf8')],
        [specB, fs.readFileSync(specB, 'utf8')],
      ]);
      const result = collectLocallyImportedFiles(sources, root);
      assert.equal(result.size, 0, 'specB was already a seed file, not a new dependency');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
