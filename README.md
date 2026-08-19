# @qaguardian/playwright-score

[![CI](https://github.com/qa-guardian/playwright-score/actions/workflows/ci.yml/badge.svg)](https://github.com/qa-guardian/playwright-score/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@qaguardian/playwright-score.svg)](https://www.npmjs.com/package/@qaguardian/playwright-score)
[![license](https://img.shields.io/npm/l/@qaguardian/playwright-score.svg)](./LICENSE)

**Deterministic, AI-free quality score for Playwright specs** (`sqs-v1`).

**Website:** [qaguardian.com/open-source/playwright-score](https://qaguardian.com/open-source/playwright-score)  
**Built by:** [QA Guardian](https://qaguardian.com) — managed Playwright E2E (AI drafts, engineers verify, you own the code)

Lint + score Playwright tests against community best practices via
[`eslint-plugin-playwright`](https://github.com/playwright-community/eslint-plugin-playwright)
plus suite-level metrics (locator ratio, assertion-delegation tracing,
Page Object Model import resolution, ...).

The score never calls an LLM. AI may *generate* or *repair* code using findings; **rules grade code**.

## Real-world results

17 public Playwright suites, scored with the published package against each
project's actual source — chosen to include both well-known,
heavily-engineered platforms and smaller, less mature projects. Not curated
to look good: 3 of 17 fail the default threshold, for real, verifiable
reasons (see [VALIDATION.md](./VALIDATION.md)).

**17 suites · 1,212 files · 5,921 tests · 14/17 passed (80% threshold)**

| Repo (source scanned) | Score | Grade | Result |
|---|---:|:-:|:-:|
| [Playwright (own TodoMVC example)](https://github.com/microsoft/playwright/tree/main/examples/todomvc) | 98/100 | A | PASS |
| [Supabase](https://github.com/supabase/supabase/tree/master/e2e) | 98/100 | A | PASS |
| [Documenso](https://github.com/documenso/documenso/tree/main/packages/app-tests) | 96/100 | A | PASS |
| [Storybook](https://github.com/storybookjs/storybook/tree/next/code/e2e-internal) | 96/100 | A | PASS |
| [freeCodeCamp](https://github.com/freeCodeCamp/freeCodeCamp/tree/main/e2e) | 97/100 | A | PASS |
| [n8n](https://github.com/n8n-io/n8n/tree/master/packages/testing/playwright) | 95/100 | A | PASS |
| [dub](https://github.com/dubinc/dub/tree/main/apps/web/playwright) | 95/100 | A | PASS |
| [novu](https://github.com/novuhq/novu/tree/next/apps/dashboard/tests) | 93/100 | A | PASS |
| [Grafana](https://github.com/grafana/grafana/tree/main/e2e-playwright) | 92/100 | A | PASS |
| [PostHog](https://github.com/PostHog/posthog/tree/master/playwright) | 91/100 | A | PASS |
| [Mattermost](https://github.com/mattermost/mattermost/tree/master/e2e-tests/playwright) | 90/100 | A | PASS |
| [Immich](https://github.com/immich-app/immich/tree/main/e2e/src/specs) | 90/100 | A | PASS |
| [sencho](https://github.com/Studio-Saelix/sencho/tree/main/e2e) | 90/100 | A | PASS |
| [cal.com](https://github.com/calcom/cal.com/tree/main/apps/web/playwright) | 85/100 | B | PASS |
| [livecodes](https://github.com/live-codes/livecodes/tree/develop/e2e) | 78/100 | C | FAIL |
| [openplayerjs](https://github.com/openplayerjs/openplayerjs/tree/master/e2e) | 77/100 | C | FAIL |
| [TheCyberHub](https://github.com/th3cyb3rhub/TheCyberHub/tree/dev/e2e) | 73/100 | C | FAIL |

Repo names link to the exact source scanned. Full methodology, findings
breakdown, and `scripts/validate-corpus.sh` to reproduce every number here
yourself live in [VALIDATION.md](./VALIDATION.md). A visual version of this
table is at [`docs/scorecard.html`](./docs/scorecard.html) — self-contained,
host it wherever (GitHub Pages, qaguardian.com, ...).

See [METHODOLOGY.md](./METHODOLOGY.md) for the frozen formula, or the full product write-up on the [landing page](https://qaguardian.com/open-source/playwright-score).

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
- After AI **generate**, specs below threshold get one automatic **heal** pass with score findings  
- **Heal** prompts always include score findings when the scorer reports issues  

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
