# Real-world validation

`playwright-score` is checked against real, public Playwright suites, not
just its own fixtures. This file documents how, and the results for
3.1.0. The 2.x write-up (a 100-repo corpus scored with model v4, and the
scorer bugs found that way) is kept in
[docs/validation-2.1.0.md](docs/validation-2.1.0.md).

**Tested on 2026-11-26**: 3.1.0, scoring model v5, default gate
(`--fail-on passes-regardless`, no score bar, without `--allow-partial`),
279-suite corpus.

## Recall: defects found by hand

The headline recall is manual: people read real suites, wrote down every
defect a test has (a test that would pass whatever the app does, a flake
risk, a test with no assertion), and only then compared the list with the
scorer's output.

- **Manual recall: 75%** (27 of 36 defect classes found by hand that
  a rule targets are reported by the scorer).
- The other 9 are defects a rule targets that it did not report. Defects
  that no rule targets are listed under "Known limitations".
- The recall figures are the 3.0.0 measurement and were not re-measured for 3.1.0.

## Precision of certain findings

Only certain findings charge a test or fail the default gate. A rule
becomes certain when the precision of its hand-checked findings on real
suites reaches the release bar. In 3.0.0 three rules are certain, in spec
files only; every other rule, and every finding in a shared file, is
likely or advisory. The table is the 3.0.0 measurement, not re-measured for 3.1.0.

| Rule | Hand-checked | True | False | Precision | 95% lower bound |
|---|---:|---:|---:|---:|---:|
| `pwscore/no-weak-assertion` | 36 | 36 | 0 | 100% | 90.4% |
| `pwscore/no-unawaited-action` | 33 | 33 | 0 | 100% | 89.6% |
| `playwright/no-wait-for-selector` | 36 | 36 | 0 | 100% | 90.4% |

The lower bound is the Wilson score interval.

## Corpus results

- 279 suites · 17,019 files · 86,200 tests · 264/279 pass the default gate.
- Status: 278 scored, 0 partial, 1 not scored (its files hold no test the scorer counts); no crash and no timeout. (Status carried from the 3.0.0 run; not re-aggregated for 3.1.0.)
- Tests by state: 68,982 clean, 1,976 issue, 368 unasserted, 13,565 unverified, 1,309 excluded.
- Findings by tier: 2,016 certain, 20,801 likely, 122,324 advisory, 553 not decided automatically (`needs-check`).
- Determinism (3.1.0): 20 suites scored twice, byte-identical (`deterministic: true`).
- Determinism (3.0.0): the output was byte-identical on two machines, and when
  scored from the packed tarball under Node 20 and 22, installed with npm
  and with pnpm.
- Provenance: the 3.1.0 corpus run was made at commit 89b9a50 (the version bump). The QAG-289 merge (fa35891) came after it and adds only `src/diff`; it does not touch scoring. A run at fa35891 is pending.

## Results (last run: 2026-11-26, 3.1.0, scoring model v5, `standard` profile, threshold 0)

The pass count and score distribution of the same corpus run. Threshold 0
means no score bar: "pass" is the default gate.

**264 pass / 15 fail / 279 total (94.6%).** 17,019 files, 86,200 tests, 145,694 findings.
Score distribution: mean 96.7, median 100; grades 256 A / 9 B / 6 C / 3 D / 5 F (unchanged vs 3.0.0).

### Changes against 3.0.0

Comparison of the 3.1.0 run with the 3.0.0 results for the same 279 suites.

- Suites whose score or grade changed: 0. Gate changes: 0.
- Certain findings: 2,016, no change.
- Likely findings: +178, all in helper files reached through `require()` (openobserve 139, unopim 18, Open-Web-Analytics 12, metasfresh 4, rcourtman-Pulse 4, apolloconfig 1). No score effect: likely findings never cost points.
- Advisory `missing-playwright-await`: -5 (promises that are now stored or handed on).
- Other likely deltas: `no-wait-for-timeout` +94, `no-networkidle` +55, `no-wait-for-selector` +18, `no-swallowed-assertion` +7, `no-wait-for-navigation` +2, `prefer-web-first-assertions` +2.
- `--changed-since` check: not re-measured for 3.1.0; no figure is given.

## Performance

3.1.0 corpus run: wall time 1,185 s on 2 slots, remote runner, commit 89b9a50.
Peak memory was not re-measured for 3.1.0.

Last measured on release candidate 3.0.0-rc.1 (commit 22653be, 2026-11-25,
Apple M1 Pro), against 2.x on the same machine. The final 3.0.0 build adds
a worker-memory fix and has not been re-timed.

- Summed CPU time over the corpus: 1.384x 2.x (1.413x on a paired sample
  of 20 heavy suites).
- Slowest suite: 160.5 s. Peak memory (RSS): 2.79 GiB.
- One spec file, cold start: 2.79 s at the 99th percentile.

## Running it yourself

```bash
npm run build
bash scripts/validate-corpus.sh standard 0
```

The script scores a separate, public list of well-known repositories
(listed in the script), so its numbers are not the corpus numbers above.
Each entry is a fresh, shallow, sparse clone of the repo's live default
branch (only the Playwright suite's own subdirectory is fetched); nothing
is committed to this repository. Scores drift over time as these
projects' own suites change.

## Regression benchmark

Two fixed sets of synthetic specs. Neither is a measure of real-world
recall. The development benchmark is scored on every change to catch
regressions.

- Development benchmark: 152 of 155 seeded defects reported (98.1%).
- Sealed set: 210 of 234 hand-written cases reported (89.7%), none of
  them used during development. This is below the
  development figure: the rules do less well on code they were not built
  from, and work to make them generalise is planned for 3.0.x.
- The package's own test suite: 2,912 of 2,912 tests pass.

## Known limitations

Some defects no static rule decides. The scorer does not report an
assertion on the wrong variable or element, `toHaveText("")` on an input in
general, a test whose title does not match what it checks, vacuous loops
in general, hard-coded credentials, or clicks at fixed coordinates. An
`expect` renamed in its import (`import { expect as verify } from
'@playwright/test'`) is followed by `missing-playwright-await` and
`prefer-web-first-assertions`, but not yet by `valid-expect`,
`no-weak-assertion`, `no-trivial-assertion` and
`no-unawaited-expect-value`. See the README's "Not covered" section for the
exact boundaries.
