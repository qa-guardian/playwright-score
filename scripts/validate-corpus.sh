#!/usr/bin/env bash
# Re-runnable real-world validation corpus. Shallow/sparse-clones each
# public repo below fresh, scores its actual Playwright suite with the
# locally built CLI, and prints a results table — the same thing manual
# validation this project has relied on all along, just reproducible by
# anyone instead of living in a throwaway /tmp directory. See VALIDATION.md
# for the frozen results and the story behind each entry.
#
# Usage: bash scripts/validate-corpus.sh [profile] [threshold]
# Env:   MAX_PARALLEL=4   bounded clone/score concurrency (default 4 — kind
#                          to both this machine and github.com; each entry
#                          is an independent fresh clone, scored, then
#                          deleted, so parallelizing is safe)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$ROOT/bin/playwright-score.js"

if [[ ! -f "$CLI" ]]; then
  (cd "$ROOT" && npm run build)
fi

PROFILE="${1:-standard}"
THRESHOLD="${2:-80}"
MAX_PARALLEL="${MAX_PARALLEL:-4}"

# label|repo|sparse-checkout path scored|optional wider sparse-checkout path.
# The 4th field only exists for the rare entry where the directory actually
# scored needs a sibling/ancestor file present on disk too (e.g. its own
# playwright.config.* one level up, for this package's config-scoped
# discovery to find and apply testMatch) but that wider directory shouldn't
# itself be the scored root. When omitted, the 3rd field is used for both.
# Chosen to be well-known, respected projects with a real, populated
# Playwright suite — not cherry-picked for a good score. See VALIDATION.md.
CORPUS=(
  "Playwright (own TodoMVC example)|microsoft/playwright|examples/todomvc"
  "n8n|n8n-io/n8n|packages/testing/playwright"
  "Supabase|supabase/supabase|e2e"
  "Storybook|storybookjs/storybook|code/e2e-internal"
  "freeCodeCamp|freeCodeCamp/freeCodeCamp|e2e"
  "cal.com|calcom/cal.com|apps/web/playwright"
  "Grafana|grafana/grafana|e2e-playwright"
  "Mattermost|mattermost/mattermost|e2e-tests/playwright"
  "dub|dubinc/dub|apps/web/playwright"
  "Documenso|documenso/documenso|packages/app-tests"
  "PostHog|PostHog/posthog|playwright"
  "novu|novuhq/novu|apps/dashboard/tests"
  "Immich|immich-app/immich|e2e/src/specs"
  # Smaller/less mature projects found via a targeted search (real
  # @playwright/test usage + a known hard-wait smell) — included
  # deliberately so this corpus isn't only well-engineered platforms that
  # were always going to score well. See VALIDATION.md for why each of
  # these scores what it does.
  "openplayerjs|openplayerjs/openplayerjs|e2e"
  "livecodes|live-codes/livecodes|e2e"
  "TheCyberHub|th3cyb3rhub/TheCyberHub|e2e"
  "sencho|Studio-Saelix/sencho|e2e"
  # QAG-196 corpus expansion (2026-09-21): 17 -> 50. Same selection rule
  # as above — real @playwright/test usage, >=5 specs, licence recorded
  # per repo in VALIDATION.md (read-only scoring, nothing here is
  # redistributed). Found via GitHub tree/code search for
  # playwright.config.* and hand-verified: not every "e2e"-named
  # directory found this way turned out to actually be a Playwright
  # suite (some were Cypress, some vitest/jest with a coincidentally
  # similar layout) — those were simply left out of the list below
  # rather than tracked separately, since the corpus is defined by what
  # it includes.
  "Formbricks|formbricks/formbricks|apps/web/playwright"
  "Element (Matrix client)|element-hq/element-web|apps/web/playwright"
  "AFFiNE|toeverything/AFFiNE|tests/blocksuite/e2e"
  "tldraw|tldraw/tldraw|apps/examples/e2e"
  "WordPress Gutenberg|WordPress/gutenberg|test/e2e"
  "WooCommerce|woocommerce/woocommerce|plugins/woocommerce/tests/e2e"
  "Twenty CRM|twentyhq/twenty|packages/twenty-e2e-testing/tests"
  "Penpot|penpot/penpot|frontend/playwright"
  "Strapi|strapi/strapi|tests/e2e"
  "Appsmith|appsmithorg/appsmith|app/client/playwright/tests"
  "Qwik|QwikDev/qwik|e2e"
  "Payload CMS|payloadcms/payload|test/admin/e2e"
  "Rocket.Chat|RocketChat/Rocket.Chat|apps/meteor/tests/e2e"
  "Coder|coder/coder|site/e2e"
  "Umami|umami-software/umami|tests/e2e"
  "Plausible Analytics|plausible/analytics|e2e"
  "WordPress.com Calypso|Automattic/wp-calypso|test/e2e"
  "SigNoz|SigNoz/signoz|tests/e2e"
  # Path renamed upstream from "playwright" to "e2e-legacy" (2026-09-23
  # re-run) when the project started a new, still-nascent "e2e" suite
  # (one spec file so far) alongside its existing, actually-populated one
  # — same 39 specs/158 tests/67 findings/84 score as this corpus always
  # scored under the old path, just relocated. See VALIDATION.md.
  "Saleor Dashboard|saleor/saleor-dashboard|e2e-legacy"
  "Vendure|vendure-ecommerce/vendure|packages/dashboard/e2e"
  "OpenReplay|openreplay/openreplay|frontend/tests/playwright"
  "Handsontable|handsontable/handsontable|tests/e2e"
  "Activepieces|activepieces/activepieces|packages/tests-e2e"
  "Clerk|clerk/javascript|integration/tests"
  "Astro|withastro/astro|packages/astro/e2e"
  "Wire (wire-webapp)|wireapp/wire-webapp|apps/webapp/test/e2e_tests"
  "Keycloak admin-ui|keycloak/keycloak|js/apps/admin-ui/test"
  "Bruno|usebruno/bruno|tests"
  "Flagsmith|Flagsmith/flagsmith|frontend/e2e/tests"
  "Temporal UI|temporalio/ui|tests"
  "Builder.io SDKs|BuilderIO/builder|packages/sdks-tests/src/e2e-tests"
  "Wekan|wekan/wekan|tests/playwright/specs"
  "VS Code (component fixtures)|microsoft/vscode|test/componentFixtures/playwright"
  # Corpus expansion (2026-09-23): 50 -> ~100. Same selection rule
  # as above (real @playwright/test usage, >=10 specs, active in the last
  # 12 months, not a fork/tutorial) plus a deliberate mix: major OSS
  # platforms (Gitea, Nuxt, Superset, Vault/Consul, Sentry), framework/
  # design-system authors (Ionic, Primer, Carbon, Radix, Mermaid), and
  # smaller active projects (Cryptgeon, TagSpaces, Godot Launcher,
  # Zotero web library, the PRADO PHP framework). Found via `gh search
  # code`/`gh api orgs/<org>/repos` + `git/trees` tree search for
  # playwright.config.*, same method as the 17->50 pass, this time run
  # against candidate lists instead of guessed directory names. See
  # VALIDATION.md for why each subpath was chosen over the config's
  # literal testDir in the handful of cases where they differ (compiled
  # output dirs, dynamic testDir expressions, BDD configs excluded).
  "Apache APISIX Dashboard|apache/apisix-dashboard|e2e/tests"
  # Sparse-checked-out one level wider than scored (4th field): its
  # test.extend() fixture (superset-frontend/playwright/helpers/fixtures/
  # testAssets.ts, testWithAssets(...)) is a *sibling* of tests/, not
  # inside it — 2.1.0's cross-file alias detection (test-aliases.ts) needs
  # that file present on disk to follow the import, same reasoning as
  # Adobe's entry above. Found 2026-09-24 re-scoring the 84->100 pass: this
  # repo's score didn't move at all under 2.1.0 with just tests/ sparse-
  # checked-out (the fixtures file, and the argos-ci/argos-style false
  # positive it causes, simply wasn't fetched) — re-confirmed as fixed once
  # this wider path was added.
  "Apache Superset|apache/superset|superset-frontend/playwright/tests|superset-frontend/playwright"
  "Eclipse Theia|eclipse-theia/theia|examples/playwright/src/tests"
  "GLPI|glpi-project/glpi|tests/e2e/specs"
  "HashiCorp Vault UI|hashicorp/vault|ui/e2e"
  "HashiCorp Consul UI|hashicorp/consul|ui/packages/consul-ui/e2e-tests/tests"
  "Mozilla Firefox Accounts|mozilla/fxa|packages/functional-tests/tests"
  "GitLens (GitKraken)|gitkraken/vscode-gitlens|tests/e2e/specs"
  "KittyCAD Modeling App|KittyCAD/modeling-app|e2e/playwright"
  "XMLUI|xmlui-org/xmlui|xmlui"
  "Ionic Framework (core)|ionic-team/ionic-framework|core"
  "IBM Carbon Design System|carbon-design-system/carbon|e2e"
  "GitHub Primer React|primer/react|e2e"
  "Apache Zeppelin (Angular UI)|apache/zeppelin|zeppelin-web-angular/e2e"
  "Gitea|go-gitea/gitea|tests/e2e"
  "Radix UI Primitives|radix-ui/primitives|e2e"
  "Mermaid|mermaid-js/mermaid|e2e"
  "TanStack Table (examples smoke suite)|tanstack/table|examples"
  "Argos (visual testing)|argos-ci/argos|tests"
  "Cryptgeon|cupcakearmy/cryptgeon|test"
  "Gitako|EnixCoda/Gitako|e2e"
  "TagSpaces|tagspaces/tagspaces|tests/e2e"
  "Nuxt|nuxt/nuxt|test/e2e"
  "Sanity Studio|sanity-io/sanity|e2e"
  "Invoice Ninja|invoiceninja/invoiceninja|tests/e2e"
  "Cloudflare Templates|cloudflare/templates|playwright-tests"
  "Cloudflare Vinext|cloudflare/vinext|tests/e2e/pages-router"
  "Elastic Charts|elastic/elastic-charts|e2e/tests"
  "Sentry Spotlight|getsentry/spotlight|packages/spotlight/tests"
  "Baloise Design System|baloise/design-system|packages/core"
  "Godot Launcher|godotlauncher/launcher|e2e"
  "Zotero Web Library|zotero/web-library|test/playwright"
  "PRADO PHP Framework|pradosoft/prado|tests/playwright"
  "What Got Done|mtlynch/whatgotdone|e2e"
  # Corpus expansion (2026-09-24): 84 -> 100. Brand-recognition and
  # competitor pass, found via a repo tree search per candidate, spot-
  # reading 1-2 spec files to confirm a genuine @playwright/test import
  # (direct or via a local fixture wrapper). Two entries share a repo with
  # a much larger *non*-Playwright test population and need the narrower,
  # hand-verified subpath below, not the parent directory:
  #   - Adobe: gen2/packages/swc/components also holds Storybook
  #     interaction tests (*.test.ts, @storybook/test); only *.a11y.spec.ts
  #     (real @playwright/test) should score. Its own
  #     gen2/packages/swc/playwright.config.js already restricts
  #     testMatch to those — sparse-checked-out one level wider than the
  #     scored path so this package's config-scoped discovery (2.1.0) can
  #     find and apply it, rather than hand-filtering here.
  #   - BBC: ws-nextjs-app/ also holds ws-nextjs-app/integration (123 Jest
  #     *.test.ts unit tests) alongside the real suite; the scored subpath
  #     already excludes it by directory, no config-scoping needed.
  # Last four entries are competitors (Playwright orchestration/reporting/
  # cross-browser vendors) — flagged as such in VALIDATION.md, scored the
  # same as everyone else.
  "Nextcloud|nextcloud/server|tests/playwright/e2e"
  "Ghost|TryGhost/Ghost|e2e/tests"
  "Pinterest Gestalt|pinterest/gestalt|playwright/accessibility"
  "Microsoft Fluent UI (web components)|microsoft/fluentui|packages/web-components/src"
  "The Guardian (dotcom-rendering)|guardian/dotcom-rendering|dotcom-rendering/playwright/tests"
  "Shopify Hydrogen|shopify/hydrogen|e2e/specs"
  "Shopify CLI|shopify/cli|packages/e2e/tests"
  "Adobe Spectrum Web Components|adobe/spectrum-web-components|gen2/packages/swc/components|gen2/packages/swc"
  "Automattic Jetpack|Automattic/jetpack|projects/plugins/jetpack/tests/e2e/specs"
  "BBC Simorgh|bbc/simorgh|ws-nextjs-app/playwright"
  "Google Site Kit WP|google/site-kit-wp|tests/playwright/specs"
  "Datadog Documentation|DataDog/documentation|hugo/e2e"
  "Twilio Segment (analytics-next)|segmentio/analytics-next|packages/browser-integration-tests/src"
  "Checkly (checkly-cli examples) [competitor]|checkly/checkly-cli|examples/advanced-project/src"
  "Currents (examples) [competitor]|currents-dev/currents-examples|playwright/pnpm/tests"
  "LambdaTest (playwright-sample) [competitor]|LambdaTest/playwright-sample|playwright-test-ts/tests"
)

