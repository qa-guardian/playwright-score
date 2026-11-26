# pwscore (@qaguardian/playwright-score)

[![CI](https://github.com/qa-guardian/playwright-score/actions/workflows/ci.yml/badge.svg)](https://github.com/qa-guardian/playwright-score/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@qaguardian/playwright-score.svg)](https://www.npmjs.com/package/@qaguardian/playwright-score)
[![license](https://img.shields.io/npm/l/@qaguardian/playwright-score.svg)](https://github.com/qa-guardian/playwright-score/blob/main/LICENSE)

**Deterministic, AI-free quality check for Playwright specs.** It finds
the tests that would pass whatever your app does, the tests with flake
risk and the tests with no assertion, and scores the share of your tests
that are clean.

**Website:** [qaguardian.com/open-source/playwright-score](https://qaguardian.com/open-source/playwright-score)  
**Built by:** [QA Guardian](https://qaguardian.com) — managed Playwright E2E (AI drafts, engineers verify, you own the code)

Static analysis only: rules from
[`eslint-plugin-playwright`](https://github.com/playwright-community/eslint-plugin-playwright)
plus the package's own checks, with imports followed into your helpers,
page objects and fixtures. Nothing is run against your app.

The score never calls an LLM. AI may *generate* or *repair* code using findings; **rules grade code**.

## What the output says

The text and markdown output open with a headline and the score:

```
86 tests. 79 have no certain issue. 2 would pass whatever the app does. 5 have flake risk. 3 have no assertion.
Score 92/100 (A)  ·  FAIL  ·  e2e  ·  41 files
```

This suite scores 92 and still fails the default gate, because 2 tests
would pass whatever the app does. A clause whose count is 0 is left out.
What each count means:

| Count | Meaning |
|---|---|
| `86 tests` | Every test declared in the scored spec files (`summary.tests`). Each has one entry in the JSON `testStates`. |
| `have no certain issue` | Tests with no certain finding in the test or in a hook that runs for it. |
| `would pass whatever the app does` | Tests charged by a certain finding of the passes-regardless family: an assertion that never runs, is never awaited, or cannot fail. |
| `have flake risk` | Tests charged by a certain flake-risk finding, such as a fixed wait for a selector. A test can be in this count and the one above. |
| `have no assertion` | Tests in state `unasserted`: no assertion can be reached from the test or its hooks, and every call it makes was followed. |
| `certain issues in shared code` | Certain findings in page objects, fixtures and helpers, with the number of spec files that use them. |
| the score | `round(100 x (counted - charged) / counted)`: the share of counted tests that are not charged. |

Every test gets one state, first match wins:

| State | Meaning | Counted | Charged |
|---|---|:-:|:-:|
| `excluded-empty` | the test makes no call | no | no |
| `excluded-skipped` | declared with `skip` or `fixme`, inside a skipped `describe`, or skipped unconditionally by its first statement | no | no |
| `issue` | a certain finding in the test, or in a hook that runs for it | yes | yes |
| `unasserted` | no reachable assertion, and every call was followed | yes | once that check is certain (`summary.unassertedCharged`) |
| `unverified` | no assertion found, but some call could not be followed (the entry names it) | yes | no |
| `clean` | anything else | yes | no |

Likely, advisory and not-decided findings, findings in shared files and
findings outside every test are listed and never cost points. A result is
`scored`, `partial` (a file was skipped: a syntax error, over 1 MB, binary,
unreadable, or cut off by a limit; `coverage.skipped` lists them) or
`not-scored` (no files, or no counted test and no limit involved; score 0,
grade F).

## Tiers: what "certain" means

A rule can report several shapes of code; each shape is a **form**, and
each finding carries its `form` and a `tier`:

- **certain**: the check for this rule and form is listed as certain in
  the committed precision file (`labels/precision.json`), which is built
  from hand-checked findings: either its precision was measured on real
  suites, or the defect follows from the code shape alone. Only certain
  findings charge a test or fail the default gate. They are shown first.
- **likely**: probably worth fixing, shown under "Worth a look". Never
  costs points.
- **advisory**: shown as one count line; `--advice` lists them.
- **needs-check** ("not decided automatically"): the scorer cannot decide
  it, for example when an `expect` cannot be traced to Playwright's. One
  count line; `--advice` gives the reasons.

Every finding also carries `quotable`: true only for a certain finding
whose check passed the measured release path. SARIF levels follow the
tier: certain `error`, likely `warning`, the rest `note`.

## Shared code

The files your specs import (page objects, fixtures, helpers) are checked
too, by default, with the rules that hold outside a test body, such as a
Playwright call that is not awaited or a fixed wait. Their findings are
shown with `scope: "shared"` and `usedBy` (the spec files that reach the
file), and they are **never charged to a test**: they never change the
score. A shared finding can fail the gate only under `--fail-on shared`,
and only when it is certain, which needs a measured check; until then shared
findings are likely at most. `--no-shared` turns the check off.

## Not covered

Some defects no static rule decides. The scorer does not report:

- an assertion on the wrong variable or element;
- `toHaveText("")` on an input in general (only an `<input>` located with
  an explicit `type` in a CSS selector is reported, as a likely finding;
  role and placeholder locators are not);
- a test whose title does not match what it checks;
- vacuous loops in general (only a loop whose every assertion depends on a
  list that may be empty, with no earlier check, is reported, as a likely
  finding);
- hard-coded credentials;
- clicks at fixed coordinates (they are the right way to drive a canvas,
  so there is no rule for them).

## Real-world results

3.0.0 was checked on 279 public Playwright suites, scored against each
project's own source with the default gate (no score bar). People also
read real suites by hand and listed every defect before comparing with the
output: 27 of the 36 defect classes they found that a rule targets are
reported.

**279 suites · 17,019 files · 86,200 tests · 264/279 pass (default gate) ·
tested on 2026-11-25**

[VALIDATION.md](https://github.com/qa-guardian/playwright-score/blob/main/VALIDATION.md)
has the recall measured by hand, the precision of the certain rules, the
corpus breakdown, the regression benchmark and the known limitations;
`scripts/validate-corpus.sh` scores a public list of repositories on your
own machine. A machine-readable
[`validation.json`](https://github.com/qa-guardian/playwright-score/blob/main/validation.json)
carries the same numbers for tooling. See
[CHANGELOG.md](https://github.com/qa-guardian/playwright-score/blob/main/CHANGELOG.md)
for what changed release to release, including "Upgrading from 2.x". A
self-contained visual report of an earlier five-suite audit lives at
[`docs/scorecard.html`](https://github.com/qa-guardian/playwright-score/blob/main/docs/scorecard.html).

See [METHODOLOGY.md](https://github.com/qa-guardian/playwright-score/blob/main/METHODOLOGY.md) for the full scoring model, or the product write-up on the [landing page](https://qaguardian.com/open-source/playwright-score).

## Install

```bash
npm install -D pwscore
```

Packages on npm: [pwscore](https://www.npmjs.com/package/pwscore) (primary) and
[@qaguardian/playwright-score](https://www.npmjs.com/package/@qaguardian/playwright-score)
(alias). Both are published from the same source on every release and contain
identical code. Both install a `pwscore` command and a `playwright-score` command.

This project is not affiliated with Microsoft or the Playwright project.

## CLI

```bash
# One-shot, default gate
npx pwscore ./tests

# Also fail on flake risk and on tests with no assertion, and keep a score bar
npx pwscore ./tests --fail-on passes-regardless,flake-risk,unasserted --threshold 80

# After local install
npx pwscore ./flow.spec.ts --format json --out report.json

# Same tool under the scoped name (use -p so the pwscore command is resolved)
npx -p @qaguardian/playwright-score pwscore ./tests
```

| Flag | Description |
|---|---|
| `--profile standard` | Scoring profile (default, and only, profile) |
| `--fail-on <list>` | What fails the gate, comma-separated: `passes-regardless` (default; a certain finding that lets a test pass whatever the app does), `flake-risk` (a certain flake-risk finding, or a `page.pause()` or focused test), `unasserted` (a counted test with no assertion found: `unasserted` or `unverified`), `shared` (a certain finding in a shared file a counted spec imports), `none`. A finding counts when it is in a counted test, in a hook that runs for one, or outside every test in a spec file with a counted test. `none` combines with nothing |
| `--threshold <n>` | Also fail when the score is below n (0–100). Without it the score does not fail the gate |
| `--allow-partial` | Let a partial result (a file was skipped) pass, also one where a limit left nothing scored (score 0; `status` says `partial`). A not-scored result never passes |
| `--advice` | Also show advisory findings and the reasons for findings not decided automatically (text, markdown, report). JSON always has every finding |
| `--format text\|json\|markdown\|sarif\|report` | Output format (default `text`; `report` is a self-contained one-page HTML suite report) |
| `--out <file>`, `--output <file>` | Write the report to a file |
| `--markdown-out <file>` | Also write the markdown report to file, from the same run (for example with `--format json --out <file>`) |
| `--name <suite name>` | Suite name for the report headline (default: the directory basename) |
| `--max-seconds <n>` | Time limit for the whole run, counted from the start. No default: without it a run is never cut short. Finding the files always finishes; after that no new step starts once the limit has passed. Files not analysed in time are skipped and the result is partial (with reason `limit-reached` and score 0 when no test was scored in time) |
| `--max-heap-mb <n>` | Heap limit of the analysis worker. Default 4608, the same on every machine; a whole number from 64 to 65536. The batch that hits it and every later batch are skipped (`worker-died`) |
| `--changed-since <git-ref>` | Score only the spec files changed since the ref, and the specs that import a changed shared file. See [Scoring only what changed](#scoring-only-what-changed) |
| `--no-shared` | Do not check the shared files the specs import (see [Shared code](#shared-code)) |
| `--shared` | Check the shared files (the default) |
| `--version`, `-v` | Print the version |
| `--help`, `-h` | Show help |

**Exit codes:**

| Code | Meaning |
|---|---|
| `0` | Pass: status `scored` (or `partial` with `--allow-partial`), nothing named by `--fail-on` found, and the score at or above `--threshold` when it is given |
| `1` | Not pass, including a `partial` result without `--allow-partial` (also when a limit left no test counted) and every `not-scored` result (no files matched, every file skipped with no limit hit, or no counted test) |
| `2` | Tool or usage error: an unknown option, an unknown `--fail-on` value or `none` combined with another value, or a limit that is not usable; with `--changed-since` also not a git repository, an unknown ref, or a shallow clone that lacks the ref |

### Scoring only what changed

`--changed-since <git-ref>` scores the spec files changed since a ref instead of the whole suite, so a pull request check takes seconds on a large repo:

```bash
npx pwscore . --changed-since origin/main
```

Run it from inside the repository. In scope are the spec files changed between the merge base of the ref and `HEAD` (the three-dot range), plus uncommitted and untracked files, plus every spec that imports a changed or deleted file (a page object, fixture or helper) directly or through other files. A rename counts as the new file only. Changes outside the scored paths are ignored.

- **The result is labelled SCOPED.** Text, markdown and the HTML report (`--format report`) say `SCOPED to changes since <ref>: n of N spec files scored`; JSON gets an extra `scope` object (`ref`, `scoped`, `specFiles`, `specFilesTotal`, `changedFiles`, `empty`, `files`, and `fallback` when set). Every other JSON field is unchanged, and a run without the flag has no `scope`. The score is the score of those files, not of the suite: do not compare it with a full run.
- **Gate and exit codes** are the usual ones, applied to the files in scope only: a certain finding in a spec you did not touch cannot fail the check. When no spec file is in scope the result is "nothing to score" and the exit code is `0` (`scope.empty` is `true`; no score bar applies). When the scoped specs count no test, the result is not scored and the exit code is `1`, as in a full run.
- **Fallback to a full run:** if the Playwright config (`playwright*.config.*`), a `tsconfig`/`jsconfig` file or a lockfile (`package-lock.json`, `npm-shrinkwrap.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lock`, `bun.lockb`) or a `package.json` / `pnpm-workspace.yaml`, or a file the Playwright config imports, changed anywhere in the diff, every spec is scored and the output says `Full run, not scoped` (`scope.scoped` is `false`, `scope.fallback` says why).
- **Errors (exit 2):** the paths are not inside a git repository, the ref does not exist, or the clone is shallow and does not hold the ref. Fetch the full history (`fetch-depth: 0` in `actions/checkout`, or unshallow the clone with git).

In the GitHub Action, `changed-only: true` does this on `pull_request` events with the PR base commit as the ref:

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0        # the PR base commit must be in the clone
- uses: qa-guardian/playwright-score@v3
  with:
    paths: tests
    changed-only: true
```

The job summary and the PR comment carry the SCOPED line, and the Action output `scoped` is `"true"` when the result covers only the changed files and `"false"` for a full run (also when a changed config, tsconfig or lockfile made it fall back to every spec). The scope follows imports through the whole repository (no depth or file cap, and not limited to the scored directory); if a file does not parse the import graph is incomplete and any changed source file forces a full run. On other events (including `pull_request_target`, which checks out the base branch, so a diff against the PR base would always be empty) the input is ignored and every spec is scored. If the base commit is missing from the clone the step fails with a message that says to use `fetch-depth: 0`.

## Library

```ts
import { scorePaths } from '@qaguardian/playwright-score';

const result = await scorePaths({
  paths: ['tests/login.spec.ts'],
  profile: 'standard',
  failOn: ['passes-regardless', 'flake-risk'], // default: ['passes-regardless']
  allowPartial: false,
  threshold: 80, // optional: without it the score does not gate
});

console.log(result.score, result.grade, result.pass, result.gate.reasons, result.testStates, result.findings);
```

## GitHub Action

Drop this into a workflow to gate PRs, post a job summary, and keep a sticky
PR comment with the full findings up to date. The gate is the CLI's default
gate: a result fails when a test would pass whatever the app does, when it
is partial or not scored, or when the score is below a threshold you set
(there is none by default):

```yaml
- uses: qa-guardian/playwright-score@v3
  with:
    paths: tests e2e
    # threshold: 80        # optional score bar; empty (default) = none
    mode: gate              # gate: fail CI when the result does not pass · warn: report only
```

| Input | Description | Default |
|---|---|---|
| `paths` | Space-separated paths/globs to score | `tests` |
| `profile` | `standard` (default, and only, profile) | `standard` |
| `threshold` | Optional score bar 0–100; empty means no score bar | empty |
| `allow-partial` | `true`: a partial result (a file was skipped) can pass, also one where a limit left nothing scored (score 0) | `false` |
| `max-seconds` | Optional time limit for the run; files not analysed in time are skipped | empty |
| `mode` | `gate` (fail CI when the result does not pass) \| `warn` (report only) | `gate` |
| `comment` | Post/update a sticky PR comment | `true` |
| `changed-only` | `true`: on pull requests score only the specs changed since the PR base (SCOPED result; needs `fetch-depth: 0`). See [Scoring only what changed](#scoring-only-what-changed) | `false` |
| `version` | `@qaguardian/playwright-score` version to run | `3` |
| `github-token` | Token for the PR comment | `${{ github.token }}` |

Outputs: `score`, `grade`, `pass` — usable by downstream steps (e.g. a
custom badge, a Slack notification on regression, etc).

Upgrading from `@v2`: an empty `threshold` used to mean 80 and now means no
score bar; set `threshold: 80` to keep the old bar.

Prefer a raw CLI call, or a non-GitHub CI system? See the [CLI](#cli)
section above — same gate, same exit codes:

```yaml
- name: Playwright Spec Score
  run: npx pwscore ./tests --format text
```

## QA Guardian integration

QA Guardian's own codegen pipeline (`playwright_runner`) dogfoods this
package for the `standard` profile, layering its own private house-rules
gate on top internally — that layer isn't part of this package (it's
product-specific, e.g. "timeouts must be exactly 2000 or 20000ms", not
Playwright best practice) and isn't published here. `playwright_runner`
sets:

| Env | Values | Default |
|---|---|---|
| `SPEC_SCORE_MODE` | `off` \| `warn` \| `gate` | `warn` |
| `SPEC_SCORE_THRESHOLD` | `0`–`100` | `80` |

- **`warn`**: log score; never fail the run; findings still inject into heal/generate repair prompts  
- **`gate`**: fail the run when score &lt; threshold  
- After AI **generate**, every spec is scored; a spec below threshold is repaired with its score findings and re-scored, up to 3 scored attempts (the initial generation plus up to two repairs). A spec still below threshold, or one that could not be scored, is flagged for Guardian review and never silently accepted.
- **Heal** and repair prompts always include score findings when the scorer reports issues.

```bash
# Local from monorepo
cd playwright-score && npm run build
cd ../playwright_runner && npm install
SPEC_SCORE_MODE=warn node ...
```

## Development

```bash
npm install
npm run build
npm test
npm run score -- ./fixtures/good-standard.spec.ts
```

## License

MIT
