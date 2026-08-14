# Changelog

All notable changes to this project are documented here. The scoring
methodology itself (`sqs-v1`) is frozen — see [METHODOLOGY.md](./METHODOLOGY.md).
Any change to formulas, weights, or constants requires a new score version
(`sqs-v2`), not a patch release.

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
