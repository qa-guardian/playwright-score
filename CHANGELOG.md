# Changelog

All notable changes to this project are documented here. The scoring
methodology itself (`sqs-v1`) is frozen — see [METHODOLOGY.md](./METHODOLOGY.md).
Any change to formulas, weights, or constants requires a new score version
(`sqs-v2`), not a patch release.

## Unreleased

### Added
- **Reusable GitHub Action** (`action.yml` at repo root, usable as
  `qa-guardian/playwright-score@v1`). Runs the scorer, writes a job summary
  (always — no extra permissions needed), optionally posts/updates a sticky
  PR comment with the full findings, and gates or warns on the threshold
  via `mode: gate|warn` (mirrors the existing `SPEC_SCORE_MODE` convention
  from the QA Guardian integration). Exposes `score`/`grade`/`pass` as step
  outputs. Not yet published to the Marketplace or exercised in a live
  workflow — validated locally by running the same commands/JSON parsing
  the action performs against the built CLI, not by an actual GitHub
  Actions run.

## 0.1.9 — 2026-08-15

### Fixed
- **`playwright/prefer-locator` and `playwright/prefer-native-locators` were
  mapped in `profiles.ts` but never actually enabled — completely inert.**
  `prefer-locator` specifically catches Playwright's older direct-action API
  (`page.click('#foo')` instead of a locator or native locator), arguably
  the single most common raw-selector anti-pattern in naive/AI-generated
  code. Also extended `countLocators`'s raw/native ratio to recognize this
  pattern (`click`/`dblclick`/`hover`/`check`/`uncheck`/`tap`/`focus` called
  with a string selector as the first argument — methods a real `Locator`
  never accepts a string for, so this is unambiguous regardless of receiver
  name; `fill`/`type`/`press`/`selectOption` are deliberately excluded since
  their first argument is legitimately a string on a `Locator` too).
  Verified manually: a realistic "naive AI-generated" test sample using
  nothing but `page.click(selector)`/`page.type(selector, ...)` went from a
  misleading 85/B (PASS) to a correct 65/D (FAIL). Re-validated against the
  full real-world corpus (~130 files across freeCodeCamp, OpenMRS, patient
  chart, and Storybook e2e suites, plus 15 real Guardian specs) — no new
  false positives.

## 0.1.8 — 2026-08-15

### Fixed
- **Directory/glob scanning did not exclude `node_modules` (or `dist`,
  `build`, `.next`, `coverage`, and similar vendored/generated
  directories).** Verified as a real bug: running the CLI against a
  project root that has any dependency shipping its own `*.spec.ts`/
  `*.test.ts` files silently swept those in alongside real specs. Every
  comparable tool in this space (ESLint, Prettier, Jest) default-excludes
  these directories for the same reason. Re-verified against a real
  823MB `node_modules` containing 385 spec-like files: now correctly
  excluded, and fast (glob itself skips traversing into the ignored
  directories, not just filtering results afterward). An explicit file
  path always bypasses this, same as the non-Playwright-test filter.

## 0.1.7 — 2026-08-15

Deeper real-world validation: ~10 more single-file pulls (API-only specs,
mobile device emulation, deeply-chained fixtures, Japanese-language
content) plus a full clone of freeCodeCamp's e2e suite (89 spec files)
scored as one directory. No crashes; UTF-8/multi-byte content (Japanese,
Chinese, emoji seen across this and the previous round) parses and scores
correctly throughout.

### Fixed
- **The `assertFunctionPatterns` name-guessing from 0.1.6 was still
  fundamentally unbounded.** A fourth real production file used yet
  another naming convention (`alertToBeVisible`, imported from another
  module) for the exact same assertion-delegation shape, and a fifth
  (`checkFlashMessageVisibility`) didn't match any reasonable prefix/suffix
  pattern at all — real codebases name these helpers however they want.
  Replaced pure name-guessing with `findLocalAssertionHelperNames`: a
  same-file call-graph pass that discovers any function (declared or
  const-bound to an arrow/function expression) whose own body actually
  contains an `expect(...)`-shaped call, regardless of what it's named,
  and feeds the result into `playwright/expect-expect`'s own
  `assertFunctionNames` option per run. This is fully name-agnostic for
  the common (same-file helper) case; the name-pattern list from 0.1.6
  remains only as a fallback for helpers imported from another file, which
  can't be resolved without following module specifiers — a narrower,
  clearly-scoped residual limitation.

## 0.1.6 — 2026-08-15

