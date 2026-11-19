import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scorePaths } from '../src/index.js';
import { getEngineVersions, resolveEngineVersions } from '../src/engine-versions.js';

// QAG-287 S1: the engine versions are exact, bundled, and reported.

function packageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'fixtures'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('package root not found');
}
const root = packageRoot();
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));

const ENGINE = ['@typescript-eslint/parser', 'eslint', 'eslint-plugin-playwright', 'glob', 'typescript'];
const EXACT = /^\d+\.\d+\.\d+$/;

describe('QAG-287 S1: package manifest', () => {
  it('pins the five engine packages to exact versions in dependencies', () => {
    for (const name of ENGINE) {
      const range = pkg.dependencies?.[name];
      assert.match(String(range), EXACT, `${name} must be an exact version, got ${range}`);
    }
  });

  it('keeps typescript out of devDependencies (one copy, the pinned one)', () => {
    assert.equal(pkg.devDependencies?.typescript, undefined);
  });

  it('bundles exactly the five engine packages', () => {
    assert.deepEqual([...pkg.bundleDependencies].sort(), [...ENGINE].sort());
  });

  it('the lockfile resolves every pin to the same version', () => {
    const rootDeps = lock.packages[''].dependencies;
    for (const name of ENGINE) {
      assert.equal(rootDeps[name], pkg.dependencies[name], `${name} root range in package-lock.json`);
      assert.equal(lock.packages[`node_modules/${name}`]?.version, pkg.dependencies[name], `${name} resolved version`);
    }
  });
});

describe('QAG-287 S1: engine versions', () => {
  it('reports the pinned versions', () => {
    const engine = getEngineVersions();
    assert.equal(engine.eslint, pkg.dependencies.eslint);
    assert.equal(engine.parser, pkg.dependencies['@typescript-eslint/parser']);
    assert.equal(engine.plugin, pkg.dependencies['eslint-plugin-playwright']);
    assert.equal(engine.typescript, pkg.dependencies.typescript);
  });

  it('resolves typescript from the parser directory, not from the anchor', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-versions-'));
    try {
      const put = (rel: string, body: object | string) => {
        const file = path.join(tmp, rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body));
      };
      const mod = (rel: string, name: string, version: string) => {
        put(`${rel}/package.json`, { name, version, main: 'index.js' });
        put(`${rel}/index.js`, 'module.exports = {};');
      };
      // Host-hoisted typescript 6.x next to the anchor; the parser carries its own 5.x.
      mod('node_modules/typescript', 'typescript', '6.0.3');
      mod('node_modules/eslint', 'eslint', '9.0.0');
      mod('node_modules/eslint-plugin-playwright', 'eslint-plugin-playwright', '2.0.0');
      mod('node_modules/@typescript-eslint/parser', '@typescript-eslint/parser', '8.0.0');
      mod('node_modules/@typescript-eslint/parser/node_modules/typescript', 'typescript', '5.9.3');
      put('anchor.js', '');
      const engine = resolveEngineVersions(path.join(tmp, 'anchor.js'));
      assert.deepEqual(engine, { eslint: '9.0.0', parser: '8.0.0', plugin: '2.0.0', typescript: '5.9.3' });
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('reports unknown for a package that cannot be resolved', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-versions-'));
    try {
      fs.writeFileSync(path.join(tmp, 'anchor.js'), '');
      const engine = resolveEngineVersions(path.join(tmp, 'anchor.js'));
      assert.deepEqual(engine, { eslint: 'unknown', parser: 'unknown', plugin: 'unknown', typescript: 'unknown' });
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('adds an engine key to a score result', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-score-'));
    try {
      const spec = path.join(dir, 'a.spec.ts');
      fs.writeFileSync(spec, "import { test, expect } from '@playwright/test';\ntest('t', async ({ page }) => {\n  await page.goto('/');\n  await expect(page.getByRole('heading')).toBeVisible();\n});\n");
      const result = await scorePaths({ paths: [spec], cwd: dir });
      assert.deepEqual(result.engine, getEngineVersions());
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
