#!/usr/bin/env bash
# Dogfood playwright-score against real Guardian sample specs.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$ROOT/bin/playwright-score.js"
GUARDIAN="$(cd "$ROOT/.." && pwd)"

if [[ ! -f "$CLI" ]]; then
  (cd "$ROOT" && npm run build)
fi

PROFILE="${1:-guardian}"
THRESHOLD="${2:-75}"

echo "=== playwright-score dogfood profile=$PROFILE threshold=$THRESHOLD ==="

# Collect up to 15 real specs from deployment samples
mapfile -t SPECS < <(find "$GUARDIAN/deployment/Other/playwright" -name '*.spec.ts' \
  -not -path '*/node_modules/*' 2>/dev/null | head -15)

if [[ ${#SPECS[@]} -eq 0 ]]; then
  echo "No sample specs found under deployment/Other/playwright"
  exit 1
fi

PASS=0
FAIL=0
TOTAL=0
declare -a ROWS

for f in "${SPECS[@]}"; do
  TOTAL=$((TOTAL + 1))
  OUT=$(node "$CLI" "$f" --profile "$PROFILE" --threshold "$THRESHOLD" --format json 2>/dev/null || true)
  SCORE=$(echo "$OUT" | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{try{const j=JSON.parse(s);console.log(j.score+'|'+j.grade+'|'+(j.pass?'PASS':'FAIL')+'|'+j.summary.findings)}catch{console.log('?|?|ERR|0')}})")
  IFS='|' read -r SC GR PS FC <<<"$SCORE"
  BASE=$(basename "$f")
  ROWS+=("$SC|$GR|$PS|$FC|$BASE")
  if [[ "$PS" == "PASS" ]]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi
  echo "  $PS  score=$SC ($GR) findings=$FC  $BASE"
done

echo ""
echo "=== Summary: $PASS pass / $FAIL fail / $TOTAL total (threshold $THRESHOLD) ==="
echo "score,grade,result,findings,file"
for r in "${ROWS[@]}"; do echo "$r"; done
