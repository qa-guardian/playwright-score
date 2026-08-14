import path from 'node:path';
import { ESLint } from 'eslint';
import { commonAncestorDir } from './fs-util.js';
import type { Linter } from 'eslint';
import playwright from 'eslint-plugin-playwright';
import {
  guardianPlugin,
  guardianRuleConfigs,
} from './rules/guardian-plugin.js';
import { mapRule } from './profiles.js';
import type { Finding, ProfileName, Severity } from './types.js';

function buildConfig(profile: ProfileName): Linter.Config[] {
  const playwrightRecommended =
    playwright.configs?.['flat/recommended'] ??
    playwright.configs?.recommended;

  const base: Linter.Config[] = [
    {
      files: ['**/*.{ts,tsx,js,jsx,mjs,cjs}'],
      languageOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        parser: undefined as unknown as Linter.Parser, // set below if available
      },
      plugins: {
        playwright,
        ...(profile === 'guardian' ? { guardian: guardianPlugin } : {}),
      },
      rules: {
        // Ensure key hygiene rules even if recommended set differs by version
        'playwright/no-wait-for-timeout': 'error',
        'playwright/no-networkidle': 'error',
        'playwright/no-force-option': 'error',
        'playwright/no-wait-for-selector': 'error',
        'playwright/no-wait-for-navigation': 'error',
        'playwright/missing-playwright-await': 'error',
        'playwright/expect-expect': 'error',
        'playwright/no-focused-test': 'error',
        'playwright/no-skipped-test': 'warn',
        'playwright/no-raw-locators': 'warn',
        'playwright/prefer-web-first-assertions': 'warn',
        ...(profile === 'guardian' ? { ...guardianRuleConfigs } : {}),
      },
    },
  ];

  // Prefer spreading official recommended flat config when available
  if (Array.isArray(playwrightRecommended)) {
    const configs = playwrightRecommended as Linter.Config[];
    if (profile === 'guardian') {
      return [
        ...configs,
        {
          plugins: { guardian: guardianPlugin },
          rules: { ...guardianRuleConfigs },
        },
        // our severity tweaks
        base[0],
      ];
    }
    return [...configs, base[0]];
  }

  return base;
}

function toSeverity(
  eslintSeverity: number,
  override?: Severity
): Severity {
  if (override) return override;
  if (eslintSeverity === 2) return 'error';
  if (eslintSeverity === 1) return 'warning';
  return 'info';
}

/**
 * Run ESLint once per scorePaths invocation with embedded config only.
 * Does not load host-repo eslint.config.js.
 */
export async function runEslint(options: {
  files: string[];
  profile: ProfileName;
  cwd?: string;
}): Promise<Finding[]> {
  // ESLint 9 flat config resolves a `basePath` from `cwd` and silently
  // drops (as an untracked, ruleId-less message) any file that isn't
  // underneath it — no error, no findings, just a quietly clean score.
  // The caller's cwd (e.g. a runner process's install dir) has no reason
  // to contain the spec files being scored, so it can never be trusted
  // as the ESLint basePath. Derive a basePath that is guaranteed to
  // contain every file instead; fall back to the caller's cwd only when
  // there are no files (nothing to lint anyway).
  const cwd =
    options.files.length > 0
      ? commonAncestorDir(options.files)
      : (options.cwd ?? process.cwd());
  const overrideConfig = buildConfig(options.profile);

  // Try to attach typescript-eslint parser for .ts files
  try {
    const tsParser = await import('@typescript-eslint/parser');
    for (const cfg of overrideConfig) {
      if (cfg.files) {
        cfg.languageOptions = {
          ...cfg.languageOptions,
          parser: tsParser as unknown as Linter.Parser,
          parserOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
          },
        };
      }
    }
  } catch {
    // parser optional for pure JS
  }

  const eslint = new ESLint({
    cwd,
    // Prevent loading ambient project ESLint configs (ESLint 9 flat API)
    overrideConfigFile: true,
    overrideConfig: overrideConfig as never,
    // Ignore host ignore files that might exclude generated specs
    ignore: false,
  });

  const results = await eslint.lintFiles(options.files);
  const findings: Finding[] = [];

  for (const result of results) {
    const file = path.resolve(result.filePath);
    for (const msg of result.messages) {
      if (!msg.ruleId) continue;
      const mapping = mapRule(msg.ruleId);
      findings.push({
        rule: msg.ruleId,
        severity: toSeverity(msg.severity, mapping.severityOverride),
        message: msg.message,
        file,
        line: msg.line,
        column: msg.column,
        dimension: mapping.dimension,
        reportOnly: mapping.reportOnly,
      });
    }
  }

  return findings;
}
