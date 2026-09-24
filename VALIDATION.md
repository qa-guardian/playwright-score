# Real-world validation

`playwright-score` is validated against real, public Playwright suites —
not just its own fixtures — on an ongoing basis. This file documents the
methodology and the current results; `scripts/validate-corpus.sh`
re-produces them from scratch against each repo's live `main`/`master`.

Every bug this project has found and fixed was found this way: point the
tool at real code, read the findings by hand, and treat anything
suspicious as a bug in the scorer until proven otherwise.

**Tested on 2026-09-24** — 2.1.0, scoring model v4, 100-repo corpus. See
"## Results" below for the full table and "## Backup corpus candidates"
for repos vetted but not (yet) in the 100.

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

## Results (last run: 2026-09-24, 2.1.0, scoring model v4, `standard` profile, threshold 80)

Grown from 84 to exactly 100 repos (third pass) — 16 new
entries chosen for brand recognition (Nextcloud, Ghost, Pinterest,
Microsoft, The Guardian, Shopify ×2, Adobe, Automattic, BBC, Google,
Datadog, Twilio) plus three named competitors (Checkly, Currents,
LambdaTest), flagged as such in the table below and scored under the
exact same rules as everyone else — no separate bar for them. Selected by
hand for brand recognition rather than a mechanical repo search — see
"Selection notes for the 16 newest repos" below for the full method and
the candidates considered and rejected. All
100 scores below are from one fresh run against each repo's live default
branch on 2026-09-24 (bounded 4-way concurrency, `scripts/
validate-corpus.sh`'s `MAX_PARALLEL`); every entry's exact commit SHA and
the date it was scored are recorded in the table's "Tested" column, so a
future re-run can tell real upstream drift apart from a scoring-model
change.

**Honest note on the previous pass's target vs. what shipped** (kept for
history): the 50→84 pass aimed for ~50 new repos (100 total) and shipped
34, not 50 — see git history for the full accounting. This pass closed
that gap: 16 more, landing on exactly 100.

