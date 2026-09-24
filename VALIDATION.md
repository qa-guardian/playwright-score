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

Grown from 50 to 84 repos (QAG-196, second pass). Chosen deliberately to
include well-known heavily-engineered platforms, mid-size company
products, frameworks'/libraries' own e2e suites, and smaller/less mature
projects — this isn't a corpus selected to make the tool look good.
Licence is recorded per repo for reference; nothing here is
redistributed, only read and scored (`NOASSERTION` means GitHub's own
detector found no machine-readable licence file, not that one doesn't
exist). All 84 scores below (including the original 50) are from one
fresh run against each repo's live default branch on 2026-09-23, so the
handful of original-50 scores that drifted by a point or two from the
last published table reflect real upstream changes to those suites, not
a re-scoring artifact.

**Honest note on the target vs. what shipped**: the goal for this pass
was ~50 new repos (100 total). 34 shipped, not 50. Two things ate the
rest of the budget: (1) most blind guesses at "reputable org uses
Playwright" were wrong — of roughly 900 owner/repo candidates checked
across `gh search code`/`gh search repos --topic`/`gh api orgs/*/repos`
sweeps (Apache, Cloudflare, Elastic, SAP, Atlassian, Red Hat, Shopify,
LinkedIn, Netflix, PayPal, eBay, and ~120 hand-picked well-known names),
the overwhelming majority had no `playwright.config.*` at all or fell
below the 10-spec bar; (2) one candidate (`remix-run/remix`, tested at
`packages/ui`) was found and *deliberately excluded* after scoring:
it has a `playwright.config.ts` but its actual test files import
`describe`/`it`/`expect` from `@remix-run/test`/`@remix-run/assert`, a
completely different, custom test framework — not `@playwright/test` at
all. The config appears vestigial. Publishing that repo's score would
have been scoring the wrong thing. 34 real, verified repos was judged
better than padding to 50 with a repo that fails this test's own
premise.

