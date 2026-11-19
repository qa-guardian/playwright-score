import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/**
 * Versions of the lint engine that produced a result. Reported so two runs
 * can be compared, and so a host project's own TypeScript can be told apart
 * from the one the parser really loads.
 *
 * TypeScript is resolved from the parser's own directory, because that is
 * where `@typescript-eslint/parser` finds it at run time. Resolving it from
 * this package would report the wrong copy whenever a host project has
 * another TypeScript hoisted next to the parser.
 */
export interface EngineVersions {
  eslint: string;
  parser: string;
  plugin: string;
  typescript: string;
}

const UNKNOWN = 'unknown';

/** Walk up from a resolved file to the package.json with the given name. */
function packageVersion(resolvedFile: string, name: string): string {
  let dir = path.dirname(resolvedFile);
  for (let i = 0; i < 12; i++) {
    const candidate = path.join(dir, 'package.json');
    if (fs.existsSync(candidate)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(candidate, 'utf8')) as { name?: string; version?: string };
        if (pkg.name === name && typeof pkg.version === 'string') return pkg.version;
      } catch {
        // unreadable package.json: keep walking
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return UNKNOWN;
}

function resolveFrom(fromFile: string, name: string): string | null {
  try {
    return createRequire(fromFile).resolve(name);
  } catch {
    return null;
  }
}

/** Resolve the engine versions as seen from `anchorFile` (a file path). */
export function resolveEngineVersions(anchorFile: string): EngineVersions {
  const eslintEntry = resolveFrom(anchorFile, 'eslint');
  const parserEntry = resolveFrom(anchorFile, '@typescript-eslint/parser');
  const pluginEntry = resolveFrom(anchorFile, 'eslint-plugin-playwright');
  // From the parser's own directory, which is where the parser loads it from.
  const tsEntry = parserEntry ? resolveFrom(fs.realpathSync(parserEntry), 'typescript') : null;
  return {
    eslint: eslintEntry ? packageVersion(eslintEntry, 'eslint') : UNKNOWN,
    parser: parserEntry ? packageVersion(parserEntry, '@typescript-eslint/parser') : UNKNOWN,
    plugin: pluginEntry ? packageVersion(pluginEntry, 'eslint-plugin-playwright') : UNKNOWN,
    typescript: tsEntry ? packageVersion(tsEntry, 'typescript') : UNKNOWN,
  };
}

let cached: EngineVersions | undefined;

export function getEngineVersions(): EngineVersions {
  if (!cached) cached = resolveEngineVersions(fileURLToPath(import.meta.url));
  return cached;
}
