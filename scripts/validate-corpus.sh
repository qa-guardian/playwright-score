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
