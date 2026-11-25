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

## 3.0.0 — unreleased

3.0.0 is a new scoring model (v5) and a new gate. Most suites get a
different score, and whether a result passes now depends on what its tests
can miss, not on a score bar. The summary below is the net change against
2.3.0; the entries under "Changes in detail" describe each change on its
own, against the behaviour just before it, so a line such as "the score is
unchanged" there refers to that change alone.

### Breaking

- **Score model v5: the score comes from test states.** Every test gets
  one state: `excluded-empty`, `excluded-skipped`, `issue`, `unasserted`,
  `unverified` or `clean`. The score is
  `round(100 x (countedTests - chargedTests) / countedTests)`, the share of
  counted tests that are not charged. A test is charged when a certain
  finding sits in it or in a hook that runs for it (an `issue`), and, once
  that check is measured as certain, when it is `unasserted`;
  `summary.unassertedCharged` says which applies. Likely, advisory and
  needs-check findings, findings in shared files and findings outside every
  test never cost points. `scoreVersion` is `v5`. The four `dimensions` and
  `summary.cleanTests` are kept for information and no longer feed the
  score. `summary.unassertedTests` now counts the tests in state
  `unasserted`; it used to count `playwright/expect-expect` findings.
- **The default gate replaces the score bar of 80.** `pass` and the exit
  code no longer compare the score with 80. A result passes when its status
  is `scored`, when nothing named by `--fail-on` is found (default
  `passes-regardless`: a certain finding that lets a counted test pass
  whatever the app does), and, only when `--threshold` is given, when the
  score is at or above it. To keep the 2.x bar, pass `--threshold 80`
  (Action: `threshold: 80`). Without `--threshold` the JSON `threshold` is 0.
- **Exit codes.** `0` pass. `1` not pass, which now includes every
  `partial` result without `--allow-partial` and every `not-scored` result.
  `2` tool or usage error: an unknown option, an unknown `--fail-on` value
  or `none` combined with another value, or a `--max-seconds` /
  `--max-heap-mb` value that is not usable. A broken or looping link no
  longer ends the run with exit 2: the file is skipped.
- **`partial` and `not-scored`.** A spec that cannot be scored (a syntax
  error, over 1 MB, binary, unreadable, or cut off by `--max-seconds` or
  `--max-heap-mb`) is skipped instead of taking the whole suite to 0. The
  result is then `partial`, which does not pass unless `--allow-partial` is
  given. A suite with no file, no scorable file or no counted test is
  `not-scored`: score 0, grade F, exit 1 (a suite with files but no test
  could score up to 100 before). New JSON keys: `status`, `reason`,
  `coverage`.
- **GitHub Action 3.x.** Use `qa-guardian/playwright-score@v3`; the
  `version` input defaults to `3`. An empty `threshold` (the default) means
  no score bar; it used to mean 80. New inputs `allow-partial` and
  `max-seconds`. The Action runs the scorer once and gates with the CLI's
  default gate.
- **Removed rules:** `playwright/no-standalone-expect`,
  `pwscore/no-coordinate-click`, `pwscore/no-self-fulfilling-fallback` and
  `pwscore/no-soft-assertion-only-test`. A hand-check of their findings on
  real suites did not confirm a single real defect. The ids no longer
  appear in any output, and no other rule takes over their findings, so a
  suite that was charged for one of them can score higher.
- **Paths.** Finding paths are relative to the directory you scored. The
  `playwright-score/no-files` finding has `file: "."` and `scope: "module"`
  instead of an absolute path.
- **Pinned engine.** `eslint`, `@typescript-eslint/parser`,
  `eslint-plugin-playwright`, `glob` and `typescript` ship inside the
  package at exact versions, so a project's own TypeScript is no longer
  picked up by the parser. The JSON `engine` key names the versions loaded.

### Added

