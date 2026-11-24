import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scorePaths } from '../src/index.js';
import { awaitedCallArgument } from '../src/awaited-call-argument.js';
import { rowFor } from '../src/catalogue/index.js';

// QAG-287 B3c: form `awaited-call-argument` of playwright/missing-playwright-await. An assertion passed straight
// into a call whose chain is awaited, returned or an arrow body. Narrowing only: form and copy change, nothing else.

const AWAIT = 'playwright/missing-playwright-await';
const FORM = 'awaited-call-argument';
const here = path.dirname(fileURLToPath(import.meta.url));
// The package root (the source tree, not dist-tests), found as tests/rule-fixtures.test.ts finds it.
const root = ((): string => {
  let dir = here;
  for (let i = 0; i < 6; i++, dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'fixtures'))) return dir;
  }
  throw new Error('package root not found');
})();
const cells = path.join(root, 'tests', 'fixtures', 'cells');
const cell = path.join(cells, 'playwright__missing-playwright-await');
const TRACK = 'async function track(check: unknown): Promise<void> {\n  await check;\n}\n';

type F = Awaited<ReturnType<typeof scorePaths>>['findings'][number];

async function scoreFile(file: string, opts: { inProcess?: boolean } = {}): Promise<F[]> {
  const r = await scorePaths({ paths: [file], profile: 'standard', threshold: 0, cwd: cells, ...(opts.inProcess ? { isolate: false } : {}) });
  return r.findings;
}

