#!/usr/bin/env bash
# Consumer compatibility check: does a TypeScript project that depends on this package still build and
# pass its own tests when the packed tarball of this checkout replaces the version it locks?
#
# Usage: scripts/runner-compat.sh <consumer project dir> <out dir>
# Env:   NODE_IMAGE   container image (default node:22)
#        TEST_GLOB    the consumer's compiled tests, run one file at a time with node
#                     (default dist/app/**/__tests__/*.test.js)
#        DOCKER_WRAP  optional command prefix for the docker run (for example a lock wrapper)
#        SIBLINGS     optional space-separated dirs the consumer's tests look for next to it; each is
#                     mounted read-only and copied beside the consumer's copy (without node_modules, .git)
#        BROWSERS     optional Playwright browsers to install before the tests (for example chromium)
#
# This checkout must be built (dist/) with its bundled dependencies installed (node_modules/).
# The consumer is mounted read-only and copied inside the container (without node_modules, dist and .git),
# so it is never written to; its `git status --porcelain` is recorded before and after and must not change.
# Inside one container: `npm pack` of this checkout; `npm ci` in the consumer; then twice, first with
# the locked version (baseline) and then with the tarball installed over it (packed): `npm run build`,
# `npx tsc --noEmit` and every test file. Results: <out dir>/results.tsv (phase, step, exit code) and
# one log per step. Exit 0 only when every packed step passes and the consumer's status is unchanged.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONSUMER="$(cd "${1:?consumer project dir}" && pwd)"
OUT="${2:?out dir}"
mkdir -p "$OUT"; OUT="$(cd "$OUT" && pwd)"
[ -d "$ROOT/dist" ] && [ -d "$ROOT/node_modules" ] || { echo "build this checkout first (dist/ and node_modules/)" >&2; exit 2; }

status_of() { git -C "$CONSUMER" status --porcelain 2>/dev/null | (md5sum 2>/dev/null || md5) | cut -d' ' -f1; }
BEFORE=$(status_of)
echo "$BEFORE" > "$OUT/consumer-status.before"

${DOCKER_WRAP:-} docker run --rm -i \
  -v "$ROOT:/pkg:ro" -v "$CONSUMER:/consumer:ro" -v "$OUT:/out" \
  $(for d in ${SIBLINGS:-}; do d="$(cd "$d" && pwd)"; printf -- '-v %s:/sib/%s:ro ' "$d" "$(basename "$d")"; done) \
  -e TEST_GLOB="${TEST_GLOB:-dist/app/**/__tests__/*.test.js}" -e BROWSERS="${BROWSERS:-}" \
  "${NODE_IMAGE:-node:22}" bash -s <<'INNER'
set -u
shopt -s globstar nullglob
R=/out/results.tsv; : > "$R"
cd /tmp
TGZ=$(cd /pkg && npm pack --silent --pack-destination /out 2>/out/pack.log | tail -1)
echo -e "pack\tnpm pack\t$([ -n "$TGZ" ] && [ -f "/out/$TGZ" ] && echo 0 || echo 1)" >> "$R"
echo "$TGZ" > /out/tarball.txt
mkdir -p /tmp/ws/c && (cd /consumer && tar --exclude=./node_modules --exclude=./dist --exclude=./.git -cf - .) | tar -C /tmp/ws/c -xf -
for d in /sib/*; do mkdir -p "/tmp/ws/${d##*/}" && (cd "$d" && tar --exclude=./node_modules --exclude=./.git --exclude=./.venv -cf - .) | tar -C "/tmp/ws/${d##*/}" -xf -; done
cd /tmp/ws/c
npm ci --no-audit --no-fund > /out/npm-ci.log 2>&1; echo -e "setup\tnpm ci\t$?" >> "$R"
if [ -n "$BROWSERS" ]; then npx playwright install --with-deps $BROWSERS > /out/browsers.log 2>&1; echo -e "setup\tplaywright install $BROWSERS\t$?" >> "$R"; fi
phase() {
  local p=$1
  rm -rf dist
  npm run build > "/out/$p-build.log" 2>&1; echo -e "$p\tbuild\t$?" >> "$R"
  npx tsc --noEmit > "/out/$p-tsc.log" 2>&1; echo -e "$p\ttsc --noEmit\t$?" >> "$R"
  mkdir -p "/out/$p-tests"
  for f in $TEST_GLOB; do
    timeout 600 node "$f" > "/out/$p-tests/$(echo "$f" | tr / _).log" 2>&1
    echo -e "$p\t$f\t$?" >> "$R"
  done
  node -p "require('./node_modules/@qaguardian/playwright-score/package.json').version" > "/out/$p-version.txt" 2>&1
}
phase baseline
npm install --no-save --no-audit --no-fund "/out/$TGZ" > /out/install-tarball.log 2>&1; echo -e "setup\tinstall tarball\t$?" >> "$R"
phase packed
INNER
DOCKER_RC=$?

AFTER=$(status_of)
echo "$AFTER" > "$OUT/consumer-status.after"
R="$OUT/results.tsv"
FAILED=$(awk -F'\t' '($1=="packed" || $1=="setup" || $1=="pack") && $3!="0"' "$R" 2>/dev/null | wc -l | tr -d ' ')
BASE_FAILED=$(awk -F'\t' '$1=="baseline" && $3!="0"' "$R" 2>/dev/null | wc -l | tr -d ' ')
PACKED=$(awk -F'\t' '$1=="packed"' "$R" 2>/dev/null | wc -l | tr -d ' ')
echo "docker $DOCKER_RC; packed steps $PACKED, failed $FAILED; baseline failed $BASE_FAILED; consumer status $([ "$BEFORE" = "$AFTER" ] && echo unchanged || echo CHANGED)"
[ "$DOCKER_RC" -eq 0 ] && [ "$PACKED" -gt 0 ] && [ "$FAILED" -eq 0 ] && [ "$BEFORE" = "$AFTER" ]