Further real-world validation: ~45 more spec files across single-file
pulls (visual regression, accessibility, file upload, iframes, auth
setup, Storybook) and three fully-cloned real e2e suites (openmrs-esm-core,
openmrs-esm-patient-chart, storybook) scored as whole directories. No
crashes across ~100+ real files total (this round plus 0.1.5's); all
formatters (text/json/markdown/sarif) and `--out` file writing checked at
that scale too.

### Fixed
- **`playwright/expect-expect` can only see `expect(...)` calls written
  directly in a test body — it has no way to trace an assertion made
  inside a helper function the test calls.** Delegating assertions to a
  shared helper (e.g. an `audit(page, path)` a11y check reused across many
  near-identical tests, or an `expectXToBeVisible(page)` helper) is a very
  common way to dedupe similar specs, and was flagged as "no assertions"
  at error severity — verified against two real production files (one
  losing 2 tests' worth of real signal to this). Configured
  `assertFunctionPatterns` (eslint-plugin-playwright's own documented
  escape hatch for this) with a conservative, camelCase/exact-anchored
  pattern set (`assert*`, `verify*`, `validate*`, `audit*`, `expect*`,
  `checkA11y`, `checkAccessibility`) — anchored so e.g. `checkoutFlow`
  doesn't collide with a bare `check*` prefix.

## 0.1.5 — 2026-08-15

Validated against ~16 real-world Playwright spec files pulled from public
GitHub repos (react-joyride, openmrs, rancher-desktop, stylelint-demo,
Microsoft's own Playwright test suite, and others) plus the sample suites
already dogfooded internally, in addition to unit/integration coverage.
Found and fixed three more real false positives this surfaced:

### Fixed
- **`expect.poll()`/`expect.soft()` assertions weren't recognized as
  assertions at all.** A source-text-regex check (`metrics/no-empty-test`)
  only matched a bare `expect(` call, so any file whose only assertion
  used the poll/soft chained form was flagged at **error** severity as
  having no assertions — on a real file that unambiguously polls until a
  condition is true. The AST-based community `playwright/expect-expect`
  rule (already active) handles this correctly on its own, so the
  redundant, buggy regex check has been removed rather than patched
  further.
- **Playwright's own documented conditional `test.skip(condition, reason)`
  was flagged identically to an always-skipped test declaration.**
  `eslint-plugin-playwright`'s `no-skipped-test` doesn't distinguish
  `test.skip('name', fn)` (a test that never runs — worth flagging) from
  `test.skip(browserName === 'webkit', 'reason')` (Playwright's documented
  API for conditionally skipping at runtime — playwright.dev/docs/test-annotations#conditionally-skip-a-test).
  Verified against a real cross-browser test file where this generated
  five warnings on entirely idiomatic code. Replaced with
  `pwscore/no-skipped-test-declaration`, which tells the two apart by
  whether the trailing argument is a function (a declaration always
  supplies one; a conditional skip's second argument, if any, is the
  reason string) — same severity for the real anti-pattern, none for the
  documented one.
- **`// eslint-disable-next-line @typescript-eslint/no-unused-vars` (and
  any other disable comment referencing a rule we don't bundle) produced a
  confusing non-finding.** We only embed `@typescript-eslint`'s *parser*,
  not its rule set, so ESLint reports "Definition for rule '...' was not
  found" for any disable directive targeting one of its rules — a
  diagnostic about our own rule coverage, not the spec's quality. This
  pattern is extremely common in real TypeScript code (any repo that also
  lints with `@typescript-eslint`, react-hooks, import, etc.). These
  messages are now dropped entirely instead of appearing as a report-only
  finding.

## 0.1.4 — 2026-08-15

Comprehensive correctness/hardening pass ahead of public launch.

### Fixed
- **A spec file with a syntax error scored a perfect 100/A.** ESLint
  reports parse errors as a message with `fatal:true` and `ruleId:null`;
  those were silently dropped by the same filter that skips harmless
  "file ignored" notices. A file that isn't even valid JS/TS is now a hard
  fail (score 0 / grade F) with an explicit `playwright-score/parse-error`
  finding, instead of the worst possible outcome for a tool whose job is
  catching bad — including AI-generated — code.
- **Directory/glob scanning could sweep in unrelated Jest/Vitest/RTL unit
  tests** sitting next to real Playwright specs (a very common repo
  layout, e.g. `src/Button.test.tsx` next to `e2e/login.spec.ts`, both
  matching a broad `*.test.ts`-style glob), silently polluting the
  aggregate score. Files matched via directory/glob expansion are now
  skipped when they show positive evidence of a non-Playwright framework
  (an import from vitest/jest/mocha/jasmine/@testing-library, or RTL's
  `screen.*`/`toBeInTheDocument()`); reported explicitly via the new
  `skippedFiles` result field, not silently. Paths passed explicitly are
  always scored regardless. An earlier version of this check tried to
  *positively* require Playwright evidence instead and was reverted after
  it silently skipped 18 of 19 genuine specs in a real production suite —
  custom Playwright fixtures (`test/expect` re-exported from a project
  fixtures module) can destructure arbitrarily-named fixtures, not just
  `page`/`context`/`browser`, so there's no reliable positive signal.
- **The new AST-based locator counter (added in the previous release)
  silently returned zero for any `.tsx`/`.jsx` file containing real JSX**
  (e.g. Playwright component tests), because `@typescript-eslint/parser`
  doesn't enable JSX parsing by default and the failure was swallowed by
  the same try/catch that handles genuinely unparseable source. JSX is now
  enabled based on the file extension.
- `test.fix(...)` isn't a real Playwright API — the actual modifier is
  `test.fixme(...)`. Several guardian rules (`one-describe-one-test`,
  `require-test-step`) and metric heuristics (`countTests`,
  `findEmptyExpectTests`) checked for the nonexistent `.fix` spelling and
  so never recognized real `test.fixme(...)` declarations.
- `guardian/require-expect` only recognized bare `test(...)` calls, so
  `test.only/skip/fixme/slow(...)` declarations with zero assertions went
  unflagged by this rule specifically (the community `expect-expect` rule
  still caught them as a redundant safety net, so real-world impact was
  partial).
- `guardian/one-describe-one-test` didn't recognize
  `test.describe.serial/parallel/only/fixme(...)` as a describe form at
  all (only bare `test.describe(...)` matched), and flagged
  `test.describe.serial(...)`'s multiple ordered `test()` calls as
  "sprawl" — but `describe.serial` is Playwright's own documented
  mechanism for exactly that one-journey-multiple-ordered-tests pattern.
- `guardian/no-hardcoded-secrets` matched "auth" as a bare substring, so
  `authorName`, `isAuthenticated`, and similar common identifiers were
  flagged as possible secrets. Matching is now whole-word (after
  camelCase/snake_case splitting), so `authorName` no longer matches while
  `authToken`/`apiKey`/`Authorization` still do.
- `guardian/no-generic-long-timeout` flagged *any* object property named
  `timeout` anywhere in the file — including unrelated business/fixture
  data like `{ timeout: 1800 }` describing a session-length field — not
  just `timeout` options passed to a Playwright call. Now scoped to
  `timeout` properties passed inline as a call argument.
- `prefer-web-first-assertions` was downgraded to `warn` with no stated
  reason, softer than eslint-plugin-playwright's own recommended `error`
  severity for a rule it treats as important. Aligned to match.

### Added
- `ScoreResult.skippedFiles`, and a summary of skipped files in the text
  and markdown formatters.

## 0.1.3 — 2026-08-14

### Fixed
- The `locators` dimension counted native/raw locator calls with a regex
  anchored to literal `page`/`frame` receivers, undercounting raw locators
  on any other receiver (e.g. `this.container.locator(...)` in a Page
  Object Model, or a second `.locator()` chained off a prior locator call).
  Counting now walks the same AST ESLint already parses, so it can't
  silently disagree with `no-raw-locators` findings.
- SARIF output pointed `informationUri` at a URL missing a hyphen
  (`github.com/qaguardian/...` instead of `qa-guardian`), and
  `artifactLocation.uri` used absolute filesystem paths, which GitHub code
  scanning cannot map back to files in a PR diff. `Finding.file` (and so
  every formatter, not just SARIF) is now relative to the files' common
  ancestor directory instead of an absolute path.
- Removed `guardian/prefer-uuid` and `guardian/fixtures-import` from the
  rule→dimension map: they were referenced but never implemented or
  enabled, so they could never fire.

### Added
- Fixture and integration test coverage for the 5 guardian rules that
  previously had none: `no-hardcoded-secrets`, `no-generic-long-timeout`,
  `one-describe-one-test`, `require-test-step`, `no-wait-for-load-state`.

## 0.1.2 — 2026-08-14

### Fixed
- ESLint 9 flat config resolves a `basePath` from the `cwd` passed to it and
  silently drops (no error, no `ruleId`) any file outside that path.
  `scorePaths`/`runEslint` now derive the basePath from the common ancestor
  of the files actually being linted instead of trusting the caller's `cwd`,
  which is not guaranteed to contain them. Previously, any caller running
  from an unrelated working directory got zero ESLint-based findings on
  every file regardless of content.

## 0.1.1 — 2026-08-03

### Fixed
- Empty file matches now hard-fail with score 0 / grade F instead of
  reporting a misleadingly healthy ~99 pass.

### Docs
- Scoped-package CLI invocation docs (`npx -p @qaguardian/playwright-score`).
- `--version` flag.

## 0.1.0 — 2026-07-30

Initial release. `sqs-v1` scoring: `standard` (community `eslint-plugin-playwright`
+ suite metrics) and `guardian` (house conventions) profiles. CLI with text,
json, markdown, and sarif output. Library export via `scorePaths`.
