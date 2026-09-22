# Real-world validation

`playwright-score` is validated against real, public Playwright suites —
not just its own fixtures — on an ongoing basis. This file documents the
methodology and the current results; `scripts/validate-corpus.sh`
re-produces them from scratch against each repo's live `main`/`master`.

Every bug this project has found and fixed was found this way: point the
tool at real code, read the findings by hand, and treat anything
suspicious as a bug in the scorer until proven otherwise.

## Running it yourself

```bash
npm run build
bash scripts/validate-corpus.sh            # profile=standard threshold=80
bash scripts/validate-corpus.sh guardian 75
```

Each entry is a fresh, shallow, sparse clone of the real repo (only the
Playwright suite's own subdirectory is fetched) — nothing here is
committed to this repository, so there's no third-party source to keep in
sync or any licensing question to answer. Scores will drift slightly over
time as these projects' own suites change; that's expected and fine.

## Results (last run: 2026-09-21, Unreleased corpus-50 rules on top of v1.0.0, scoring model v3, `standard` profile, threshold 80)

Grown from 17 to 50 repos (QAG-196). Chosen deliberately to include
well-known heavily-engineered platforms, mid-size company products,
frameworks'/libraries' own e2e suites, and smaller/less mature projects —
this isn't a corpus selected to make the tool look good. Licence is
recorded per repo for reference; nothing here is redistributed, only read
and scored (`NOASSERTION` means GitHub's own detector found no
machine-readable licence file, not that one doesn't exist).

| Repo (source scanned) | Licence | Score | Grade | Pass | Files | Tests | Findings |
|---|---|---:|:-:|:-:|---:|---:|---:|
| [plausible/analytics](https://github.com/plausible/analytics/tree/0f362bd84eaa/e2e) | AGPL-3.0 | 98 | A | ✓ | 12 | 71 | 64 |
| [microsoft/playwright](https://github.com/microsoft/playwright/tree/0facd9234452/examples/todomvc) | Apache-2.0 | 98 | A | ✓ | 24 | 24 | 4 |
| [penpot/penpot](https://github.com/penpot/penpot/tree/433f8774497a/frontend/playwright) | MPL-2.0 | 96 | A | ✓ | 63 | 504 | 208 |
| [SigNoz/signoz](https://github.com/SigNoz/signoz/tree/64fff60d7e8c/tests/e2e) | NOASSERTION | 96 | A | ✓ | 51 | 312 | 118 |
| [dubinc/dub](https://github.com/dubinc/dub/tree/bd69439da068/apps/web/playwright) | NOASSERTION | 96 | A | ✓ | 34 | 365 | 46 |
| [temporalio/ui](https://github.com/temporalio/ui/tree/ffee0375c167/tests) | MIT | 96 | A | ✓ | 52 | 236 | 189 |
| [strapi/strapi](https://github.com/strapi/strapi/tree/142d9c6b31f3/tests/e2e) | NOASSERTION | 95 | A | ✓ | 98 | 278 | 187 |
| [keycloak/keycloak](https://github.com/keycloak/keycloak/tree/525b92e82211/js/apps/admin-ui/test) | Apache-2.0 | 95 | A | ✓ | 72 | 451 | 100 |
| [storybookjs/storybook](https://github.com/storybookjs/storybook/tree/0365105152a6/code/e2e-internal) | MIT | 95 | A | ✓ | 7 | 26 | 13 |
| [WordPress/gutenberg](https://github.com/WordPress/gutenberg/tree/736cfd3daf75/test/e2e) | NOASSERTION | 94 | A | ✓ | 338 | 1,902 | 1,611 |
| [n8n-io/n8n](https://github.com/n8n-io/n8n/tree/4e3a7720cf85/packages/testing/playwright) | NOASSERTION | 94 | A | ✓ | 276 | 1,023 | 65 |
| [freeCodeCamp/freeCodeCamp](https://github.com/freeCodeCamp/freeCodeCamp/tree/42e6beeed4e9/e2e) | BSD-3-Clause | 94 | A | ✓ | 85 | 286 | 179 |
| [documenso/documenso](https://github.com/documenso/documenso/tree/c81bc72c4c27/packages/app-tests) | AGPL-3.0 | 93 | A | ✓ | 132 | 1,156 | 713 |
| [supabase/supabase](https://github.com/supabase/supabase/tree/e1bdcc99dbf8/e2e) | Apache-2.0 | 92 | A | ✓ | 33 | 264 | 222 |
| [vendure-ecommerce/vendure](https://github.com/vendure-ecommerce/vendure/tree/07d595e1b844/packages/dashboard/e2e) | NOASSERTION | 91 | A | ✓ | 44 | 212 | 364 |
| [coder/coder](https://github.com/coder/coder/tree/47d3e1c52b14/site/e2e) | AGPL-3.0 | 91 | A | ✓ | 41 | 96 | 59 |
| [twentyhq/twenty](https://github.com/twentyhq/twenty/tree/710f1632ae96/packages/twenty-e2e-testing/tests) | NOASSERTION | 91 | A | ✓ | 9 | 17 | 24 |
| [wireapp/wire-webapp](https://github.com/wireapp/wire-webapp/tree/9b0f1ea71e1d/apps/webapp/test/e2e_tests) | GPL-3.0 | 91 | A | ✓ | 79 | 378 | 156 |
| [woocommerce/woocommerce](https://github.com/woocommerce/woocommerce/tree/aa5308378124/plugins/woocommerce/tests/e2e) | NOASSERTION | 90 | A | ✓ | 213 | 785 | 1,200 |
| [umami-software/umami](https://github.com/umami-software/umami/tree/ec0ff50388c2/tests/e2e) | MIT | 90 | A | ✓ | 8 | 38 | 33 |
| [element-hq/element-web](https://github.com/element-hq/element-web/tree/3153cc6ae123/apps/web/playwright) | AGPL-3.0 | 89 | B | ✓ | 154 | 753 | 1,084 |
| [PostHog/posthog](https://github.com/PostHog/posthog/tree/854a4262ec8b/playwright) | NOASSERTION | 88 | B | ✓ | 43 | 120 | 274 |
| [grafana/grafana](https://github.com/grafana/grafana/tree/1fd1d6398053/e2e-playwright) | AGPL-3.0 | 87 | B | ✓ | 213 | 680 | 872 |
| [clerk/javascript](https://github.com/clerk/javascript/tree/81a641348101/integration/tests) | MIT | 87 | B | ✓ | 130 | 579 | 452 |
| [Studio-Saelix/sencho](https://github.com/Studio-Saelix/sencho/tree/489e1a9a9a90/e2e) | AGPL-3.0 | 86 | B | ✓ | 32 | 191 | 336 |
| [Automattic/wp-calypso](https://github.com/Automattic/wp-calypso/tree/af6245bcd266/test/e2e) | GPL-2.0 | 85 | B | ✓ | 122 | 187 | 194 |
| [formbricks/formbricks](https://github.com/formbricks/formbricks/tree/55ade3bc2a5a/apps/web/playwright) | NOASSERTION | 85 | B | ✓ | 48 | 131 | 428 |
| [usebruno/bruno](https://github.com/usebruno/bruno/tree/f1b433f7b06f/tests) | MIT | 84 | B | ✓ | 479 | 1,564 | 3,339 |
| [mattermost/mattermost](https://github.com/mattermost/mattermost/tree/f0b63f8ed11e/e2e-tests/playwright) | NOASSERTION | 84 | B | ✓ | 354 | 1,215 | 1,925 |
| [saleor/saleor-dashboard](https://github.com/saleor/saleor-dashboard/tree/3508127f50dc/playwright) | BSD-3-Clause | 84 | B | ✓ | 39 | 158 | 66 |
| [handsontable/handsontable](https://github.com/handsontable/handsontable/tree/40c2738b2e87/tests/e2e) | NOASSERTION | 83 | B | ✓ | 152 | 1,469 | 169 |
| [RocketChat/Rocket.Chat](https://github.com/RocketChat/Rocket.Chat/tree/828fa06f72d5/apps/meteor/tests/e2e) | NOASSERTION | 83 | B | ✓ | 175 | 1,030 | 792 |
| [novuhq/novu](https://github.com/novuhq/novu/tree/6fc9d02ea001/apps/dashboard/tests) | NOASSERTION | 82 | B | ✓ | 2 | 2 | 3 |
| [microsoft/vscode](https://github.com/microsoft/vscode/tree/7b24b6303075/test/componentFixtures/playwright) | MIT | 81 | B | ✓ | 6 | 16 | 42 |
| [appsmithorg/appsmith](https://github.com/appsmithorg/appsmith/tree/a72a95b73a99/app/client/playwright/tests) | Apache-2.0 | 80 | B | ✓ | 6 | 15 | 9 |
| [payloadcms/payload](https://github.com/payloadcms/payload/tree/5f9bcac2f07b/test/admin/e2e) | MIT | 79 | C | ✗ FAIL | 8 | 271 | 652 |
| [immich-app/immich](https://github.com/immich-app/immich/tree/f48d4b332127/e2e/src/specs) | AGPL-3.0 | 78 | C | ✗ FAIL | 13 | 43 | 40 |
| [withastro/astro](https://github.com/withastro/astro/tree/40896acb7449/packages/astro/e2e) | NOASSERTION | 75 | C | ✗ FAIL | 50 | 311 | 994 |
| [openplayerjs/openplayerjs](https://github.com/openplayerjs/openplayerjs/tree/ee1673106237/e2e) | MIT | 73 | C | ✗ FAIL | 8 | 77 | 39 |
| [tldraw/tldraw](https://github.com/tldraw/tldraw/tree/a6cfe996e1df/apps/examples/e2e) | NOASSERTION | 73 | C | ✗ FAIL | 35 | 213 | 359 |
| [calcom/cal.com](https://github.com/calcom/cal.com/tree/54343aa685ae/apps/web/playwright) | MIT | 72 | C | ✗ FAIL | 53 | 253 | 1,259 |
| [BuilderIO/builder](https://github.com/BuilderIO/builder/tree/51cd0521bbf1/packages/sdks-tests/src/e2e-tests) | MIT | 72 | C | ✗ FAIL | 52 | 198 | 438 |
| [toeverything/AFFiNE](https://github.com/toeverything/AFFiNE/tree/d897bb3d8409/tests/blocksuite/e2e) | NOASSERTION | 71 | C | ✗ FAIL | 99 | 1,013 | 1,644 |
| [wekan/wekan](https://github.com/wekan/wekan/tree/84414711b7ae/tests/playwright/specs) | MIT | 71 | C | ✗ FAIL | 91 | 400 | 1,423 |
| [QwikDev/qwik](https://github.com/QwikDev/qwik/tree/02b5c6b18fe7/e2e) | MIT | 70 | C | ✗ FAIL | 69 | 449 | 1,646 |
| [live-codes/livecodes](https://github.com/live-codes/livecodes/tree/747054828256/e2e) | MIT | 70 | C | ✗ FAIL | 14 | 246 | 180 |
| [openreplay/openreplay](https://github.com/openreplay/openreplay/tree/3fce37d89113/frontend/tests/playwright) | NOASSERTION | 66 | D | ✗ FAIL | 5 | 5 | 31 |
| [Flagsmith/flagsmith](https://github.com/Flagsmith/flagsmith/tree/66dc2e9ed00b/frontend/e2e/tests) | BSD-3-Clause | 63 | D | ✗ FAIL | 20 | 27 | 77 |
| [activepieces/activepieces](https://github.com/activepieces/activepieces/tree/ab8cd5c9069e/packages/tests-e2e) | NOASSERTION | 58 | F | ✗ FAIL | 5 | 5 | 30 |
| [th3cyb3rhub/TheCyberHub](https://github.com/th3cyb3rhub/TheCyberHub/tree/1cf418654f16/e2e) | NOASSERTION | 56 | F | ✗ FAIL | 11 | 138 | 431 |

Repo names link straight to the exact commit/source scanned on GitHub —
re-run `scripts/validate-corpus.sh` for the full findings list of any
entry (it always scores the live default branch, so numbers drift
slightly over time; that's expected), or
`playwright-score <path> --format markdown` against your own clone.

**35 pass / 15 fail / 50 total.** 4,159 files, 20,183 tests. Model v3 is
deliberately stricter than the density models it replaced — see
METHODOLOGY.md. Adding the four Unreleased rules (`no-timer-sleep`,
`no-coordinate-click`, `no-trivial-assertion`,
`no-soft-assertion-only-test`) moved 13/50 repos' scores, net −33 points
across the corpus (mean −0.66/repo) — real findings on real code, not
noise: biggest movers were tldraw (−8) and AFFiNE (−6), both from
`no-coordinate-click`, and activepieces (−5) from one `no-trivial-
assertion` hit (`expect(true).toBe(true)` in a literal placeholder test).

**Known false-positive class, not fixed**: `no-coordinate-click` flags
`page.mouse.click(x, y)` unconditionally. That's the right call for a
typical DOM app (a fixed-pixel click is always brittle there) but it is
the *correct and only* way to interact with canvas-based apps — tldraw
and AFFiNE (both infinite-canvas editors) account for 428 of the rule's
459 hits across this corpus, and in both cases the coordinate click is
testing real canvas content with no addressable DOM element, not gaming
the score. If you maintain a canvas/whiteboard/drawing-tool suite,
`// eslint-disable-next-line pwscore/no-coordinate-click` with a reason is
the correct escape hatch — this is a known, accepted trade-off, not a bug.

## Bugs found this way, and fixed

Each of these was a real repo producing a wrong or unusable result — not
a hypothetical:

- **ESLint `basePath` bug** — the core reason the tool had zero effect
  anywhere it was used before this hardening pass.
- **Syntax errors scored 100/A** — the worst possible input got the best
  possible grade. Now a hard fail.
- **`node_modules` not excluded from directory scans** — a vendored
  dependency shipping its own `*.spec.ts` files got silently swept in.
- **`playwright/prefer-locator`/`prefer-native-locators` configured but
  never enabled** — Playwright's classic `page.click(selector)` anti-pattern
  was completely invisible to the score.
- **The entire upstream `recommended` rule group silently dropped**
  (≤0.2.0) — `buildConfig` spread eslint-plugin-playwright's
  `flat/recommended` only when it was an array, but the plugin exports a
  single config object, so nine mapped rules (`no-conditional-in-test`,
  `no-conditional-expect`, `no-element-handle`, `no-eval`,
  `no-page-pause`, `no-useless-await`, `valid-expect`,
  `no-standalone-expect`, `max-nested-describe`) never fired. A suite
  built entirely out of `if (await locator.isVisible())` branches scored
  a clean 100. Fixed in 0.3.0 by enabling the sqs-v1 rule set explicitly
  (frozen severities, no install-time inheritance).
- **Page Object Model suites scored 0/100 on locators** (n8n: 256 spec
  files, 0 direct locator calls, real locators living in a separate
  page-object layer) — fixed by tracing relative imports into local
  dependency files (`src/import-graph.ts`).
- **Assertion delegation only recognized free functions, never a class
  method** — almost every real Page Object Model is a class. Also missed
  `.waitFor({ state })`-style assertions and delegation more than one call
  deep (n8n's `NotificationsPage`).
- **`.e2e.`/`.e2e-spec.` naming conventions not discovered at all** —
  cal.com (53 specs, `*.e2e.ts`) and Immich (13 specs, `*.e2e-spec.ts`,
  alongside 31 same-suffix `vitest`/`supertest` backend specs correctly
  excluded) both hard-failed with "no files matched" despite fully healthy
  suites.
- **CLI stdout truncation on large output** — `console.log()` immediately
  followed by `process.exit()` raced Node's async pipe write; any report
  over 64KB (cal.com's 1,215-finding JSON, ~370KB) was silently cut at
  exactly the pipe buffer boundary when piped to another process. Anyone
  running `playwright-score ... | jq` (or any CI log processor) on a large
  enough suite got truncated, invalid JSON with no error.
- **`.pw.ts` naming convention not discovered at all** (QAG-196,
  2026-09-21) — Flagsmith's entire 20-spec `frontend/e2e` suite
  (`billing-test.pw.ts`, `flag-tests.pw.ts`, ...) hard-failed with "no
  files matched", the same failure mode `.e2e.ts`/`.e2e-spec.ts` were
  fixed for above. Fixed by adding `pw` to the spec-suffix glob.
- **Four gameable patterns had zero cost** (QAG-196, 2026-09-21,
  motivated by an internal finding that a spec built entirely from these
  four tricks scored 93/A): sleeping via
  `new Promise((resolve) => setTimeout(resolve, ms))` instead of
  `page.waitForTimeout` (same anti-pattern, undetectable by name),
  `page.mouse.click(x, y)` coordinate clicks, asserting on a literal
  constant (`expect(true).toBe(true)`), and a test whose only assertions
  are `expect.soft(...)`. Fixed by four new rules — see CHANGELOG.md
  "Unreleased" for exactly what each one catches and the corpus
  before/after.

See `CHANGELOG.md` for the full, dated history.
