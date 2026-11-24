#!/usr/bin/env bash
# Pack determinism: the packed tarball must give byte-identical JSON on Node 20 and Node 22, installed with
# npm and with pnpm, into a project whose own root has a different TypeScript (6.0.x). The scorer must keep
# using its bundled TypeScript (engine.typescript in the JSON).
#
# Usage:
#   scripts/pack-determinism.sh prepare <work dir>
#       npm pack of this checkout (built, with node_modules/), then one fresh container per combination
#       (node:20 and node:22, npm and pnpm, network on for the installs): a project with typescript@~6.0.0
#       at its root installs the tarball. Writes <work dir>/<node>-<pm>/{proj/,node,info.txt}; `node` is
#       the image's own node binary, so a combination can also run where only its directory is mounted.
#   scripts/pack-determinism.sh score <work dir>/<node>-<pm> <out dir> <key>=<repo dir>[:<sub dir>]...
#       Scores each suite (--format json, default flags) in a fresh container of that combination's image,
#       network off, the repo mounted read-only at /suite. Writes <out dir>/<key>.json and .status.
#   scripts/pack-determinism.sh compare <out dir> <reference dir> [typescript version, default 5.9.3]
#       Byte-compares every <out dir>/<key>.json with <reference dir>/<key>.json and checks engine.typescript.
#       Prints one line per combination of counts; exit 0 only when all are identical.
# Env: DOCKER_WRAP  optional command prefix for docker run (for example a lock wrapper).
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cmd="${1:-}"; shift || true

case "$cmd" in
prepare)
  W="${1:?work dir}"; mkdir -p "$W"; W="$(cd "$W" && pwd)"
  [ -d "$ROOT/dist" ] && [ -d "$ROOT/node_modules" ] || { echo "build this checkout first (dist/ and node_modules/)" >&2; exit 2; }
  ${DOCKER_WRAP:-} docker run --rm -v "$ROOT:/pkg:ro" -v "$W:/w" node:22 \
    bash -c 'cd /pkg && npm pack --silent --pack-destination /w | tail -1 > /w/tarball.txt' || exit 1
  TGZ=$(cat "$W/tarball.txt")
  rc=0
  for node in 20 22; do for pm in npm pnpm; do
    C="$W/$node-$pm"; rm -rf "$C"; mkdir -p "$C"
    ${DOCKER_WRAP:-} docker run --rm -v "$W:/w" -e PM="$pm" -e TGZ="$TGZ" -e C="/w/$node-$pm" "node:$node" bash -c '
      set -e
      cp "$(command -v node)" "$C/node"
      mkdir "$C/proj" && cd "$C/proj"
      echo "{\"name\":\"pack-determinism\",\"version\":\"1.0.0\",\"private\":true}" > package.json
      if [ "$PM" = pnpm ]; then
        npm install -g pnpm@9 --silent --no-audit --no-fund > /dev/null
        pnpm add typescript@~6.0.0 > ../install.log 2>&1
        pnpm add "/w/$TGZ" >> ../install.log 2>&1
      else
        npm install --no-audit --no-fund typescript@~6.0.0 > ../install.log 2>&1
        npm install --no-audit --no-fund "/w/$TGZ" >> ../install.log 2>&1
      fi
      B=node_modules/@qaguardian/playwright-score
      { echo "node $(node -v)"; echo "pm $PM $($PM --version)"; echo "root typescript $(node -p "require(\"typescript/package.json\").version")";
        echo "scorer $(node -p "require(\"./$B/package.json\").version") at $(realpath $B)";
        echo "scorer typescript $(cd "$(realpath $B)" && node -p "require(\"typescript/package.json\").version")"; } > ../info.txt
    ' || rc=1
    echo "$node-$pm: $(tr '\n' ';' < "$C/info.txt" 2>/dev/null || echo FAILED)"
  done; done
  exit $rc ;;
score)
  C="$(cd "${1:?combination dir}" && pwd)"; O="${2:?out dir}"; shift 2
  mkdir -p "$O"; O="$(cd "$O" && pwd)"
  node=$(basename "$C" | cut -d- -f1)
  for s in "$@"; do
    key="${s%%=*}"; rest="${s#*=}"; repo="${rest%%:*}"; sub=.; [ "$rest" != "$repo" ] && sub="${rest#*:}"
    ${DOCKER_WRAP:-} docker run --rm --network none -v "$C:/c:ro" -v "$(cd "$repo" && pwd):/suite:ro" -w /suite "node:$node" \
      /c/node /c/proj/node_modules/@qaguardian/playwright-score/bin/playwright-score.js "$sub" --format json > "$O/$key.json" 2> "$O/$key.err"
    echo $? > "$O/$key.status"
  done ;;
compare)
  O="${1:?out dir}"; REF="${2:?reference dir}"; TS="${3:-5.9.3}"
  python3 - "$O" "$REF" "$TS" <<'PY'
import json, os, sys
o, ref, ts = sys.argv[1:4]
keys = sorted(f[:-5] for f in os.listdir(o) if f.endswith('.json') and not f.startswith('_'))
same = differ = missing = badts = 0
for k in keys:
    a = open(os.path.join(o, k + '.json'), 'rb').read()
    rp = os.path.join(ref, k + '.json')
    if not os.path.exists(rp):
        missing += 1; print('no reference:', k); continue
    if a == open(rp, 'rb').read():
        same += 1
    else:
        differ += 1; print('differs:', k)
    try:
        if json.loads(a).get('engine', {}).get('typescript') != ts:
            badts += 1; print('engine.typescript is not', ts + ':', k)
    except ValueError:
        badts += 1; print('not JSON:', k)
print(f'{os.path.basename(os.path.normpath(o))}: {len(keys)} suites, {same} identical, {differ} differ, {missing} no reference, {badts} wrong engine.typescript')
sys.exit(0 if keys and same == len(keys) and badts == 0 else 1)
PY
  ;;
*) sed -n '2,22p' "$0"; exit 2 ;;
esac