| Repo (source scanned) | Licence | Score | Grade | Pass | Files | Tests | Findings | Tested |
|---|---|---:|:-:|:-:|---:|---:|---:|---|
| [pinterest/gestalt](https://github.com/pinterest/gestalt/tree/22874a7522d1/playwright/accessibility) | Apache-2.0 | 100 | A | ✓ | 173 | 173 | 1 | [2026-09-24](https://github.com/pinterest/gestalt/commit/22874a7522d1803df992fae2bcb31ef42be29519) |
| [TryGhost/Ghost](https://github.com/TryGhost/Ghost/tree/9d7248b56d53/e2e/tests) | MIT | 99 | A | ✓ | 99 | 343 | 5 | [2026-09-24](https://github.com/TryGhost/Ghost/commit/9d7248b56d536d7e1c7b79bb8d46619371e3c720) |
| [hashicorp/vault](https://github.com/hashicorp/vault/tree/f03da019aba5/ui/e2e) | NOASSERTION | 98 | A | ✓ | 32 | 51 | 140 | [2026-09-24](https://github.com/hashicorp/vault/commit/f03da019aba55c963e8f90d3c79d093d9b0432cb) |
| [microsoft/playwright](https://github.com/microsoft/playwright/tree/7563c5a67eab/examples/todomvc) | Apache-2.0 | 98 | A | ✓ | 24 | 24 | 4 | [2026-09-24](https://github.com/microsoft/playwright/commit/7563c5a67eab93b550dd3fafe01a67754bae3c9a) |
| [plausible/analytics](https://github.com/plausible/analytics/tree/8f3970104aa7/e2e) | AGPL-3.0 | 98 | A | ✓ | 12 | 71 | 64 | [2026-09-24](https://github.com/plausible/analytics/commit/8f3970104aa77aedf2395868028e337169616267) |
| [segmentio/analytics-next](https://github.com/segmentio/analytics-next/tree/2d6d55301804/packages/browser-integration-tests/src) | MIT | 98 | A | ✓ | 4 | 7 | 1 | [2026-09-24](https://github.com/segmentio/analytics-next/commit/2d6d5530180489c45675fe9537a42745df9a847e) |
| [cloudflare/templates](https://github.com/cloudflare/templates/tree/a0bb6ef9a990/playwright-tests) | MIT | 97 | A | ✓ | 41 | 63 | 26 | [2026-09-24](https://github.com/cloudflare/templates/commit/a0bb6ef9a990a5ec4afecab50edf56c69676b031) |
| [glpi-project/glpi](https://github.com/glpi-project/glpi/tree/9e8a9570a90b/tests/e2e/specs) | GPL-3.0 | 97 | A | ✓ | 106 | 391 | 214 | [2026-09-24](https://github.com/glpi-project/glpi/commit/9e8a9570a90bf98ab0dba4dbc7d71e283b4de0d7) |
| [shopify/hydrogen](https://github.com/shopify/hydrogen/tree/3ef7ec23096a/e2e/specs) | MIT | 97 | A | ✓ | 34 | 201 | 28 | [2026-09-24](https://github.com/shopify/hydrogen/commit/3ef7ec23096ad29e701073b35a892f0938a0acf4) |
| [dubinc/dub](https://github.com/dubinc/dub/tree/feab62272a63/apps/web/playwright) | NOASSERTION | 96 | A | ✓ | 34 | 365 | 46 | [2026-09-24](https://github.com/dubinc/dub/commit/feab62272a63be9e5bd1ce6adf24e981b1cb2cdc) |
| [keycloak/keycloak](https://github.com/keycloak/keycloak/tree/f4d8e3363585/js/apps/admin-ui/test) | Apache-2.0 | 96 | A | ✓ | 72 | 452 | 103 | [2026-09-24](https://github.com/keycloak/keycloak/commit/f4d8e3363585db5052d69453ebfe75f35e15d4e0) |
| [mozilla/fxa](https://github.com/mozilla/fxa/tree/7e0a5009953d/packages/functional-tests/tests) | MPL-2.0 | 96 | A | ✓ | 111 | 429 | 99 | [2026-09-24](https://github.com/mozilla/fxa/commit/7e0a5009953d9a6339e828f9415815f6e6a78c36) |
| [penpot/penpot](https://github.com/penpot/penpot/tree/aeeca59b1afc/frontend/playwright) | MPL-2.0 | 96 | A | ✓ | 64 | 506 | 238 | [2026-09-24](https://github.com/penpot/penpot/commit/aeeca59b1afc08ecea079572b99b10f795f343ce) |
| [temporalio/ui](https://github.com/temporalio/ui/tree/ffee0375c167/tests) | MIT | 96 | A | ✓ | 52 | 236 | 201 | [2026-09-24](https://github.com/temporalio/ui/commit/ffee0375c167ae61ad9acedc19f104c85ceef59d) |
| [xmlui-org/xmlui](https://github.com/xmlui-org/xmlui/tree/d9e00d2e208b/xmlui) | MIT | 96 | A | ✓ | 406 | 6880 | 2397 | [2026-09-24](https://github.com/xmlui-org/xmlui/commit/d9e00d2e208bb57f1f6390afddfb3a6cadef8882) |
| [SigNoz/signoz](https://github.com/SigNoz/signoz/tree/8e2da68fc6c5/tests/e2e) | NOASSERTION | 95 | A | ✓ | 51 | 312 | 161 | [2026-09-24](https://github.com/SigNoz/signoz/commit/8e2da68fc6c5355b9eee23a7c28edccae889fc93) |
| [argos-ci/argos](https://github.com/argos-ci/argos/tree/bf589c1c579a/tests) | MIT | 95 | A | ✓ | 21 | 89 | 74 | [2026-09-24](https://github.com/argos-ci/argos/commit/bf589c1c579ada9d627ed9f29be37f8c88605739) |
| [baloise/design-system](https://github.com/baloise/design-system/tree/e3ec4adc5191/packages/core) | Apache-2.0 | 95 | A | ✓ | 15 | 192 | 62 | [2026-09-24](https://github.com/baloise/design-system/commit/e3ec4adc5191d3b45845db9e4bbabf6bf8b6fbf0) |
| [nextcloud/server](https://github.com/nextcloud/server/tree/4057ae1e0159/tests/playwright/e2e) | AGPL-3.0 | 95 | A | ✓ | 101 | 395 | 92 | [2026-09-24](https://github.com/nextcloud/server/commit/4057ae1e01594242ab9803f08e2bc3ba3944afe1) |
| [storybookjs/storybook](https://github.com/storybookjs/storybook/tree/c6aac840245a/code/e2e-internal) | MIT | 95 | A | ✓ | 7 | 26 | 13 | [2026-09-24](https://github.com/storybookjs/storybook/commit/c6aac840245a0ea63fa97f5b7a522655291c59af) |
| [Automattic/jetpack](https://github.com/Automattic/jetpack/tree/9730de752479/projects/plugins/jetpack/tests/e2e/specs) | NOASSERTION | 94 | A | ✓ | 10 | 16 | 23 | [2026-09-24](https://github.com/Automattic/jetpack/commit/9730de75247972057b328e743c652bcca4c514df) |
| [LambdaTest/playwright-sample *(competitor)*](https://github.com/LambdaTest/playwright-sample/tree/21296e92c8b9/playwright-test-ts/tests) | NOASSERTION | 94 | A | ✓ | 4 | 33 | 27 | [2026-09-24](https://github.com/LambdaTest/playwright-sample/commit/21296e92c8b971c7e15117085fa825a7cbd29723) |
| [carbon-design-system/carbon](https://github.com/carbon-design-system/carbon/tree/a686f4de8884/e2e) | Apache-2.0 | 94 | A | ✓ | 95 | 423 | 199 | [2026-09-24](https://github.com/carbon-design-system/carbon/commit/a686f4de888484ddc646ed1f81a9d04058818b0e) |
| [freeCodeCamp/freeCodeCamp](https://github.com/freeCodeCamp/freeCodeCamp/tree/b0ed81fb24d2/e2e) | BSD-3-Clause | 94 | A | ✓ | 83 | 282 | 188 | [2026-09-24](https://github.com/freeCodeCamp/freeCodeCamp/commit/b0ed81fb24d25a1b2ba9452cd7e8de789e382e67) |
| [strapi/strapi](https://github.com/strapi/strapi/tree/8d6fe6030438/tests/e2e) | NOASSERTION | 94 | A | ✓ | 100 | 280 | 204 | [2026-09-24](https://github.com/strapi/strapi/commit/8d6fe60304385812b13188ac97a9ab0ef1abf70a) |
| [WordPress/gutenberg](https://github.com/WordPress/gutenberg/tree/72e0cc4f894d/test/e2e) | NOASSERTION | 93 | A | ✓ | 341 | 1922 | 1777 | [2026-09-24](https://github.com/WordPress/gutenberg/commit/72e0cc4f894dde390838f64e588cc25b294c0fa3) |
| [apache/apisix-dashboard](https://github.com/apache/apisix-dashboard/tree/fa2fd0f60f8a/e2e/tests) | Apache-2.0 | 93 | A | ✓ | 125 | 208 | 172 | [2026-09-24](https://github.com/apache/apisix-dashboard/commit/fa2fd0f60f8afffb096476333b9ba63b4c518fa3) |
| [documenso/documenso](https://github.com/documenso/documenso/tree/39ae85483ae0/packages/app-tests) | AGPL-3.0 | 93 | A | ✓ | 135 | 1183 | 741 | [2026-09-24](https://github.com/documenso/documenso/commit/39ae85483ae0941b7b273bc0270d9687ff42f8fb) |
| [godotlauncher/launcher](https://github.com/godotlauncher/launcher/tree/f77f86aaa65d/e2e) | MIT | 93 | A | ✓ | 17 | 113 | 133 | [2026-09-24](https://github.com/godotlauncher/launcher/commit/f77f86aaa65ded67beea25cfc2e04a9bf57d3a49) |
| [google/site-kit-wp](https://github.com/google/site-kit-wp/tree/661a1bbcd4ce/tests/playwright/specs) | Apache-2.0 | 93 | A | ✓ | 8 | 36 | 8 | [2026-09-24](https://github.com/google/site-kit-wp/commit/661a1bbcd4ce44a8d35fb37c9fa58073cfee2a66) |
| [n8n-io/n8n](https://github.com/n8n-io/n8n/tree/f63195656a0f/packages/testing/playwright) | NOASSERTION | 93 | A | ✓ | 279 | 1044 | 117 | [2026-09-24](https://github.com/n8n-io/n8n/commit/f63195656a0fa75da187b755990f5fd725762f85) |
| [radix-ui/primitives](https://github.com/radix-ui/primitives/tree/f7ecd5ab16f5/e2e) | MIT | 93 | A | ✓ | 11 | 105 | 52 | [2026-09-24](https://github.com/radix-ui/primitives/commit/f7ecd5ab16f5e1e820eb5786a1419a98a2d594ae) |
| [sanity-io/sanity](https://github.com/sanity-io/sanity/tree/f5a99eb64c3b/e2e) | MIT | 93 | A | ✓ | 65 | 171 | 247 | [2026-09-24](https://github.com/sanity-io/sanity/commit/f5a99eb64c3b751b6a654071451d49cf7bb41897) |
| [supabase/supabase](https://github.com/supabase/supabase/tree/21df8d02e62a/e2e) | Apache-2.0 | 92 | A | ✓ | 33 | 264 | 222 | [2026-09-24](https://github.com/supabase/supabase/commit/21df8d02e62a3cc3f0b4eeebeecec3241be2ff48) |
| [umami-software/umami](https://github.com/umami-software/umami/tree/ec0ff50388c2/tests/e2e) | MIT | 92 | A | ✓ | 8 | 38 | 33 | [2026-09-24](https://github.com/umami-software/umami/commit/ec0ff50388c264ed8ce46f00967e92f7e71476ae) |
| [coder/coder](https://github.com/coder/coder/tree/d7b6528d7e4f/site/e2e) | AGPL-3.0 | 91 | A | ✓ | 41 | 96 | 59 | [2026-09-24](https://github.com/coder/coder/commit/d7b6528d7e4feb8db82bd62aedbd13c527cd94c8) |
| [primer/react](https://github.com/primer/react/tree/f2c075a5d4d0/e2e) | MIT | 91 | A | ✓ | 79 | 195 | 82 | [2026-09-24](https://github.com/primer/react/commit/f2c075a5d4d0b51a279c39effa18226ad909929d) |
| [vendure-ecommerce/vendure](https://github.com/vendure-ecommerce/vendure/tree/cccf0a72ec1b/packages/dashboard/e2e) | NOASSERTION | 91 | A | ✓ | 44 | 212 | 365 | [2026-09-24](https://github.com/vendure-ecommerce/vendure/commit/cccf0a72ec1b88a4e00ea3cffad4d30b35aaf7e7) |
| [cupcakearmy/cryptgeon](https://github.com/cupcakearmy/cryptgeon/tree/cc2c45221bbd/test) | MIT | 89 | B | ✓ | 11 | 24 | 8 | [2026-09-24](https://github.com/cupcakearmy/cryptgeon/commit/cc2c45221bbd92d17f7692e2b36c50e306d6a4da) |
| [element-hq/element-web](https://github.com/element-hq/element-web/tree/60b54fc8446a/apps/web/playwright) | AGPL-3.0 | 89 | B | ✓ | 154 | 753 | 1104 | [2026-09-24](https://github.com/element-hq/element-web/commit/60b54fc8446ad1a88963660927cd7e1865905e63) |
| [woocommerce/woocommerce](https://github.com/woocommerce/woocommerce/tree/e889a5b3bf81/plugins/woocommerce/tests/e2e) | NOASSERTION | 89 | B | ✓ | 213 | 846 | 1362 | [2026-09-24](https://github.com/woocommerce/woocommerce/commit/e889a5b3bf819f03f6683c653482dae39863048e) |
| [PostHog/posthog](https://github.com/PostHog/posthog/tree/c98f567e60eb/playwright) | NOASSERTION | 88 | B | ✓ | 43 | 121 | 276 | [2026-09-24](https://github.com/PostHog/posthog/commit/c98f567e60eb88ba183dc7a54b77b100e2ad65ae) |
| [go-gitea/gitea](https://github.com/go-gitea/gitea/tree/05f049e8bb1e/tests/e2e) | MIT | 88 | B | ✓ | 29 | 56 | 128 | [2026-09-24](https://github.com/go-gitea/gitea/commit/05f049e8bb1eabb8f9b2b967062524839f7e36aa) |
| [wireapp/wire-webapp](https://github.com/wireapp/wire-webapp/tree/4b361a4ddda8/apps/webapp/test/e2e_tests) | GPL-3.0 | 88 | B | ✓ | 38 | 132 | 82 | [2026-09-24](https://github.com/wireapp/wire-webapp/commit/4b361a4ddda83efdf8dca15864c309a0c3e32e3e) |
| [clerk/javascript](https://github.com/clerk/javascript/tree/e9bea99a9b4e/integration/tests) | MIT | 87 | B | ✓ | 130 | 577 | 483 | [2026-09-24](https://github.com/clerk/javascript/commit/e9bea99a9b4e833f8f9913c62c4d2cf47d1b5b0a) |
| [grafana/grafana](https://github.com/grafana/grafana/tree/06216b89712a/e2e-playwright) | AGPL-3.0 | 87 | B | ✓ | 213 | 680 | 954 | [2026-09-24](https://github.com/grafana/grafana/commit/06216b89712ad099f5277bc99b81e4646037844e) |
| [nuxt/nuxt](https://github.com/nuxt/nuxt/tree/25b87bebe589/test/e2e) | MIT | 87 | B | ✓ | 23 | 171 | 240 | [2026-09-24](https://github.com/nuxt/nuxt/commit/25b87bebe589497c29f3392f40ea0b220db2ba37) |
| [shopify/cli](https://github.com/shopify/cli/tree/175ccbdcc4d1/packages/e2e/tests) | MIT | 87 | B | ✓ | 11 | 26 | 28 | [2026-09-24](https://github.com/shopify/cli/commit/175ccbdcc4d1b44efd15e32915e6212789340b18) |
| [checkly/checkly-cli *(competitor)*](https://github.com/checkly/checkly-cli/tree/2a36513d6226/examples/advanced-project/src) | Apache-2.0 | 86 | B | ✓ | 4 | 6 | 7 | [2026-09-24](https://github.com/checkly/checkly-cli/commit/2a36513d6226dd606017ec91709e48e5a5c33088) |
| [mtlynch/whatgotdone](https://github.com/mtlynch/whatgotdone/tree/ef10be2a9f8a/e2e) | Apache-2.0 | 86 | B | ✓ | 12 | 24 | 60 | [2026-09-24](https://github.com/mtlynch/whatgotdone/commit/ef10be2a9f8a57c35f67d299a4c0ef374e768e04) |
| [zotero/web-library](https://github.com/zotero/web-library/tree/d0f2ea882023/test/playwright) | NOASSERTION | 86 | B | ✓ | 17 | 104 | 154 | [2026-09-24](https://github.com/zotero/web-library/commit/d0f2ea88202359ce6fa77f16ac97b2345a828dbd) |
| [Studio-Saelix/sencho](https://github.com/Studio-Saelix/sencho/tree/698d3f34bc25/e2e) | AGPL-3.0 | 85 | B | ✓ | 34 | 200 | 363 | [2026-09-24](https://github.com/Studio-Saelix/sencho/commit/698d3f34bc251c9b2613dcf8f86fc40bd2750714) |
| [formbricks/formbricks](https://github.com/formbricks/formbricks/tree/b066f19c1e7c/apps/web/playwright) | NOASSERTION | 85 | B | ✓ | 48 | 132 | 437 | [2026-09-24](https://github.com/formbricks/formbricks/commit/b066f19c1e7ca26b85fd5206e621acef8c2f0a41) |
| [Automattic/wp-calypso](https://github.com/Automattic/wp-calypso/tree/1cf7275fa542/test/e2e) | GPL-2.0 | 84 | B | ✓ | 122 | 187 | 202 | [2026-09-24](https://github.com/Automattic/wp-calypso/commit/1cf7275fa542b799d7a4baf41765791e869e70c1) |
| [saleor/saleor-dashboard](https://github.com/saleor/saleor-dashboard/tree/693c7459326d/e2e-legacy) | BSD-3-Clause | 84 | B | ✓ | 39 | 158 | 67 | [2026-09-24](https://github.com/saleor/saleor-dashboard/commit/693c7459326d66105d127ec1bc578bc53abddec9) |
| [twentyhq/twenty](https://github.com/twentyhq/twenty/tree/0023d3d382fc/packages/twenty-e2e-testing/tests) | NOASSERTION | 84 | B | ✓ | 6 | 8 | 24 | [2026-09-24](https://github.com/twentyhq/twenty/commit/0023d3d382fcca0704b50d88cdd254139518a0f1) |
| [usebruno/bruno](https://github.com/usebruno/bruno/tree/057cf3057941/tests) | MIT | 84 | B | ✓ | 488 | 1583 | 3374 | [2026-09-24](https://github.com/usebruno/bruno/commit/057cf30579415d3020e034fdd983779d1890e726) |
| [RocketChat/Rocket.Chat](https://github.com/RocketChat/Rocket.Chat/tree/6df9543243cc/apps/meteor/tests/e2e) | NOASSERTION | 83 | B | ✓ | 176 | 1050 | 800 | [2026-09-24](https://github.com/RocketChat/Rocket.Chat/commit/6df9543243ccfb656c7e5f5cfa786896fa9c20b0) |
| [handsontable/handsontable](https://github.com/handsontable/handsontable/tree/6a98a8b0b5fd/tests/e2e) | NOASSERTION | 83 | B | ✓ | 159 | 1526 | 252 | [2026-09-24](https://github.com/handsontable/handsontable/commit/6a98a8b0b5fddcc6dd53594713305f2412f80b7a) |
| [adobe/spectrum-web-components](https://github.com/adobe/spectrum-web-components/tree/ac4890e36399/gen2/packages/swc/components) | Apache-2.0 | 82 | B | ✓ | 26 | 185 | 94 | [2026-09-24](https://github.com/adobe/spectrum-web-components/commit/ac4890e36399c44af96feb8c7fe47fb4ae426b64) |
| [hashicorp/consul](https://github.com/hashicorp/consul/tree/85cae40655a5/ui/packages/consul-ui/e2e-tests/tests) | NOASSERTION | 82 | B | ✓ | 15 | 82 | 101 | [2026-09-24](https://github.com/hashicorp/consul/commit/85cae40655a5ac7c4c0bbdcd4433535efc4654de) |
| [novuhq/novu](https://github.com/novuhq/novu/tree/eb07ee45d6aa/apps/dashboard/tests) | NOASSERTION | 82 | B | ✓ | 2 | 2 | 3 | [2026-09-24](https://github.com/novuhq/novu/commit/eb07ee45d6aa80056c50c6f1da86625474ffd25d) |
| [appsmithorg/appsmith](https://github.com/appsmithorg/appsmith/tree/8ac0b3b7c50b/app/client/playwright/tests) | Apache-2.0 | 80 | B | ✓ | 6 | 15 | 9 | [2026-09-24](https://github.com/appsmithorg/appsmith/commit/8ac0b3b7c50b689f8f03a45f1d2184c7006c2f7f) |
| [elastic/elastic-charts](https://github.com/elastic/elastic-charts/tree/baed578ee0ef/e2e/tests) | NOASSERTION | 80 | B | ✓ | 29 | 385 | 28 | [2026-09-24](https://github.com/elastic/elastic-charts/commit/baed578ee0efe9771adc46176a391fb7e01ba3ea) |
| [microsoft/fluentui](https://github.com/microsoft/fluentui/tree/d27922755beb/packages/web-components/src) | NOASSERTION | 80 | B | ✓ | 43 | 737 | 367 | [2026-09-24](https://github.com/microsoft/fluentui/commit/d27922755bebae866d9ffe86b7da44c27ec801ee) |
| [KittyCAD/modeling-app](https://github.com/KittyCAD/modeling-app/tree/eeab22daa262/e2e/playwright) | MIT | 79 | C | ✗ FAIL | 50 | 309 | 771 | [2026-09-24](https://github.com/KittyCAD/modeling-app/commit/eeab22daa262e81629ca16ab7e029b2262b3a327) |
| [mattermost/mattermost](https://github.com/mattermost/mattermost/tree/4cd9cbfc6c38/e2e-tests/playwright) | NOASSERTION | 79 | C | ✗ FAIL | 116 | 467 | 1423 | [2026-09-24](https://github.com/mattermost/mattermost/commit/4cd9cbfc6c3852c5cdc5b0a4c8e938533afbcd76) |
| [payloadcms/payload](https://github.com/payloadcms/payload/tree/7605e01961a6/test/admin/e2e) | MIT | 79 | C | ✗ FAIL | 8 | 272 | 658 | [2026-09-24](https://github.com/payloadcms/payload/commit/7605e01961a69d9f4993c31102eeec1d08c7142a) |
| [eclipse-theia/theia](https://github.com/eclipse-theia/theia/tree/d8106d7ffa62/examples/playwright/src/tests) | EPL-2.0 | 78 | C | ✗ FAIL | 16 | 97 | 44 | [2026-09-24](https://github.com/eclipse-theia/theia/commit/d8106d7ffa62b3413ff1ca5b63a0e6c2fe0b0649) |
| [immich-app/immich](https://github.com/immich-app/immich/tree/e598e1089668/e2e/src/specs) | AGPL-3.0 | 78 | C | ✗ FAIL | 13 | 43 | 42 | [2026-09-24](https://github.com/immich-app/immich/commit/e598e108966814fe8f70f81cd2a47c66dd5e7c71) |
| [invoiceninja/invoiceninja](https://github.com/invoiceninja/invoiceninja/tree/f1ffa5f9989a/tests/e2e) | NOASSERTION | 78 | C | ✗ FAIL | 37 | 335 | 693 | [2026-09-24](https://github.com/invoiceninja/invoiceninja/commit/f1ffa5f9989afbed4e7dc80b5c0cc18944335ffc) |
| [tanstack/table](https://github.com/tanstack/table/tree/21d713fc4947/examples) | MIT | 78 | C | ✗ FAIL | 398 | 1278 | 4496 | [2026-09-24](https://github.com/tanstack/table/commit/21d713fc4947d2a08cc2136bb055889a61412ded) |
| [apache/superset](https://github.com/apache/superset/tree/9ad6917600dd/superset-frontend/playwright/tests) | Apache-2.0 | 77 | C | ✗ FAIL | 32 | 100 | 134 | [2026-09-24](https://github.com/apache/superset/commit/9ad6917600ddcc67c260eebb808d6960f698657a) |
| [apache/zeppelin](https://github.com/apache/zeppelin/tree/3219ccc8eddd/zeppelin-web-angular/e2e) | Apache-2.0 | 77 | C | ✗ FAIL | 54 | 286 | 345 | [2026-09-24](https://github.com/apache/zeppelin/commit/3219ccc8eddd84396a1c2ae249b9c19439cc17a5) |
| [guardian/dotcom-rendering](https://github.com/guardian/dotcom-rendering/tree/0f68208eb0a4/dotcom-rendering/playwright/tests) | Apache-2.0 | 77 | C | ✗ FAIL | 16 | 76 | 153 | [2026-09-24](https://github.com/guardian/dotcom-rendering/commit/0f68208eb0a41085d3e089904d4e3db9e3280595) |
| [pradosoft/prado](https://github.com/pradosoft/prado/tree/8edd985ebdc2/tests/playwright) | NOASSERTION | 77 | C | ✗ FAIL | 214 | 319 | 280 | [2026-09-24](https://github.com/pradosoft/prado/commit/8edd985ebdc2270a5ebc268cf20b86a2aa056d05) |
| [cloudflare/vinext](https://github.com/cloudflare/vinext/tree/57d9efa866e5/tests/e2e/pages-router) | MIT | 76 | C | ✗ FAIL | 31 | 144 | 505 | [2026-09-24](https://github.com/cloudflare/vinext/commit/57d9efa866e53ccf51574eb26ca911477b46d36b) |
| [mermaid-js/mermaid](https://github.com/mermaid-js/mermaid/tree/69778e6e995c/e2e) | MIT | 76 | C | ✗ FAIL | 75 | 456 | 316 | [2026-09-24](https://github.com/mermaid-js/mermaid/commit/69778e6e995cd72c6cb524449d8e08ee3d231628) |
| [microsoft/vscode](https://github.com/microsoft/vscode/tree/ceeb50ecd802/test/componentFixtures/playwright) | MIT | 76 | C | ✗ FAIL | 7 | 18 | 55 | [2026-09-24](https://github.com/microsoft/vscode/commit/ceeb50ecd8021211707307a9d44cf85120b68c02) |
| [withastro/astro](https://github.com/withastro/astro/tree/c17d9209bef3/packages/astro/e2e) | NOASSERTION | 75 | C | ✗ FAIL | 50 | 311 | 998 | [2026-09-24](https://github.com/withastro/astro/commit/c17d9209bef385ea88b6fee36e91ad4e635f4a86) |
| [bbc/simorgh](https://github.com/bbc/simorgh/tree/53be43c9d5e5/ws-nextjs-app/playwright) | NOASSERTION | 74 | C | ✗ FAIL | 10 | 116 | 171 | [2026-09-24](https://github.com/bbc/simorgh/commit/53be43c9d5e584407b17bb3b7682d1b095bfada7) |
| [BuilderIO/builder](https://github.com/BuilderIO/builder/tree/2587fea5dd08/packages/sdks-tests/src/e2e-tests) | MIT | 72 | C | ✗ FAIL | 52 | 199 | 444 | [2026-09-24](https://github.com/BuilderIO/builder/commit/2587fea5dd0800858ae9eee7021a65466d688387) |
| [ionic-team/ionic-framework](https://github.com/ionic-team/ionic-framework/tree/fac9344012a9/core) | MIT | 72 | C | ✗ FAIL | 505 | 2962 | 5534 | [2026-09-24](https://github.com/ionic-team/ionic-framework/commit/fac9344012a9f777ca916bd49bba7d9548fa6762) |
| [openplayerjs/openplayerjs](https://github.com/openplayerjs/openplayerjs/tree/ee1673106237/e2e) | MIT | 72 | C | ✗ FAIL | 8 | 77 | 47 | [2026-09-24](https://github.com/openplayerjs/openplayerjs/commit/ee167310623712d479fec076afe22c86e9806244) |
| [tagspaces/tagspaces](https://github.com/tagspaces/tagspaces/tree/23b09c522062/tests/e2e) | AGPL-3.0 | 72 | C | ✗ FAIL | 37 | 307 | 228 | [2026-09-24](https://github.com/tagspaces/tagspaces/commit/23b09c522062c3dbafbcb75c273037a8b9bfd7da) |
| [tldraw/tldraw](https://github.com/tldraw/tldraw/tree/e8e194c3a55a/apps/examples/e2e) | NOASSERTION | 72 | C | ✗ FAIL | 35 | 213 | 518 | [2026-09-24](https://github.com/tldraw/tldraw/commit/e8e194c3a55af60d1f6da86ce842de38784d07e1) |
| [toeverything/AFFiNE](https://github.com/toeverything/AFFiNE/tree/ca0ffc52f781/tests/blocksuite/e2e) | NOASSERTION | 72 | C | ✗ FAIL | 99 | 1013 | 2024 | [2026-09-24](https://github.com/toeverything/AFFiNE/commit/ca0ffc52f78187382928c90293cd487618f5f024) |
| [calcom/cal.com](https://github.com/calcom/cal.com/tree/54343aa685ae/apps/web/playwright) | MIT | 71 | C | ✗ FAIL | 53 | 253 | 1308 | [2026-09-24](https://github.com/calcom/cal.com/commit/54343aa685ae8f33159d2f485ec4a57bad5c574a) |
| [live-codes/livecodes](https://github.com/live-codes/livecodes/tree/747054828256/e2e) | MIT | 70 | C | ✗ FAIL | 14 | 246 | 180 | [2026-09-24](https://github.com/live-codes/livecodes/commit/74705482825630e97fd9ba07210a14540b2aad4d) |
| [wekan/wekan](https://github.com/wekan/wekan/tree/fa7d2584dfa6/tests/playwright/specs) | MIT | 70 | C | ✗ FAIL | 106 | 441 | 1770 | [2026-09-24](https://github.com/wekan/wekan/commit/fa7d2584dfa64e91035426724eaa0d5b4f01a849) |
| [QwikDev/qwik](https://github.com/QwikDev/qwik/tree/fa8b7dfa92a9/e2e) | MIT | 69 | D | ✗ FAIL | 69 | 449 | 1664 | [2026-09-24](https://github.com/QwikDev/qwik/commit/fa8b7dfa92a910539bd94a05086d63b1e19415d5) |
| [currents-dev/currents-examples *(competitor)*](https://github.com/currents-dev/currents-examples/tree/572181203381/playwright/pnpm/tests) | NOASSERTION | 69 | D | ✗ FAIL | 8 | 12 | 33 | [2026-09-24](https://github.com/currents-dev/currents-examples/commit/57218120338119bffbea248214e224e832c2dfaa) |
| [gitkraken/vscode-gitlens](https://github.com/gitkraken/vscode-gitlens/tree/3638bca0b257/tests/e2e/specs) | NOASSERTION | 69 | D | ✗ FAIL | 26 | 238 | 416 | [2026-09-24](https://github.com/gitkraken/vscode-gitlens/commit/3638bca0b257935cdbf3808d6ae3162aa4d8c264) |
| [EnixCoda/Gitako](https://github.com/EnixCoda/Gitako/tree/f64526d45347/e2e) | MIT | 66 | D | ✗ FAIL | 36 | 53 | 103 | [2026-09-24](https://github.com/EnixCoda/Gitako/commit/f64526d45347670cf057e4580069279e989f7cec) |
| [openreplay/openreplay](https://github.com/openreplay/openreplay/tree/354828a17fd2/frontend/tests/playwright) | NOASSERTION | 66 | D | ✗ FAIL | 5 | 5 | 31 | [2026-09-24](https://github.com/openreplay/openreplay/commit/354828a17fd2fc90fcfb4965a43aa79100638d1f) |
| [Flagsmith/flagsmith](https://github.com/Flagsmith/flagsmith/tree/ea5ad826e85b/frontend/e2e/tests) | BSD-3-Clause | 62 | D | ✗ FAIL | 20 | 27 | 80 | [2026-09-24](https://github.com/Flagsmith/flagsmith/commit/ea5ad826e85b240947ff6eeea7630650812bb1fe) |
| [activepieces/activepieces](https://github.com/activepieces/activepieces/tree/9e493a87f471/packages/tests-e2e) | NOASSERTION | 58 | F | ✗ FAIL | 5 | 5 | 30 | [2026-09-24](https://github.com/activepieces/activepieces/commit/9e493a87f471d38b40bafaaf82bbc57b266f6eda) |
| [th3cyb3rhub/TheCyberHub](https://github.com/th3cyb3rhub/TheCyberHub/tree/1cf418654f16/e2e) | NOASSERTION | 56 | F | ✗ FAIL | 11 | 138 | 431 | [2026-09-24](https://github.com/th3cyb3rhub/TheCyberHub/commit/1cf418654f16050e9687e9127d6161f46d055cfe) |
| [DataDog/documentation](https://github.com/DataDog/documentation/tree/6cd10f40cf46/hugo/e2e) | NOASSERTION | 50 | F | ✗ FAIL | 31 | 150 | 188 | [2026-09-24](https://github.com/DataDog/documentation/commit/6cd10f40cf46600bc694554d85140f18ff05aab7) |
| [getsentry/spotlight](https://github.com/getsentry/spotlight/tree/3dd5eb5b315f/packages/spotlight/tests) | NOASSERTION | 33 | F | ✗ FAIL | 6 | 47 | 197 | [2026-09-24](https://github.com/getsentry/spotlight/commit/3dd5eb5b315f29374e9872547c00370ced8066bd) |

Repo names link straight to the exact commit/source scanned on GitHub —
re-run `scripts/validate-corpus.sh` for the full findings list of any
entry (it always scores the live default branch, so numbers drift
slightly over time; that's expected), or
`playwright-score <path> --format markdown` against your own clone.

**65 pass / 35 fail / 100 total (65%).** 7,281 files, 39,059 tests, 45,935
findings. Score distribution: mean 83.7, median 86, range 33–100; grades
38 A / 27 B / 25 C / 6 D / 4 F. The 16 newest repos alone: **12 pass / 4
fail (75%)**, mean 85.9, median 90 — a higher pass rate than the corpus
as a whole, consistent with picking recognizable, well-resourced brands
rather than a mechanical search; the four fails (guardian/dotcom-rendering
77/C, bbc/simorgh 74/C, currents-dev/currents-examples 69/D — a
competitor's own thin example suite, and DataDog/documentation 50/F) were
each read by hand (see "Most common findings" below) and are real
raw-locator/conditional-logic findings, not scorer artifacts. Model v3
was already deliberately stricter than the density models it replaced
(see METHODOLOGY.md); v4 tightens it further by scoring the four
gameability rules and the `eslint-disable-comment` finding directly under
`standard` (owner direction — see CHANGELOG.md's 2.0.0 entry), instead of
report-only under `standard` as a never-published 1.1.0 had planned.

**53/84 passing at 2.0.0 → 65/100 at 2.1.0** (pass rate 63% → 65%, on a
larger corpus). **Against 2.0.0 (last published), the 84 repos both
passes share**: 10/84
move, 74 unchanged. Two real, visible before/after wins from 2.1.0's two
false-positive fixes (see CHANGELOG.md's 2.1.0 entry): `argos-ci/argos`
**57/F → 95/A (+38)** — its entire suite calls its `test.extend()`
fixture `loggedTest(...)`, which upstream `eslint-plugin-playwright`
can't follow across files; `apache/superset` **70/C → 77/C (+7)** — same
false-positive shape (`testWithAssets(...)`), smaller move because most
of its suite's other findings are real. Seven other repos moved for
reasons *unrelated* to either fix — real upstream changes to those
suites between 2026-09-23 and 2026-09-24 (`twentyhq/twenty` 91→84,
`wireapp/wire-webapp` 91→88, plus five 1-point drifts: `n8n-io/n8n`,
`primer/react`, `strapi/strapi` down 1, `apache/zeppelin`,
`PostHog/posthog` up 1). One repo moved for a *different* 2.1.0 reason —
narrower, more accurate discovery, not a false-positive fix:
`mattermost/mattermost` **84/B → 79/C (−5, a pass→fail flip)**: its
`e2e-tests/playwright` directory holds both `specs/` (the suite its
top-level `playwright.config.ts` actually declares as `testDir`) and
`upgrade-specs/` (real Playwright tests too, but run only under
per-project `testDir` overrides this package's parser doesn't read — see
"Known limitations"). Pre-2.1.0 filename-suffix discovery swept both in
(355 files); config-scoped discovery now correctly limits to the 116
files the top-level config actually owns, and that smaller, more
representative sample scores lower on its own merits (467 tests vs. the
old 1,219, 1,423 findings vs. 2,003) — an accuracy improvement that
happens to cost points, the same category as the `ionic-team/
ionic-framework` contamination noted below, not a regression.

**Against the last actually-published version (1.0.0, model v3, none of
these rules at all), original 50 only**: 20/50 repos move. Net **+22** across
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

### Selection notes for the 16 newest repos (2026-09-24)

Different method from the two mechanical-search passes above: hand-picked
for brand recognition rather than found by sweeping — `gh api
repos/<owner>/<repo>` for public/archived/last-push status, `gh api
.../git/trees/<branch>?recursive=1` (or `gh search code` where rate
limits allowed) to locate `playwright.config.*` and enumerate spec files,
then 1–2 spec files per repo spot-read to confirm a genuine
`@playwright/test` import (directly, or via a local fixture wrapper that
itself imports it — several existing corpus entries already use this
pattern). 19 candidates were vetted this way; 16 were added, and 3 were
vetted but left out (redundant brand coverage or a thinner suite than an
already-shortlisted alternative, not a scorer or discovery problem).
Others considered but not vetted this pass at all — a broader initial
name sweep (Vercel/Next.js, Sentry, Home Assistant, Atlassian, GitLab,
Elastic/Kibana, QA Wolf, Meticulous, Octomind, Reflect, Wix, Netlify,
NYTimes, eBay, and more) — turned out on inspection to have no
`playwright.config.*` at all, or one whose matched files import a
different test framework (the same failure mode documented for
`remix-run/remix` under "Known limitations" below). Two entries needed a
narrower scored subpath than their repo's obvious top-level test
directory, because that directory mixes in a much larger *non*-Playwright
test population:

- **`adobe/spectrum-web-components`** — `gen2/packages/swc/components`
  holds both real a11y specs (`*.a11y.spec.ts`, `@playwright/test`) and
  Storybook interaction tests (`*.test.ts`, `@storybook/test`). The
  repo's own `gen2/packages/swc/playwright.config.js` already restricts
  `testMatch` to the 26 real ones — 2.1.0's config-scoped discovery reads
  that directly (scored 26/28 files, exactly matching the config), so no
  manual glob was needed, just a sparse-checkout one level wider than
  scored so the config file itself is present on disk (see
  `scripts/validate-corpus.sh`'s 4th CORPUS field).
- **`bbc/simorgh`** — `ws-nextjs-app/` also holds `ws-nextjs-app/
  integration/` (123 Jest `*.test.ts` unit tests); the scored subpath
  (`ws-nextjs-app/playwright`) excludes it by directory alone, no
  config-scoping needed.

### Most common findings among the 16 newest (detailed JSON, all 16)

Rule frequency across all 16 (not just the lowest scorers, since the
group is small enough to check in full, per-repo counts confirmed via
`--format json`): `playwright/no-raw-locators` dominates as usual, 824 of
1,226 total findings — Microsoft Fluent UI's per-component shadow-DOM
queries alone account for 293 (36% of the rule's hits on its own), then
guardian/dotcom-rendering 108, bbc/simorgh 106, DataDog/documentation 99,
and adobe/spectrum-web-components 88; the other 11 repos combined
contribute the remaining 130. Next most common:
`playwright/no-conditional-in-test` (91), `playwright/
prefer-native-locators` (39), `playwright/no-wait-for-selector` (38),
`playwright/no-force-option` (35) — the same handful of rule *families*
(raw/native locators, conditional logic) that dominate the other 84, not
a brand/competitor-specific pattern.

### New suspected false positives found among the 16 (not fixed)

None found with real confidence. The four lowest scorers
(`DataDog/documentation` 50/F, `currents-dev/currents-examples` 69/D,
`bbc/simorgh` 74/C, `guardian/dotcom-rendering` 77/C) were each re-run
with `--format json` and hand-read rule-by-rule: every one is dominated
by `no-raw-locators`/conditional-logic/`prefer-locator` findings on
genuinely non-idiomatic locator code, not a scorer artifact — Currents'
low score in particular is a small (8-file), thin example/onboarding
suite from a testing-infra vendor, not a flagship product, so a lower
score there is plausible on its face rather than suspicious. One
adjacent, *not-a-corpus-false-positive* finding did turn up and is
recorded under "Against 2.0.0" above and "Known limitations" below
instead: `mattermost/mattermost` (one of the *existing* 84, not the 16)
lost real points when 2.1.0's discovery correctly stopped scoring
`upgrade-specs/`, a second, real Playwright suite the top-level config
doesn't own.

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
- **The four gameability rules match specific known patterns, not the
  general class they're each named for.** See CHANGELOG.md's 2.0.0 entry for
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
- **Config-scoped discovery (2.1.0) only reads the top-level `testDir`/
  `testMatch`/`testIgnore`, not per-project overrides.** Playwright lets
  a config declare multiple `projects`, each with its own `testDir` —
  real, standard usage (`mattermost/mattermost`'s `upgrade-specs/`
  projects, scored via `testDir: 'upgrade-specs'`/`'upgrade-specs/from'`/
  `'upgrade-specs/to'`, entirely separate from the top-level `testDir:
  'specs'`). Those per-project files are real, correctly-written
  Playwright specs, but this package silently excludes them once a
  top-level config is found and applied, rather than including them or
  warning that they exist — see "Against 2.0.0" above for the concrete
  effect (mattermost's file count 355→116, tests 1,219→467, a pass→fail
  flip: the `upgrade-specs/` files this excludes scored comparatively
  cleaner than `specs/` on its own, so losing them lowers the result). A
  future version could read `projects[].testDir` too; not attempted this
  pass
  (project-level config resolution is a materially bigger static-analysis
  surface than the single top-level object this release's parser
  handles).

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
- **`.pw.ts` naming convention not discovered at all** (2026-09-21) — Flagsmith's entire 20-spec `frontend/e2e` suite
  (`billing-test.pw.ts`, `flag-tests.pw.ts`, ...) hard-failed with "no
  files matched", the same failure mode `.e2e.ts`/`.e2e-spec.ts` were
  fixed for above. Fixed by adding `pw` to the spec-suffix glob.
- **Four gameable patterns had zero cost** (2026-09-21,
  motivated by an internal finding that a spec built entirely from these
  four tricks scored 93/A): sleeping via
  `new Promise((resolve) => setTimeout(resolve, ms))` instead of
  `page.waitForTimeout` (same anti-pattern, undetectable by name),
  `page.mouse.click(x, y)` coordinate clicks, asserting on a literal
  constant (`expect(true).toBe(true)`), and a test whose only assertions
  are `expect.soft(...)`. Fixed by four new rules — see CHANGELOG.md's
  2.0.0 entry for exactly what each one catches and the corpus
  before/after.
- **A `test.extend()` fixture bound to a custom name was invisible to
  every rule that keys off the literal identifier `test`** (2026-09-23/24) — `argos-ci/argos`'s `loggedTest(...)` and
  `apache/superset`'s `testWithAssets(...)` each got every `expect()`
  inside a completely normal, well-formed test flagged as
  `no-standalone-expect`/`no-conditional-expect`/"outside a test block",
  and undercounted by this package's own test-span/`countTests` logic
  too. Upstream `eslint-plugin-playwright` already dereferences a
  *same-file* extend chain; it can't follow one across files (a fixture
  declared in one module, imported — sometimes through a re-export
  barrel — into every spec file, the common real-world shape). Fixed by
  `src/test-aliases.ts` (a bounded fixed-point resolver over the scored
  files' own import/export graph) feeding `eslint-plugin-playwright`'s
  `globalAliases.test` setting and this package's own AST rules. Corpus
  effect: argos-ci/argos 57/F → 95/A (+38, the corpus's single biggest
  mover to date), apache/superset 70/C → 77/C (+7, smaller because most
  of its other findings are real) — see "Against 2.0.0" above.
- **Spec discovery matched by filename suffix only, never the scanned
  repo's own `playwright.config.*`** (2026-09-23/24) — could
  both over-match (a different test runner's files sharing a directory
  and naming convention, `ionic-team/ionic-framework`'s 60 Stencil/Jest
  files, still an open caveat — see the original 34-repo selection notes
  above) and, once real config-parsing was added, initially under-match
  in three ways found scoring PostHog, Appsmith, and Payload CMS: (1) a
  `testMatch`/`testIgnore` pattern with no leading `**/` only matched
  files directly in `testDir` under a plain glob library, where
  Playwright's own `createFileMatcher` auto-prepends `**/` so the same
  pattern matches at any depth (`payloadcms/payload`'s
  `testMatch: ['*e2e.spec.ts', ...]`, every real spec several
  directories deep, silently matched zero files); (2) globbing from the
  caller's own (possibly narrower) scanned directory instead of the
  config's `testDir` broke a config whose `testDir` is an *ancestor* of
  where the caller pointed (`PostHog/posthog`'s `testDir: ".."`,
  path-anchored `testMatch` patterns that only make sense relative to
  that wider root); (3) the safety net added alongside config-scoped
  discovery (a matched file must transitively import `@playwright/test`,
  to keep an over-broad `testMatch` like a generic `**/*.ts` from
  sweeping in plain source files) treated an unresolvable relative
  import as *negative* evidence by default, which broke a real spec
  importing its fixtures from a sibling directory of `testDir` rather
  than a descendant (`appsmithorg/appsmith`'s specs import `test`/
  `expect` from `../../fixtures`) under a sparse/partial checkout where
  that sibling genuinely isn't on disk. Fixed by (1) matching
  Playwright's own auto-`**/`-prefix behavior, (2) globbing from
  `testDir` and filtering results back down to the caller's requested
  directory, and (3) failing *open* (keeping the file) on an
  unresolvable import instead of treating it as proof the file isn't a
  spec. `src/playwright-config.ts`, `tests/integration.test.ts`.
- **The same transitive-import safety net only recognized ES `import`/
  `export ... from` syntax, not CommonJS `require()`** (2026-09-24,
  found scoring this very pass's 84→100 corpus re-run, after
  the three fixes above had already shipped) — a plain CommonJS suite
  (`wekan/wekan`'s `tests/playwright/`: every spec does `const { test,
  expect } = require('../fixtures')`, `fixtures.js` does `const { test:
  base } = require('@playwright/test')`, no ES `import` anywhere) has
  zero ES import syntax for the safety net to walk, so
  `hasAnyRelativeImport` never became true and its own "nothing left to
  resolve" fallback read as *definitive negative evidence* — the exact
  opposite of the truth. Silently hard-failed two real, previously-scored
  suites to 0 files (wekan/wekan 70/C → 0/F, hashicorp/consul's UI 82/B →
  0/F) the moment config-scoped discovery activated for them. Fixed by
  also scanning top-level `require('x')` calls the same way as ES
  imports; both repos reproduce their pre-regression scores (wekan/wekan
  106 files/441 tests/1,770 findings, exact match; hashicorp/consul 15
  files vs. the old 18 — its own `testMatch` now legitimately narrows it
  further, same tests/findings/score). Caught before this ever shipped
  to a published version, but left in `src/playwright-config.ts` for a
  full day of local development first — a reminder that "config-scoped
  discovery's safety net fails open on missing evidence" needs checking
  against more than one module system, not just the ES-import fixtures
  this release's own test suite happened to use.

## Backup corpus candidates

Vetted (`playwright.config.*` found, spot-read for a genuine
`@playwright/test` import) but not in the 100 above — candidates for a
future growth pass, not scored on the same schedule as the 100:

- **Algolia** (`algolia/instantsearch`, `tests/e2e/playwright/specs`) —
  scored once for reference on 2026-09-24: 80/B, 6 files/15 tests/38
  findings, commit `604c7d318194`. Small (6 specs) but a genuine,
  well-known search-as-a-service brand.
- **BrowserStack** (`browserstack/node-js-playwright-browserstack`,
  `tests`) — checked 2026-09-24: hard-fails discovery (`0/F`, "no files
  matched"). Not a scorer bug — its only two files
  (`bstack_test_demo.js`, `bstack_local_test.js`) use `_test.js`
  (underscore), not `.test.js` (dot), so they genuinely don't match this
  package's `.spec.`/`.test.`/`.e2e.`/`.e2e-spec.`/`.e2e-test.`/`.pw.`
  naming convention — the same class of gap `.pw.ts`/`.e2e.ts` were
  fixed for in earlier releases, just a spelling not yet seen. A
  real user would just pass the two files as explicit paths (explicit
  paths bypass discovery entirely); scoring a directory of 2 adjacent
  demo files isn't a useful corpus entry regardless.
- **Kibana** (`elastic/kibana`, `@kbn/scout`/`kbn-scout` framework) —
  still pending. A real Playwright-based framework exists, but its
  actual suites are fragmented across dozens of tiny per-plugin
  `playwright.config.ts` files (e.g. `x-pack/platform/plugins/shared/
  fleet/test/scout_fi_agentless/ui`) with no single subpath large or
  representative enough found in the time available across two separate
  passes (2026-09-24). Left pending rather than picking an
  unrepresentative tiny subpath just to check the box.

See `CHANGELOG.md` for the full, dated history.
