# Playwright Spec Score (SQS) Methodology

**Score version:** `sqs-v1`  
**Package:** `playwright-score`  
**Landing page:** https://qaguardian.com/open-source/playwright-score  
**Maintainer:** [QA Guardian](https://qaguardian.com)  
**Deterministic:** same inputs → same score  
**AI-free:** no LLM calls in the scoring path

Any change to formulas, weights, SLOC definition, caps, or constants requires a new version (`sqs-v2`, …).

---

## Profiles

| Profile | Purpose |
|---|---|
| `standard` | Community Playwright best practices (`eslint-plugin-playwright`) + suite metrics |
| `guardian` | `standard` + QA Guardian house conventions (optional; clearly labeled) |

House rules are **not** claimed to be official Playwright doctrine.

---

## Output

- **score:** integer 0–100  
- **grade:** A (90–100), B (80–89), C (70–79), D (60–69), F (0–59)  
- **pass:** `score >= threshold`  
- **dimensions:** per-dimension 0–100  
- **findings:** full list (uncapped) for humans/agents  

---

## Dimension weights

### `standard`

| Dimension | Weight |
|---|---|
| playwrightHygiene | 40 |
| assertions | 25 |
| locators | 20 |
| structure | 15 |

### `guardian`

| Dimension | Weight |
|---|---|
| playwrightHygiene | 30 |
| assertions | 15 |
| locators | 15 |
| structure | 15 |
| guardianConventions | 25 |

---

## Locators dimension (ratio)

Independent of finding-penalty math:

```
native = count(getByRole|getByLabel|getByTestId|getByText|getByPlaceholder)
raw    = count(page.locator(|frame.locator()
total  = native + raw

locatorsScore = total === 0 ? 100 : round(100 * native / total)
```

ESLint `no-raw-locators` / `prefer-native-locators` still appear in `findings[]` for repair guidance.  
They are **not** double-counted into the locators dimension via exponential penalties.  
For sqs-v1 they map to **report-only** for scoring (severity still shown in findings; units = 0 for penalty dimensions).

---

## SLOC (source lines of code)

```
sloc = lines that are NOT:
  - blank / whitespace-only
  - pure comment lines (// or block-comment-only lines)
sloc = max(sloc, 1)
```

Used for penalty density. JSDoc / decorative comments do not inflate slots.

---

## Penalty dimensions

Applies to: `playwrightHygiene`, `assertions`, `structure`, `guardianConventions`.

### Constants (frozen sqs-v1)

| Constant | Value |
|---|---|
| `ERROR_UNIT` | 1.0 |
| `WARNING_UNIT` | 0.4 |
| `INFO_UNIT` | 0.0 |
| `MAX_FINDINGS_PER_RULE_PER_FILE` | 3 (for penalty math only) |
| `SLOT_DIVISOR` | 25 |
| `MIN_SLOTS` | 4 |
| `K` | 0.4 |

### Steps

1. **Cap** findings per `(file, ruleId)` to 3 for penalty math (report all in `findings[]`).
2. **Units:** `rawUnits = E * 1.0 + W * 0.4`
3. **Slots:** `slots = max(sloc / 25, 4)`
4. **Load:** `load = rawUnits / slots`
5. **Score:** `dimensionScore = clamp(0, 100, round(100 * exp(-0.4 * load)))`

### Final score

```
score = round(Σ (weight_d / 100) * dimensionScore_d)
pass  = score >= threshold
```

---

## Worked examples (Phase 0 validation)

Assumptions: single-file runs; weights as above.

### 1. Tiny clean (~15 SLOC, 0 findings, all native locators)

- All penalty dims = 100  
- Locators = 100  
- **standard score ≈ 100**

### 2. Tiny file, 1 hygiene error (~20 SLOC)

- slots = max(20/25, 4) = 4  
- rawUnits = 1.0 → load = 0.25 → hygiene = round(100 * e^(-0.1)) ≈ **90**  
- Other dims 100  
- standard ≈ 0.4*90 + 0.25*100 + 0.2*100 + 0.15*100 = **96**

### 3. Medium file, 5 distinct hygiene errors (~100 SLOC)

- slots = max(100/25, 4) = 4  
- rawUnits = 5 → load = 1.25 → hygiene = round(100 * e^(-0.5)) ≈ **61**  
- standard ≈ 0.4*61 + 60 = **84** if other dims perfect  

### 4. Large file, 20× same warning (capped to 3)

- 20 warnings same rule → cap 3 → rawUnits = 3 * 0.4 = 1.2  
- sloc = 500 → slots = 20 → load = 0.06 → score ≈ **98** on that dim  
- Cap prevents auto-zero  

### 5. Locator ratio 2 native / 10 total

- locatorsScore = round(100 * 2/10) = **20**  
- Independent of caps  

These examples feel fair: tiny single error stays high; multi-error drops materialy; repeated same-rule does not nuke large files; locator mix is a pure ratio.

---

## Default thresholds

| Context | Profile | Threshold |
|---|---|---|
| CLI default | standard | 80 |
| QAG dogfood (warn) | guardian | 75 → 80 |
| QAG gate (later) | guardian | 80 |

---

## Rule → dimension map (summary)

See package rule docs / source `profiles.ts`. High level:

- **playwrightHygiene:** waits, force, networkidle, missing await, handles, conditionals  
- **assertions:** expect-expect, empty tests, web-first preference  
- **locators:** ratio metric only (for score); raw-locator ESLint in findings  
- **structure:** focused/skipped, oversized file, describe shape  
- **guardianConventions:** load-state ban, Date.now ban, secrets, test.step, one-describe-one-test, etc.  