| Repo (source scanned) | Licence | Score | Grade | Pass | Files | Tests | Findings |
|---|---|---:|:-:|:-:|---:|---:|---:|
| [hashicorp/vault](https://github.com/hashicorp/vault/tree/c4cb28fd7129/ui/e2e) | NOASSERTION | 98 | A | ✓ | 32 | 51 | 140 |
| [microsoft/playwright](https://github.com/microsoft/playwright/tree/85b947350fd1/examples/todomvc) | Apache-2.0 | 98 | A | ✓ | 24 | 24 | 4 |
| [plausible/analytics](https://github.com/plausible/analytics/tree/b04e60123206/e2e) | AGPL-3.0 | 98 | A | ✓ | 12 | 71 | 64 |
| [cloudflare/templates](https://github.com/cloudflare/templates/tree/a0bb6ef9a990/playwright-tests) | MIT | 97 | A | ✓ | 41 | 63 | 26 |
| [glpi-project/glpi](https://github.com/glpi-project/glpi/tree/cd55bb669123/tests/e2e/specs) | GPL-3.0 | 97 | A | ✓ | 106 | 389 | 212 |
| [dubinc/dub](https://github.com/dubinc/dub/tree/277d31dffd7b/apps/web/playwright) | NOASSERTION | 96 | A | ✓ | 34 | 365 | 46 |
| [keycloak/keycloak](https://github.com/keycloak/keycloak/tree/421c23f5221d/js/apps/admin-ui/test) | Apache-2.0 | 96 | A | ✓ | 72 | 452 | 103 |
| [mozilla/fxa](https://github.com/mozilla/fxa/tree/0e56416ee5ec/packages/functional-tests/tests) | MPL-2.0 | 96 | A | ✓ | 111 | 429 | 99 |
| [penpot/penpot](https://github.com/penpot/penpot/tree/cbb9e5d971cf/frontend/playwright) | MPL-2.0 | 96 | A | ✓ | 64 | 506 | 238 |
| [temporalio/ui](https://github.com/temporalio/ui/tree/ffee0375c167/tests) | MIT | 96 | A | ✓ | 52 | 236 | 201 |
| [xmlui-org/xmlui](https://github.com/xmlui-org/xmlui/tree/d9e00d2e208b/xmlui) | MIT | 96 | A | ✓ | 406 | 6880 | 2397 |
| [baloise/design-system](https://github.com/baloise/design-system/tree/2b28db9b43e3/packages/core) | Apache-2.0 | 95 | A | ✓ | 15 | 192 | 62 |
| [SigNoz/signoz](https://github.com/SigNoz/signoz/tree/2c09fedde156/tests/e2e) | NOASSERTION | 95 | A | ✓ | 51 | 312 | 161 |
| [storybookjs/storybook](https://github.com/storybookjs/storybook/tree/6d3aa36dc2db/code/e2e-internal) | MIT | 95 | A | ✓ | 7 | 26 | 13 |
| [strapi/strapi](https://github.com/strapi/strapi/tree/a82c2d8bab32/tests/e2e) | NOASSERTION | 95 | A | ✓ | 99 | 279 | 191 |
| [carbon-design-system/carbon](https://github.com/carbon-design-system/carbon/tree/61b90a427aab/e2e) | Apache-2.0 | 94 | A | ✓ | 95 | 422 | 199 |
| [freeCodeCamp/freeCodeCamp](https://github.com/freeCodeCamp/freeCodeCamp/tree/416b4f236f6d/e2e) | BSD-3-Clause | 94 | A | ✓ | 85 | 286 | 188 |
| [n8n-io/n8n](https://github.com/n8n-io/n8n/tree/bd2efe1c9e5a/packages/testing/playwright) | NOASSERTION | 94 | A | ✓ | 276 | 1025 | 117 |
| [apache/apisix-dashboard](https://github.com/apache/apisix-dashboard/tree/fa2fd0f60f8a/e2e/tests) | Apache-2.0 | 93 | A | ✓ | 125 | 208 | 172 |
| [documenso/documenso](https://github.com/documenso/documenso/tree/39ae85483ae0/packages/app-tests) | AGPL-3.0 | 93 | A | ✓ | 135 | 1183 | 741 |
| [godotlauncher/launcher](https://github.com/godotlauncher/launcher/tree/f77f86aaa65d/e2e) | MIT | 93 | A | ✓ | 17 | 113 | 133 |
| [radix-ui/primitives](https://github.com/radix-ui/primitives/tree/f7ecd5ab16f5/e2e) | MIT | 93 | A | ✓ | 11 | 105 | 52 |
| [sanity-io/sanity](https://github.com/sanity-io/sanity/tree/455717e7ba18/e2e) | MIT | 93 | A | ✓ | 65 | 171 | 247 |
| [WordPress/gutenberg](https://github.com/WordPress/gutenberg/tree/1d28da902fb1/test/e2e) | NOASSERTION | 93 | A | ✓ | 340 | 1910 | 1775 |
| [primer/react](https://github.com/primer/react/tree/535ced4af63f/e2e) | MIT | 92 | A | ✓ | 79 | 190 | 77 |
| [supabase/supabase](https://github.com/supabase/supabase/tree/6817c483a7ed/e2e) | Apache-2.0 | 92 | A | ✓ | 33 | 264 | 222 |
| [umami-software/umami](https://github.com/umami-software/umami/tree/ec0ff50388c2/tests/e2e) | MIT | 92 | A | ✓ | 8 | 38 | 33 |
| [coder/coder](https://github.com/coder/coder/tree/d95082840d50/site/e2e) | AGPL-3.0 | 91 | A | ✓ | 41 | 96 | 59 |
| [twentyhq/twenty](https://github.com/twentyhq/twenty/tree/964199914006/packages/twenty-e2e-testing/tests) | NOASSERTION | 91 | A | ✓ | 9 | 17 | 24 |
| [vendure-ecommerce/vendure](https://github.com/vendure-ecommerce/vendure/tree/cccf0a72ec1b/packages/dashboard/e2e) | NOASSERTION | 91 | A | ✓ | 44 | 212 | 365 |
| [wireapp/wire-webapp](https://github.com/wireapp/wire-webapp/tree/e14ccb31925c/apps/webapp/test/e2e_tests) | GPL-3.0 | 91 | A | ✓ | 79 | 378 | 156 |
| [cupcakearmy/cryptgeon](https://github.com/cupcakearmy/cryptgeon/tree/cc2c45221bbd/test) | MIT | 89 | B | ✓ | 11 | 24 | 8 |
| [element-hq/element-web](https://github.com/element-hq/element-web/tree/49d715c1e9f7/apps/web/playwright) | AGPL-3.0 | 89 | B | ✓ | 154 | 753 | 1104 |
| [woocommerce/woocommerce](https://github.com/woocommerce/woocommerce/tree/1d9de8547954/plugins/woocommerce/tests/e2e) | NOASSERTION | 89 | B | ✓ | 213 | 785 | 1280 |
| [go-gitea/gitea](https://github.com/go-gitea/gitea/tree/2177969aba55/tests/e2e) | MIT | 88 | B | ✓ | 29 | 56 | 128 |
| [clerk/javascript](https://github.com/clerk/javascript/tree/a97eec424fbf/integration/tests) | MIT | 87 | B | ✓ | 130 | 577 | 483 |
| [grafana/grafana](https://github.com/grafana/grafana/tree/4a20de9a9ed6/e2e-playwright) | AGPL-3.0 | 87 | B | ✓ | 213 | 680 | 954 |
| [nuxt/nuxt](https://github.com/nuxt/nuxt/tree/3006e5ac9273/test/e2e) | MIT | 87 | B | ✓ | 23 | 171 | 240 |
| [PostHog/posthog](https://github.com/PostHog/posthog/tree/754fa69e9d80/playwright) | NOASSERTION | 87 | B | ✓ | 43 | 120 | 279 |
| [mtlynch/whatgotdone](https://github.com/mtlynch/whatgotdone/tree/ef10be2a9f8a/e2e) | Apache-2.0 | 86 | B | ✓ | 12 | 24 | 60 |
| [zotero/web-library](https://github.com/zotero/web-library/tree/d0f2ea882023/test/playwright) | NOASSERTION | 86 | B | ✓ | 17 | 104 | 154 |
| [formbricks/formbricks](https://github.com/formbricks/formbricks/tree/97a1c69b9656/apps/web/playwright) | NOASSERTION | 85 | B | ✓ | 48 | 132 | 437 |
| [Studio-Saelix/sencho](https://github.com/Studio-Saelix/sencho/tree/fc6cc62a27dd/e2e) | AGPL-3.0 | 85 | B | ✓ | 34 | 200 | 362 |
| [Automattic/wp-calypso](https://github.com/Automattic/wp-calypso/tree/1ffdf172dccb/test/e2e) | GPL-2.0 | 84 | B | ✓ | 122 | 187 | 202 |
| [mattermost/mattermost](https://github.com/mattermost/mattermost/tree/913291dd0518/e2e-tests/playwright) | NOASSERTION | 84 | B | ✓ | 355 | 1219 | 2003 |
| [saleor/saleor-dashboard](https://github.com/saleor/saleor-dashboard/tree/a1c34ce380ca/e2e-legacy) | BSD-3-Clause | 84 | B | ✓ | 39 | 158 | 67 |
| [usebruno/bruno](https://github.com/usebruno/bruno/tree/4eb7e585f0fb/tests) | MIT | 84 | B | ✓ | 486 | 1579 | 3376 |
| [handsontable/handsontable](https://github.com/handsontable/handsontable/tree/3af7620923d9/tests/e2e) | NOASSERTION | 83 | B | ✓ | 158 | 1492 | 251 |
| [RocketChat/Rocket.Chat](https://github.com/RocketChat/Rocket.Chat/tree/eaba8ddd60fe/apps/meteor/tests/e2e) | NOASSERTION | 83 | B | ✓ | 176 | 1050 | 800 |
| [hashicorp/consul](https://github.com/hashicorp/consul/tree/409cd2a8be20/ui/packages/consul-ui/e2e-tests/tests) | NOASSERTION | 82 | B | ✓ | 18 | 82 | 101 |
| [novuhq/novu](https://github.com/novuhq/novu/tree/eda627cdee8c/apps/dashboard/tests) | NOASSERTION | 82 | B | ✓ | 2 | 2 | 3 |
| [appsmithorg/appsmith](https://github.com/appsmithorg/appsmith/tree/bb851c2939cb/app/client/playwright/tests) | Apache-2.0 | 80 | B | ✓ | 6 | 15 | 9 |
| [elastic/elastic-charts](https://github.com/elastic/elastic-charts/tree/bbe41a2aebfb/e2e/tests) | NOASSERTION | 80 | B | ✓ | 29 | 385 | 28 |
| [KittyCAD/modeling-app](https://github.com/KittyCAD/modeling-app/tree/d2f7712388ef/e2e/playwright) | MIT | 79 | C | ✗ FAIL | 50 | 309 | 771 |
| [payloadcms/payload](https://github.com/payloadcms/payload/tree/346bd5087d12/test/admin/e2e) | MIT | 79 | C | ✗ FAIL | 8 | 272 | 658 |
| [eclipse-theia/theia](https://github.com/eclipse-theia/theia/tree/b0f9e63a6d33/examples/playwright/src/tests) | EPL-2.0 | 78 | C | ✗ FAIL | 16 | 97 | 44 |
| [immich-app/immich](https://github.com/immich-app/immich/tree/e66f2c7615ba/e2e/src/specs) | AGPL-3.0 | 78 | C | ✗ FAIL | 13 | 43 | 42 |
| [invoiceninja/invoiceninja](https://github.com/invoiceninja/invoiceninja/tree/f1ffa5f9989a/tests/e2e) | NOASSERTION | 78 | C | ✗ FAIL | 37 | 335 | 693 |
| [tanstack/table](https://github.com/tanstack/table/tree/21d713fc4947/examples) | MIT | 78 | C | ✗ FAIL | 398 | 1278 | 4496 |
| [pradosoft/prado](https://github.com/pradosoft/prado/tree/8edd985ebdc2/tests/playwright) | NOASSERTION | 77 | C | ✗ FAIL | 214 | 319 | 280 |
| [apache/zeppelin](https://github.com/apache/zeppelin/tree/bd1ecc6dc442/zeppelin-web-angular/e2e) | Apache-2.0 | 76 | C | ✗ FAIL | 53 | 284 | 345 |
| [cloudflare/vinext](https://github.com/cloudflare/vinext/tree/182f1d910f58/tests/e2e/pages-router) | MIT | 76 | C | ✗ FAIL | 31 | 144 | 505 |
| [mermaid-js/mermaid](https://github.com/mermaid-js/mermaid/tree/69778e6e995c/e2e) | MIT | 76 | C | ✗ FAIL | 75 | 456 | 316 |
| [microsoft/vscode](https://github.com/microsoft/vscode/tree/bcd8645be0d5/test/componentFixtures/playwright) | MIT | 76 | C | ✗ FAIL | 7 | 18 | 55 |
| [withastro/astro](https://github.com/withastro/astro/tree/2b8b2e80169d/packages/astro/e2e) | NOASSERTION | 75 | C | ✗ FAIL | 50 | 311 | 998 |
| [BuilderIO/builder](https://github.com/BuilderIO/builder/tree/51cd0521bbf1/packages/sdks-tests/src/e2e-tests) | MIT | 72 | C | ✗ FAIL | 52 | 198 | 440 |
| [ionic-team/ionic-framework](https://github.com/ionic-team/ionic-framework/tree/61f0ddaf62cf/core) | MIT | 72 | C | ✗ FAIL | 505 | 2962 | 5534 |
| [openplayerjs/openplayerjs](https://github.com/openplayerjs/openplayerjs/tree/ee1673106237/e2e) | MIT | 72 | C | ✗ FAIL | 8 | 77 | 47 |
| [tagspaces/tagspaces](https://github.com/tagspaces/tagspaces/tree/23b09c522062/tests/e2e) | AGPL-3.0 | 72 | C | ✗ FAIL | 37 | 307 | 228 |
| [tldraw/tldraw](https://github.com/tldraw/tldraw/tree/d5a92f075dcb/apps/examples/e2e) | NOASSERTION | 72 | C | ✗ FAIL | 35 | 213 | 518 |
| [toeverything/AFFiNE](https://github.com/toeverything/AFFiNE/tree/ca0ffc52f781/tests/blocksuite/e2e) | NOASSERTION | 72 | C | ✗ FAIL | 99 | 1013 | 2024 |
| [calcom/cal.com](https://github.com/calcom/cal.com/tree/54343aa685ae/apps/web/playwright) | MIT | 71 | C | ✗ FAIL | 53 | 253 | 1308 |
| [apache/superset](https://github.com/apache/superset/tree/8141d666d6de/superset-frontend/playwright/tests) | Apache-2.0 | 70 | C | ✗ FAIL | 32 | 69 | 255 |
| [live-codes/livecodes](https://github.com/live-codes/livecodes/tree/747054828256/e2e) | MIT | 70 | C | ✗ FAIL | 14 | 246 | 180 |
| [wekan/wekan](https://github.com/wekan/wekan/tree/ecd853dc1da0/tests/playwright/specs) | MIT | 70 | C | ✗ FAIL | 106 | 440 | 1770 |
| [gitkraken/vscode-gitlens](https://github.com/gitkraken/vscode-gitlens/tree/d1690c6802bf/tests/e2e/specs) | NOASSERTION | 69 | D | ✗ FAIL | 26 | 238 | 416 |
| [QwikDev/qwik](https://github.com/QwikDev/qwik/tree/a17603ea0c8c/e2e) | MIT | 69 | D | ✗ FAIL | 69 | 449 | 1664 |
| [EnixCoda/Gitako](https://github.com/EnixCoda/Gitako/tree/f64526d45347/e2e) | MIT | 66 | D | ✗ FAIL | 36 | 53 | 103 |
| [openreplay/openreplay](https://github.com/openreplay/openreplay/tree/354828a17fd2/frontend/tests/playwright) | NOASSERTION | 66 | D | ✗ FAIL | 5 | 5 | 31 |
| [Flagsmith/flagsmith](https://github.com/Flagsmith/flagsmith/tree/cd1c5db2dbea/frontend/e2e/tests) | BSD-3-Clause | 62 | D | ✗ FAIL | 20 | 27 | 80 |
| [activepieces/activepieces](https://github.com/activepieces/activepieces/tree/17e2ac0b0179/packages/tests-e2e) | NOASSERTION | 58 | F | ✗ FAIL | 5 | 5 | 30 |
| [argos-ci/argos](https://github.com/argos-ci/argos/tree/bf589c1c579a/tests) | MIT | 57 | F | ✗ FAIL | 21 | 9 | 464 |
| [th3cyb3rhub/TheCyberHub](https://github.com/th3cyb3rhub/TheCyberHub/tree/1cf418654f16/e2e) | NOASSERTION | 56 | F | ✗ FAIL | 11 | 138 | 431 |
| [getsentry/spotlight](https://github.com/getsentry/spotlight/tree/3dd5eb5b315f/packages/spotlight/tests) | NOASSERTION | 33 | F | ✗ FAIL | 6 | 47 | 197 |

Repo names link straight to the exact commit/source scanned on GitHub —
re-run `scripts/validate-corpus.sh` for the full findings list of any
entry (it always scores the live default branch, so numbers drift
slightly over time; that's expected), or
`playwright-score <path> --format markdown` against your own clone.

**53 pass / 31 fail / 84 total (63%).** 6,978 files, 37,303 tests, 45,769
findings. Score distribution: mean 83.0, median 85, range 33–98; grades
31 A / 22 B / 22 C / 5 D / 4 F. The 34 new repos alone: **19 pass / 15
fail (56%)**, mean 81.9, median 82 — lower than the original 50's pass
rate, as expected from a batch found mostly by mechanical search
(`gh search code`, `gh api orgs/*/repos`) rather than hand-picking names
already known to be well-tested. Model v3 was already deliberately
stricter than the density models it replaced (see METHODOLOGY.md); v4
tightens it further by scoring the four QAG-196 gameability rules and the
`eslint-disable-comment` finding directly under `standard` (owner
direction — see CHANGELOG.md's 2.0.0 entry), instead of report-only under
`standard` as a never-published 1.1.0 had planned.

**Against the last actually-published version (1.0.0, model v3, no QAG-196
rules at all), original 50 only**: 20/50 repos move. Net **+22** across
the corpus, but that's almost entirely one repo — Flagsmith moves from a
hard-failed 0 (its 20-spec suite wasn't discovered at all before the
`.pw.ts` fix) to a real 62/D, +62 on its own. Excluding Flagsmith, the
other 19 movers are **net −40** (mean −2.1/repo) — real, quality-driven
drops, not noise. Biggest: tldraw −9, AFFiNE −5, activepieces −5,
microsoft/vscode −4, Studio-Saelix/sencho −2, cal.com −2, then a tail of
thirteen −1s. **Three pass→fail flips at the default threshold (80)**:
`payloadcms/payload` (80→79), `microsoft/vscode` (81→77), and
`tldraw/tldraw` (81→72, also the corpus's biggest single mover — see the
canvas-app note below). Pass rate moved from 37/50 (74%) to 34/50 (68%)
at that time; today's re-run of the same 50 reproduces 34/50 exactly,
confirming the score is stable across a ~2-day gap on unrelated repos.

### Selection notes for the 34 new repos

Same method as the 17→50 pass (`gh api repos/<owner>/<repo>/git/trees/
HEAD?recursive=1`, filtered for `playwright\.config\.(ts|js|mjs|cts|mts)$`,
then the config's `testDir` resolved by hand and spot-checked against a
real `@playwright/test` import), extended with `gh search code
"filename:playwright.config.ts"` and `gh api orgs/<org>/repos` sweeps
across ~30 large organisations (Apache, HashiCorp, Cloudflare, Elastic,
SAP, Atlassian, Red Hat, Shopify, LinkedIn, Netflix, PayPal, eBay,
GoogleChromeLabs, and more) to avoid a corpus built only from repos this
project's authors already knew about. Roughly 900 owner/repo names were
checked; the ~865 that didn't qualify mostly had no Playwright config at
all (Directus, NocoDB, Excalidraw, Ghost, Logseq, Budibase and dozens of
other plausible-sounding candidates use Cypress, Vitest, or nothing).
Two real problems turned up during scoring itself, not discovery, and are
documented here rather than silently worked around:

- **`ionic-team/ionic-framework` (`core`, 72/C)**: the scorer's directory
  glob doesn't parse the target's own `playwright.config.ts`
  (`testMatch: '*.e2e.ts'`), so it also swept up 60 co-located Stencil
  unit-test files (`*.spec.ts`, `import { newSpecPage } from
  '@stencil/core/testing'`, run under Jest, not Playwright) alongside the
  419 real `*.e2e.ts` files — both live in the same `test/` directories
  per component. ~12.5% of what's scored here isn't a Playwright test.
  Kept in the corpus (it's still 87% real, and a large, reputable
  component framework is a useful corpus entry) but the number should be
  read with that caveat.
- **`remix-run/remix` (`packages/ui`) was found and excluded, not
  published.** See the honest note above — it has a `playwright.config.ts`
  but its test files use a different, custom test framework entirely.
  Recorded here so a future pass doesn't re-add it on the strength of the
  config file alone.

### Most common findings (sample: 16 of the 34 new repos, detailed JSON)

Re-ran the 16 lowest-scoring new repos with `--format json` to see what's
actually driving the C/D/F grades (the corpus script itself only prints a
findings *count* per repo, not the rule breakdown). Rule frequency across
those 16: `playwright/no-raw-locators` 8,452 (dominated by
`ionic-team/ionic-framework`'s per-component shadow-DOM queries and
`tanstack/table`'s example apps), `playwright/no-standalone-expect` 2,416,
`playwright/no-conditional-expect` 791, `playwright/no-conditional-in-test`
693, `playwright/prefer-locator` 602, `playwright/no-wait-for-timeout`
369, `pwscore/no-coordinate-click` 333, `playwright/prefer-web-first-
assertions` 331. Consistent with the original 50: raw/native locators and
standalone/conditional expects are still the most common real issues in
public suites generally, not corpus-specific noise.

### Candidate scorer false positives found this pass (not fixed in this pass)

- **`pwscore/no-coordinate-click`'s canvas-app exception (see below) has a
  second confirmed example**: `KittyCAD/modeling-app` (a browser-based CAD
  tool) accounts for 130 of this pass's 333 hits, on top of tldraw/AFFiNE
  already documented from the original 50.

**Known false-positive class, mitigated but not eliminated**:
`no-coordinate-click` flags `page.mouse.click/dblclick/move/down/up(x, y)`
unconditionally. That's the right call for a typical DOM app (a
fixed-pixel interaction is always brittle there) but it is the *correct
and only* way to interact with canvas-based apps — tldraw, AFFiNE, and
now KittyCAD's modeling-app (three infinite-canvas/CAD editors) account
for the large majority of this rule's hits across the corpus, and in each
case the coordinate interaction is testing real canvas content with no
addressable DOM element, not gaming the score. As of 2.0.0 this rule is a
**warning** (0.4 demerit), not an error (1.0), specifically to soften
this case — see METHODOLOGY.md's "Why v4" for why a severity change was
chosen over a canvas-detection heuristic. It still costs real points for
a canvas-heavy suite (this is exactly what flips tldraw from pass to fail
above), and there's no per-repo override: **this project no longer
recommends `// eslint-disable-next-line pwscore/no-coordinate-click` as a
workaround** — see "Known limitations" below for why, and use a
per-test-file exemption in your own CI config if you maintain a
canvas/whiteboard/drawing-tool suite and need one.

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
- **`remix-run/remix`'s `packages/ui`** has a `playwright.config.ts` but
  none of its matched test files actually import `@playwright/test` (a
  different, custom test framework) — caught during discovery and the
  repo simply wasn't added to the corpus rather than published with a
  misleading score. Config-scoped discovery (see "Bugs found this way,
  and fixed" below) would now also filter a case like this out on its own
  via the transitive-`@playwright/test`-import safety net, but this repo
  was excluded by hand before that existed.

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