// `inProcess`: for a test that flips the switch of this thread's module, which the analysis worker does not share.
async function score(body: string, opts: { inProcess?: boolean; head?: string } = {}): Promise<F[]> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-callarg-'));
  try {
    const file = path.join(dir, 'a.spec.ts');
    const head = opts.head ?? "import { test, expect } from '@playwright/test';";
    fs.writeFileSync(file, `${head}\n${TRACK}\ntest('t', async ({ page }) => {\n${body}\n});\n`);
    const r = await scorePaths({ paths: [file], profile: 'standard', threshold: 0, cwd: dir, ...(opts.inProcess ? { isolate: false } : {}) });
    return r.findings;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const awaits = (fs: F[]) => fs.filter((f) => f.rule === AWAIT);
const forms = (fs: F[]) => awaits(fs).map((f) => f.form);

// Pinned by hand from the brief, not derived from the files on disk.
const MOVES = [
  'step-helper-argument-precedence.ts',
  'js-cjs-returned-helper-argument.js',
  'aliased-locator-helper-argument.ts',
  'arrow-body-helper-argument.ts',
  'step-passed-to-helper.ts',
  'poll-passed-to-helper.ts',
  'as-type-wrapper.ts',
  'satisfies-type-wrapper.ts',
  'arrow-body-in-callback.ts',
];
const STAYS = [
  'array-argument.ts',
  'object-argument.ts',
  'outer-call-not-awaited.ts',
  'js-outer-call-stored-never-awaited.js',
  'aliased-locator-outer-call-not-awaited.ts',
  'callback-body.ts',
  'pushed-never-awaited.ts',
];
// Not reported upstream: a stored promise read by an awaited call counts as consumed, and a `test.step(...)` whose
// parent is a call is not taken for a step call at all (the moved step shape goes through `as Promise<void>`).
const NO_FINDING = ['stored-then-passed.ts', 'expect-rejects-control.ts', 'step-bare-argument.ts'];

describe('QAG-287 B3c: awaited-call-argument fixtures', () => {
  it('each moved shape has exactly one finding, form awaited-call-argument, likely, with the new copy', async () => {
    const row = rowFor(AWAIT, FORM)!;
    for (const name of MOVES) {
      for (const file of [path.join(cell, FORM, `true-${name}`), path.join(cell, 'assertion', `false-${name}`)]) {
        const f = awaits(await scoreFile(file));
        assert.equal(f.length, 1, file);
        assert.equal(f[0].form, FORM, file);
        assert.equal(f[0].tier, 'likely', file);
        assert.deepEqual([f[0].title, f[0].what, f[0].why, f[0].fix], [row.title, row.what, row.why, row.fix], file);
        assert.equal(f[0].family, 'passes-regardless', file);
      }
    }
  });

  it('each shape outside the condition keeps exactly one assertion finding', async () => {
    for (const name of STAYS) {
      const file = path.join(cell, FORM, `false-${name}`);
      assert.deepEqual(forms(await scoreFile(file)), ['assertion'], file);
    }
  });

  it('a stored promise read by an awaited call, expect(promise).rejects and a bare step argument are not reported at all', async () => {
    for (const name of NO_FINDING) {
      const file = path.join(cell, FORM, `false-${name}`);
      assert.deepEqual(forms(await scoreFile(file)), [], file);
    }
  });

  it('precedence: foreign-expect wins over awaited-call-argument', async () => {
    for (const file of [path.join(cell, 'foreign-expect', 'true-vitest-awaited-helper-precedence.ts'), path.join(cell, FORM, 'false-foreign-expect-precedence.ts')]) {
      assert.deepEqual(forms(await scoreFile(file)), ['foreign-expect'], file);
    }
  });
});

describe('QAG-287 B3c: the condition', () => {
  it('a type assertion in angle brackets and a non-null assertion are type-only wrappers', async () => {
    assert.deepEqual(forms(await score("  await track(<Promise<void>>expect(page.getByRole('alert')).toBeHidden());")), [FORM]);
    assert.deepEqual(forms(await score("  await track(expect(page.getByRole('alert')).toBeHidden()!);")), [FORM]);
  });

  it('a conditional, a spread, a parenthesised sequence or a new expression keeps the form', async () => {
    for (const body of [
      "  await track(page.url() === '/' ? expect(page.getByRole('main')).toBeVisible() : undefined);",
      "  await track(...[expect(page.getByRole('main')).toBeVisible()]);",
      "  await track((page.url(), expect(page.getByRole('main')).toBeVisible()));",
      "  class Tracker {\n    constructor(readonly check: unknown) {}\n  }\n  await new Tracker(expect(page.getByRole('main')).toBeVisible());",
    ]) {
      const f = forms(await score(body));
      assert.ok(f.length === 1 && f[0] === 'assertion', `${body}: ${f.join()}`);
    }
  });

  it('the outer chain may continue after the call: await track(...).then(...) moves', async () => {
    assert.deepEqual(forms(await score("  await track(expect(page.getByRole('main')).toBeVisible()).then(() => undefined);")), [FORM]);
  });

  it('an action passed to an awaited call is never touched', async () => {
    assert.deepEqual(forms(await score("  await track(page.waitForResponse('**/api/cart'));")), ['action']);
  });

  it('an unresolved expect keeps tier needs-check when it moves; only form and copy change', async () => {
    const f = awaits(await score("  await track(expect(page.getByRole('main')).toBeVisible());", { head: "import { test } from '@playwright/test';" }));
    assert.equal(f.length, 1);
    assert.equal(f[0].form, FORM);
    assert.equal(f[0].tier, 'needs-check');
    assert.match(f[0].what ?? '', /could not confirm that this expect is the one from Playwright/);
    assert.ok((f[0].what ?? '').startsWith(rowFor(AWAIT, FORM)!.what));
  });
});

describe('QAG-287 B3c: narrowing only', () => {
  const identity = (fs: F[]) => fs.map((f) => [f.rule, f.line, f.column, f.message, f.severity, f.dimension].join('|')).sort();
  const strip = (f: F) => {
    const { form: _form, tier: _tier, title: _title, what: _what, why: _why, fix: _fix, ...rest } = f as F & Record<string, unknown>;
    return JSON.stringify(rest);
  };

  it('with the step off, every fixture finding is where it was, and only the moved shapes change form', async () => {
    const moved: string[] = [];
    const files = [
      ...MOVES.map((n) => path.join(cell, FORM, `true-${n}`)),
      ...STAYS.map((n) => path.join(cell, FORM, `false-${n}`)),
      ...NO_FINDING.map((n) => path.join(cell, FORM, `false-${n}`)),
      path.join(cell, FORM, 'false-foreign-expect-precedence.ts'),
    ];
    for (const file of files) {
      const on = await scoreFile(file, { inProcess: true });
      awaitedCallArgument.enabled = false;
      let off: F[];
      try {
        off = await scoreFile(file, { inProcess: true });
      } finally {
        awaitedCallArgument.enabled = true;
      }
      assert.deepEqual(identity(on), identity(off), file);
      assert.deepEqual(on.map(strip).sort(), off.map(strip).sort(), file);
      assert.ok(off.every((f) => f.rule !== AWAIT || f.form !== FORM), file);
      const cellsOf = (fs: F[]) => awaits(fs).map((f) => `${f.form}:${f.tier}`).join();
      if (cellsOf(on) !== cellsOf(off)) moved.push(`${path.basename(file)} ${cellsOf(off)} -> ${cellsOf(on)}`);
    }
    // The switch is live: the nine moved shapes, and nothing else, go from assertion to awaited-call-argument; tier stays likely.
    assert.deepEqual(moved, MOVES.map((n) => `true-${n} assertion:likely -> ${FORM}:likely`));
  });

  it('the new row is likely by design, class C1, not BC-eligible, on the assertions docs page, with copy of its own', () => {
    const row = rowFor(AWAIT, FORM)!;
    const base = rowFor(AWAIT, 'assertion')!;
    assert.deepEqual([row.design, row.cls, row.bcEligible, row.family, row.basis, row.docs], ['likely', 'C1', false, 'passes-regardless', 'docs', base.docs]);
    assert.equal(row.title, 'Assertion handed to another call instead of awaited');
    assert.notEqual(row.title, base.title);
    for (const text of [row.title, row.what, row.why, row.fix]) assert.doesNotMatch(text, /promise (is|is not|isn't) awaited|claude|anthropic|\bAI\b/i);
  });
});
