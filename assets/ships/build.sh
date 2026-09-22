#!/bin/sh
# Assembles js/shipart.js = the renderer core + every hull family, in class order. Plain concatenation, no tooling.
set -e
cd "$(dirname "$0")/../.."
{
  cat assets/ships/src/core.js
  printf '\n/* ==================== hull families (appended from assets/ships/src/*.js by assets/ships/build.sh) ==================== */\n'
  for id in corvette frigate destroyer cruiser lancer freighter station; do
    f="assets/ships/src/$id.js"
    if [ -f "$f" ]; then printf '\n/* ---- %s ---- */\n' "$id"; cat "$f"; printf '\n'; fi
  done
} > js/shipart.js.tmp
node -e "require('vm').runInNewContext(require('fs').readFileSync('js/shipart.js.tmp','utf8'), {window:{}, document:{}})"
mv js/shipart.js.tmp js/shipart.js
echo "built js/shipart.js ($(wc -c < js/shipart.js) bytes)"
