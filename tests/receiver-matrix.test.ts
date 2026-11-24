import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scorePaths } from '../src/index.js';
import { RECEIVER_TIERED_RULES } from '../src/receiver-forms.js';

// QAG-287 B2.2, layer 2: every on-disk fixture of the proof matrix goes through the scorer. Each fixture holds one
// reported call; the test asserts the form and the tier of every finding of the rule in the fixture, by file and line.

const here = path.dirname(fileURLToPath(import.meta.url));
const root = [path.resolve(here, 'fixtures/cells'), path.resolve(here, '../../tests/fixtures/cells')].find((d) => fs.existsSync(d))!;
const manifestPath = [path.resolve(here, 'receiver-matrix.json'), path.resolve(here, '../../tests/receiver-matrix.json')].find((f) => fs.existsSync(f))!;
interface Row { id: string; row: string; rule: string; dir: string; entry: string; line: number; expect: 'PROVEN' | 'NOT'; tier: string }
const matrix = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { fixtures: Row[] };

const WFS = 'playwright/no-wait-for-selector';
/** Always receiver-tiered. Written out, not read from the list. */
const PINNED = ['playwright/no-wait-for-navigation', 'playwright/no-element-handle', 'playwright/no-page-pause'];
const tiered = (rule: string): boolean => PINNED.includes(rule) || (rule === WFS && RECEIVER_TIERED_RULES.includes(WFS));

async function findingsOf(scanned: string, rule: string, target = scanned): Promise<string[]> {
  const result = await scorePaths({ paths: [target], profile: 'standard', threshold: 0, cwd: scanned });
  return result.findings
    .filter((f) => f.rule === rule)
    .map((f) => `${path.relative(scanned, path.resolve(scanned, f.file))}:${f.line} form=${f.form ?? '-'} tier=${f.tier}`)
    .sort();
}
/** What the one finding of a fixture must be. A rule taken out of the receiver-tiered list keeps form `-` and its own tier. */
function want(r: Pick<Row, 'rule' | 'entry' | 'line' | 'expect'>): string[] {
  const own = r.rule === WFS ? 'certain' : 'likely';
  if (!tiered(r.rule)) return [`${r.entry}:${r.line} form=- tier=${own}`];
  return [r.expect === 'PROVEN' ? `${r.entry}:${r.line} form=- tier=${own}` : `${r.entry}:${r.line} form=unresolved tier=likely`];
}

describe('QAG-287 B2.2: the proof matrix on disk', () => {
  it('the matrix lists every row for no-wait-for-selector and for a pinned rule', () => {
    const by = (rule: string): string[] => matrix.fixtures.filter((f) => f.rule === rule).map((f) => `${f.row} ${path.basename(f.dir)}`).sort();
    assert.ok(by(WFS).length >= 100);
    assert.deepEqual(by(WFS), by(PINNED[0]));
    assert.ok(matrix.fixtures.some((f) => f.expect === 'NOT') && matrix.fixtures.some((f) => f.expect === 'PROVEN'));
  });
  for (const r of matrix.fixtures) {
    it(`${r.row} ${r.id}: ${r.expect}`, async () => {
      assert.equal(path.basename(path.dirname(r.dir)), r.expect === 'PROVEN' ? '-' : 'unresolved', 'the fixture lives in the cell of its form');
      assert.deepEqual(await findingsOf(path.join(root, r.dir), r.rule), want(r));
    });
  }
  it('an unresolved finding is never certain', async () => {
    for (const r of matrix.fixtures.filter((f) => f.expect === 'NOT').slice(0, 12)) {
      const result = await scorePaths({ paths: [path.join(root, r.dir)], profile: 'standard', threshold: 0, cwd: path.join(root, r.dir) });
      for (const f of result.findings) if (f.form === 'unresolved') assert.equal(f.tier, 'likely', r.id);
    }
  });
});

describe('QAG-287 B2.2: trees with symbolic links, built at run time', () => {
  const PW = '@playwright/test';
  const OWN = `const fakePage = { waitForSelector: async () => null, waitForNavigation: async () => null };\nexport function test(title: string, body: (args: { page: any }) => unknown) { return body({ page: fakePage }); }\n`;
  const calls: Record<string, string> = { [WFS]: `await page.waitForSelector('#orders-table');`, [PINNED[0]]: 'await page.waitForNavigation();' };
  const spec = (rule: string, source: string): string => `import { test } from '${source}';\n\ntest('orders table loads', async ({ page }) => {\n  ${calls[rule]}\n});\n`;
  const withTree = async (files: Record<string, string>, run: (dir: string) => Promise<void>): Promise<void> => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-b22-')));
    try {
      for (const [f, text] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
        fs.writeFileSync(path.join(dir, f), text);
      }
      await run(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
  for (const rule of [WFS, PINNED[0]]) {
    it(`RD-14 ${rule}: a linked fixture file whose star leads to another file than the one beside the link: NOT`, async () => {
      await withTree({ 'p/e2e/a.spec.ts': spec(rule, './fixtures'), 'p/shared/fixtures.ts': `export * from './base';\n`, 'p/e2e/base.ts': `export { test } from '${PW}';\n`, 'p/shared/base.ts': OWN }, async (dir) => {
        fs.symlinkSync('../shared/fixtures.ts', path.join(dir, 'p/e2e/fixtures.ts'));
        assert.deepEqual(await findingsOf(path.join(dir, 'p'), rule), want({ rule, entry: 'e2e/a.spec.ts', line: 4, expect: 'NOT' }));
      });
    });
    it(`RD-14 control ${rule}: the same tree with a real file in place of the link: PROVEN`, async () => {
      await withTree({ 'p/e2e/a.spec.ts': spec(rule, './fixtures'), 'p/e2e/fixtures.ts': `export * from './base';\n`, 'p/e2e/base.ts': `export { test } from '${PW}';\n`, 'p/shared/base.ts': OWN }, async (dir) => {
        assert.deepEqual(await findingsOf(path.join(dir, 'p'), rule), want({ rule, entry: 'e2e/a.spec.ts', line: 4, expect: 'PROVEN' }));
      });
    });
    // A linked directory given as the scan root itself matches no file (the walk does not follow a link), so the spec is named through the link.
    it(`RD-14c ${rule}: a spec of a project reached through a linked directory: PROVEN`, async () => {
      await withTree({ 'real/orders.spec.ts': spec(rule, './fixtures.js'), 'real/fixtures.ts': `export { test } from '${PW}';\n` }, async (dir) => {
        fs.symlinkSync(path.join(dir, 'real'), path.join(dir, 'link'));
        assert.deepEqual(await findingsOf(path.join(dir, 'link'), rule, path.join(dir, 'link/orders.spec.ts')), want({ rule, entry: 'orders.spec.ts', line: 4, expect: 'PROVEN' }));
      });
    });
  }
});
