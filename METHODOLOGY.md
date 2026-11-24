# Playwright Spec Score Methodology

**Scoring model:** v5 (3.0.0, unreleased; v4 from 2026-09-23 until then)  
**Package:** `playwright-score`  
**Landing page:** https://qaguardian.com/open-source/playwright-score  
**Maintainer:** [QA Guardian](https://qaguardian.com)  
**Deterministic:** same inputs → same score  
**AI-free:** no LLM calls in the scoring path

Any change that alters what a given suite scores is a new model version
(v5, …), documented in the CHANGELOG. Model history: v1/v2 (published as
"sqs-v1"/"sqs-v2" through package 0.4.0) scored finding *density per line
of code*; v3 replaced that entirely — see "Why v3" below. v4 keeps v3's
exact per-test ratio formula and changes only which findings feed it —
see "Why v4" below.

---

## The model in one sentence

**Your score is the share of your counted tests that are clean.**

---

## v5: the score from test states

Every test gets one state, first match wins (the JSON `testStates` list):
`excluded-empty` (the test makes no call), `excluded-skipped` (declared
with `skip` or `fixme`, inside a skipped `describe`, or skipped
unconditionally by its first statement), `issue` (a certain finding in
the test or in a hook in scope for it), `unasserted` (no assertion is
reachable and every call was followed), `unverified` (no assertion was
found and some call could not be followed), `clean`.

```
counted = every test except excluded-empty and excluded-skipped
charged = issue tests, plus unasserted tests when that check is certain
score   = round(100 x (counted - charged) / counted)
grade   = A >=90 · B >=80 · C >=70 · D >=60 · F <60
```

- Only **certain** findings charge a test. Likely and advisory findings
  are listed and never cost points.
- `unverified` counts as clean and is always listed.
- An `unasserted` test is charged only once that check is measured as
  certain. Until then it is listed and counts as clean, and the JSON says
  so: `summary.unassertedCharged` is `false`.
- A finding in a shared file (a page object, a fixture, a helper) never
  charges a test.
- A certain finding outside every test and hook (a describe body, the
  module top level, a spec-local `test.extend`) belongs to no test. It is
  listed in `outsideTests` and does not change the score.
- Every point lost names a finding or a state: an `issue` entry lists its
  findings in `chargedBy`; `summary.countedTests` and
  `summary.chargedTests` give the two numbers of the formula.
- With no file found, or no counted test, the suite is `not-scored`:
  score 0, grade F, no pass, exit code 1.

### The gate: `pass` and the exit code

`pass` (exit code 0) needs all three:

- status `scored`, or `partial` with `--allow-partial` (library:
  `allowPartial`). A `not-scored` suite never passes.
- nothing named by `--fail-on` (library: `failOn`) is found. The values,
  combined with commas:
  - `passes-regardless` (the default): a certain finding of that family.
  - `flake-risk`: a certain finding of the flake-risk family, or of the
    suite family (`page.pause()`, a focused test).
  - `unasserted`: a counted test in state `unasserted` or `unverified`,
    whether or not the score charges it.
  - `shared`: a certain finding in a shared file whose `usedBy` names a
    spec file with a counted test. A likely shared finding never counts.
  - `none`: nothing; it cannot be combined with another value.

  For the two family values a finding counts when it is in a counted
  test, in a hook in scope for a counted test, or outside every test in a
  spec file with at least one counted test. A finding in a shared file
  counts only through `shared`.
- `score >= threshold`, only when `--threshold` was given. Without it the
  score does not gate, and the JSON `threshold` is 0.

The gate reads the states, tiers, families and scopes already in the
result; it never changes a finding, a state or the score. The JSON `gate`
object says which settings were used and lists every reason a result does
not pass. Exit code 1 means not pass; 2 is a tool or usage error, such
as an unknown `--fail-on` value or `none` combined with another value.

The four dimensions below, `summary.cleanTests` and locator usage
(`locators`, with `scored: false`) are still computed as before. They are
for information and no longer feed the score.

---

## How it works (v4, the dimensions)

### 1. Findings are attributed to tests

Every file is parsed and each test declaration's source span is recorded
(`test(...)`, `test.only/skip/fixme/slow(...)` — any form carrying a
function body). Each lint/metric finding is then attributed to:

- **the test it sits in**, when its line falls inside a test span;
- **every test in the file**, when it sits in a `beforeEach`/`afterEach`/
  `beforeAll`/`afterAll` hook — setup problems affect every test that runs
  through them;
- **the file, once** (module scope), for anything else — imports,
  `describe` bodies, file-level metrics like oversized-file.

### 2. Tests accumulate demerits

Within each scored dimension, a test's demerit is the sum of its findings'
units, capped at 1:

| Severity | Demerit |
|---|---|
| error | 1.0 |
| warning | 0.4 |
| info / report-only | 0 |

A test is at worst *fully flawed* (demerit 1) — never more. That cap is
both the anti-nuke mechanism (one loop-generated repeated finding cannot
zero a suite) and the anti-gaming mechanism (there is no per-line density
left to dilute by padding files with clean code). Module-scope findings
are capped at 1 demerit per file per dimension.

### 3. Dimensions are ratios

```
dimensionScore = round(100 × (1 − totalDemerit / tests))     // clamped 0–100
```

With zero tests the denominator is 1, so a findings-bearing zero-test
input still cannot score clean.

The **locators** dimension is independent of demerits — it is the usage
ratio it always was:

```
native = getByRole|getByLabel|getByTestId|getByText|getByPlaceholder|getByAltText|getByTitle calls
raw    = .locator(...) calls + legacy string-selector actions (page.click('#x'), …)

locatorsScore = total === 0 ? 100 : round(100 × native / total)
```

(`no-raw-locators` / `prefer-native-locators` / `prefer-locator` findings
appear in `findings[]` for repair guidance but are report-only — the ratio
owns this dimension; counting them as demerits too would double-penalize.)

### 4. Weighted sum

| Dimension | Weight | Demerit sources |
|---|---:|---|
| playwrightHygiene | 40 | hard waits (`page.waitForTimeout`, `new Promise`+`setTimeout` and its respellings, `node:timers/promises` setTimeout), networkidle, force, missing await, element handles, eval, conditionals, page.pause, useless await |
| assertions | 25 | a test with no recognized assertion is fully flawed (`expect-expect`, after all delegation resolution; a test with no `expect` of its own that calls an assertion-named method (`assert`, `verify`, `check`, `validate`, `expect`, `ensure`, `should`, `confirm` followed by an upper-case letter, `_`, a digit or nothing; or `toBe*`, `toHave*`, `toContain*`, `toMatch*`, `toEqual*`, `toThrow*`) on an object the scan cannot read, or calls a fixture that comes from a module the scan cannot resolve is a report-only `playwright-score/assertion-unverified` "not decided automatically" finding, not a demerit, and is counted in `summary.unverifiedTests` rather than as asserting; any other call on such an object does not excuse the test, so query-style names (`is...`, `has...`, `wait...`), helper methods named like Playwright actions (`fill`, `check`, `goto`) and built-in calls are never treated as assertions; an assertion helper or fixture only counts when its body is readable, it is called by the test, and its name does not collide with a Playwright method); an assertion whose subject/matcher combination can only ever pass (`expect(true).toBe(true)`, `expect([]).toEqual([])`, never a deliberate force-fail like `expect(true).toBe(false)`, and never an array that may be mutated elsewhere: passed to a call, the receiver of a mutating method such as `push`, an assignment target, or captured by a closure such as an event listener doing so, including an inner array mutated through an index such as `rows[0].push(9)`); `valid-expect`, `prefer-web-first-assertions`, all add partial demerits |
| locators | 20 | usage ratio (above) |
| structure | 15 | focused tests, always-skipped declarations, nested-describe depth, oversized files (module scope), an inline `eslint-disable` suppression comment (partial demerit — see "Known limitations" in VALIDATION.md) |

```
score = round(Σ (weight_d / 100) × dimensionScore_d)
pass  = score >= threshold        // computeScore on its own; scorePaths uses the gate
grade = A ≥90 · B ≥80 · C ≥70 · D ≥60 · F <60
```

---

## Worked example

3 tests. Test 1 has two hard-wait errors and no assertion. Test 2 is an
always-skipped declaration with a conditional and no assertion. Test 3 is
clean. Locators: 4 native, 4 raw.

- **hygiene**: test 1 → min(1, 2×1.0) = 1; test 2 → 0.4 → total 1.4/3 → **53**
- **assertions**: tests 1, 2 unasserted → 2/3 → **33**
- **locators**: 4/8 → **50**
- **structure**: skip warning 0.4/3 → **87**
- **score** = 0.40·53 + 0.25·33 + 0.20·50 + 0.15·87 = **53 → F**

The same suite scored 78/C under the v1 density model. "Two of your three
tests are broken" should not read as a near-B.

---

## SLOC

`summary.sloc` (non-blank, non-comment lines) is reported for context and
feeds the oversized-file check (>400 SLOC per file → structure warning,
module scope). It plays no other role in scoring.

---

## Active rule set (frozen)

The exact ESLint rules that produce findings are enabled explicitly in
`eslint-runner.ts` with fixed severities — the score never inherits
eslint-plugin-playwright's `recommended` set at install time, so identical
code scores identically regardless of which plugin version npm resolves.

### Tests that would miss a real bug

Five rules (QAG-287) target tests that pass whatever the app does. Each
matches one exact syntactic shape and stays silent when unsure.

| Rule | Dimension, severity | Exact shape |
|---|---|---|
| `pwscore/no-fixme-test` | structure, warning (info when a reason is given or the body is empty) | `test.fixme('t', fn)` / `test.describe.fixme(...)` declarations; in-body or describe-level `test.fixme()` or `test.fixme(true, ...)`. Conditional `test.fixme(cond, 'why')` is clean. Warning when nothing says why. Info, with a different message, when `test.fixme(true, 'reason')` carries a reason, a comment directly above names a tracker reference (`ABC-123`, an issue URL, `#1234`) or a re-enable condition, or an annotation was pushed earlier in the same body; and for an empty-body `test.fixme('t', () => {})`, which is a to-do placeholder rather than a broken test. |
| `pwscore/no-swallowed-assertion` | assertions, warning | `expect(...)` in a `try` whose `catch` has no throw, expect, fail-ish call, returned value or assignment (not inside a loop); or `await expect(...).catch(fn)` as a statement where `fn` does not throw. A negated chain whose `.catch` discards the rejection (`() => {}`, `() => undefined`, or a local empty function) is reported even when a later assertion checks the same subject, unless that assertion repeats the same negated check. |
| `pwscore/no-weak-assertion` | assertions, error | `.count()`/`.length` `toBeGreaterThanOrEqual(0)`; a syntactic Locator (`page.locator`, `getBy*`, or a const from one) asserted `toBeTruthy`/`toBeDefined`/`not.toBeNull`; `isVisible()`-style and `count()` results asserted `toBeDefined`. `toBeTruthy()` on other values is not flagged. |
| `pwscore/no-unawaited-expect-value` | assertions, error | `expect(<promise call>)` without `await`, receiver syntactically a Page/Locator, matcher not web-first (also an un-awaited promise call as the expected value of `toBe`/`toEqual`). `.resolves`/`.rejects` are exempt. |
| `pwscore/no-floating-callback-assertion` | assertions, error | An awaited assertion (an `expect(...)` matcher chain, `expect.soft`, `expect.poll` or `toPass`) inside an async callback of `forEach`, or of `map` whose result is discarded (an expression statement). Neither method awaits the promises its callback returns, so the test can finish before the assertion runs. Not flagged: `for...of` with `await`, `await Promise.all(items.map(async ...))`, a `map` or `forEach` whose result is awaited, assigned, returned or passed on, a callback that is not async, an assertion in a function nested in the callback. A proven non-Playwright `expect` gives no finding; an `expect` whose origin is not resolved gives the finding with tier `needs-check`. |


---

## Why v4

v4 keeps v3's per-test ratio formula unchanged. What changed is which
findings feed it:

1. **Gameability rules, planned as report-only under `standard`, are
   real demerits there instead.** 1.1.0 (never published) planned four
   of them (a timer sleep, a click at fixed pixel coordinates, an
   assertion on a literal constant, and a test with only soft
   assertions) behind a separate opt-in `strict` profile, so the public
   default (`standard`) wouldn't move anyone's score. Owner direction,
   2026-09-23: public scores should reflect quality, full stop — a spec
   that sleeps on a timer or asserts on a literal constant should score
   worse under the default profile, not only under an opt-in one nobody
   has to run. `strict` is removed as a result: with nothing left for it
   to gate (every rule now scores the same way in the only remaining
   profile), a second profile identical to the first was dead weight,
   not a real choice. See CHANGELOG.md's 2.0.0 entry for the exact
   corpus repos this moved, including pass→fail flips. Two of the four
   remain today, `pwscore/no-timer-sleep` and
   `pwscore/no-trivial-assertion`: the soft-assertion rule was removed in
   2.4.0 (a failed `expect.soft` does fail the test), and the
   fixed-coordinate click rule was removed in 3.0.0 (see item 2).
2. **The fixed-coordinate click rule was a warning (0.4 demerit) in v4,
   and is removed in 3.0.0.** The 50-repo corpus surfaced a real
   false-positive class: two infinite-canvas editors (tldraw, AFFiNE)
   accounted for 428/459 of its hits, and a fixed-pixel
   `page.mouse.click(x, y)` is the *correct*, only way to interact with
   canvas content that has no addressable DOM element — not a
   brittleness anti-pattern there. v4 answered with a partial demerit
   instead of a full one. A later hand-check of its real findings
   measured zero precision, so 3.0.0 deletes the rule rather than keep
   charging for a correct interaction.
3. **Inline `eslint-disable` suppression comments are now a demerit,
   not invisible.** A pre-2.0.0 review found this project's own docs
   recommending an inline `eslint-disable-next-line` comment as an
   escape hatch for one rule, while every rule this package ships can in
   fact be silenced the same way — defeating the score for whatever it
   hides. `pwscore/eslint-disable-comment` reports the presence of any
   suppression directive (not, yet, which specific rule it targets — a
   documented known limitation, see VALIDATION.md).

Together these move `standard` scores — see CHANGELOG.md's 2.0.0 entry
for the "scores changed" breakdown, and VALIDATION.md for the full
before/after table across all 50 corpus repos, including which ones flip
from pass to fail at the default threshold.

## Why v3

v1/v2 scored findings per 25 lines of code through an exponential decay
with a minimum-slots floor. Three structural problems, each verified with
real inputs:

1. **Density is not how anyone judges a test suite.** "2 of 3 tests have
   hard waits" is what a reviewer says; "0.5 penalty units per slot" is
   not. v2 already fixed this for assertions (coverage ratio); v3 applies
   the same per-test framing everywhere.
2. **Small suites were structurally under-penalized** — the minimum-slots
   floor meant a 3-test suite with 2 errors, 2 assertion-free tests, and a
   skipped test scored 78/C.
3. **Density is gameable**: adding clean lines of code (or clean files)
   diluted `findings/SLOC` and raised the score without fixing anything.
   A per-test ratio has no such lever — padding with fake tests costs
   assertions coverage instead.

---

## Flake-risk rules (unreleased)

Five static checks for the patterns that make a test pass or fail by luck.
Each is syntactic and conservative: when the receiver or value cannot be
read from the source, nothing is reported.

| Rule | Exact shape | Severity / dimension |
|---|---|---|
| `pwscore/no-unawaited-action` | An expression statement that is exactly `<receiver>.<action>(...)` inside an `async` function, where the receiver is `page`, a `.page` property, a `page.locator/getBy*/first/nth/filter` chain, or a `const` initialised from one, and the action is goto/reload/goBack/goForward/click/dblclick/fill/clear/press/type/check/uncheck/setChecked/selectOption/hover/focus/tap/dragTo/setInputFiles/setContent/scrollIntoViewIfNeeded/waitFor*. Not matched: await, return, void, assignment, argument, `Promise.all`, `.catch()`/`.then()` chains, other receivers. Chosen over eslint-plugin-playwright's `missing-playwright-await` `includePageLocatorMethods` option because that one matches the method name on any receiver. | error / hygiene |
| `pwscore/no-brittle-selector` | A fully static selector string passed to `.locator()`, `.frameLocator()` or a legacy selector method on a Page/Locator that is XPath (`xpath=`, `//`, `(//`), uses `:nth-child`/`:nth-of-type`, is a plain CSS chain with 4 or more combinators, or contains a generated class (`.css-1a2b3c`, `.sc-bdfBwQ`, `.jss12`, `.MuiBox-root-12`); plus `.nth()/.first()/.last()` directly on a raw `.locator('<string>')` (test-id, `role=` and `text=` strings exempt; also exempt: a comma-union selector, a locator whose chain already passes through `getByTestId`/`getByRole`/a test-id selector, and a pick used only for an existence/count/attribute check such as `.isVisible()`, `.count()`, `.getAttribute()` or `expect(..).toBeVisible()/toHaveCount()/toHaveAttribute()`). | warning, **report-only** / locators |
| `pwscore/no-shared-mutable-state` | A module- or describe-level `let`/`var` (or `const` object/array/Map/Set) that one `test()` body assigns or mutates and a later `test()` body reads without writing it. `push/set/add/delete/clear/...` count as mutation only on a variable known to be a collection (initialised or assigned with an array/object/Map/Set literal or constructor), so an SDK client's `.delete()` is not one. Not matched: writes only in hooks, any `beforeEach` write, reader that also writes, reader earlier in the file than the writer, a writer of a different static property than the reader reads, a reader that calls a same-file helper assigning the variable. | warning / structure |
| `pwscore/serial-mode-dependency` | A serial scope (`test.describe.configure({ mode: 'serial' })` or `test.describe.serial(...)`) in which one test assigns a shared module/describe variable and a LATER test in the same scope reads it (the writer-before-reader analysis of `no-shared-mutable-state`, same property rule). Serial scopes with fewer than 2 tests, or used only for exclusion/shared setup, are not reported. No double report: a variable with an unordered pair belongs to `no-shared-mutable-state` and is skipped here. One finding per serial scope. | info, **report-only** / structure |
| `pwscore/no-excessive-timeout` | `{ timeout: N }` with N > 60,000 (strictly more than one minute) on an action, wait or matcher call; `test.setTimeout(N)`/`testInfo.setTimeout(N)` with N >= 300,000; `test.slow()` with no arguments directly at file or describe level. Literals and simple arithmetic only (`2 * 60 * 1000`, `60_000`). Config files are not read. `setTimeout` inside a `beforeAll/beforeEach/afterAll/afterEach` hook is not matched. | info (no score effect) / hygiene |

`no-brittle-selector` is report-only on purpose: the locators dimension is a
native/raw ratio that already counts every raw `.locator()` and legacy
selector call, so scoring the same call again would charge it twice. The
finding is named evidence for why that raw call is fragile.

**Helper and page-object resolution.** Imports are followed through relative
paths (including the TypeScript `./x.js` to `x.ts` convention), tsconfig
`paths`/`baseUrl` aliases and workspace packages, never outside the scored
directory or the repository. A helper (function, arrow function, class method)
clears `expect-expect` in a spec only if it is defined in that spec or in a file
the spec reaches through imports and re-exports; a same-named helper in an
unrelated file never counts. Evidence: an `expect`, or a `.waitFor()` call, in
the helper's own file (same-file chains included) counts as before. Across files
only real `expect` evidence is passed on, so a wrapper that merely calls a
`.waitFor()` helper in another file does not become an assertion helper; and a
setup-shaped wrapper (`await*`, `setup*`, `bootstrap*`, `init*`, `prepare*`,
`seed*`, `goto*`, `navigate*`, `login*`, `signIn*`, `ensure*`) does not become
one through helpers in other files, because the expects in a setup chain check
preconditions rather than the behaviour under test.

**Test factories.** A function whose `return` is `<test>.extend(...)`, a known
test alias, or a call of another such function (same file or imported through
relative paths) is a test factory; `const t = factory(...)` makes `t` a test
alias, so `t('name', ...)` is a test declaration, counted and checked like any
other test.
