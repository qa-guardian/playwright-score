# Changelog

All notable changes to this project are documented here. The scoring
methodology itself (`sqs-v1`) is frozen — see [METHODOLOGY.md](./METHODOLOGY.md).
Any change to formulas, weights, or constants requires a new score version
(`sqs-v2`), not a patch release.

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
