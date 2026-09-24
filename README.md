# @qaguardian/playwright-score

[![CI](https://github.com/qa-guardian/playwright-score/actions/workflows/ci.yml/badge.svg)](https://github.com/qa-guardian/playwright-score/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@qaguardian/playwright-score.svg)](https://www.npmjs.com/package/@qaguardian/playwright-score)
[![license](https://img.shields.io/npm/l/@qaguardian/playwright-score.svg)](https://github.com/qa-guardian/playwright-score/blob/main/LICENSE)

**Deterministic, AI-free quality score for Playwright specs** — the
weighted share of your tests that are clean.

**Website:** [qaguardian.com/open-source/playwright-score](https://qaguardian.com/open-source/playwright-score)  
**Built by:** [QA Guardian](https://qaguardian.com) — managed Playwright E2E (AI drafts, engineers verify, you own the code)

Lint + score Playwright tests against community best practices via
[`eslint-plugin-playwright`](https://github.com/playwright-community/eslint-plugin-playwright)
plus suite-level metrics (locator ratio, assertion-delegation tracing,
Page Object Model import resolution, ...).

The score never calls an LLM. AI may *generate* or *repair* code using findings; **rules grade code**.

## Real-world results

100 public Playwright suites, scored with the published package against each
project's actual source — chosen to include both well-known,
heavily-engineered platforms and smaller, less mature projects, plus three
named testing-infra competitors scored under the exact same rules as
everyone else. Not curated to look good: 35 of 100 fail the default
threshold, for real, verifiable reasons (see
[VALIDATION.md](https://github.com/qa-guardian/playwright-score/blob/main/VALIDATION.md),
which also has the full before/after against the last published version
and every one of the 100 entries, not just the 15 shown below).

**100 suites · 7,281 files · 39,059 tests · 65/100 pass (80% threshold) ·
tested on 2026-09-24**

Top 10 scorers:

| Repo (source scanned) | Score | Grade | Result |
|---|---:|:-:|:-:|
| [pinterest/gestalt](https://github.com/pinterest/gestalt/tree/22874a7522d1/playwright/accessibility) | 100/100 | A | PASS |
| [TryGhost/Ghost](https://github.com/TryGhost/Ghost/tree/9d7248b56d53/e2e/tests) | 99/100 | A | PASS |
| [hashicorp/vault](https://github.com/hashicorp/vault/tree/f03da019aba5/ui/e2e) | 98/100 | A | PASS |
| [microsoft/playwright (TodoMVC example)](https://github.com/microsoft/playwright/tree/7563c5a67eab/examples/todomvc) | 98/100 | A | PASS |
| [plausible/analytics](https://github.com/plausible/analytics/tree/8f3970104aa7/e2e) | 98/100 | A | PASS |
| [segmentio/analytics-next](https://github.com/segmentio/analytics-next/tree/2d6d55301804/packages/browser-integration-tests/src) | 98/100 | A | PASS |
| [cloudflare/templates](https://github.com/cloudflare/templates/tree/a0bb6ef9a990/playwright-tests) | 97/100 | A | PASS |
| [glpi-project/glpi](https://github.com/glpi-project/glpi/tree/9e8a9570a90b/tests/e2e/specs) | 97/100 | A | PASS |
| [shopify/hydrogen](https://github.com/shopify/hydrogen/tree/3ef7ec23096a/e2e/specs) | 97/100 | A | PASS |
| [dubinc/dub](https://github.com/dubinc/dub/tree/feab62272a63/apps/web/playwright) | 96/100 | A | PASS |

Bottom 5 scorers:

| Repo (source scanned) | Score | Grade | Result |
|---|---:|:-:|:-:|
| [Flagsmith/flagsmith](https://github.com/Flagsmith/flagsmith/tree/ea5ad826e85b/frontend/e2e/tests) | 62/100 | D | FAIL |
| [activepieces/activepieces](https://github.com/activepieces/activepieces/tree/9e493a87f471/packages/tests-e2e) | 58/100 | F | FAIL |
| [th3cyb3rhub/TheCyberHub](https://github.com/th3cyb3rhub/TheCyberHub/tree/1cf418654f16/e2e) | 56/100 | F | FAIL |
| [DataDog/documentation](https://github.com/DataDog/documentation/tree/6cd10f40cf46/hugo/e2e) | 50/100 | F | FAIL |
| [getsentry/spotlight](https://github.com/getsentry/spotlight/tree/3dd5eb5b315f/packages/spotlight/tests) | 33/100 | F | FAIL |

Repo names link to the exact commit scanned. Selected by a mix of
mechanical GitHub search (real `@playwright/test` usage, hand-verified)
and, for the most recent 16, hand-picked brand recognition — three of the
100 are named competitors' own example suites (Checkly, Currents,
LambdaTest), scored with no separate bar. Full methodology, the complete
100-repo table, findings breakdown, and
`scripts/validate-corpus.sh` to reproduce every number here yourself live
in
[VALIDATION.md](https://github.com/qa-guardian/playwright-score/blob/main/VALIDATION.md).
A machine-readable
[`validation.json`](https://github.com/qa-guardian/playwright-score/blob/main/validation.json)
carries the same per-repo data for tooling. See
[CHANGELOG.md](https://github.com/qa-guardian/playwright-score/blob/main/CHANGELOG.md)
for what changed release to release. A self-contained visual
report of an earlier five-suite audit lives at
[`docs/scorecard.html`](https://github.com/qa-guardian/playwright-score/blob/main/docs/scorecard.html) — host it wherever
(GitHub Pages, qaguardian.com, ...).

See [METHODOLOGY.md](https://github.com/qa-guardian/playwright-score/blob/main/METHODOLOGY.md) for the full scoring model, or the product write-up on the [landing page](https://qaguardian.com/open-source/playwright-score).

## Install

```bash
npm install -D @qaguardian/playwright-score
```

Package: [@qaguardian/playwright-score](https://www.npmjs.com/package/@qaguardian/playwright-score) on npm.

## CLI

```bash
# One-shot (scoped package — use -p so the playwright-score binary is resolved)
npx -p @qaguardian/playwright-score playwright-score ./tests --profile standard --threshold 80

# After local install
npx playwright-score ./flow.spec.ts --format json --out report.json
```

| Flag | Description |
|---|---|
| `--profile standard` | Scoring profile (default, and only, profile) |
| `--threshold <n>` | Pass bar 0–100 |
| `--format text\|json\|markdown\|sarif` | Output format |
| `--out <file>` | Write report to file |
| `--version` | Print version |

**Exit codes:** `0` pass · `1` below threshold **or no files matched** · `2` tool error  

## Library

```ts
import { scorePaths } from '@qaguardian/playwright-score';

const result = await scorePaths({
  paths: ['tests/login.spec.ts'],
  profile: 'standard',
  threshold: 80,
});

console.log(result.score, result.grade, result.pass, result.findings);
```

## GitHub Action

Drop this into a workflow to gate PRs on the score, post a job summary, and
keep a sticky PR comment with the full findings up to date:

```yaml
- uses: qa-guardian/playwright-score@v1
  with:
    paths: tests e2e
    # threshold: 80        # defaults to 80
    mode: gate              # gate: fail CI below threshold · warn: report only
```

| Input | Description | Default |
|---|---|---|
| `paths` | Space-separated paths/globs to score | `tests` |
| `profile` | `standard` (default, and only, profile) | `standard` |
| `threshold` | Pass bar 0–100 | `80` |
| `mode` | `gate` (fail CI below threshold) \| `warn` (report only) | `gate` |
| `comment` | Post/update a sticky PR comment | `true` |
| `version` | `@qaguardian/playwright-score` version to run | `latest` |
| `github-token` | Token for the PR comment | `${{ github.token }}` |

Outputs: `score`, `grade`, `pass` — usable by downstream steps (e.g. a
custom badge, a Slack notification on regression, etc).

Prefer a raw CLI call, or a non-GitHub CI system? See the [CLI](#cli)
section above — same score, same exit codes:

```yaml
- name: Playwright Spec Score
  run: npx -p @qaguardian/playwright-score playwright-score ./tests --profile standard --threshold 80 --format text
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
