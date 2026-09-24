#!/usr/bin/env bash
# Re-runnable real-world validation corpus. Shallow/sparse-clones each
# public repo below fresh, scores its actual Playwright suite with the
# locally built CLI, and prints a results table — the same thing manual
# validation this project has relied on all along, just reproducible by
# anyone instead of living in a throwaway /tmp directory. See VALIDATION.md
# for the frozen results and the story behind each entry.
#
# Usage: bash scripts/validate-corpus.sh [profile] [threshold]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$ROOT/bin/playwright-score.js"

if [[ ! -f "$CLI" ]]; then
  (cd "$ROOT" && npm run build)
fi

PROFILE="${1:-standard}"
THRESHOLD="${2:-80}"

# label|repo|sparse-checkout path (also the path scored). Chosen to be
# well-known, respected projects with a real, populated Playwright suite —
# not cherry-picked for a good score. See VALIDATION.md.
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
  # QAG-196 corpus expansion (2026-09-23): 50 -> ~100. Same selection rule
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
  "Apache Superset|apache/superset|superset-frontend/playwright/tests"
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
)

echo "=== playwright-score real-world validation corpus · profile=$PROFILE threshold=$THRESHOLD ==="
echo ""

PASS=0
FAIL=0
TOTAL=0
declare -a ROWS

for entry in "${CORPUS[@]}"; do
  IFS='|' read -r LABEL REPO SUBPATH <<<"$entry"
  TOTAL=$((TOTAL + 1))
  WORKDIR=$(mktemp -d)

  # Anonymous git clones against a public host are occasionally flaky
  # (transient network/DNS hiccups, brief rate-limiting) independent of
  # anything this tool does — retry a couple of times before giving up,
  # and show the real error on final failure instead of swallowing it.
  CLONE_OK=0
  for attempt in 1 2 3; do
    if git clone --filter=blob:none --sparse --depth 1 -q "https://github.com/$REPO.git" "$WORKDIR/repo" 2>"$WORKDIR/clone-err.log"; then
      CLONE_OK=1
      break
    fi
    rm -rf "$WORKDIR/repo"
    sleep 2
  done
  if [[ "$CLONE_OK" -ne 1 ]]; then
    echo "  SKIP  clone failed after 3 attempts  $LABEL ($REPO)"
    sed 's/^/         /' "$WORKDIR/clone-err.log"
    rm -rf "$WORKDIR"
    continue
  fi
  (cd "$WORKDIR/repo" && git sparse-checkout set "$SUBPATH" >/dev/null 2>&1)

  OUT=$(node "$CLI" "$WORKDIR/repo/$SUBPATH" --profile "$PROFILE" --threshold "$THRESHOLD" --format json 2>/dev/null || true)
  SCORE=$(echo "$OUT" | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{try{const j=JSON.parse(s);console.log(j.score+'|'+j.grade+'|'+(j.pass?'PASS':'FAIL')+'|'+j.summary.files+'|'+j.summary.tests+'|'+j.summary.findings)}catch{console.log('?|?|ERR|0|0|0')}})")
  IFS='|' read -r SC GR PS FILES TESTS FC <<<"$SCORE"
  ROWS+=("$SC|$GR|$PS|$FILES|$TESTS|$FC|$LABEL")
  if [[ "$PS" == "PASS" ]]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi
  echo "  $PS  score=$SC ($GR) files=$FILES tests=$TESTS findings=$FC  $LABEL"

  rm -rf "$WORKDIR"
done

echo ""
echo "=== Summary: $PASS pass / $FAIL fail / $TOTAL total (threshold $THRESHOLD) ==="
echo "score,grade,result,files,tests,findings,repo"
for r in "${ROWS[@]}"; do echo "$r"; done
