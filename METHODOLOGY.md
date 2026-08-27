# Playwright Spec Score Methodology

**Scoring model:** v3 (2026-08-27)  
**Package:** `playwright-score`  
**Landing page:** https://qaguardian.com/open-source/playwright-score  
**Maintainer:** [QA Guardian](https://qaguardian.com)  
**Deterministic:** same inputs → same score  
**AI-free:** no LLM calls in the scoring path

Any change that alters what a given suite scores is a new model version
(v4, …), documented in the CHANGELOG. Model history: v1/v2 (published as
"sqs-v1"/"sqs-v2" through package 0.4.0) scored finding *density per line
of code*; v3 replaced that entirely — see "Why v3" at the bottom.

---

## The model in one sentence

**Your score is the weighted share of your tests that are clean.**

---

## How it works

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
native = getByRole|getByLabel|getByTestId|getByText|getByPlaceholder calls
raw    = .locator(...) calls + legacy string-selector actions (page.click('#x'), …)

locatorsScore = total === 0 ? 100 : round(100 × native / total)
```

(`no-raw-locators` / `prefer-native-locators` / `prefer-locator` findings
appear in `findings[]` for repair guidance but are report-only — the ratio
owns this dimension; counting them as demerits too would double-penalize.)

### 4. Weighted sum

| Dimension | Weight | Demerit sources |
|---|---:|---|
| playwrightHygiene | 40 | hard waits, networkidle, force, missing await, element handles, eval, conditionals, page.pause, useless await |
| assertions | 25 | a test with no recognized assertion is fully flawed (`expect-expect`, after all delegation resolution); `valid-expect`, `no-standalone-expect`, `prefer-web-first-assertions` add partial demerits |
| locators | 20 | usage ratio (above) |
| structure | 15 | focused tests, always-skipped declarations, nested-describe depth, oversized files (module scope) |

```
score = round(Σ (weight_d / 100) × dimensionScore_d)
pass  = score >= threshold        // CLI default 80
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

---

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
