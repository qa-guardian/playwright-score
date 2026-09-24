import path from 'node:path';
import { ESLint } from 'eslint';
import { commonAncestorDir } from './fs-util.js';
import type { Linter } from 'eslint';
import playwright from 'eslint-plugin-playwright';
import { basePlugin } from './rules/base-plugin.js';
import { mapRule } from './profiles.js';
import type { Finding, ProfileName, Severity } from './types.js';

function buildConfig(assertFunctionNames: string[], testAliasNames: string[]): Linter.Config[] {
  const base: Linter.Config[] = [
    {
      files: ['**/*.{ts,tsx,js,jsx,mjs,cjs}'],
      // Identifiers bound to a `test.extend(...)`-derived fixture under a
      // custom name (test-aliases.ts) — upstream eslint-plugin-playwright
      // already dereferences a *same-file* extend chain internally, but
      // can't follow one across files (its own `dereference` is scoped to
      // the current file); this setting is what makes a cross-file alias
      // (`import { loggedTest } from './fixtures'`) resolve to `test` for
      // every rule that keys off the literal identifier — no-standalone-
      // expect, no-conditional-expect, no-conditional-in-test, valid-expect,
      // no-focused-test, and others built on the same parseFnCall/
      // resolveToPlaywrightFn helper. Verified against two real corpus
      // repos (argos-ci/argos's `loggedTest`, apache/superset's
      // `testWithAssets`) where this exact cross-file shape was the actual
      // false-positive cause.
      settings: {
        playwright: {
          globalAliases: { test: testAliasNames },
        },
      },
      // A pre-2.0.0 review found `/* eslint-disable */` on line 1 of a
      // 10-test file (waitForTimeout + expect(true).toBe(true) in every
      // test) took it from 35/F to 99/A — every rule this package enables
      // is an ordinary ESLint rule, so an ordinary inline disable comment
      // silences it exactly like it would in any host project, defeating
      // every one of these rules at will. noInlineConfig makes every
      // eslint-disable/-line/-next-line comment (and enable/env/global)
      // inert for this run's rule set; pwscore/eslint-disable-comment
      // (metrics.ts) still reports the comment itself as a demerit — see
      // eslint-disable-comment's docs — but it can no longer also silence
      // whatever it's aimed at.
      linterOptions: { noInlineConfig: true },
      languageOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        parser: undefined as unknown as Linter.Parser, // set below if available
      },
      plugins: {
        playwright,
        pwscore: basePlugin,
      },
      rules: {
        // Ensure key hygiene rules even if recommended set differs by
        // version. A few (no-wait-for-timeout, no-force-option,
        // no-wait-for-selector, expect-expect) are intentionally stricter
        // than eslint-plugin-playwright's own "recommended" severity —
        // these are patterns Playwright's own docs call out as anti-
        // patterns (see playwright.dev/docs/best-practices), so this scorer
        // treats them as errors rather than warnings. no-networkidle and
        // no-raw-locators aren't part of upstream "recommended" at all but
        // are enabled here for the same reason.
        'playwright/no-wait-for-timeout': 'error',
        'playwright/no-networkidle': 'error',
        'playwright/no-force-option': 'error',
        'playwright/no-wait-for-selector': 'error',
        'playwright/no-wait-for-navigation': 'error',
        'playwright/missing-playwright-await': 'error',
        // expect-expect can only see expect(...) calls written directly in
        // the test body — it has no way to trace an assertion made inside
        // a helper function the test calls. assertFunctionNames is
        // populated per-run (see index.ts's findLocalAssertionHelperNames)
        // with every same-file helper whose own body actually contains an
        // expect(...)-shaped call, so this is name-agnostic for the common
        // case regardless of what the helper is called. assertFunctionPatterns
        // is a secondary, name-based fallback for helpers imported from
        // another file (which we can't inspect the body of) — patterns are
        // camelCase/exact-anchored so e.g. "checkoutFlow" doesn't collide
        // with "check*"; the suffix pattern catches any name embedding a
        // real Playwright matcher name (toBeVisible, toHaveText, ...).
        // Verified against several real production files using several
        // different naming conventions for the exact same delegation shape
        // (audit, expectRealButtonToBeVisible, alertToBeVisible,
        // checkFlashMessageVisibility) — all previously false-positived as
        // "no assertions" at error severity.
        'playwright/expect-expect': [
          'error',
          {
            assertFunctionNames,
            assertFunctionPatterns: [
              '^(assert|verify|validate|audit|expect)([A-Z]|$)',
              '^checkA11y$',
              '^checkAccessibility$',
              '(ToBe|ToHave|ToContain|ToMatch|ToEqual)[A-Z]',
            ],
          },
        ],
        'playwright/no-focused-test': 'error',
        // Upstream flags every test.skip(...) form identically, including
        // Playwright's own documented conditional runtime skip
        // (test.skip(condition, reason)) — a false positive on entirely
        // idiomatic cross-browser test code, verified against real-world
        // suites. pwscore/no-skipped-test-declaration (below) replaces it
        // with the same severity for the actual anti-pattern (an
        // always-skipped test declaration) only.
        'playwright/no-skipped-test': 'off',
        'pwscore/no-skipped-test-declaration': ['warn', { testAliasNames }],
        'playwright/no-raw-locators': 'warn',
        // Both were mapped in profiles.ts (report-only, so they don't
        // double-penalize the ratio-based locators dimension) but never
        // actually enabled anywhere — completely inert. prefer-locator
        // specifically catches Playwright's older direct-action API
        // (page.click('#foo') instead of a locator or native locator),
        // arguably the single most common raw-selector anti-pattern in
        // naive/AI-generated code — verified against a realistic sample
        // that scored a perfect 100 on the locators dimension despite
        // using nothing but page.click(selector)/page.type(selector, ...)
        // throughout, before this fix.
        'playwright/prefer-locator': 'warn',
        'playwright/prefer-native-locators': 'warn',
        // Matches eslint-plugin-playwright's own recommended severity.
        'playwright/prefer-web-first-assertions': 'error',
        // The rules below complete the intended rule set from
        // profiles.ts's ESLINT_RULE_MAP. Earlier versions (<=0.2.0)
        // expected them to arrive via eslint-plugin-playwright's
        // flat/recommended config, but the spread only handled an array
        // shape while the plugin exports a single config object — so the
        // entire recommended set was silently dropped and these rules
        // never ran (METHODOLOGY.md's hygiene dimension lists
        // "conditionals" and "handles", yet neither could ever fire).
        // They are enabled explicitly and frozen here on purpose:
        // eslint-plugin-playwright is a ^range dependency, and inheriting
        // whatever its recommended set says at install time would make
        // identical code score differently across installs. Severities
        // mirror upstream flat/recommended as of eslint-plugin-playwright
        // 2.x. require-top-level-describe stays disabled deliberately —
        // it is stylistic, not in upstream recommended, and would
        // penalize idiomatic describe-less suites.
        'playwright/no-conditional-in-test': 'warn',
        'playwright/no-conditional-expect': 'warn',
        'playwright/no-element-handle': 'warn',
        'playwright/no-eval': 'warn',
        'playwright/no-page-pause': 'warn',
        'playwright/no-useless-await': 'warn',
        'playwright/valid-expect': 'error',
        'playwright/no-standalone-expect': 'error',
        'playwright/max-nested-describe': 'warn',

        // QAG-196 gameability fixes (2026-09-21), scored unconditionally
        // as of 2.0.0/model v4 — see base-plugin.ts for what each one
        // catches and profiles.ts for the severity → demerit mapping.
        // no-coordinate-click is 'warn' here too (not 'error'): profiles.ts
        // overrides its scoring severity to 'warning' regardless (the
        // canvas-app false-positive mitigation), so setting 'error' here
        // would only mislead the raw ESLint severity shown in some
        // formatters without changing what it actually costs.
        'pwscore/no-timer-sleep': 'error',
        'pwscore/no-coordinate-click': 'warn',
        'pwscore/no-trivial-assertion': 'error',
        'pwscore/no-soft-assertion-only-test': ['warn', { testAliasNames }],
      },
    },
  ];

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
  // Kept on the options shape for call-site/API stability even though
  // mapRule no longer branches on it (there's only one profile as of
  // 2.0.0 — see profiles.ts and types.ts's ProfileName).
  profile: ProfileName;
  cwd?: string;
  /** See findLocalAssertionHelperNames in metrics.ts. */
  assertFunctionNames?: string[];
  /** See detectExtendedTestAliases in test-aliases.ts. */
  testAliasNames?: string[];
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
  const overrideConfig = buildConfig(options.assertFunctionNames ?? [], options.testAliasNames ?? []);

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
    const absFile = path.resolve(result.filePath);
    const file = path.relative(cwd, absFile) || path.basename(absFile);
    for (const msg of result.messages) {
      // A `// eslint-disable-next-line some/rule-we-dont-bundle` comment is
      // extremely common in real-world code (any host project that lints
      // with plugins we don't embed, e.g. react-hooks, import, sonarjs, or
      // even @typescript-eslint's own rules — we only bundle its parser,
      // not its rule set). ESLint reports these with a fixed message
      // regardless of reportUnusedDisableDirectives config, since it can't
      // even validate a rule id it has no definition for. This is a
      // diagnostic about *our* rule coverage, not the spec's quality —
      // surfacing it as a finding (even report-only) is pure confusion,
      // not signal.
      if (/^Definition for rule '.*' was not found\.$/.test(msg.message)) {
        continue;
      }
      // noInlineConfig (above) reports every inline directive comment
      // itself as a `ruleId: null` message ("'...' has no effect because
      // you have 'noInlineConfig' setting in your config.") — already
      // caught by the generic `!msg.ruleId` skip below, but matched
      // explicitly here too (same treatment as "Definition for rule",
      // above) so this stays true even if that generic skip is ever
      // narrowed: it's a diagnostic about our own noInlineConfig setting,
      // not the spec's quality, and pwscore/eslint-disable-comment already
      // reports the comment itself as a real finding.
      if (/has no effect because you have 'noInlineConfig' setting in your config\.$/.test(msg.message)) {
        continue;
      }
      if (msg.fatal) {
        // A file that doesn't parse can't be meaningfully scored at all —
        // surface it explicitly rather than silently dropping it (it has
        // no ruleId) and letting an unparseable file default to a clean
        // 100. scorePaths hard-fails the whole result when this rule id
        // is present.
        findings.push({
          rule: 'playwright-score/parse-error',
          severity: 'error',
          message: msg.message,
          file,
          line: msg.line,
          column: msg.column,
          dimension: 'structure',
        });
        continue;
      }
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
