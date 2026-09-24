# Changelog

All notable changes to this project are documented here. Any change that
alters what a given suite scores *by changing a rule's weight or
severity* is a new scoring-model version (see
[METHODOLOGY.md](./METHODOLOGY.md)), not a quiet patch. A release that
leaves every rule's weight and severity untouched but changes which files
or which test names get recognized in the first place — discovery and
parsing accuracy, not grading policy — can still move a suite's score
without itself being a new model version; 2.1.0 below is exactly that
case, and says so explicitly.

## 2.1.0 — 2026-09-24

Scoring model stays v4 — nothing here changes a rule's weight or
severity, only whether a suite is *recognized* correctly in the first
place (see the note at the top of this file reconciling that with "any
score-changing release is a new model version"). Every fix below made at
least one real corpus repo's score more accurate — not uniformly higher,
and not less strict or more lenient by policy; see "Behaviour change"
below and VALIDATION.md's "Bugs found this way, and fixed" for the full
story (corpus repo, exact before/after) behind each one.

### Fixed
- **Custom `test.extend()` fixture names.** A suite that always declares
  its tests via a custom-named fixture (`const loggedTest =
  test.extend(...)`, imported into every spec file — sometimes through a
  re-export barrel) had every `expect()` inside a completely normal test
  flagged by upstream `eslint-plugin-playwright`'s `no-standalone-expect`
  and sibling rules (which key off the literal identifier `test`, and
  can only dereference a same-file extend chain), and undercounted by
  this package's own test-span/`countTests` logic too.
  `src/test-aliases.ts` resolves these aliases — same-file and
  cross-file, through imports and re-export barrels — and feeds both
  `eslint-plugin-playwright`'s `globalAliases.test` setting and this
  package's own AST rules. Scores rise for affected suites:
  `argos-ci/argos` 57/F → 95/A, `apache/superset` 70/C → 77/C.
- **Discovery now honours the target's own `playwright.config.*`
  `testDir`/`testMatch`/`testIgnore`.** Spec discovery previously matched
  by filename suffix only, so a directory holding a different test
  runner's files under a similar naming convention got swept in
  alongside the real suite. `src/playwright-config.ts` statically parses
  (never executes — a scored repo's config is untrusted input) the
  nearest `playwright.config.{ts,js,mjs,cjs}` at or above the scanned
  directory and scopes discovery to what the target itself declares.
  When no config is found at all, this falls back to the previous
  filename-based behavior silently, exactly as before this release; when
  a config *is* found but can't be read statically (a dynamic value or
  an unsupported shape, e.g. a `RegExp` `testMatch`), it falls back the
  same way but now also adds an entry to the new, additive, optional
  `ScoreResult.configWarnings` field so the caller can see why. Includes
  three fixes found making this work against real configs: matching
  Playwright's own `createFileMatcher` auto-`**/`-prefix behavior for a
  `testMatch`/`testIgnore` pattern with no leading `**/`; globbing from
  the config's `testDir` rather than the caller's own (possibly narrower
  or differently-rooted) scanned directory; and failing *open* (keeping a
  file) rather than treating an unresolvable relative import as proof a
  file isn't a real spec, since a sparse/partial checkout can legitimately
  be missing a fixtures module the real project has. This moves a
  suite's score in *either* direction depending on whether the old
  filename-only discovery had been over- or under-matching relative to
  what the config itself declares — see "Behaviour change" below for a
  concrete case where it lowers a score.
- **Discovery no longer misses a plain CommonJS suite.** A follow-on to
  the config-scoped discovery fix above: the safety net that confirms a
  config-matched file transitively imports `@playwright/test` only
  walked ES `import`/`export ... from` syntax, so a suite written
  entirely in CommonJS (`require()`, no `import` anywhere) read as
  *definitive negative evidence* of not being a Playwright spec — the
  opposite of the truth — and hard-failed to 0 files the moment
  config-scoped discovery activated for it. Fixed by also recognizing a
  top-level `require('x')` call the same way as an ES import.
- **Config discovery and a config's `testDir` can no longer escape the
  scanned repo.** Hardening fixes for a public tool that reads an
  untrusted repo's own config. `findPlaywrightConfig` stops walking
  upward at the first ancestor directory containing `.git` (a directory
  for a normal clone, a file for a worktree/submodule), so a coincidental
  `playwright.config.*` sitting above the actual repo root — a shared CI
  runner, a monorepo checkout nested inside another one — is never picked
  up. The bug this closes: when no `.git` existed anywhere in the
  ancestor chain, the walk fell back to whatever directory it happened to
  stop at — the filesystem root, or 20 levels up — instead of a bounded
  repo boundary; used as the clamp for a config's `testDir`, that's
  effectively no clamp at all, and as the search bound for the config
  walk itself it made a filesystem-wide walk (in the worst case, a hang
  on a slow or deep filesystem) possible. It now falls back to the
  directory actually passed to the scorer, or the config file's own
  directory when that's the wider of the two — never the filesystem root.
  Symlinks got the same treatment: a `testDir` is now checked *after
  resolving symlinks* on both sides of the ancestor check, not just
  lexically, so a `testDir` that's a symlink to somewhere outside the
  repo can't launder an escape the plain path comparison would have
  missed (the glob's own `follow` option, already `false` by default for
  `**` patterns, is also now pinned explicitly). An escaping `testDir` —
  absolute (`'/'`), climbing out (`'../../..'`), or via a symlink — gets a
  `configWarnings` entry and falls back to filename-based discovery
  rather than globbing the clamped repo root with testMatch/testIgnore
  patterns written for a different directory. To be clear about the
  actual exposure this closes: a scored *result* was never able to
  include a file outside the scan root either way — index.ts always
  filters expanded matches back down to the caller's own requested
  directory — the risk was the walk/glob itself reading (or hanging on)
  parts of the filesystem well outside the repo, not a leaked finding in
  the output. Neither case is exercised by any corpus repo (a legitimate
  config never does this); found and fixed during this release's own
  review, not from a corpus regression.

### Behaviour change
- **Config-scoped discovery can lower a suite's score, not just raise
  it.** Scoping to what a target's own `playwright.config.*` actually
  declares is strictly more accurate than the old filename-suffix match,
  but "more accurate" isn't the same as "friendlier": `mattermost/
  mattermost` moves **84/B → 79/C (a pass→fail flip)** because its
  top-level config's `testDir` doesn't cover the real, correctly-written
  `upgrade-specs/` suite it runs only through per-project `testDir`
  overrides — `projects[].testDir` isn't read yet (see VALIDATION.md's
  "Known limitations"). A future config parser that reads
  `projects[].testDir` would recover this repo's full suite and its
  higher score.

### Corpus
Grown from 50 (2.0.0) to 100 public suites: 34 added in an interim,
unpublished pass (84 total — see VALIDATION.md for the full accounting of
that pass), then 16 more here for brand
recognition (Nextcloud, Ghost, Pinterest, Microsoft, The Guardian,
Shopify ×2, Adobe, Automattic, BBC, Google, Datadog, Twilio) plus three
named competitors (Checkly, Currents, LambdaTest), scored under the
exact same rules as everyone else. Every one of the 100 entries in
VALIDATION.md now carries the exact commit SHA scored and the date it
was tested, not just an aggregate "last run" date.

## 2.0.0 — 2026-09-23

**Scoring model v4 — `standard` scores change.** Owner direction: public
scores should reflect quality, full stop, not be softened to avoid moving
anyone's number ("I don't care who fails"). This supersedes the 1.1.0
plan of shipping these same rules as report-only under `standard`; 1.1.0
was never published. See METHODOLOGY.md's "Why v4" for the full
reasoning and VALIDATION.md for the complete before/after table across
all 50 corpus repos, including every pass→fail flip.

Corpus expanded from 17 to 50 real public repos (see
`scripts/validate-corpus.sh`) — every rule below was checked against real
findings across all 50 before landing, not just the fixtures.

### Scores changed
`standard` scores are **not** unchanged in this release (that was 1.1.0's
promise; it's void under v4). Against the last actually-published version
(1.0.0, model v3, none of these rules): 20/50 corpus repos move. Net
**+22** across the corpus, but that's almost entirely Flagsmith's `.pw.ts`
discovery fix alone (+62, previously hard-failed at 0 — its 20-spec suite
wasn't found at all). Excluding Flagsmith, the other 19 movers are **net
−40** (mean −2.1/repo) — real, quality-driven drops. Biggest: tldraw −9,
AFFiNE −5, activepieces −5, microsoft/vscode −4, sencho −2, cal.com −2,
then thirteen repos at −1. **Three pass→fail flips** at the default
threshold (80): `payloadcms/payload` (80→79), `microsoft/vscode`
(81→77), `tldraw/tldraw` (81→72). Pass rate: 37/50 (74%) → 34/50 (68%).
See VALIDATION.md for the full per-repo table and the "Known
limitations" this release documents rather than papers over. Two
acceptance bars now guard against these rules over-correcting: Playwright's
own official examples must still score >= 90/A (see
`tests/official-examples.test.ts`, vendored from microsoft/playwright),
and a hand-written "gold" fixture must still reach exactly 100.

### Added — four rules narrowing the gameability gap (scored under `standard`)
Narrowing, not closing: each rule matches specific known patterns (see the
respellings each one closed in this same release), not the general class
of "code that fakes stability or coverage" — a determined author can
likely still find an unmatched spelling. Real signal on real code, not a
guarantee nothing slips through.
- **`pwscore/no-timer-sleep`** (error) — flags a hard-coded sleep
  disguised past `playwright/no-wait-for-timeout`: `await new
  Promise((resolve) => setTimeout(resolve, ms))`, its `globalThis.
  setTimeout` and wrapped-callback (`setTimeout(() => resolve(), ms)`)
  respellings, and the unrelated but equally invisible `node:timers/
  promises` sleep (`await setTimeout(ms)`).
- **`pwscore/no-coordinate-click`** (**warning**, not error — see below)
  — flags coordinate-based mouse interaction (`page.mouse.click/dblclick/
  move/down/up(x, y)`, including a destructured `const { mouse } = page`
  binding) in place of a locator. **Known false positive, mitigated, not
  eliminated**: this is also the *correct* way to interact with
  canvas-based apps (whiteboard/drawing-tool suites with no addressable
  DOM element) — two infinite-canvas editors in the corpus (tldraw,
  AFFiNE) account for 428/459 of this rule's hits. Demoted to a
  warning-level (0.4, not 1.0) demerit rather than skipped for canvas
  apps by heuristic, which would itself become a new gameability surface
  — see METHODOLOGY.md's "Why v4" and VALIDATION.md's "Known
  limitations".
- **`pwscore/no-trivial-assertion`** (error) — flags an assertion whose
  subject and matcher combination can only ever pass regardless of
  anything the app under test does (`expect(true).toBe(true)`,
  `expect([]).toEqual([])`, `` expect(`x`).toBe(`x`) ``, `expect(1 +
  1).toBe(2)`). Always passes, satisfies `playwright/expect-expect`,
  verifies nothing about the app. Never flags a deliberate force-fail
  assertion that always *fails* (`expect(true).toBe(false)`,
  `expect(true, msg).toBeFalsy()`).
- **`pwscore/no-soft-assertion-only-test`** (warning) — flags a test
  whose every assertion is `expect.soft(...)`, so a failed check never
  fails the run. `expect.poll(...)` counts as a hard assertion (a failed
  poll still throws). Soft assertions are a legitimate, deliberate choice
  (gather every problem in one pass) in many suites, but a warning-level
  (not error) demerit as the default now that it's scored, not report-
  only.

### Added — inline `eslint-disable` comments are now a finding, not invisible
`pwscore/eslint-disable-comment` (warning) flags every ESLint suppression-
directive comment (`eslint-disable`, `eslint-disable-line`,
`eslint-disable-next-line`, block or line form) in a scored file — a real
demerit, same as everything else in this release. **Known limitation**:
it reports the presence of the comment, not which specific rule or
finding it silences — see VALIDATION.md.

### Fixed — an inline `eslint-disable` comment could still silence every finding it named
Found in review, before this ever shipped: adding the finding above was
not enough on its own — every rule this package enables is an ordinary
ESLint rule, and ESLint honors an inline disable comment by default, so
`/* eslint-disable */` on line 1 still silenced everything it named for
scoring purposes, same as it always had. A 10-test file (a hard wait plus
a tautological assertion in every test) scored 35/F; the same file with
that one comment on line 1 scored **99/A** — the new
`pwscore/eslint-disable-comment` finding was reported, but the four real
findings it was covering for were simply gone. ESLint 9's flat-config
`linterOptions.noInlineConfig` (see `eslint-runner.ts`) now makes every
inline directive comment inert for this package's rule set: the comment
itself is still scored via `pwscore/eslint-disable-comment`, but it can
no longer also make the finding it targets disappear. The "Known
limitation" above is narrower as a result — a disable comment can no
longer silence anything this package's own rules find, it just isn't
attributed to which specific rule it named.

### Removed — `strict` profile
1.1.0 (never published) planned a `strict` profile to gate the four rules
above and the `eslint-disable-comment` finding behind an opt-in, leaving
`standard` unchanged. With all of them scored under `standard` directly
as of v4, `strict` would be byte-for-byte identical to `standard` —
nothing left to gate. `--profile strict` on the CLI now errors with a
migration message; the library API degrades a legacy `'strict'` string
to `standard` weights, same fallback as the `guardian` profile's removal
in 1.0.0.

### Fixed — `.pw.ts` spec discovery
Directory/glob discovery now recognizes `*.pw.ts` (joining `.spec.`,
`.test.`, `.e2e.`, `.e2e-spec.`, `.e2e-test.`) — Flagsmith's entire
20-spec `frontend/e2e` suite (`billing-test.pw.ts`, `flag-tests.pw.ts`,
...) previously hard-failed as "no files matched" despite being a fully
healthy, populated suite, the same failure mode `.e2e.ts`/`.e2e-spec.ts`
were fixed for in 1.0.0 and its predecessors.

### Added — acceptance bars: official examples score high, 100 is reachable
`tests/official-examples.test.ts` vendors unmodified (attribution header
only) specs from microsoft/playwright (Apache-2.0; see
`fixtures/playwright-official/NOTICE.md`) and asserts each scores >= 90
and grades A under `standard` — three `examples/todomvc` specs (100/A
each) and `examples/github-api/tests/test-api.spec.ts` (97/A). Checked
that the 97, not 100, isn't an unfair penalty: the file's only finding is
`pwscore/eslint-disable-comment` on its own `/* eslint-disable
notice/notice */` licence-header lint escape (Playwright's monorepo
convention, unrelated to Playwright/test quality — see NOTICE.md), −3
points (structure dimension 100→80, weighted). That's correct, not a
bug: this project scores every suppression-directive comment as a real,
unconditional demerit regardless of what it's aimed at (see the "Added —
inline eslint-disable comments" entry above and VALIDATION.md's Known
limitations) — a licence-header opt-out is still, mechanically, an
`eslint-disable` comment. 97/A comfortably clears the >= 90 bar either
way.
`examples/svgomg/tests/example.spec.ts` was investigated and excluded
(79/C, genuine non-idiomatic CSS/text-selector usage predating current
Playwright locator guidance, not a scorer bug — documented in NOTICE.md).
A new hand-written `fixtures/gold.spec.ts` scores exactly 100 with zero
findings, proving 100 is reachable, not just a theoretical ceiling.

## 1.0.0 — 2026-08-28

First stable release. The scoring model (v3), CLI contract, library API,
and GitHub Action inputs/outputs are now considered stable — breaking
changes to any of them mean a major version bump from here on.

### Fixed — locator ratio
- **`getByAltText` and `getByTitle` now count as native locators.** They
  are part of Playwright's own `getBy*` family but were missing from the
  native set, so an image-heavy suite using alt/title locators plus a
  single `.locator()` fallback scored 0/100 on the locators dimension for
  perfectly idiomatic code. Scores can only improve or stay the same under
  this fix (the native count grows; raw counting is unchanged). The
  17-suite validation corpus was re-run — see VALIDATION.md.

### Added — public API for composing layers
- `getTestSpans` and `attributeFindingScopes` are now exported. A caller
  layering its own rules on top of `standard` (an extra private dimension,
  say) can attribute its findings to test/hook/module scope with the exact
  logic the package uses internally, then score the dimension with the
  already-exported `ratioDimensionScore` — reused, not reimplemented, so
  the math can't drift.

## 0.5.0 — 2026-08-27

### Changed — scoring model v3: "the weighted share of your tests that are clean"
- **The density model is gone.** v1/v2 scored findings per 25 lines of
  code through an exponential decay with a minimum-slots floor. That was
  unexplainable ("0.5 penalty units per slot"), structurally lenient on
  small suites, and gameable — padding a suite with clean lines diluted
  the penalty. All of it (K, slot divisor, minimum slots, per-rule caps,
  `e^-x`) is removed.
- **Model v3**: every finding is attributed to the test it sits in via AST
  test spans. A test accumulates demerits per dimension (error 1.0,
  warning 0.4, capped at 1 — a test is at worst fully flawed); findings in
  before/after hooks demerit every test in the file; module-level findings
  count once per file. Each dimension is
  `100 × (1 − demerits/tests)`; locators stays the native/raw usage
  ratio; final score is the weighted sum (40/25/20/15), unchanged grades.
- The motivating example (3 tests: two hard waits, two assertion-free, one
  skipped) scores **53/F** — it was 78/C under v1 density math and 64/D
  under v2.
- **In-house acronyms removed**: the score version is now plainly `v3`
  (JSON `scoreVersion: "v3"`); "sqs-*" no longer appears anywhere in
  output, docs, or code.
- `summary.cleanTests` added (tests with no demerit in any dimension);
  text output now prints `clean tests=N/M`.
- **Removed exports**: `SQS_V1`, `SQS_V2`, `penaltyDimensionScore`,
  `applyPerRuleCap` (the density machinery). `MODEL` and
  `ratioDimensionScore` replace them. Callers composing house rules on
  top (QA Guardian's `playwright_runner`) should migrate when they bump.

## 0.4.0 — 2026-08-27

### Changed — score version `sqs-v2`
- **Assertions dimension is now a per-test coverage ratio** instead of a
  finding-density penalty. sqs-v1's density math misread assertion
  coverage badly on small suites: 2 of 3 tests asserting nothing scored
  82/100 on the dimension (and the overall example suite 78/C) because two
  findings in a tiny file barely register per-SLOC. Whether a test asserts
  anything is a fraction of tests, not a smell rate — so, like the
  locators dimension, the primary signal is now
  `coverage = assertedTests / tests` (an **uncapped** census of
  `playwright/expect-expect` findings, taken after all delegation
  resolution), decayed multiplicatively by the density load of the
  remaining assertion-quality rules (`valid-expect`,
  `no-standalone-expect`, `prefer-web-first-assertions`). The motivating
  example now scores the dimension 33 and the suite 64/D.
- Everything else — weights, hygiene/structure density math, locator
  ratio, constants, grades — is unchanged. Per METHODOLOGY's change
  policy this is a new score version: results now report `sqs-v2`.
- `summary.unassertedTests` added to the JSON output; the text formatter
  prints `tests asserting=N/M`.
- `SQS_V1` export is deprecated and aliases `SQS_V2` (identical
  constants); it will be removed in a future release.

## 0.3.0 — 2026-08-27

### Fixed
- **Nine documented sqs-v1 rules never ran.** `buildConfig` spread
  eslint-plugin-playwright's `flat/recommended` config only when it was an
  array, but the plugin exports a single config object — so the whole
  recommended set was silently dropped, and every rule that relied on it
  was inert. Concretely: `no-conditional-in-test`, `no-conditional-expect`,
  `no-element-handle`, `no-eval`, `no-page-pause`, `no-useless-await`,
  `valid-expect`, `no-standalone-expect`, and `max-nested-describe` were
  all mapped to dimensions in `profiles.ts` (and METHODOLOGY.md's hygiene
  dimension explicitly lists "handles, conditionals") yet could never
  produce a finding. A spec whose tests were built entirely out of
  `if (await locator.isVisible())` branches scored a clean 100.
- The fix enables the intended rule set **explicitly and frozen** in
  `eslint-runner.ts` rather than re-spreading upstream `recommended`:
  eslint-plugin-playwright is a `^` range dependency, and inheriting its
  recommended set at install time would let identical code score
  differently across installs. Severities mirror upstream flat/recommended
  (2.x). `require-top-level-describe` remains deliberately disabled
  (stylistic; not in upstream recommended; would penalize idiomatic
  describe-less suites).

### Scoring impact
- The formula, weights, and constants are unchanged — this restores the
  *documented* sqs-v1 rule inputs, so the score version stays `sqs-v1`.
  Suites that use conditional test logic, element handles, `page.pause()`,
  or malformed/standalone `expect` calls will score **lower** than under
  0.2.0 (which could not see those findings at all). Clean suites are
  unaffected — all `good-*` fixtures score identically.

## 0.2.0 — 2026-08-19

### Removed
- **The `guardian` profile.** It was QA Guardian's own internal codegen
  house-rules layer — arbitrary product-specific conventions (e.g.
  "timeouts must be exactly 2000 or 20000ms") never claimed as official
  Playwright doctrine, and not part of this package's actual differentiated
  value (the aggregate score, locator-ratio tracing, assertion-delegation
  resolution — all in `standard`). Shipping one company's house rules
  inside a general-purpose public tool undermined the "this is a neutral
  community linter" positioning the rest of this project has been built
  around. `ProfileName` is now `'standard'` only; `--profile guardian` on
  the CLI now exits 2 with an explicit message pointing here instead of
  silently doing something unexpected. Passing an unrecognized profile
  string programmatically (e.g. a caller still pinned to the old contract)
  falls back to `standard`'s weights rather than throwing — a defensive
  guard, not an invitation to keep using it.
  QA Guardian's own `playwright_runner` now runs its private house-rules
  layer separately, composed with this package's public `standard`
  profile — verified byte-for-byte identical output to the old built-in
  `guardian` profile across every fixture and 15 real production specs
  before cutover. `penaltyDimensionScore`/`applyPerRuleCap` are now
  exported (they always existed internally) specifically so that
  composition — or anyone else building a similar house-rules layer on
  top of `standard` — doesn't have to reimplement the scoring math.
- `scripts/dogfood.sh` — it reached into a relative sibling-repo path that
  only exists inside this project's private internal monorepo, and
  defaulted to the now-removed `guardian` profile. Internal-only tooling
  that never belonged in a public repo; `scripts/validate-corpus.sh`
  (real public repos, no internal paths) is the tool for this now.

## 0.1.14 — 2026-08-19

### Fixed
- **CLI stdout truncation on large output.** `console.log(body)` immediately
  followed by `process.exit()` raced Node's async pipe write against
  process termination — for output over ~64KB (a real suite's 1,215-finding
  JSON report, ~370KB), the write was silently cut at exactly the pipe
  buffer boundary when stdout wasn't a TTY (piped to `jq`, a CI log
  processor, anything). No error, just truncated, invalid output. Found
  while building `scripts/validate-corpus.sh` — reproduced with `--out
  file.json` (full 376,920 bytes) vs. piped (exactly 65,536 bytes) against
  the same input. Fixed by using `process.exitCode` instead of
  `process.exit()` everywhere in the CLI, which lets Node exit naturally
  once pending I/O actually drains — the standard fix for this class of
  bug. 3 new tests spawn the real CLI binary as a child process (the only
  way to reproduce a stdout-pipe bug — the existing suite only ever called
  `scorePaths()` in-process).
- **`.e2e-spec.`/`.e2e-test.` naming conventions weren't discovered either**
  — the same gap as 0.1.13's `.e2e.` fix, one suffix short. Verified
  against Immich: 13 real Playwright specs named `*.e2e-spec.ts`,
  previously invisible, sitting alongside 31 *other* files using the
  identical suffix for `vitest`/`supertest` backend tests — correctly
  excluded by the existing `looksLikeNonPlaywrightTest` safety net once
  discovery found them. `SPEC_GLOBS` now also matches
  `*.e2e-spec.*`/`*.e2e-test.*`.

### Added
- **`scripts/validate-corpus.sh`** — re-runnable real-world validation:
  shallow/sparse-clones 17 real public repos fresh and scores each with the
  local build. See `VALIDATION.md` for the current results and the story
  behind every fix that came from running it.

## 0.1.13 — 2026-08-19

### Fixed
- **Directory/glob discovery only matched `*.spec.*`/`*.test.*` — a repo
  using `.e2e.` to disambiguate end-to-end specs from unit tests scored a
  hard 0/F ("no files matched") no matter how healthy its suite actually
  was.** Verified against a real, large, well-known repo (cal.com:
  `apps/web/playwright/` — 53 real Playwright specs, all named `*.e2e.ts`,
  zero `*.spec.ts`/`*.test.ts`). `SPEC_GLOBS` now also matches
  `*.e2e.{ts,tsx,js,jsx}`. Re-scored: 0/F, no files matched → 85/B, PASS,
  53 files / 278 tests found — and the findings are real (642
  `no-raw-locators`, spot-checked against the actual source), not noise
  introduced by the wider glob.
  `.e2e.` is also Cypress's own scaffolding convention, so
  `looksLikeNonPlaywrightTest` (the existing safety net for a broad glob
  sweeping in a different framework's tests) gained an explicit Cypress
  check — an import from `'cypress'`, or common `cy.*` command usage
  (`cy.visit`, `cy.get`, `cy.contains`, ...) with no import at all, since
  Cypress's globals are injected the same way React Testing Library's
  `screen` often is. Matched on specific command names, not a bare `cy.`
  prefix, so a Playwright spec with an unrelated local variable named `cy`
  is never caught by mistake.
  9 new tests, full real-world corpus re-verified with zero regressions.

## 0.1.12 — 2026-08-19

### Fixed
- **Assertion-helper delegation was invisible for class-based Page Object
  Models — `findLocalAssertionHelperNames` only recognized free functions
  and `const`-bound arrows, never a class method.** Since almost every
  real-world POM is written as a class, this meant the cross-file
  assertion-delegation tracing shipped in 0.1.11 didn't actually reach the
  common case. Now also collects `MethodDefinition` (`kind: 'method'`)
  candidates.
- **`.waitFor({ state })` (state defaults to `'visible'`) is now recognized
  as an assertion equivalent to `expect(...)`.** It exists only to verify
  a state, unlike an action method that merely throws on failure as a
  side effect — functionally the same as `expect(locator).toBeVisible()`.
  Matched on the exact property name `waitFor`, never confused with
  `waitForEvent`/`waitForURL`/`waitForResponse`/`waitForLoadState`/
  `waitForTimeout`, none of which are assertions.
- **Delegation through more than one call is now resolved within a single
  file** — e.g. a `waitForNotificationAndClose()` method calling
  `this.waitForNotification()`, which itself calls `.waitFor()`, two
  calls removed from anything expect-expect could previously see. A
  bounded fixed-point pass: any candidate calling (by name, any receiver —
  same matching eslint-plugin-playwright's own `assertFunctionNames`
  option already uses) something already recognized is added too, until
  no new names are found.
  Verified against the real suite this was found in (n8n): its
  `NotificationsPage.waitForNotificationAndClose` is exactly this shape,
  two calls deep, defined in the same file as `waitForNotification`. Files
  with an `expect-expect` finding dropped from ~15 to 5 across n8n's 256
  specs; the remaining ones are a different, disclosed pattern (some tests
  signal failure by throwing directly rather than asserting a state —
  still open, not attempted here). Re-verified against the full real-world
  corpus (Playwright, Supabase, Storybook, freeCodeCamp, OpenMRS,
  patient-chart, 15 real Guardian specs) with zero regressions.

## 0.1.11 — 2026-08-17

### Fixed
- **Page Object Model suites read as 0/100 on the locators dimension even
  when the suite uses native locators throughout.** A spec file that routes
  all interaction through an imported class (`canvas.addNode(...)` instead
  of `page.getByRole(...)` directly) has zero locator calls of its own —
  the real `getByRole`/`getByTestId`/`.locator()` calls live in a separate
  page-object file the scorer never looked at. Verified against a real,
  large suite (n8n's own e2e tests: 256 spec files, 1,046 tests, every one
  of them at 0 direct locator calls) — it scored 79/C and *failed* the
  default threshold for this reason alone; the suite's actual page objects
  use native locators almost exclusively.
  `src/import-graph.ts` now follows a spec file's *relative* imports
  (`./`, `../` only — never a bare package specifier, npm dependency, or
  path alias, which would need a real module resolver to resolve safely)
  to locate local dependency files within the scanned directory, and folds
  their locator counts into the suite-level ratio. Dependency files are
  never linted and never count toward SLOC/tests/findings — only their
  locator calls are attributed to the suite. Bounded deliberately (depth
  and file-count capped, confined to the scanned directory) so a large or
  circular import graph can't blow up cost. Re-scoring n8n's suite with
  this fix: 79/C (FAIL) → 95/A (PASS).
  As a byproduct of the same infrastructure, assertion delegated to an
  *imported* helper function (not just a same-file one, which already
  worked — see 0.1.7) is now also recognized by `expect-expect`.
- Fixed a related bug found while building the above: the import-tracing
  boundary was initially set to the scored spec files' own common
  ancestor, which is *narrower* than the actual project directory whenever
  specs live in a dedicated `tests/` folder sibling to `pages/`/
  `fixtures/` (the normal shape for this pattern) — every import climbing
  back out of `tests/` was rejected as "outside the boundary." Fixed by
  widening the boundary to the directory the caller actually pointed the
  scanner at. Does not apply when every input is an explicit file path
  with no directory to widen to — see the new regression test documenting
  that limitation.

## 0.1.10 — 2026-08-15

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
- **CI auto-publish** (`.github/workflows/publish.yml`): on push to `main`
  touching `package.json`, builds, tests, and publishes to npm only if the
  local version isn't already on the registry. Authenticates via npm's
  **Trusted Publisher (OIDC)** flow (`id-token: write`, no stored token) —
  chosen over a classic automation token specifically because npm is
  restricting 2FA-bypass tokens for direct publishing starting January 2027;
  OIDC isn't affected and has nothing to rotate or expire. Requires the
  trusted publisher configured once on npmjs.com (package settings →
  Trusted Publisher → GitHub Actions → repo `qa-guardian/playwright-score`,
  workflow `publish.yml`) and npm CLI ≥11.5.1 / Node ≥22.14.0 in the runner
  (both satisfied by `actions/setup-node@v4` with `node-version: '22'`).

### Chore
- No functional change beyond the above. Version bump to verify the new
  CI auto-publish pipeline (`.github/workflows/publish.yml`,
  Trusted Publisher/OIDC) works end-to-end against the real npm registry.

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
