// Spec files come in every module flavour Playwright itself loads
// (`?(c|m)[jt]s?(x)`): .mjs/.mts are always ES modules, .cjs/.cts are always
// CommonJS, and plain .js/.ts/.jsx/.tsx stay on the ES-module parse this
// package has always used (it is a superset for every realistic spec: a
// plain `require` call parses fine as a module, and guessing from
// package.json "type" would mean reading untrusted files for no gain).

export type SourceType = 'module' | 'commonjs';

export function sourceTypeFor(file: string | undefined): SourceType {
  return /\.(cjs|cts)$/.test(file ?? '') ? 'commonjs' : 'module';
}

/** Every extension a Playwright spec can have (matches Playwright's own default testMatch). */
export const SPEC_EXTENSIONS = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts'] as const;

export const SPEC_EXTENSION_RE = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;
