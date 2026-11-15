import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scorePaths } from '../src/index.js';
import { parseLenientJson } from '../src/module-resolution.js';

// QAG-287 slice D: an assertion that lives in an imported helper must be
// found through the TypeScript `.js` -> `.ts` convention, tsconfig aliases and
// workspace packages. A helper that really asserts nothing still fires.

const tmpRoots: string[] = [];
function repo(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pws-resolve-'));
  tmpRoots.push(root);
  fs.mkdirSync(path.join(root, '.git'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}
after(() => {
  for (const r of tmpRoots) fs.rmSync(r, { recursive: true, force: true });
});

const ASSERTING_HELPER = `import { expect, type Page } from '@playwright/test';
export async function submitForm(page: Page) {
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved')).toBeVisible();
}
`;
const IDLE_HELPER = `import type { Page } from '@playwright/test';
export async function submitForm(page: Page) {
  await page.getByRole('button', { name: 'Save' }).click();
}
`;
const specFor = (from: string) => `import { test } from '@playwright/test';
import { submitForm } from '${from}';
test('saves', async ({ page }) => {
  await page.goto('/form');
  await submitForm(page);
});
`;

async function rules(root: string, sub = '.'): Promise<string[]> {
  const r = await scorePaths({ paths: [path.join(root, sub)], profile: 'standard', threshold: 0, cwd: root });
  return r.findings.map((f) => f.rule);
}

describe('QAG-287 slice D: helper resolution', () => {
  it('follows an import written with .js to the .ts source (TypeScript ESM)', async () => {
    const good = repo({ 'e2e/a.spec.ts': specFor('./helper.js'), 'e2e/helper.ts': ASSERTING_HELPER });
    assert.ok(!(await rules(good)).includes('playwright/expect-expect'));
    const bad = repo({ 'e2e/a.spec.ts': specFor('./helper.js'), 'e2e/helper.ts': IDLE_HELPER });
    assert.ok((await rules(bad)).includes('playwright/expect-expect'), 'a resolved helper with no assertion still fires');
  });

  it('maps .js to .tsx and .mjs to .mts', async () => {
    const tsx = repo({ 'e2e/a.spec.ts': specFor('./helper.js'), 'e2e/helper.tsx': ASSERTING_HELPER });
    assert.ok(!(await rules(tsx)).includes('playwright/expect-expect'));
    const mts = repo({ 'e2e/a.spec.mts': specFor('./helper.mjs'), 'e2e/helper.mts': ASSERTING_HELPER });
    assert.ok(!(await rules(mts)).includes('playwright/expect-expect'));
  });

  it('resolves a tsconfig paths alias (JSON with comments, extends)', async () => {
    const files = {
      'tsconfig.base.json': `{ // shared\n "compilerOptions": { "baseUrl": ".", "paths": { "@helpers/*": ["e2e/helpers/*"], }, }, }`,
      'tsconfig.json': `{ "extends": "./tsconfig.base.json" }`,
      'e2e/a.spec.ts': specFor('@helpers/form'),
    };
    const good = repo({ ...files, 'e2e/helpers/form.ts': ASSERTING_HELPER });
    assert.ok(!(await rules(good)).includes('playwright/expect-expect'));
    const bad = repo({ ...files, 'e2e/helpers/form.ts': IDLE_HELPER });
    assert.ok((await rules(bad)).includes('playwright/expect-expect'));
  });

  it('resolves a baseUrl-relative bare specifier', async () => {
    const root = repo({
      'tsconfig.json': `{ "compilerOptions": { "baseUrl": "e2e" } }`,
      'e2e/a.spec.ts': specFor('support/form'),
      'e2e/support/form.ts': ASSERTING_HELPER,
    });
    assert.ok(!(await rules(root)).includes('playwright/expect-expect'));
  });

  it('resolves a workspace package (package.json workspaces, main in dist maps to src)', async () => {
    const root = repo({
      'package.json': JSON.stringify({ name: 'mono', workspaces: ['packages/*'] }),
      'packages/ui-test/package.json': JSON.stringify({ name: '@acme/ui-test', main: 'dist/index.js' }),
      'packages/ui-test/src/index.ts': ASSERTING_HELPER,
      'e2e/a.spec.ts': specFor('@acme/ui-test'),
    });
    assert.ok(!(await rules(root)).includes('playwright/expect-expect'));
  });

  it('resolves a pnpm workspace package subpath', async () => {
    const root = repo({
      'pnpm-workspace.yaml': `packages:\n  - 'libs/*'\n`,
      'libs/kit/package.json': JSON.stringify({ name: '@acme/kit' }),
      'libs/kit/form.ts': ASSERTING_HELPER,
      'e2e/a.spec.ts': specFor('@acme/kit/form'),
    });
    assert.ok(!(await rules(root)).includes('playwright/expect-expect'));
  });

  it('follows delegation across files: a spec-local function calls an imported page object that asserts', async () => {
    const page = `import { expect, type Page } from '@playwright/test';
export class Panel {
  constructor(private page: Page) {}
  async confirmOption(name: string) {
    await this.page.getByRole('option', { name }).click();
    await expect(this.page.getByRole('option', { name })).toBeChecked();
  }
}
`;
    const idlePage = page.replace('    await expect(this.page.getByRole(\'option\', { name })).toBeChecked();\n', '');
    const spec = `import { test } from '@playwright/test';
import { Panel } from './panel';
test('picks', async ({ page }) => {
  await page.goto('/x');
  await runPick(new Panel(page));
});
async function runPick(panel: Panel) {
  await panel.confirmOption('A');
}
`;
    assert.ok(!(await rules(repo({ 'e2e/a.spec.ts': spec, 'e2e/panel.ts': page }))).includes('playwright/expect-expect'));
    assert.ok((await rules(repo({ 'e2e/a.spec.ts': spec, 'e2e/panel.ts': idlePage }))).includes('playwright/expect-expect'));
  });

  it('leaves an unresolvable assertion-like helper report-only, never silently clean', async () => {
    const root = repo({
      'e2e/a.spec.ts': `import { test } from '@playwright/test';
import { checkSaved } from '@acme/missing';
test('saves', async ({ page }) => {
  await page.goto('/form');
  await checkSaved(page);
});
`,
    });
    const r = await rules(root);
    assert.ok(r.includes('playwright-score/assertion-unverified'), r.join());
    assert.ok(!r.includes('playwright/expect-expect'));
  });

  it('never follows an alias out of the scored directory', async () => {
    const root = repo({
      'tsconfig.json': `{ "compilerOptions": { "paths": { "@out/*": ["../outside/*"] } } }`,
      'e2e/a.spec.ts': specFor('@out/form'),
    });
    fs.mkdirSync(path.join(path.dirname(root), 'outside'), { recursive: true });
    fs.writeFileSync(path.join(path.dirname(root), 'outside', 'form.ts'), ASSERTING_HELPER);
    try {
      assert.ok((await rules(root, 'e2e')).includes('playwright/expect-expect'));
    } finally {
      fs.rmSync(path.join(path.dirname(root), 'outside'), { recursive: true, force: true });
    }
  });

  it('parseLenientJson tolerates comments and trailing commas but not strings with slashes', () => {
    assert.deepEqual(parseLenientJson('{ /* a */ "u": "http://x//y", "n": [1,2,], // c\n }'), { u: 'http://x//y', n: [1, 2] });
    assert.equal(parseLenientJson('{ nope'), undefined);
  });
});
