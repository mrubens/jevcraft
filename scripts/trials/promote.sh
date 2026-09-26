#!/bin/sh
# A first-days trial done with no death becomes (a loop in the first days
# leaves the world as fit a start as any)  a midgame trial on
# the same port: harvested (world to .trial-sources, bot state archived),
# then started as mid-<n>-<letter>.
#   sh scripts/trials/promote.sh 25582 [letter]
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
PORT=$1; LETTER=${2:-a}
cd "$ROOT" || exit 1
V=$(FIRST_DAYS_PORT=$PORT node scripts/first-days.js verdict 2>/dev/null)
echo "$V" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const v=JSON.parse(s);if(!v.done||v.reasons.some(r=>/death/.test(r))){console.error('not promotable: '+JSON.stringify({done:v.done,reasons:v.reasons}));process.exit(1)}})" || exit 1
set -- $(sh scripts/trials/harvest.sh "$PORT") || exit 1
SRC=$1; ARC=$2; N=${SRC##*first-days-}
MIDGAME_PORT=$PORT node scripts/midgame.js start "mid-$N-$LETTER" "$SRC" "$ARC"
