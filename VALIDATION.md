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
bash scripts/validate-corpus.sh standard 75
```

Each entry is a fresh, shallow, sparse clone of the real repo (only the
Playwright suite's own subdirectory is fetched) — nothing here is
committed to this repository, so there's no third-party source to keep in
sync or any licensing question to answer. Scores will drift slightly over
time as these projects' own suites change; that's expected and fine.

## Results (last run: 2026-09-23, 2.0.0, scoring model v4, `standard` profile, threshold 80)

Grown from 17 to 50 repos (QAG-196). Chosen deliberately to include
well-known heavily-engineered platforms, mid-size company products,
frameworks'/libraries' own e2e suites, and smaller/less mature projects —
this isn't a corpus selected to make the tool look good. Licence is
recorded per repo for reference; nothing here is redistributed, only read
and scored (`NOASSERTION` means GitHub's own detector found no
machine-readable licence file, not that one doesn't exist).

| Repo (source scanned) | Licence | Score | Grade | Pass | Files | Tests | Findings |
|---|---|---:|:-:|:-:|---:|---:|---:|
| [microsoft/playwright](https://github.com/microsoft/playwright/tree/91eeb0cfe924/examples/todomvc) | Apache-2.0 | 98 | A | ✓ | 24 | 24 | 4 |
| [plausible/analytics](https://github.com/plausible/analytics/tree/b04e60123206/e2e) | AGPL-3.0 | 98 | A | ✓ | 12 | 71 | 64 |
| [dubinc/dub](https://github.com/dubinc/dub/tree/78c4d999482f/apps/web/playwright) | NOASSERTION | 96 | A | ✓ | 34 | 365 | 46 |
| [keycloak/keycloak](https://github.com/keycloak/keycloak/tree/421c23f5221d/js/apps/admin-ui/test) | Apache-2.0 | 96 | A | ✓ | 72 | 452 | 103 |
| [penpot/penpot](https://github.com/penpot/penpot/tree/cbb9e5d971cf/frontend/playwright) | MPL-2.0 | 96 | A | ✓ | 64 | 506 | 238 |
| [temporalio/ui](https://github.com/temporalio/ui/tree/ffee0375c167/tests) | MIT | 96 | A | ✓ | 52 | 236 | 201 |
| [SigNoz/signoz](https://github.com/SigNoz/signoz/tree/2c09fedde156/tests/e2e) | NOASSERTION | 95 | A | ✓ | 51 | 312 | 161 |
| [storybookjs/storybook](https://github.com/storybookjs/storybook/tree/6d3aa36dc2db/code/e2e-internal) | MIT | 95 | A | ✓ | 7 | 26 | 13 |
| [strapi/strapi](https://github.com/strapi/strapi/tree/a82c2d8bab32/tests/e2e) | NOASSERTION | 95 | A | ✓ | 99 | 279 | 191 |
| [freeCodeCamp/freeCodeCamp](https://github.com/freeCodeCamp/freeCodeCamp/tree/416b4f236f6d/e2e) | BSD-3-Clause | 94 | A | ✓ | 85 | 286 | 187 |
| [n8n-io/n8n](https://github.com/n8n-io/n8n/tree/bd2efe1c9e5a/packages/testing/playwright) | NOASSERTION | 94 | A | ✓ | 276 | 1,025 | 117 |
| [documenso/documenso](https://github.com/documenso/documenso/tree/638e92d53447/packages/app-tests) | AGPL-3.0 | 93 | A | ✓ | 135 | 1,183 | 741 |
| [WordPress/gutenberg](https://github.com/WordPress/gutenberg/tree/d1180ee9bdab/test/e2e) | NOASSERTION | 93 | A | ✓ | 340 | 1,910 | 1,773 |
| [supabase/supabase](https://github.com/supabase/supabase/tree/d067e81a6968/e2e) | Apache-2.0 | 92 | A | ✓ | 33 | 264 | 222 |
| [umami-software/umami](https://github.com/umami-software/umami/tree/ec0ff50388c2/tests/e2e) | MIT | 92 | A | ✓ | 8 | 38 | 33 |
| [coder/coder](https://github.com/coder/coder/tree/05cad598a51a/site/e2e) | AGPL-3.0 | 91 | A | ✓ | 41 | 96 | 59 |
| [twentyhq/twenty](https://github.com/twentyhq/twenty/tree/964199914006/packages/twenty-e2e-testing/tests) | NOASSERTION | 91 | A | ✓ | 9 | 17 | 24 |
| [vendure-ecommerce/vendure](https://github.com/vendure-ecommerce/vendure/tree/cccf0a72ec1b/packages/dashboard/e2e) | NOASSERTION | 91 | A | ✓ | 44 | 212 | 365 |
| [wireapp/wire-webapp](https://github.com/wireapp/wire-webapp/tree/e14ccb31925c/apps/webapp/test/e2e_tests) | GPL-3.0 | 91 | A | ✓ | 79 | 378 | 156 |
| [element-hq/element-web](https://github.com/element-hq/element-web/tree/49d715c1e9f7/apps/web/playwright) | AGPL-3.0 | 89 | B | ✓ | 154 | 753 | 1,104 |
| [woocommerce/woocommerce](https://github.com/woocommerce/woocommerce/tree/1d9de8547954/plugins/woocommerce/tests/e2e) | NOASSERTION | 89 | B | ✓ | 213 | 785 | 1,275 |
| [clerk/javascript](https://github.com/clerk/javascript/tree/a97eec424fbf/integration/tests) | MIT | 87 | B | ✓ | 130 | 577 | 483 |
| [grafana/grafana](https://github.com/grafana/grafana/tree/4a20de9a9ed6/e2e-playwright) | AGPL-3.0 | 87 | B | ✓ | 213 | 680 | 954 |
| [PostHog/posthog](https://github.com/PostHog/posthog/tree/debd20ac48f5/playwright) | NOASSERTION | 87 | B | ✓ | 43 | 120 | 278 |
| [formbricks/formbricks](https://github.com/formbricks/formbricks/tree/97a1c69b9656/apps/web/playwright) | NOASSERTION | 85 | B | ✓ | 48 | 132 | 437 |
| [Studio-Saelix/sencho](https://github.com/Studio-Saelix/sencho/tree/bb85e08b3657/e2e) | AGPL-3.0 | 85 | B | ✓ | 34 | 200 | 362 |
| [Automattic/wp-calypso](https://github.com/Automattic/wp-calypso/tree/5582346c4d19/test/e2e) | GPL-2.0 | 84 | B | ✓ | 122 | 187 | 202 |
| [mattermost/mattermost](https://github.com/mattermost/mattermost/tree/163baf0351e8/e2e-tests/playwright) | NOASSERTION | 84 | B | ✓ | 354 | 1,216 | 2,003 |
| [saleor/saleor-dashboard](https://github.com/saleor/saleor-dashboard/tree/a1c34ce380ca/e2e-legacy) | BSD-3-Clause | 84 | B | ✓ | 39 | 158 | 67 |
| [usebruno/bruno](https://github.com/usebruno/bruno/tree/4eb7e585f0fb/tests) | MIT | 84 | B | ✓ | 486 | 1,579 | 3,376 |
| [handsontable/handsontable](https://github.com/handsontable/handsontable/tree/3af7620923d9/tests/e2e) | NOASSERTION | 83 | B | ✓ | 158 | 1,492 | 251 |
| [RocketChat/Rocket.Chat](https://github.com/RocketChat/Rocket.Chat/tree/8503912d6709/apps/meteor/tests/e2e) | NOASSERTION | 83 | B | ✓ | 176 | 1,050 | 800 |
| [novuhq/novu](https://github.com/novuhq/novu/tree/eda627cdee8c/apps/dashboard/tests) | NOASSERTION | 82 | B | ✓ | 2 | 2 | 3 |
| [appsmithorg/appsmith](https://github.com/appsmithorg/appsmith/tree/bb851c2939cb/app/client/playwright/tests) | Apache-2.0 | 80 | B | ✓ | 6 | 15 | 9 |
| [payloadcms/payload](https://github.com/payloadcms/payload/tree/346bd5087d12/test/admin/e2e) | MIT | 79 | C | ✗ FAIL | 8 | 272 | 658 |
| [immich-app/immich](https://github.com/immich-app/immich/tree/e66f2c7615ba/e2e/src/specs) | AGPL-3.0 | 78 | C | ✗ FAIL | 13 | 43 | 42 |
| [microsoft/vscode](https://github.com/microsoft/vscode/tree/1e13e20a1125/test/componentFixtures/playwright) | MIT | 76 | C | ✗ FAIL | 7 | 18 | 55 |
| [withastro/astro](https://github.com/withastro/astro/tree/2b8b2e80169d/packages/astro/e2e) | NOASSERTION | 75 | C | ✗ FAIL | 50 | 311 | 998 |
| [BuilderIO/builder](https://github.com/BuilderIO/builder/tree/51cd0521bbf1/packages/sdks-tests/src/e2e-tests) | MIT | 72 | C | ✗ FAIL | 52 | 198 | 440 |
| [openplayerjs/openplayerjs](https://github.com/openplayerjs/openplayerjs/tree/ee1673106237/e2e) | MIT | 72 | C | ✗ FAIL | 8 | 77 | 47 |
| [tldraw/tldraw](https://github.com/tldraw/tldraw/tree/f73c0603e63e/apps/examples/e2e) | NOASSERTION | 72 | C | ✗ FAIL | 35 | 213 | 518 |
| [toeverything/AFFiNE](https://github.com/toeverything/AFFiNE/tree/ca0ffc52f781/tests/blocksuite/e2e) | NOASSERTION | 72 | C | ✗ FAIL | 99 | 1,013 | 2,024 |
| [calcom/cal.com](https://github.com/calcom/cal.com/tree/54343aa685ae/apps/web/playwright) | MIT | 71 | C | ✗ FAIL | 53 | 253 | 1,308 |
| [live-codes/livecodes](https://github.com/live-codes/livecodes/tree/747054828256/e2e) | MIT | 70 | C | ✗ FAIL | 14 | 246 | 180 |
| [wekan/wekan](https://github.com/wekan/wekan/tree/ecd853dc1da0/tests/playwright/specs) | MIT | 70 | C | ✗ FAIL | 106 | 440 | 1,770 |
| [QwikDev/qwik](https://github.com/QwikDev/qwik/tree/a17603ea0c8c/e2e) | MIT | 69 | D | ✗ FAIL | 69 | 449 | 1,664 |
| [openreplay/openreplay](https://github.com/openreplay/openreplay/tree/354828a17fd2/frontend/tests/playwright) | NOASSERTION | 66 | D | ✗ FAIL | 5 | 5 | 31 |
| [Flagsmith/flagsmith](https://github.com/Flagsmith/flagsmith/tree/cd1c5db2dbea/frontend/e2e/tests) | BSD-3-Clause | 62 | D | ✗ FAIL | 20 | 27 | 80 |
| [activepieces/activepieces](https://github.com/activepieces/activepieces/tree/5885f009ad30/packages/tests-e2e) | NOASSERTION | 58 | F | ✗ FAIL | 5 | 5 | 30 |
| [th3cyb3rhub/TheCyberHub](https://github.com/th3cyb3rhub/TheCyberHub/tree/1cf418654f16/e2e) | NOASSERTION | 56 | F | ✗ FAIL | 11 | 138 | 431 |

Repo names link straight to the exact commit/source scanned on GitHub —
re-run `scripts/validate-corpus.sh` for the full findings list of any
entry (it always scores the live default branch, so numbers drift
slightly over time; that's expected), or
`playwright-score <path> --format markdown` against your own clone.

**34 pass / 16 fail / 50 total.** 4,198 files, 20,334 tests. Model v3 was
already deliberately stricter than the density models it replaced (see
METHODOLOGY.md); v4 tightens it further by scoring the four QAG-196
gameability rules and the `eslint-disable-comment` finding directly under
`standard` (owner direction — see CHANGELOG.md's 2.0.0 entry), instead of
report-only under `standard` as a never-published 1.1.0 had planned.

**Against the last actually-published version (1.0.0, model v3, no QAG-196
rules at all)**: 20/50 repos move. Net **+22** across the corpus, but
that's almost entirely one repo — Flagsmith moves from a hard-failed 0
(its 20-spec suite wasn't discovered at all before the `.pw.ts` fix) to a
real 62/D, +62 on its own. Excluding Flagsmith, the other 19 movers are
**net −40** (mean −2.1/repo) — real, quality-driven drops, not noise.
Biggest: tldraw −9, AFFiNE −5, activepieces −5, microsoft/vscode −4,
Studio-Saelix/sencho −2, cal.com −2, then a tail of thirteen −1s. **Three
pass→fail flips at the default threshold (80)**: `payloadcms/payload`
(80→79), `microsoft/vscode` (81→77), and `tldraw/tldraw` (81→72, also the
corpus's biggest single mover — see the canvas-app note below). Pass rate
moves from 37/50 (74%) to 34/50 (68%).

**Known false-positive class, mitigated but not eliminated**:
`no-coordinate-click` flags `page.mouse.click/dblclick/move/down/up(x, y)`
unconditionally. That's the right call for a typical DOM app (a
fixed-pixel interaction is always brittle there) but it is the *correct
and only* way to interact with canvas-based apps — tldraw and AFFiNE
(both infinite-canvas editors) account for 428 of the rule's 459 hits
across this corpus, and in both cases the coordinate interaction is
testing real canvas content with no addressable DOM element, not gaming
the score. As of 2.0.0 this rule is a **warning** (0.4 demerit), not an
error (1.0), specifically to soften this case — see METHODOLOGY.md's "Why
v4" for why a severity change was chosen over a canvas-detection
heuristic. It still costs real points for a canvas-heavy suite (this is
exactly what flips tldraw from pass to fail above), and there's no
per-repo override: **this project no longer recommends `// eslint-disable-
next-line pwscore/no-coordinate-click` as a workaround** — see "Known
limitations" below for why, and use a per-test-file exemption in your own
CI config if you maintain a canvas/whiteboard/drawing-tool suite and need
one.

## Known limitations

- **`pwscore/eslint-disable-comment` reports the presence of a suppression
  comment, not which specific rule or finding it silences.** It flags
  every `eslint-disable`/`eslint-disable-line`/`eslint-disable-next-line`
  (block or line form) in a scored file, unconditionally — including one
  that legitimately silences a rule this package doesn't even bundle
  (e.g. `@typescript-eslint/no-unused-vars`). As of 2.0.0 the comment can
  no longer also silence the finding it names for scoring purposes:
  `linterOptions.noInlineConfig` (see CHANGELOG.md's 2.0.0 "Fixed" entry)
  makes every inline directive inert for this package's own rule set, so
  the comment is only ever a demerit, never a way to make a real finding
  disappear. This project's own earlier docs recommended `//
  eslint-disable-next-line pwscore/no-coordinate-click` as an escape
  hatch for canvas apps (see above); that recommendation stays withdrawn
  regardless — it no longer even works as a silencer, only as an extra
  demerit on top of whatever it was aimed at. Resolving exactly which
  rule a given comment targets (and whether that rule is even one this
  scorer emits) would make the finding precise instead of coarse; that's
  a known, intentional gap for now, not an oversight.
- **The four QAG-196 rules match specific known patterns, not the general
  class they're each named for.** See CHANGELOG.md's 2.0.0 entry for
  exactly which respellings each one catches — any pattern not listed is
  a false negative this scorer will not see.

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
  are `expect.soft(...)`. Fixed by four new rules — see CHANGELOG.md's
  2.0.0 entry for exactly what each one catches and the corpus
  before/after.

See `CHANGELOG.md` for the full, dated history.
