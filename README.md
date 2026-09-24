# @qaguardian/playwright-score

[![CI](https://github.com/qa-guardian/playwright-score/actions/workflows/ci.yml/badge.svg)](https://github.com/qa-guardian/playwright-score/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@qaguardian/playwright-score.svg)](https://www.npmjs.com/package/@qaguardian/playwright-score)
[![license](https://img.shields.io/npm/l/@qaguardian/playwright-score.svg)](./LICENSE)

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

50 public Playwright suites, scored with the published package against each
project's actual source — chosen to include both well-known,
heavily-engineered platforms and smaller, less mature projects. Not curated
to look good: 16 of 50 fail the default threshold, for real, verifiable
reasons (see [VALIDATION.md](./VALIDATION.md), which also has the full
before/after against the last published version).

**50 suites · 4,159 files · 20,183 tests · 34/50 passed (80% threshold)**

| Repo (source scanned) | Score | Grade | Result |
|---|---:|:-:|:-:|
| [Plausible Analytics](https://github.com/plausible/analytics/tree/0f362bd84eaa/e2e) | 98/100 | A | PASS |
| [Playwright (own TodoMVC example)](https://github.com/microsoft/playwright/tree/0facd9234452/examples/todomvc) | 98/100 | A | PASS |
| [Penpot](https://github.com/penpot/penpot/tree/433f8774497a/frontend/playwright) | 96/100 | A | PASS |
| [SigNoz](https://github.com/SigNoz/signoz/tree/64fff60d7e8c/tests/e2e) | 96/100 | A | PASS |
| [Temporal UI](https://github.com/temporalio/ui/tree/ffee0375c167/tests) | 96/100 | A | PASS |
| [dub](https://github.com/dubinc/dub/tree/bd69439da068/apps/web/playwright) | 96/100 | A | PASS |
| [Keycloak (admin-ui)](https://github.com/keycloak/keycloak/tree/525b92e82211/js/apps/admin-ui/test) | 95/100 | A | PASS |
| [Storybook](https://github.com/storybookjs/storybook/tree/0365105152a6/code/e2e-internal) | 95/100 | A | PASS |
| [Strapi](https://github.com/strapi/strapi/tree/142d9c6b31f3/tests/e2e) | 95/100 | A | PASS |
| [freeCodeCamp](https://github.com/freeCodeCamp/freeCodeCamp/tree/42e6beeed4e9/e2e) | 94/100 | A | PASS |
| [n8n](https://github.com/n8n-io/n8n/tree/4e3a7720cf85/packages/testing/playwright) | 94/100 | A | PASS |
| [Documenso](https://github.com/documenso/documenso/tree/c81bc72c4c27/packages/app-tests) | 93/100 | A | PASS |
| [WordPress Gutenberg](https://github.com/WordPress/gutenberg/tree/736cfd3daf75/test/e2e) | 93/100 | A | PASS |
| [Supabase](https://github.com/supabase/supabase/tree/e1bdcc99dbf8/e2e) | 92/100 | A | PASS |
| [Umami](https://github.com/umami-software/umami/tree/ec0ff50388c2/tests/e2e) | 92/100 | A | PASS |
| [Coder](https://github.com/coder/coder/tree/47d3e1c52b14/site/e2e) | 91/100 | A | PASS |
| [Twenty CRM](https://github.com/twentyhq/twenty/tree/710f1632ae96/packages/twenty-e2e-testing/tests) | 91/100 | A | PASS |
| [Vendure](https://github.com/vendure-ecommerce/vendure/tree/07d595e1b844/packages/dashboard/e2e) | 91/100 | A | PASS |
| [Wire (wire-webapp)](https://github.com/wireapp/wire-webapp/tree/9b0f1ea71e1d/apps/webapp/test/e2e_tests) | 91/100 | A | PASS |
| [WooCommerce](https://github.com/woocommerce/woocommerce/tree/aa5308378124/plugins/woocommerce/tests/e2e) | 90/100 | A | PASS |
| [Element (Matrix client)](https://github.com/element-hq/element-web/tree/3153cc6ae123/apps/web/playwright) | 89/100 | B | PASS |
| [Clerk](https://github.com/clerk/javascript/tree/81a641348101/integration/tests) | 87/100 | B | PASS |
| [Grafana](https://github.com/grafana/grafana/tree/1fd1d6398053/e2e-playwright) | 87/100 | B | PASS |
| [PostHog](https://github.com/PostHog/posthog/tree/854a4262ec8b/playwright) | 87/100 | B | PASS |
| [Formbricks](https://github.com/formbricks/formbricks/tree/55ade3bc2a5a/apps/web/playwright) | 85/100 | B | PASS |
| [Bruno](https://github.com/usebruno/bruno/tree/f1b433f7b06f/tests) | 84/100 | B | PASS |
| [Mattermost](https://github.com/mattermost/mattermost/tree/f0b63f8ed11e/e2e-tests/playwright) | 84/100 | B | PASS |
| [Saleor Dashboard](https://github.com/saleor/saleor-dashboard/tree/3508127f50dc/playwright) | 84/100 | B | PASS |
| [WordPress.com Calypso](https://github.com/Automattic/wp-calypso/tree/af6245bcd266/test/e2e) | 84/100 | B | PASS |
| [sencho](https://github.com/Studio-Saelix/sencho/tree/489e1a9a9a90/e2e) | 84/100 | B | PASS |
| [Handsontable](https://github.com/handsontable/handsontable/tree/40c2738b2e87/tests/e2e) | 83/100 | B | PASS |
| [Rocket.Chat](https://github.com/RocketChat/Rocket.Chat/tree/828fa06f72d5/apps/meteor/tests/e2e) | 83/100 | B | PASS |
| [novu](https://github.com/novuhq/novu/tree/6fc9d02ea001/apps/dashboard/tests) | 82/100 | B | PASS |
| [Appsmith](https://github.com/appsmithorg/appsmith/tree/a72a95b73a99/app/client/playwright/tests) | 80/100 | B | PASS |
| [Payload CMS](https://github.com/payloadcms/payload/tree/5f9bcac2f07b/test/admin/e2e) | 79/100 | C | FAIL |
| [Immich](https://github.com/immich-app/immich/tree/f48d4b332127/e2e/src/specs) | 78/100 | C | FAIL |
| [VS Code (component fixtures)](https://github.com/microsoft/vscode/tree/7b24b6303075/test/componentFixtures/playwright) | 77/100 | C | FAIL |
| [Astro](https://github.com/withastro/astro/tree/40896acb7449/packages/astro/e2e) | 75/100 | C | FAIL |
| [AFFiNE](https://github.com/toeverything/AFFiNE/tree/d897bb3d8409/tests/blocksuite/e2e) | 72/100 | C | FAIL |
| [Builder.io SDKs](https://github.com/BuilderIO/builder/tree/51cd0521bbf1/packages/sdks-tests/src/e2e-tests) | 72/100 | C | FAIL |
| [openplayerjs](https://github.com/openplayerjs/openplayerjs/tree/ee1673106237/e2e) | 72/100 | C | FAIL |
| [tldraw](https://github.com/tldraw/tldraw/tree/a6cfe996e1df/apps/examples/e2e) | 72/100 | C | FAIL |
| [cal.com](https://github.com/calcom/cal.com/tree/54343aa685ae/apps/web/playwright) | 71/100 | C | FAIL |
| [Qwik](https://github.com/QwikDev/qwik/tree/02b5c6b18fe7/e2e) | 70/100 | C | FAIL |
| [Wekan](https://github.com/wekan/wekan/tree/84414711b7ae/tests/playwright/specs) | 70/100 | C | FAIL |
| [livecodes](https://github.com/live-codes/livecodes/tree/747054828256/e2e) | 70/100 | C | FAIL |
| [OpenReplay](https://github.com/openreplay/openreplay/tree/3fce37d89113/frontend/tests/playwright) | 66/100 | D | FAIL |
| [Flagsmith](https://github.com/Flagsmith/flagsmith/tree/66dc2e9ed00b/frontend/e2e/tests) | 62/100 | D | FAIL |
| [Activepieces](https://github.com/activepieces/activepieces/tree/ab8cd5c9069e/packages/tests-e2e) | 58/100 | F | FAIL |
| [TheCyberHub](https://github.com/th3cyb3rhub/TheCyberHub/tree/1cf418654f16/e2e) | 56/100 | F | FAIL |

Repo names link to the exact source scanned. Full methodology, findings
breakdown, and `scripts/validate-corpus.sh` to reproduce every number here
yourself live in [VALIDATION.md](./VALIDATION.md). A self-contained visual
report of an earlier five-suite audit lives at
[`docs/scorecard.html`](./docs/scorecard.html) — host it wherever
(GitHub Pages, qaguardian.com, ...).

See [METHODOLOGY.md](./METHODOLOGY.md) for the full scoring model, or the product write-up on the [landing page](https://qaguardian.com/open-source/playwright-score).

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