echo "=== playwright-score real-world validation corpus · profile=$PROFILE threshold=$THRESHOLD · parallel=$MAX_PARALLEL ==="
echo ""

# One independent clone-score-cleanup per entry, run with bounded
# concurrency via xargs -P. Each invocation writes its single result line
# to its own file (never a shared, append-mode file — concurrent short
# writes are usually safe via O_APPEND but "usually" isn't a validation
# script's standard) so results can't interleave/corrupt, then those files
# are concatenated once every entry has finished.
RESULTS_DIR=$(mktemp -d)
export CLI PROFILE THRESHOLD RESULTS_DIR

score_entry() {
  local entry="$1"
  IFS='|' read -r LABEL REPO SUBPATH SPARSE_SUBPATH <<<"$entry"
  local CLONE_PATH="${SPARSE_SUBPATH:-$SUBPATH}"
  local OUT_FILE; OUT_FILE=$(mktemp "$RESULTS_DIR/result.XXXXXX")
  local WORKDIR; WORKDIR=$(mktemp -d)

  # Anonymous git clones against a public host are occasionally flaky
  # (transient network/DNS hiccups, brief rate-limiting) independent of
  # anything this tool does — retry a couple of times before giving up,
  # and show the real error on final failure instead of swallowing it.
  local CLONE_OK=0
  for attempt in 1 2 3; do
    if git clone --filter=blob:none --sparse --depth 1 -q "https://github.com/$REPO.git" "$WORKDIR/repo" 2>"$WORKDIR/clone-err.log"; then
      CLONE_OK=1
      break
    fi
    rm -rf "$WORKDIR/repo"
    sleep 2
  done
  if [[ "$CLONE_OK" -ne 1 ]]; then
    echo "  SKIP  clone failed after 3 attempts  $LABEL ($REPO)" >&2
    sed 's/^/         /' "$WORKDIR/clone-err.log" >&2
    echo "SKIP||||||||$(date +%Y-%m-%d)|$LABEL|$REPO|$SUBPATH" >"$OUT_FILE"
    rm -rf "$WORKDIR"
    return
  fi
  (cd "$WORKDIR/repo" && git sparse-checkout set "$CLONE_PATH" >/dev/null 2>&1)
  local SHA; SHA=$(git -C "$WORKDIR/repo" rev-parse HEAD)

  local OUT; OUT=$(node "$CLI" "$WORKDIR/repo/$SUBPATH" --profile "$PROFILE" --threshold "$THRESHOLD" --format json 2>/dev/null || true)
  local SCORE; SCORE=$(echo "$OUT" | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{try{const j=JSON.parse(s);console.log(j.score+'|'+j.grade+'|'+(j.pass?'PASS':'FAIL')+'|'+j.summary.files+'|'+j.summary.tests+'|'+j.summary.findings)}catch{console.log('?|?|ERR|0|0|0')}})")
  IFS='|' read -r SC GR PS FILES TESTS FC <<<"$SCORE"
  echo "RESULT|$SC|$GR|$PS|$FILES|$TESTS|$FC|$SHA|$(date +%Y-%m-%d)|$LABEL|$REPO|$SUBPATH" >"$OUT_FILE"
  echo "  $PS  score=$SC ($GR) files=$FILES tests=$TESTS findings=$FC sha=${SHA:0:12}  $LABEL" >&2

  rm -rf "$WORKDIR"
}
export -f score_entry

printf '%s\n' "${CORPUS[@]}" | xargs -P "$MAX_PARALLEL" -I{} bash -c 'score_entry "$@"' _ {}

PASS=0
FAIL=0
TOTAL=0
SKIP=0
declare -a ROWS
for f in "$RESULTS_DIR"/result.*; do
  [[ -e "$f" ]] || continue
  line=$(cat "$f")
  TOTAL=$((TOTAL + 1))
  if [[ "$line" == SKIP* ]]; then
    SKIP=$((SKIP + 1))
    continue
  fi
  IFS='|' read -r _tag SC GR PS FILES TESTS FC SHA DATE LABEL REPO SUBPATH <<<"$line"
  ROWS+=("$SC|$GR|$PS|$FILES|$TESTS|$FC|$SHA|$DATE|$LABEL|$REPO|$SUBPATH")
  if [[ "$PS" == "PASS" ]]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi
done
rm -rf "$RESULTS_DIR"

echo ""
echo "=== Summary: $PASS pass / $FAIL fail / $SKIP skip / $TOTAL total (threshold $THRESHOLD) ==="
echo "score,grade,result,files,tests,findings,sha,date,repo,gh_repo,subpath"
for r in "${ROWS[@]}"; do echo "$r"; done
