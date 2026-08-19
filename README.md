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

**[See the scorecard →](https://claude.ai/code/artifact/6eea8712-f71a-48e6-becb-1e98dc07a600)** — real scores against cal.com, Grafana, Mattermost, and more.

See [METHODOLOGY.md](./METHODOLOGY.md) for the frozen formula, [VALIDATION.md](./VALIDATION.md) for the full results table and a re-runnable script to reproduce them, or the full product write-up on the [landing page](https://qaguardian.com/open-source/playwright-score).

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