- **Tiers and forms.** Every finding carries a `tier`: `certain` (its
  check is listed as certain in the committed precision file, which is
  built from hand-checked findings), `likely`, `advisory`, or `needs-check`
  (not decided automatically, for example when an `expect` cannot be traced
  to Playwright's). A `form` says which shape of the rule a finding is.
  Text and markdown list certain findings first and likely ones under
  "Worth a look", and count the rest; SARIF levels follow the tier. Other
  new finding fields: `family`, `basis`, `docs`, `title`, `what`, `why`,
  `fix`, `evidence`, `confidence`, and for shared files `scope` and
  `usedBy`.
- **`testStates`**: one entry per test with its state, and for an `issue`
  test the findings that charge it (`chargedBy`). `outsideTests` lists the
  certain findings outside every test and hook. `summary.countedTests` and
  `summary.chargedTests` are the two numbers of the formula.
- **`--fail-on <list>`** (library `failOn`): `passes-regardless` (the
  default), `flake-risk`, `unasserted`, `shared` or `none`, combined with
  commas. The JSON `gate` object gives the settings used and every reason a
  result does not pass.
- **`--allow-partial`** (library `allowPartial`): a `partial` result can
  pass. A `not-scored` result never passes.
- **`--advice`** (library `advice`): shows the advisory findings, and the
  reasons for the findings not decided automatically, in text, markdown and
  the HTML report. JSON always has every finding.
- **`--shared` / `--no-shared`** (library `shared`): the shared files the
  specs import (page objects, fixtures, helpers) are checked by default with
  the rules that hold outside a test body. Their findings carry
  `scope: "shared"` and `usedBy`, and never change the score; they fail the
  gate only under `--fail-on shared`, and only when certain.
- **`--max-seconds <n>`** (no default) and **`--max-heap-mb <n>`** (default
  4608 on every machine): limits for the analysis, which now runs in a
  worker thread. A file a limit cuts off is listed in `coverage.skipped`.
- **`--markdown-out <file>`**: the markdown report of the same run, next
  to the main output.
- **`quotable`** on every finding: true only for a certain finding whose
  check passed the measured release path.
- **`excerpt`**: 1 to 5 lines of source at the finding.
- **A headline** on line 1 of the text and markdown output ("86 tests. 79
  have no certain issue. 2 would pass whatever the app does. ...") with the
  score on line 2, and a budget on how many locations each view shows.
- **New rules:** `pwscore/no-floating-callback-assertion` (an awaited
  assertion inside an async `forEach` callback, or an async `map` callback
  whose result is discarded), `pwscore/assertion-passes-anyway` (forms
  `root-content`, `match-anything`, `empty-fallback`,
  `form-control-text`), `pwscore/unchecked-read` (forms `discarded`,
  `unused-binding`), and the report-only `pwscore/loop-only-assertions`,
  `pwscore/negative-only-test` and `pwscore/unasserted`.
- **New forms of existing rules:** `prefer-web-first-assertions`
  `read-direct`, `read-reused`, `read-url-count` (new findings for
  `expect(page.url())` and `expect(await locator.count())`), `read-handle`
  and `read-compare`; `missing-playwright-await` `action`, `assertion` and
  `awaited-call-argument`; `valid-expect` `matcherless` and `escaped`;
  `no-element-handle` `handle-argument` and `locator-handle` (new findings
  for `elementHandle()` and `elementHandles()` on a locator); `no-page-pause`
  `gated`; `no-networkidle` `capture-window`; `unresolved` for the Page and
  Frame method rules when the receiver cannot be proven; `api-under-test`
  inside a project that implements Playwright; `foreign-expect` for an
  `expect` from another assertion library.
- **Aliases** of `page`, `test` and `expect` are followed where scope
  analysis proves them at the call.
- **Spec discovery and test recognition:** `*.spec.mjs`, `*.spec.cjs`,
  `*.test.mts`, `*.test.cts` and the `e2e`/`pw` suffixes; fuller reading of
  `testMatch`, `testIgnore` and `testDir`; tests declared through a curried
  test factory or with a named callback.
- **Two package names:** `pwscore` (primary) and
  `@qaguardian/playwright-score`, published together; both install a
  `pwscore` and a `playwright-score` command.

### Upgrading from 2.x

1. Decide whether you still want a score bar. 2.x failed below 80 by
   default; add `--threshold 80` (Action: `threshold: 80`) to keep that.
   Without it, only what `--fail-on` names fails the gate.
2. Expect a different score. v5 is the share of clean tests read from the
   test states: likely findings no longer cost points, and findings in
   shared code or outside every test never do.
3. A `partial` result fails. Fix the files listed in `coverage.skipped`, or
   pass `--allow-partial` (Action: `allow-partial: true`) if a skipped file
   is acceptable.
4. A suite with no counted test now exits 1 (`not-scored`).
5. Remove the four removed rule ids from `eslint-disable` comments and from
   any tooling that matches on them.
6. Move the Action to `qa-guardian/playwright-score@v3`.
7. Tooling that reads the JSON: new keys are additive. The values that
   change meaning are `scoreVersion` (`v5`), `pass` (the gate),
   `threshold` (0 without `--threshold`), `summary.unassertedTests` (the
   `unasserted` state count), `summary.files` (scored files) and finding
   paths (relative to the scored directory).
8. For output without shared-file findings, pass `--no-shared`.

### Changes in detail

- The `playwright-score/no-files` message echoes a path given as absolute relative to the working directory, and its SARIF level is `error`, as its JSON severity.

- The `playwright-score/no-files` finding now has `scope: "module"` and `file: "."` (the scored working directory, relative) instead of the absolute path of the working directory, so CI JSON, SARIF and PR comments no longer carry a local path.

- GitHub Action 3.x. `version` defaults to `3`. An empty `threshold` (the default) now means no score bar, as on the CLI; it no longer means 80. New inputs `allow-partial` and `max-seconds` pass `--allow-partial` and `--max-seconds`. The Action runs the scorer once instead of twice, and its messages describe the default gate. New CLI flag `--markdown-out <file>` writes the markdown report of the same run next to the main output (the Action uses it with `--format json --out`). The JSON contract (keys, types, exports, exit codes) is now checked by a test against the built package and the packed tarball.

- Actionable output and a noise budget. Text and markdown open with a headline on line 1 ("86 tests. 79 have no certain issue. 2 would pass whatever the app does. 5 have flake risk. 3 have no assertion. 2 certain issues in shared code (used by 4 spec files)."; a clause whose count is 0 is left out) and the score on line 2. Findings are shown by tier: certain issues first, then likely ones under "Worth a look"; findings not decided automatically get one count line, and advisory findings are hidden behind one count line. `--advice` shows the advisory findings and the reasons for the undecided ones in text, markdown and the HTML report. The views keep to a budget: at most 5 locations per file, 3 per rule group, 15 groups per run (10 in markdown); the rest are counted as "and N more". Syntax errors and the no-files reason are always shown in the status lines; a partial run lists its skipped files, a not-scored run names its reason, and certain findings outside any test are listed. SARIF levels follow the tier (certain `error`, likely `warning`, advisory and needs-check `note`) and each rule carries its docs URL as `helpUri`. JSON is unchanged except for `excerpt`: now 1 to 5 lines at the finding (the line, plus following lines while its brackets stay open), indentation cut, each line capped at 160 characters, taken from the text the run already read.

- The gate. `pass` and the exit code no longer compare the score with a default bar of 80. A result passes when its status is `scored` (or `partial` with the new `--allow-partial`, library `allowPartial`; `not-scored` never passes), when nothing named by the new `--fail-on <list>` (library `failOn`) is found, and, only when `--threshold` is given, when the score is at or above it. `--fail-on` takes `passes-regardless` (the default: a certain finding of that family in a counted test, in a hook in scope for one, or outside every test in a spec file with a counted test), `flake-risk` (the same for the flake-risk family and for `page.pause()` and focused tests), `unasserted` (a counted test in state `unasserted` or `unverified`), `shared` (a certain finding in a shared file whose `usedBy` names a spec file with a counted test) or `none`, combined with commas; an unknown value, or `none` with another value, is a usage error (exit 2; library: a `RangeError`). Without `--threshold` the JSON `threshold` is 0 and the text and HTML reports show no bar. The new JSON `gate` object gives the settings used and every reason a result does not pass. Every finding now always carries `quotable`, true only for a certain finding whose cell passed the measured release path. Findings, test states and the score are unchanged.

- Score model v5. The score is now the share of counted tests that are clean, read from the test states: `round(100 x (countedTests - chargedTests) / countedTests)`. A test counts unless it is `excluded-empty` or `excluded-skipped`; it is charged when it is an `issue` (a certain finding in the test or in a hook in scope for it) and, once that check is measured as certain, when it is `unasserted`. Until then an unasserted test is listed and counts as clean, and `summary.unassertedCharged` is `false`. `unverified` tests count as clean. Likely and advisory findings, findings in shared files and certain findings outside every test and hook never cost points; the last are listed in the new `outsideTests`. A suite with no counted test is `not-scored` (`no-counted-tests`): score 0, grade F, exit 1. New JSON keys: `summary.countedTests`, `summary.chargedTests`, `summary.unassertedCharged`, `testStates[].chargedBy`, `outsideTests` and `locators` (`native`, `raw`, `scored: false`). `scoreVersion` is `v5`. The four `dimensions` and `summary.cleanTests` keep their keys and values and are informational; the HTML report no longer shows a weight on each area. `computeScore` called on its own still returns the v4 number, labelled `v4`.

- New report-only rule `pwscore/loop-only-assertions`: a test whose every assertion, counted as for the test states (the test and the hooks in scope for it), sits inside a loop over `locator.all()`, `page.$$()` or a range bound to an awaited `count()`, with nothing before the loop that asserts the list or waits for an item. `locator.all()` does not wait for elements, so an empty list runs the loop zero times and the test passes having checked nothing. One finding per loop, likely tier, `info`; it never changes the score.

- New report-only rule `pwscore/negative-only-test`: a test whose every assertion, counted as for the test states (the test, the hooks in scope for it and the functions they call), checks that something is absent: `not.toBeVisible()`, `toBeHidden()`, `toBeVisible({ visible: false })`, `not.toBeAttached()`, `toBeAttached({ attached: false })` or `toHaveCount(0)`, with an action such as `goto` or `click` before the first of them, and no other assertion and no `waitForURL`, `waitForResponse`, `waitForSelector` or `waitFor()` anywhere in the test or its hooks. A locator that matches no element passes all of these checks, so the test would still pass if the page were blank or had not rendered the result. One likely finding per test, at its declaration; it never changes a test's state or the score. Scalar `not.toHaveText` and `not.toContainText` are not on the list: on a missing element they fail.

- Test states. The JSON result gets a `testStates` list with one entry per test, sorted by file and line: `excluded-empty` (the test makes no call), `excluded-skipped` (declared with `skip` or `fixme`, inside a skipped `describe`, or skipped by a first statement `test.skip()` or `test.skip(true, ...)`; a conditional skip does not count), `issue` (a certain finding in the test or in a hook that applies to it), `unasserted` (no assertion can be reached and every call in the test was followed), `unverified` (no assertion was found, but some call could not be followed; the entry names them) or `clean`. An assertion is a Playwright `expect` with a matcher (including `expect.soft`, `expect.poll` and `toPass`), a call into a known assertion library, or a `throw` under a real condition; one that `no-weak-assertion` or `no-trivial-assertion` reports does not count, and an assertion in a hook counts for every test the hook applies to. Calls are followed into the files the specs import (helpers, page objects, fixtures). Each `unasserted` test also gets one report-only finding, `pwscore/unasserted`, at its declaration. `summary.unassertedTests` now counts the tests in state `unasserted`; it used to count `playwright/expect-expect` findings. The score, grade, pass and every existing finding are unchanged.

- A file whose syntax tree declares no test counts no test. The test count of a scored file is the number of test declarations in its syntax tree. A file with none used to fall back to a text count, which read a function named `test` (a fake runner) or `/re/.test(s)` as a test: `summary.tests` and `coverage.testsCounted` counted it, it had no test state, and it raised `summary.cleanTests` and the informational dimensions. `summary.tests` now equals the number of `testStates`. The score, which is read from the test states, does not change.

- A test whose callback is a name counts and gets a state. `test('t', handler)`, `test('t', flows.login)` and `test.skip('t', handler)` with a string or template-literal title used to count no test. The callback is now read where it is declared, in the same file or through a relative import, when it is a function declaration or a const holding an arrow or function expression. A name that does not resolve to a function leaves the test `unverified`, under that name. Hooks still need an inline callback, and a runner that forwards `test(title, body)` still declares no test.

- `summary.findings` is the length of `findings` again. It had stopped counting the report-only findings added with the test states (`pwscore/unasserted` and `pwscore/loop-only-assertions`). No score, grade, pass or exit code reads it.

- The read forms and the capture-window form see the expect aliases. A `prefer-web-first-assertions` finding whose assertion uses a proven alias of Playwright's `expect` (`const check = expect`) can now take the form `read-handle` or `read-compare`, and a `no-networkidle` wait followed by an aliased assertion on a collection a listener fills is `capture-window`. In a file with an alias, every finding of the two rules is judged with the alias set.

- Shared files get the alias lints. A shared helper that asserts through a proven alias of Playwright's `expect` (`const check = expect`) is now listed with the findings the same helper gets when written with `expect`. Shared findings stay out of the score.

- Shared files are checked, by default: option `--no-shared` (library: `shared: false`) turns it off, and `--shared` restates the default. The shared files that are Playwright code (`coverage.sharedLintedFiles`: page objects, fixtures, helpers the specs import) are checked with the rules that hold outside a test body: a Playwright call or assertion that is not awaited (`playwright/missing-playwright-await`, `pwscore/no-unawaited-action`), `playwright/valid-expect`, `pwscore/no-unawaited-expect-value`, `pwscore/no-weak-assertion`, `pwscore/no-swallowed-assertion`, a one-time read of a value in an assertion (`playwright/prefer-web-first-assertions`, not the form where the value is used again), `playwright/no-networkidle`, `playwright/no-wait-for-selector`, `playwright/no-wait-for-navigation`, `playwright/no-wait-for-timeout`, `playwright/no-element-handle` and `playwright/no-page-pause`. Rules about test structure (a focused or skipped test, describe nesting, a test without an assertion, a branch in a test) never run on a shared file. Which rules run is a property of the rule catalogue (`onShared`). A finding in a shared file has `scope: "shared"` and `usedBy`, the sorted spec files that reach the file through imports; its tier is `likely` (or `needs-check` when the origin of its `expect` could not be resolved), never `certain`, because no shared cell has been measured yet. An assertion from another assertion library is not listed. A promise that a helper returns is not a finding, and neither is a call on the route inside a `page.route` handler. Shared findings never change the score, the grade or the pass value. Shared files are analysed with the specs, in the same batches and under the same `--max-seconds` and `--max-heap-mb` limits: a shared file a limit cuts off, or one that does not parse, is listed in `coverage.skipped` like a spec and the result is `partial`. With `--no-shared` the output is what it was before shared files were checked.

- Three findings move to a likely form when how the value or call is used leaves the intent open. No finding is added or removed. `no-element-handle`: a handle from `page.$()`, `page.$$()`, `elementHandle()` or `elementHandles()` that is only passed to a function that is neither a Playwright API nor `expect` (as in `const panel = await page.$('#pricing-panel'); await auditAccessibility(panel);`) takes form `handle-argument`, since that function may or may not accept a locator. `valid-expect`: an `expect(...)` without a matcher that is returned, assigned, passed as an argument or stored in an object, so a matcher may be applied elsewhere, takes form `escaped`; a bare statement, a value returned from a test callback and a variable that is never read stay `matcherless`. `no-page-pause`: a `page.pause()` that runs only when an `if`, the left side of `&&` or the test of `?:` allows it takes form `gated`. A finding in form `api-under-test`, `foreign-expect` or `unresolved` keeps it.

- `elementHandle()` and `elementHandles()` on a locator are reported. `no-element-handle` used to read only `page.$()` and `page.$$()`. A locator turned back into an element handle, as in `await page.getByRole('row').first().elementHandle()` or `const rows = page.locator('tr'); await rows.elementHandles()`, is now reported under the same rule with form `locator-handle` (likely). It counts only where the receiver is proven to be a Playwright locator: a `locator()`, `getBy*()` or `frameLocator()` chain on a proven page or frame (with `first()`, `last()`, `nth()`, `filter()`, `and()`, `or()` links), or a `const` bound to one. A parameter, a `let`, an object with its own `elementHandle` method or a helper's return value gives no finding. In a project that is a Playwright package the finding takes form `api-under-test`.

- Aliases are followed. `no-wait-for-selector`, `no-wait-for-navigation`, `no-element-handle`, `no-page-pause` and `no-wait-for-timeout` now also report a call on an alias of the `page` fixture (`const p = page`, an alias of an alias, or the fixture destructured under another name, `({ page: p })`), and `pwscore/no-unawaited-action` an unawaited action on such a renamed fixture. `no-focused-test` reports `.only` on a `const` alias of Playwright's `test`, and `no-networkidle` reports `'networkidle'` that reaches `waitUntil` or `waitForLoadState` through a `const` (an options object or a string). A name counts only where scope analysis proves it at that call: never a `let` or `var`, a parameter of any other function, a helper's return value, or a name shadowed by an inner binding. These findings carry `evidence: 'scope'`. No finding is removed or changed; a file with no such alias is linted exactly as before.

- `pwscore/no-swallowed-assertion` reports a negated assertion whose `.catch` discards the rejection even when a later assertion checks the same subject. `await expect(banner).not.toBeVisible().catch(() => {})` followed by `await expect(banner).toHaveText('Sale')` was exempt as a timed probe plus a real check, but the later positive assertion says nothing about the swallowed `not` condition. Discarding handlers: an empty function, `() => undefined`, or the name of a local function with an empty body. The exemption stays when the later hard assertion repeats the same negated check (a timeout-only options object aside). Non-negated chains and other handlers are unchanged. Severity unchanged.

- New rule `pwscore/no-floating-callback-assertion` (assertions, error). An awaited assertion inside an async `forEach` callback, or inside an async `map` callback whose result is discarded, is reported at the `forEach` / `map` call: neither method awaits the promises its callback returns, so the test can finish before the assertion runs and a failure never fails the test. `for...of` with `await`, `await Promise.all(items.map(async ...))` and a call whose result is awaited, assigned, returned or passed on are not reported. An `expect` proven to come from another assertion library gives no finding; one whose origin is not resolved is reported as `needs-check`. Tier `likely` until measured. Suites with this shape score lower.

- New rule `pwscore/assertion-passes-anyway` (assertions, warning). It reports an assertion that passes on almost any page, in four forms. `root-content`: `toBeVisible()`, `toBeAttached()` or `not.toBeEmpty()` on the document root (`locator('body')`, `'html'` or `':root'`) of a proven Playwright Page or Frame, also through `frameLocator(...)` and a `const`. `match-anything`: `toHaveText`, `toContainText`, `toHaveURL` or `toHaveTitle` given `/.*/`, `/^.*$/` or `/[\s\S]*/`, or `''` given to `toContainText` or to `toContain` on a string. `empty-fallback`: `toContainText(x ?? '')`, `toContain(x || '')` on a string, or `toMatch(new RegExp(x || ''))`, which only asks for the empty string when `x` is missing. `form-control-text`: `toHaveText('')`, or `not.toHaveText(...)` / `not.toContainText(...)` with a non-blank expected text, on a locator that is an `<input>` with a `type` other than `button`, `submit` or `reset` (for example `locator('input[type=email]')`): an input has no text content, so the check passes whatever was typed; `toHaveValue` checks what the field holds. A `textarea`, a `select`, a bare `input`, an `input` without a `type`, and role or placeholder locators are not reported. Every form is a likely finding, never a certain one. An `expect` proven to come from another assertion library is not reported, and one the scorer cannot resolve is reported as `needs-check`. The rule adds warnings to suites that use these shapes, so their score can go down.

- New rule `pwscore/unchecked-read` (assertions, warning). It reports a Playwright read whose result nothing checks, in two forms. `discarded`: a statement that is only `isVisible()` or `isHidden()` on a page, frame or locator, awaited or not; the call returns at once and its answer is thrown away. `unused-binding`: `const`/`let x = await <read>` in a test, hook or `test.step` body, where the read is a state (`isVisible`, `isHidden`, `isEnabled`, `isDisabled`, `isChecked`, `isEditable`), a text or value (`textContent`, `innerText`, `innerHTML`, `inputValue`, `getAttribute`, `allTextContents`, `allInnerTexts`), `count`, `title`, `url` or `boundingBox`, and `x` is never read. A name starting with `_` is left alone, and so is any receiver that is not syntactically a page, frame or locator. Both forms are likely, never certain.

- Shared files are reported. The files the specs import (page objects, fixtures, helpers) are now listed in the JSON `coverage` object, split in two: `sharedLinted` / `sharedLintedFiles` are the ones that are Playwright code, `sharedSkipped` / `sharedSkippedFiles` the ones that are not (each with a reason: `not-playwright-bound`, or `declaration-file` for a `.d.ts`). A shared file counts as Playwright code when it imports `@playwright/test`, `playwright` or `playwright-core`, or imports a shared file that does; when a parameter or field is typed `Page`, `Locator`, `Frame`, `BrowserContext` or `APIRequestContext` (a TypeScript annotation or a JSDoc type); when it calls `test.extend`; or when a function with a parameter named `page` calls a Playwright method on it. A spec is never a shared file. For this list a package that lives inside the repository is also found by its `package.json` name (a suite's own library next to its specs). The three lists mean three different things: `coverage.skipped` (spec files found and not scored; these make a result `partial`), `coverage.sharedSkipped` (shared files that are not Playwright code; these never do) and `skippedFiles` (files of another test framework).

- The analysis runs in a worker thread, with two limits. Files are found and classified first, as before; linting and the per-file checks then run in a worker, in sorted batches of 20 files, and the output is the same as before whenever no limit is hit. `--max-heap-mb <n>` (library: `maxHeapMb`) caps the worker's heap; the default is 4608 MB, a fixed number that is never taken from the host's memory, so a default run gives the same result on every machine. `--max-seconds <n>` (library: `maxSeconds`) is a time limit for the whole run, counted from its start, and has no default; finding and classifying the files always finishes, and after that no new step starts once the limit has passed. A file the worker gives up on is listed in `coverage.skipped` with reason `deadline` (the time limit passed before it was analysed) or `worker-died` (the worker ran out of heap, or stopped on an error, while it had the file's batch; after an error that is not the heap limit, a fresh worker takes the later batches). The result is then `partial`, also when no test is left to count (score 0, with the new reason `limit-reached`), and the exit code is 1 (0 only with `--allow-partial`), never 2. A worker that runs out of heap ends the analysis: its batch and every later one are skipped as `worker-died`, instead of a fresh worker dying again on each batch. A limit never changes which files count as Playwright files. A limit that is not usable is refused before any file is looked at: `--max-heap-mb` must be a whole number from 64 to 65536, and `--max-seconds` a number above 0 (CLI: usage error, exit 2; library: a `RangeError`). Library callers can pass `isolate: false` to run the analysis in the calling thread with no limits.

- Removed: `playwright/no-standalone-expect`, `pwscore/no-coordinate-click` and `pwscore/no-self-fulfilling-fallback` (zero measured precision). The hand-check of their findings on real suites did not confirm a single one as a real defect; a click at fixed coordinates, for one, is the correct way to drive a canvas. The three ids no longer appear in any output, and a suite that was charged for one of them can score higher. These are deletions, not renames: no other rule takes over their findings. `pwscore/no-soft-assertion-only-test` is removed too: it said a failed `expect.soft(...)` never fails the test, which is wrong (a soft failure still marks the test failed at the end), and none of 20 hand-checked findings was a real problem.

- A file that cannot be scored no longer takes the whole suite down. A spec with a syntax error used to make the whole run score 0; it is now skipped and the other files are scored. Three more kinds of Playwright file are skipped instead of scored: larger than 1 MB (only its first 1 MB is read, to tell what kind of file it is), a NUL byte in the first 8 KB (a binary file with a spec-like name), and a file that cannot be read (a broken or looping link, which used to end the run with exit 2, or a named pipe, which used to hang the run). Whether a file is a Playwright file is decided first, exactly as before, and only a Playwright file can be skipped: a file of another test framework is still listed in `skippedFiles`, and a config-matched file without a Playwright import is still left out, whatever its size. The JSON result gains `status`, `reason` and `coverage`. `status` is `scored`, `partial` (one or more files skipped; the score and findings cover the other files; `pass` is false and the exit code is 1 whatever the score) or `not-scored` (no files, every file skipped, or no tests found; score 0, grade F, exit 1, with `reason` `no-files` or `no-counted-tests`). `coverage` holds `filesFound`, `filesScored`, `testsCounted` and `skipped` (each skipped file with its reason: `parse-error`, `too-large`, `binary` or `unreadable`). A skipped file with a syntax error keeps its `playwright-score/parse-error` finding, so scoring a single unparsable file still reports it; its other findings (computed from text that does not parse) are dropped, and the finding marks the file without being a demerit on the other files. One result changes from a number to `not-scored`: a suite with files but no test at all (it could score up to 100 before). `summary.files` counts the scored files. A suite with no skipped file and at least one test scores exactly as before; its JSON only gains the new keys. On the command line a path written `./` + an absolute path (`.//home/me/e2e`, a directory or a file) now resolves to that path when nothing exists at the literal relative path. The text, markdown and HTML reports say when a result is partial and which files were skipped.

- Expect binding for the Playwright assertion rules. `missing-playwright-await`, `valid-expect`, `prefer-web-first-assertions`, `no-weak-assertion`, `no-trivial-assertion` and `no-unawaited-expect-value` read any call named `expect` as Playwright's. Each finding of these six rules now records where its `expect` comes from. When it is proven to be the one from `@playwright/test` or `playwright/test` (imported directly, through a local re-export, through a single-assignment `const`, or made from such an `expect` by `expect.extend(...)`, `expect.configure(...)` or `mergeExpects(...)`, in the spec or in a local module it imports), the finding is unchanged. When it is proven to be `expect` or `assert` imported or required from `chai`, `@jest/globals`, `vitest`, `expect` or `node:assert`, the finding gets form `foreign-expect` and tier `advisory`, with neutral copy; it stays in the JSON output. When the binding cannot be resolved (a global `expect`, an unknown package, an `expect` built by any other call, or by `extend`, `configure` or `mergeExpects` on an `expect` that is not proven to be Playwright's), the finding keeps its form and gets tier `needs-check`, and its `what` text gives the reason and the place, for example `expect binding not resolved (global or unknown package) in tests/a.spec.ts:3`. A `void`-ed `expect` is never tier `certain`. No finding is added or removed, and `rule`, file, line, column, `message`, `docs`, severity, the score, the grade and the pass are unchanged.

- An alias of Playwright's `expect` is checked like `expect`. `const check = expect; check(locator).toBeVisible()` was read by none of the assertion rules. `missing-playwright-await`, `valid-expect`, `prefer-web-first-assertions`, `no-weak-assertion`, `no-trivial-assertion` and `no-unawaited-expect-value` now check such a call, but only where the alias is proven, at that call, to be Playwright's `expect` reached through a single-assignment `const`: an alias of an alias, an alias of an `expect` made by `extend`, `configure` or `mergeExpects`, and a `const` alias exported by a local module all count. A `let` or `var`, a parameter or variable of the same name in an inner scope, and an alias of another library's `expect` never do. Each finding on an alias is the one the same rule reports when the alias is written as `expect`. Only files with such an alias are linted a second time, with these six rules; every other file is linted exactly as before. Other rules that look for `expect` (for example `expect-expect`) do not read an alias yet.

- Discouraged-API findings inside a Playwright package. `no-networkidle`, `no-wait-for-selector`, `no-wait-for-navigation`, `no-element-handle` and `no-page-pause` report APIs the Playwright docs discourage for people who use Playwright. A project that implements Playwright calls them in its own tests on purpose, so in such a project each finding of these five rules is still reported, with form `api-under-test` (advisory) and neutral copy; this form wins over every other form. The project is recognised from three manifests only, starting at the nearest `package.json` at or above the scanned path (never above the repository root): its `name`; the `name` of each `package.json` its `workspaces` globs match on disk; and a `packages["node_modules/<name>"]` entry with `link: true` in the `package-lock.json` beside it. It matches the names `playwright`, `playwright-core` and `@playwright/test`. A project that depends on these packages has registry entries, not `link: true` entries, so nothing changes for it; other lockfile formats are not read. No finding is added or removed, and the score is unchanged.

- Receiver forms of the Page and Frame method rules. `no-wait-for-navigation`, `no-element-handle` and `no-page-pause` are reported by method name on a receiver whose name looks like a page or a frame. Each finding of these three rules now records whether the scorer could prove that receiver is a Playwright `Page` or `Frame`: form `-` when it is the destructured fixture of a callback passed to Playwright's `test` (imported, required, re-exported by a local module, extended or merged), is annotated with the `Page` or `Frame` type of a Playwright package, or is only ever assigned from a Playwright factory call (`context.newPage()`, `page.mainFrame()`, `electronApp.firstWindow()`, ...); form `unresolved`, a likely finding with conditional wording, for everything else (untyped helper parameters, helper return values, page objects, reassigned variables). No finding is added or removed, no tier changes (the three rules were likely before and stay likely in both forms) and no other rule changes. `no-wait-for-selector` is not part of this: every one of its findings keeps form `-` and its earlier tier, certain, whether or not the receiver can be proven.

- Three more forms that say what a finding is, without changing what is reported. `prefer-web-first-assertions`: a read whose receiver is an ElementHandle (from `page.$`, `page.$$` or `locator.elementHandle()`) is form `read-handle`, because the defect is the handle and `no-element-handle` reports it; a read whose expected value is itself an earlier read of the page in the same test (`const prior = await tile.getAttribute('src'); ...; expect(await tile.getAttribute('src')).not.toBe(prior)`) is form `read-compare`, because a web-first matcher retries only its subject against a fixed expected value. `read-reused` and `read-url-count` win over both, and `read-handle` over `read-compare`. `no-networkidle`: when a `request`, `response`, `requestfinished` or `console` listener is registered on the page before the wait and a later assertion in the same test or hook uses what the listener collected, the finding is form `capture-window`: the wait closes a measurement window, it is not a readiness wait. All three forms are likely findings with their own title and advice. No finding is added or removed and none changes rule, position, message or severity; the score, grade and pass are unchanged.

- A form for an assertion handed to another call. A `missing-playwright-await` assertion (an `expect` chain, `expect.poll` or `test.step`) whose promise is passed straight, through nothing but type assertions, as an argument to a call that is itself awaited, returned or the body of an arrow function (`await inStep('pricing heading', expect(heading).toBeVisible())`) is form `awaited-call-argument`. The assertion is not awaited where it is written; whether it can still fail the test depends on whether the receiving function awaits it, which the call site cannot show, so the finding is likely, with its own title and advice. An argument inside an array, object, conditional or spread, a promise stored in a variable first, and an outer call that is not awaited keep form `assertion`; `foreign-expect` still wins, an unresolved expect stays needs-check, and actions are never touched. No finding is added or removed and none changes rule, position, message or severity; the score, grade and pass are unchanged.

- Forms of `prefer-web-first-assertions`. A read bound to a variable that is used again (`const shown = await banner.isVisible(); if (shown) {...} expect(shown).toBe(true)`) is now form `read-reused`, a likely finding, because the read cannot simply become a retrying assertion; every other read the upstream rule reports is form `read-direct`. `expect(page.url())` and `expect(await locator.count())` (directly, or through a `const` page, locator or stored value) are new findings of the same rule with form `read-url-count` (only with a matcher that has a web-first equivalent, such as `toBe`, `toEqual`, `toContain` or `toBeTruthy`; `toBeGreaterThanOrEqual(0)` and `toBeDefined` are left to `no-weak-assertion`); a variable is matched to the binding it actually sees, so a parameter, loop or catch variable of the same name is not a reuse; `expect.soft` is read like `expect`; a variable named like a page but built with `new` (a page object such as `const cartPage = new CartPage(page)`) is not read as a Page, so its own `url()` method is left alone; because they are new findings they can lower the assertions score of a suite that has them. A finding's tier now comes from the per-cell file `labels/precision.json` (schema 2): a listed cell has the tier the file gives it, any other cell is likely or advisory.

- Per-rule fixture gate. `tests/rule-fixtures.json` lists a set of small, docs-written TRUE and FALSE fixtures for every enabled rule (at least three of each for the rules that can reach the headline, including an alias form and a JavaScript form) and for each shape the rule must leave alone (route handlers, stored-then-awaited promises, `Promise.all`, `toPass` and `expect.poll` callbacks, return-position helpers, other test frameworks' `expect`, custom objects with a look-alike method). A fixture for a shape a later change will fix is marked `pending` with the change that fixes it, and the test fails if such a fixture already behaves as labelled. Tests only; no rule, score or output changed.

- Rule catalogue and additive finding fields. Every rule's title, plain-English copy, dimension, severity, report-only flag and display label now live in one table (`src/catalogue/`), replacing three hand-kept maps; the score, grade and pass are unchanged. Each finding in the JSON result gains `form`, `tier`, `family`, `basis`, `docs`, `title`, `what`, `why`, `fix`, `excerpt`, `evidence`, `confidence` and `quotable`. `tier` and `confidence` are generated from hand-checked rows (`labels/precision.json`, built by `scripts/build-precision.mjs`); `confidence` is the lower end of the 95% Wilson interval of the cell's decided precision, or null below five decided rows. A rule with several forms whose form cannot be decided carries no `form` and tier `needs-check`. A candidate cell stays `likely` until `labels/precision.json` records a passed release path.

- Deterministic installs. `eslint`, `@typescript-eslint/parser`, `eslint-plugin-playwright`, `glob` and `typescript` are pinned to exact versions, and all five ship inside the package (`bundleDependencies`), so the parser always loads the TypeScript this release was tested with. Before, a project that already had its own TypeScript (for example 6.x) at its root made npm (and, by the same hoisting, pnpm) install the parser next to it, and the parser used the project's copy; now npm and pnpm installs both load the pinned TypeScript. The JSON result gains an additive `engine` key with the `eslint`, `parser`, `plugin` and `typescript` versions actually loaded. On the test corpus scores, findings and every existing key are unchanged; a project whose install used to resolve a different TypeScript or parser may see different findings or scores after upgrading, because the engine is now the tested one.

- `valid-expect` exempts a returned matcher-less `expect` only when every caller in the file chains a matcher. One test that does `await banner(page).toBeVisible()` used to exempt the helper for a second test that calls `await banner(page)` and asserts nothing, so neither `valid-expect` nor `expect-expect` reported it. The helper is now reported as soon as one in-file caller drops the matcher. The helper's `expect` still counts as assertion evidence while at least one caller chains a matcher (callers are matched by helper name, so a sibling that drops the matcher is not reported by `expect-expect`, only through `valid-expect` on the helper); with no chaining caller it is no evidence at all, as before.

- `no-conditional-in-test` treats destructured awaited values as live state. `const [rows] = await Promise.all([loc.count()])` and `const { a } = await ...` (also nested, renamed, defaulted and rest bindings, and destructuring assignments) now mark every bound name as read from the page, so a branch on it is scored again instead of dropping to information only.

- `valid-expect` no longer hides a helper that returns a matcher-less `expect`. The exemption for `return expect(x)` from a named helper now applies only when a caller of that helper in the file chains a matcher on the result (`helper(x).toBeVisible()`, `(await helper(x)).not.toBe(..)`, or a stored result whose matcher is called later), or when the file exports the helper and nothing in the file calls it (callers are elsewhere). A helper whose callers never add a matcher is reported again, and its `expect` no longer makes it an assertion helper that clears `expect-expect` for its callers.

- Cross-file assertion helpers are matched through imports, not bare method names. A spec helper used to become an assertion helper (clearing `expect-expect` for its tests) when it called `anything.open()` and any file the spec imports defined an `open` method that asserts. Cross-file evidence now flows only through a call of an imported binding, or a method called on `this`, on an imported binding, on a value built with `new <imported class>` or on a parameter or variable typed with an imported class. A method called on an untyped parameter keeps only same-file evidence. A test that calls an imported asserting method directly is unchanged.

- `pwscore/no-timer-sleep` loop exemption is stricter. A loop pause counts as bounded only when the bound is in the loop's own exit path: the loop test, or the test of an `if` that guards the `break`/`return`/`throw`, compares a counter the loop steps with `++`/`--`/`+=`/`-=` (or `x = x + 1`), or compares the clock (`Date.now() < deadline`, or a value derived from the clock). A counter assigned from an awaited value, a bare `new Date()` read (a log timestamp), a `throw` in the body and `for...of`/`for...in` are no longer bounds. The unbounded UI poll (`count = await loc.count(); if (count > 0) break; sleep`), a fixed sleep after each click in a `for...of`, and a loop that only logs a timestamp are reported again.

- The package is now published under two names, and `npx pwscore <dir>` is the primary command. `pwscore` (unscoped) and `@qaguardian/playwright-score` (scoped) are released together from the same source on every version bump; `.github/workflows/publish.yml` publishes each name on its own, skipping one that already has the version, through `scripts/publish-name.mjs` (which only rewrites the `name` field for the publish). Both install a `pwscore` and a `playwright-score` command (`pwscore` is new in the `bin` map). `--help`, the README and the report footer now show `npx pwscore <dir>` first and name the scoped package as an alias; the README states that the project is not affiliated with Microsoft or the Playwright project. No rule, weight or score changed.

- The "Needs a human check" wording is replaced. It read as an accusation; the report heading, the text-output note, the confidence label, the headline line and the finding message now say the scorer cannot decide this one automatically and a person should look ("Not decided automatically"). Only wording changed: the JSON `confidence` value is still `needs-check`, and nothing is scored differently.

- Upstream eslint-plugin-playwright rules get post-filters and new severities, from a hand-check of real findings. `valid-expect` ignores an `expect`/`expect.poll` that is returned from a named helper or stored in a variable and given its matcher later. `no-conditional-expect` ignores an if/else chain where every arm (including a final `else`) asserts. `no-conditional-in-test` is scored only when the condition awaits or reads live UI state (a Playwright query such as `isVisible`/`count`, or a value read from one); other branches are information only. `no-useless-await` and `no-eval` are report-only. `prefer-web-first-assertions` skips `toPass` and `expect.poll` blocks. `missing-playwright-await` skips promises collected in an array that is awaited later. `no-wait-for-selector` is a warning (an error only when the wait is swallowed by try or `.catch`). `prefer-locator` ignores receivers that only start with `page` and helper-call receivers. Fixtures: `tests/precision-f.test.ts`.

- The "Needs a human check" note in the report and the text output no longer says "tests rely on helpers we could not read" for every report-only rule. That sentence is kept only when every item is an unverified-assertion finding; otherwise the note is neutral ("N findings are information only ...") and each report row shows the rule's own title.

- `pwscore/serial-mode-dependency` fires only on a real order dependency. It used to report every serial scope; in the hand-check sample only 4 of 18 decided hits were true, because serial mode is mostly used for mutual exclusion, a shared expensive setup or a single test. It now reports a serial scope only when one test assigns a shared variable that a later test in the same scope reads, and the message names the variable and both tests. The writer-before-reader analysis moved to `src/rules/shared-state-analysis.ts` and is shared with `no-shared-mutable-state` (behaviour unchanged there). A variable with an unordered pair is reported by `no-shared-mutable-state` only, never by both. Report-only as before.

- `pwscore/no-brittle-selector` is narrower on `.first()/.last()/.nth()`. Not reported any more: a comma-union selector (an either/or wait, any match will do), a locator already scoped under `getByTestId`/`getByRole`/a test-id selector, and a pick used only to check existence, count or an attribute (`.isVisible()`, `.count()`, `.getAttribute()`, `expect(..).toBeVisible()/toHaveCount()/toHaveAttribute()`). Still reported: a bare positional pick on an unscoped CSS/text locator used for an action or a text assertion, and every XPath selector. Report-only as before.

- `pwscore/no-excessive-timeout` has no score effect any more and is truthful about hooks. `test.setTimeout(N)` / `testInfo.setTimeout(N)` inside a `beforeAll`/`beforeEach`/`afterAll`/`afterEach` hook is no longer reported (it is setup or teardown waiting on a slow backend, and the old message said it "gives one test an extreme budget"). The rule's severity is now info (zero demerit): in the corpus hand-check only 4 of 20 hits were clearly wrong, and 14 were slow external steps (VM boot, ingestion pipelines, downloads) that a person has to judge. The messages now say "check this is a genuinely slow external step".

- `pwscore/no-shared-mutable-state` is stricter about what counts as shared state. (1) `.push/.set/.add/.delete/.clear/...` count as a mutation only when the variable is known to be a collection: initialised or assigned somewhere with an array, object, Map or Set literal or constructor. A call on anything else, such as an SDK client `payload.delete(...)`, is no longer read as a write. Plain assignment still counts. (2) A writer only counts for a reader that comes later in the file. (3) `made.yearTeam = x` does not feed a reader of `made.team`: when both sides name a static property and the names differ, the pair is skipped. (4) A reader that calls a same-file helper which assigns the variable is treated as doing its own setup. Still reported: an array pushed by earlier tests and read by a later one (the SSO tracer shape) and ids assigned in a create test and used by later tests.

- `pwscore/no-fixme-test` now says what is actually true about each case. `test.fixme(true, 'reason')` (at describe level or in a test body), a fixme with a tracker reference or re-enable condition in the comment directly above it, and a fixme after a pushed annotation are reported as info with a message that does not ask for a reason; empty-body `test.fixme('t', () => {})` placeholders are info ("empty placeholder"). A fixme with nothing to explain it, including a bare `test.fixme()` and a bare declaration, keeps the warning, and its message now asks for a reason in plain words. Severity can now differ per message of one rule. Docs: `scrollIntoViewIfNeeded` is added to the METHODOLOGY list of actions `no-unawaited-action` covers (it already did).

- `pwscore/no-timer-sleep` no longer fires on sleeps that are not a test waiting for the page. Not reported: a delay inside a `page.route()`/`context.route()` handler, or inside a function assigned onto an object member (a stubbed method that fakes latency); a delay of 0 ms; a delay that is one arm of `Promise.race`; and the pause in a `for`/`while`/`do` loop whose body can `break`, `return` or `throw` and that is bounded by an iteration counter or a deadline (a capped poll or retry; an unbounded fixed-interval poll is still reported). A plain fixed sleep before an action or assertion, an in-browser sleep inside `page.evaluate`, and a loop with no exit are still reported. Corpus hand-check: 21% of the sampled hits were right; the 11 wrong ones were mostly latency injection.

- `pwscore/no-trivial-assertion` no longer fires on constant assertions that are not a claim about the app: `expect(true)` in one arm of an if/else whose other arm fails on purpose (`expect(false)` or a `throw`), `expect(true)` inside a dummy listener or local helper function nested in a test, a type-level check on a value with a non-primitive type annotation (`const name: keyof typeof x = 'a'`), and any constant assertion inside `test.skip`/`test.fixme`. Filler `expect(true)` after real steps, an else arm that just passes, and an `if` with no `else` are still reported. Severity unchanged.

- `pwscore/no-swallowed-assertion` no longer fires on a timed probe that is followed by a real check. Not reported: a try/catch or `.catch()` around an expect when a later hard assertion checks the same subject, when the catch performs an awaited action and then asserts or waits, when a flag set in the try is read afterwards, when an `expect.poll` callback is read again afterwards, or when the try returns on success and an assertion follows. A catch that only logs or ignores, with no later check of the same thing, is still reported. Hand check: 7 of 25 sampled findings were this shape. Severity unchanged.

- Spec discovery now finds every spec file a real suite has. Specs named `*.spec.mjs`, `*.spec.cjs`, `*.test.mts` and `*.test.cts` (and the `e2e`/`pw` suffixes) are discovered, parsed (`.cjs`/`.cts` as CommonJS, the rest as ES modules), linted by every rule and counted, matching Playwright's own default `testMatch`. A playwright config is now read more fully: `testMatch` / `testIgnore` may be a string, a regex literal or an array of those, per project as well as at the top level (a file counts if any project matches it); `testDir` may be `__dirname`, `import.meta.dirname` or `path.join/resolve` over those; `const config = {...}; export default config` is understood; and a string `testMatch` is matched against the absolute path, so a pattern that names directories above `testDir` works. A spec-named file (`*.spec.*`, `*.test.*`, `*.e2e.*`) picked up by a config is no longer dropped just because it imports `test` from a wrapper package or a tsconfig path alias. A config that cannot be read statically still falls back to the default names, with a warning. Suites that scored "0 tests / F" for these reasons now score; no rule weight or severity changed.

- Tests declared through a curried test factory, `factory({...})("title", async ({ page }) => {...})` (also `.only`/`.skip`/`.fixme`), are now recognised as tests when `factory` is a function that returns `test.extend(...)` (same-file or imported). They count in `summary.tests` and are attributed and checked by the package's own rules. A curried call whose inner callee is not a known factory changes nothing. No rule weight or severity changed.

- File scope fixes. (1) Unit-test files are no longer scored as Playwright specs: imports from `vite-plus/test`, `vitest/*` and `@vitest/*` join the non-Playwright denylist, and a directory/glob-matched file that calls bare global `it(`/`describe(` (or `vi.fn`/`jest.mock` style mocks) with no `@playwright/test` mention, no `test(` call and no import that binds `it`/`describe` is skipped too; one real Vitest directory had produced 39,892 false `no-standalone-expect` hits. Files named explicitly are always scored, and a file that imports `test` from a local fixtures file, workspace package or path alias is kept. (2) Finding paths are now relative to the directory you scored (the common ancestor of the path arguments, widened only if a config-discovered spec lies outside it), not to the specs' own common ancestor or the config `testDir`, so every printed path opens from there; `skippedFiles` use the same base. A single file argument is relative to its own directory. (3) `test.skip('title', fn)` and `test.fixme('title', fn)` declarations no longer raise `playwright/expect-expect`; they never run and the structure rules already count them. No rule weight or severity changed.

- Helper and page-object resolution fixes, so `playwright/expect-expect` and `playwright-score/assertion-unverified` stop firing on tests whose assertions live in imported code. (1) An import written with a JavaScript extension (`import { x } from './helper.js'`, the TypeScript ESM convention) now resolves to its `.ts`/`.tsx` source (`.mjs` to `.mts`, `.cjs` to `.cts`); before, no such import was ever followed. (2) Bare imports that point into the same repository are resolved: tsconfig `paths` and `baseUrl` aliases (nearest tsconfig.json, `extends` followed two levels, comments and trailing commas tolerated) and workspace packages (`package.json` `workspaces`, `pnpm-workspace.yaml`; a `dist/` entry maps to `src/`). Resolved files must stay inside the scored repository, and npm packages are still never read. (3) The assertion-helper delegation chain now crosses files: a helper in a spec that calls an imported page-object method that asserts is itself an assertion helper. A helper that is resolved and really contains no assertion still raises `expect-expect`, and an import that cannot be resolved stays a report-only `assertion-unverified`. No rule weight or severity changed.

- Helper resolution is bound to imports. An assertion helper now clears `expect-expect` only in specs that define it or reach its file through imports and re-exports; a same-named helper in an unrelated file no longer hides a test that asserts nothing. Across files only a real `expect` is passed on: a wrapper that just calls a `.waitFor()` helper in another file is not an assertion helper, and neither is a setup-shaped wrapper (`awaitBootstrap`, `setupPage`, `seedData`...) that reaches an `expect` only through helpers in other files. Same-file behaviour is unchanged. No rule weight or severity changed.

## 2.3.0 — 2026-11-14

Scoring weights and the scoring model (v4) are unchanged, but **scores can
fall**: this release adds ten rules that catch tests which would miss a real
bug or flake, and suites that use those patterns now lose points. Nothing
gets more lenient. Two of the new rules are report-only (shown in the report,
no effect on the score): `pwscore/no-self-fulfilling-fallback` (info, no real
suite hit it yet, validated on fixtures only) and `pwscore/no-brittle-selector`
(its cost is already counted by the raw-locator ratio), plus
`pwscore/serial-mode-dependency` (info).

New rules, flake risk (QAG-287 slice 2b):

- `pwscore/no-unawaited-action` (error, hygiene): Playwright action or navigation on a Page/Locator as a bare statement without `await`.
- `pwscore/no-brittle-selector` (warning, report-only): XPath, `:nth-child`, 4+ combinator CSS chains, generated class names, positional `.first()/.nth()/.last()` on a raw `.locator()`.
- `pwscore/no-shared-mutable-state` (warning, structure) and report-only `pwscore/serial-mode-dependency` (info): state written in one test and read in another. Not flagged when the writing and the reading test both sit in a serial describe (`test.describe.serial` or `test.describe.configure({ mode: 'serial' })`, at file or describe level), wherever the variable is declared; flagged when either test is outside serial scope. Plus a report-only note for serial describe blocks.
- `pwscore/no-excessive-timeout` (warning, hygiene): option timeouts over 60s (exactly 60s is not flagged), `test.setTimeout` >= 5 min, unconditional `test.slow()`.

New rules, tests that would miss a real bug (QAG-287 slice 2a):

- `pwscore/no-fixme-test` (structure, warning): unconditional `test.fixme('t', fn)`, `test.describe.fixme(...)`, in-body `test.fixme()` and `test.fixme(true, ...)`. `test.fixme(condition, reason)` stays clean.
- `pwscore/no-swallowed-assertion` (assertions, warning): `expect(...)` inside a `try` whose `catch` neither rethrows, asserts, fails, returns a value, records state nor calls `.skip(...)`; and `await expect(...).catch(() => {})` with the result discarded. Retry loops are not flagged. Warning, not error, because some real suites use deliberate soft checks.
- `pwscore/no-weak-assertion` (assertions, error): `expect(count).toBeGreaterThanOrEqual(0)`, `expect(<Locator>).toBeTruthy()/toBeDefined()/not.toBeNull()`, `expect(await x.isVisible()).toBeDefined()`.
- `pwscore/no-unawaited-expect-value` (assertions, error): a Promise-returning Playwright call such as `page.title()` or `locator.innerText()` used without `await` inside `expect()` with a non-web-first matcher. Replaces the misleading `playwright/prefer-web-first-assertions` message on the same line.
- `pwscore/no-self-fulfilling-fallback` (assertions, info, report-only): a negated state check (or a `catch` of a failed expect) whose fallback fills in or selects the value itself (click-only fallbacks are setup and stay clean), followed by an assertion on the same locator.

Fix (test-factory recognition): tests declared through a factory function (`const t = testWithConfig({...}); t('x', ...)`, in the same or an imported file) are now recognised as tests, removing false `playwright/no-standalone-expect` errors.

New report format (QAG-288), output only:

- New `--format report`: a one-page, self-contained HTML suite report
  (headline, dimension bars, top findings with code excerpts, flake risk,
  items needing a human check, next steps). Light/dark, phone width, prints
  to one or two pages. All source and paths are HTML-escaped. `--output` is
  accepted as an alias of `--out`. New `--name <suite name>` sets the report
  headline. Without it the label is the last two path segments (three when the
  folder is generic, e.g. `e2e` or `tests`); it never includes a home directory
  or anything above it, and a home directory itself is labelled "Playwright suite".
- Findings are ranked with a display-only confidence tier (high / medium /
  needs-check) and every rule has a plain-English title. The text and
  markdown formats list findings by severity, then confidence, instead of
  file order.
- The report states how many tests need a human check (the report-only
  `playwright-score/assertion-unverified` findings, kept out of the score),
  groups them by file, and reads "why it matters" in business terms. A suite
  hard-failed by an unparseable file says so in the headline.
- Results gain an optional in-memory `baseDir`, used only by the report to
  read code excerpts. It is never printed and is not part of the JSON, SARIF,
  markdown or HTML output. A rule without plain-English copy renders with a
  generic title instead of failing.

Report and terminal polish (QAG-288 slice 3b), output only, scores unchanged:

- The HTML report is now a Summary page plus a Details part. The Summary
  (score, score by area, top 3 findings as rows without code, next steps) prints
  on one A4 or Letter page; Details (code excerpts, findings 4-5, the
  human-check list) starts on page 2. The duplicate "Flake risk" table is gone:
  each top finding names the file with the most occurrences, and Details lists
  the most flake-prone files.
- A line under the score explains it (weighted average of four areas, the
  grade bands, the pass bar; "your bar" when `--threshold` was passed). "clean"
  became "have no issues".
- Confidence reads Definite / Likely / Needs a human check, with one legend
  line and neutral tags (fixes the 3.95:1 contrast failure of the amber tag).
  The four areas are named Reliability, Checks, Resilience to UI changes and
  Maintainability (the JSON keys are unchanged).
- A suite with a syntax error or no tests shows "Not scored" instead of
  "0/100 F", with no zero bars and consistent counts.
- Rule copy says "can" instead of "will" for outcomes static analysis cannot
  prove. The weakest area gets a slot in the top 3 when it scores under 75.
- A rule that throws while scoring no longer vanishes silently: the run still
  finishes, the CLI prints `warning: rule <id> crashed on <n> node(s); results
  may be incomplete` to stderr, the text, markdown and report formats say "Some
  checks could not run on this suite; results may be incomplete.", and the JSON
  result gains `ruleCrashes: [{ rule, count }]`, only when a rule crashed (JSON
  of a clean run is unchanged).
- A suite with no tests no longer lists the working directory as an issue, and
  it is "Not scored" rather than "0/100 F".
- Without `--name`, the suite name falls back to the last two or three path
  segments for a folder (never above the home directory), so
  `e2e-tests/playwright` is no longer just `playwright`.
- Terminal output (`--format text`) is grouped by rule, worst first, with a
  count per rule, relative paths, at most three locations per rule (`+ N more`)
  and at most ten rules; it opens with the verdict and repeats it on the last
  line. `--format json`, `sarif` and `markdown` are byte-identical to before.

## 2.2.0 — 2026-11-14

False-positive fixes found by hand-checking error-level findings on public
suites (7 of 18 were wrong), then tightened after review so the fixes cannot be used to hide a test with no assertion. No rule's weight or severity changed, so this
is not a new scoring model (still v4), but **scores can rise**: findings
that were wrong are no longer reported. Nothing gets stricter.

- `playwright/expect-expect`: a test that asserts through a fixture
  function injected via the test args is no longer reported as having no
  assertion, but only when the fixture is a callable that really asserts:
  a `test.extend({ check: async ({ page }, use) => { await use(async () =>
  { await expect(...) }) } })` entry whose function handed to `use(...)`
  runs `expect`, the test destructures it AND calls it, and the fixtures
  module is reachable from that spec through relative imports. An `expect`
  in a fixture's setup or teardown does not count, nor does any fixture
  named like a built-in one (`page`, `context`, `request`, ...). A test
  also counts as asserting through an object-literal method / class-property
  arrow function in a file it imports (a fixture factory's returned object,
  a page object), except that a helper whose name collides with a Playwright
  method (`goto`, `click`, `fill`, `check`, `get`, `post`, ...) is never
  treated as an assertion helper, so it cannot turn every `page.goto()` into
  an assertion. When a test has no `expect` of its own but calls an
  assertion-named method (`assert`, `verify`, `check`, `validate`, `expect`,
  `ensure`, `should`, `confirm` followed by an upper-case letter, `_`, a digit
  or nothing, such as `checkTotals` but not `checkout`; or `toBe*`, `toHave*`,
  `toContain*`, `toMatch*`, `toEqual*`, `toThrow*`) on an object this scan
  cannot read (an injected fixture from another package, an unresolvable
  import, a third-party package), it is no longer an error: it is reported
  as the report-only finding `playwright-score/assertion-unverified`
  ("needs a human check"), which does not lower the score and is not
  counted in `summary.unassertedTests`. Those tests are counted separately
  in `summary.unverifiedTests`, a new field that is always present in the
  JSON output (`0` when nothing is unverified; the text and Markdown reports
  show those tests as unverified, never as asserting): they are not known to
  assert. A fixture a test calls, whose `test` comes from a module the scan
  does not resolve (a tsconfig `paths` alias, a workspace package), is
  unverified the same way. Names bound by destructuring
  (`const { channelsPage } = await pw.login(user)`) take the kind of the
  expression they come from. Query-style names (`is...`, `has...`,
  `wait...`), helper methods named like Playwright actions (`fill`, `check`,
  `goto`, ...), built-in calls (`new Date().toISOString()`,
  `user.email.toLowerCase()`, `x.toString()`), `shop.checkout()` and
  `loginPage.rememberMe.check()` are not treated as assertions: a call whose
  name is not assertion-like, a test that only calls Playwright API on
  `page`/`request`/..., and helpers whose body we can read and which do not
  assert are still `expect-expect` errors.
- `pwscore/no-trivial-assertion`: `expect(pageErrors).toEqual([])` where
  `pageErrors` is a `const` array that may be mutated (passed to a call as
  an argument, the receiver of `push`/`pop`/`splice`/`sort`/..., an
  assignment target, aliased, or captured by a closure that does one of
  those, such as a listener, or an inner array reached through an index:
  `rows[0].push(9)`) is no longer flagged. A `.length` or index
  read, a non-mutating method such as `.map()`, and an unrelated property
  with the same name (`obj.expected`) do not count as mutation; literals
  and a `const` array that is only read are still flagged.
- `pwscore/no-timer-sleep`: a retry/backoff pause inside a plain helper
  function (declaration, `const f = () =>`, class method) is no longer
  flagged, but only when the sleep sits in a `catch` clause or in a loop
  whose body contains a non-empty `try` with a `catch`, and the helper is not declared inside
  a test, hook, describe or step callback. Sleeps directly in a test body or
  hook, any loop without `try`/`catch` (including a hand-rolled
  `while (await x.isVisible()) sleep()` polling wait), helpers declared
  inside a test callback, and bare `sleep()` helpers are still flagged.
- `playwright/no-conditional-in-test`: a guard whose only body is `throw`
  (`if (!id) throw new Error(...)`, no `else`) is no longer flagged.
- `playwright/valid-expect`: a helper whose name merely ends in `Expect`
  (`clickSortableHeaderAndExpect(...)`) is no longer reported as an
  `expect()` without a matcher.
- Known and not fixed: `playwright/no-standalone-expect` on tests declared
  through a factory function that returns a `test.extend(...)` result
  (`const t = testWithConfig({...}); t('name', ...)`). The alias detection
  only follows direct `test.extend` chains.

## 2.1.1 — 2026-09-26

Scoring model stays v4. Reviewer follow-ups from the 2.1.0 release review
(QAG-230) — none of these blocked that release. They close symlink-escape
gaps a crafted repo could otherwise use, quiet a false warning, and fix a
false-positive drop the first round of these same fixes introduced. None
of that changes what an ordinary suite with no symlinked spec files
scores; the realpath dedupe fix below is the one exception — it can
change the file/test count for a suite that has a symlinked spec file
matching discovery alongside its own real target, and says so.

### Fixed
- **A match escaping the *repository* through a symlink is now dropped —
  scoped to the repo root, not the narrower directory the caller pointed
  at.** `testDirEscapesRepo` (added in 2.1.0) only clamps a config's
  `testDir` itself before it becomes a glob root — it couldn't see a
  symlinked directory the glob then walked *through* on the way to an
  individual match. A `testMatch` entry that names a symlinked directory
  by a literal path segment (not a `**` wildcard) is still followed even
  with glob's `follow: false` (that option only stops `**` from
  *expanding into* a symlinked directory, not a pattern from naming one
  explicitly), so a crafted repo (`tests/evil -> /`, `testMatch:
  ['evil/**/*.ts']`) could make discovery walk arbitrary parts of the
  filesystem while every match still lexically looked like it lived
  under the scanned directory. The same gap let an individually
  symlinked spec file sitting directly in the repo (no `testMatch`
  trickery needed) resolve to, and get scored from, a file outside it.
  `src/index.ts`'s match loop realpath's every candidate match and drops
  it unless it's still contained within the realpath of the **repository
  root** (`safeRealpath(findRepoBoundary(abs))`) — not, as this package
  first shipped it, the narrower directory the caller actually scanned.
  That first version silently dropped a real, common monorepo shape too:
  a spec reachable through an in-repo symlink that resolves to a sibling
  directory *outside* the caller's scanned subpath (one package's specs
  shared with another via a symlink) is legitimate and is kept; only a
  match whose realpath lands outside the repository itself is dropped.
  The same repo-root containment now also applies to a bare glob-pattern
  input (e.g. `tests/*.spec.ts` passed directly to `scorePaths`, not a
  directory it walks itself) — the first version of this fix only
  covered the directory-scan branch, so switching an otherwise-identical
  call from a directory argument to an equivalent glob argument silently
  bypassed the guard entirely.
- **The walk itself is now pruned at a symlink that escapes the repo
  root, not just filtered after the fact.** The realpath containment
  check above still has to pay to walk all the way through a symlinked
  directory before dropping every match inside it one by one — for a
  large or slow target (`tests/evil -> /`) that's a real cost, not just
  a theoretical one (measured: ~6.4s to fully walk a large symlinked
  directory before this fix). `RepoBoundaryIgnore` (`src/index.ts`) wraps
  glob's own `ignore` matching with a `childrenIgnored` check that stops
  the walk from ever descending into a symlinked directory whose
  realpath lands outside the repo root, only paying the realpath cost at
  an actual symlink (a plain nested directory can't walk outside a root
  its own parent is already inside, so it's never checked).
- **An in-repo symlinked spec and its own real target are no longer both
  scored, when both independently match discovery under the same scan.**
  Pre-existing, not new to the fixes above: `expandPaths` deduped a
  literal path only against `explicit` inputs, never against another
  `expanded` match that happens to resolve to the same realpath. A
  symlink sitting alongside its target inside the same scanned directory
  (or reachable via two different scan roots in one `scorePaths` call)
  was counted, and scored, twice. Now deduped by realpath, keeping the
  first lexical path in sorted order. **This can change file/test counts
  for a repo that has such a link** — said plainly here rather than
  folded into "doesn't change what a correctly-shaped suite scores",
  since a suite with this exact shape is exactly what changes.
- **False "testDir resolves outside the repository" warning on a
  nonexistent `testDir` under a symlinked repo path.** `safeRealpath`
  only resolves the portion of a path that exists on disk, so a
  nonexistent `testDir` kept its literal, unresolved form while
  `repoRoot` (which does exist) got fully resolved — on a host where the
  repo itself sits under a symlinked prefix (macOS: `/tmp` ->
  `/private/tmp`), that asymmetry alone made the two sides disagree and
  fired a false escape warning for an ordinary missing `testDir`.
  `testDirEscapesRepo` now checks existence first and returns "does not
  escape" immediately for a `testDir` that isn't on disk — consistent
  with `resolveConfigScopedRoot`'s own existing "nothing to score there"
  handling for the same case.
- **Escape warning now prints cwd-relative paths**, matching every other
  `configWarning` in this package, instead of the runner's own absolute
  filesystem paths.
- **A raw glob-pattern input pointing at a different repo than `cwd` no
  longer hard-fails with 0 matches.** The repo-root containment fix above
  used `cwd`'s own repo boundary for a bare glob pattern regardless of
  where the pattern actually pointed — an absolute pattern into a sibling
  repo (`['/abs/repoB/e2e/*.spec.ts']`), or an equivalent `../`-relative
  one, had every match rejected as an "escape" of `cwd`'s repo, where the
  same target passed as a directory already scored fine. `src/index.ts`'s
  glob-input branch now derives its containment boundary from *the
  pattern's own* literal (non-magic) leading-directory prefix, resolved
  against `cwd`, not from `cwd` itself — a literal prefix that lands
  inside another repo entirely is scored against that repo's own
  boundary, while a symlink an in-bounds prefix still reaches that escapes
  *that* repo is still dropped.
- **An explicit target and a directory scan that reaches it again through
  a symlink are no longer scored twice.** The realpath dedupe added above
  only ever populated its map from `expanded` matches; an `explicit` file
  and a same-realpath `expanded` symlink are two different literal paths,
  so the separate "explicit wins" step (an exact literal-path delete)
  never caught that pairing. The dedupe map is now seeded with
  `explicit`'s own realpaths first, so a same-realpath `expanded` match is
  recognized as a duplicate instead of surviving as a second, independent
  file.

Corpus rerun (100 public repos, directory inputs, run on the round-2 build;
the round-3 fixes only touch glob-pattern inputs): 96/100 repos score
identically, 4 moved upstream, 0 changed.

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
  up (this guarantee needs a `.git` somewhere in the ancestor chain).
  The bug this closes: when no `.git` existed anywhere in the ancestor
  chain, the boundary used to clamp a config's `testDir` fell back to the
  filesystem root (or 20 levels up), which is effectively no clamp at
  all, so a `testDir: '/'` could make the glob walk the whole filesystem
  (in the worst case, a hang). For the `testDir` clamp the fallback is
  now the directory actually passed to the scorer, or the config file's
  own directory when that's the wider of the two, never the filesystem
  root. The config search itself (a bounded series of existence checks)
  keeps its wider fallback so monorepo configs above the scanned
  directory are still found.
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
  include a file whose path lies outside the scan root either way (a
  symlinked file inside the repo is a separate, tracked follow-up) — index.ts always
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
