#!/bin/sh
# Returns when a trial on one of the ports needs attention: its verdict is
# done, or it failed by a death, a loop, or being stranded (half an hour in
# one small place with the way off answered none good, scripts/lib/stranded.js:
# nothing else ends it, and the three hours are not worth waiting out). A
# first-days milestone missed by its minute is a pace note, not a reason to
# stop: the world can still be a midgame source if it gets there with no
# death or loop. A fresh world (not a fortress or Nether save) an hour
# played with no Nether is ended too: past that it has shown what it
# shows, and the port is worth more on a new start (Fable 08:01Z,
# 2026-09-30: 69.6 of 94.5 fresh bot-hours went to trials that never
# reached a blaze fight).
#   sh scripts/trials/watch.sh 25582 25583 ...   (or auto)
# Midgame trials by default; TRIAL=first-days for first-days trials.
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
TRIAL=${TRIAL:-midgame}
cd "$ROOT" || exit 1
# Each check has two minutes: a verdict or lsof that never returned kept the
# watcher silent for five hours while trials failed (2026-09-28).
limit() { perl -e 'alarm shift; exec @ARGV' 120 "$@"; }
# auto: every running server whose world is of this kind (mid- or
# first-days-); a stopped one is not a trial.
ports() {
  if [ "$1" = auto ]; then
    PREFIX=$([ "$TRIAL" = midgame ] && echo mid- || echo first-days-)
    for d in "$ROOT"/.clean-run "$ROOT"/.clean-run-*; do
      grep -q "^level-name=$PREFIX" "$d/server.properties" 2>/dev/null || continue
      P=$(sed -n 's/^server-port=//p' "$d/server.properties")
      limit lsof -tiTCP:"$P" -sTCP:LISTEN >/dev/null 2>&1 && echo "$P"
    done
  else echo "$@"; fi
}
while :; do
  for p in $(ports "$@"); do
    if [ "$TRIAL" = midgame ]; then V=$(MIDGAME_PORT=$p limit node scripts/midgame.js verdict 2>/dev/null </dev/null)
    else V=$(FIRST_DAYS_PORT=$p limit node scripts/first-days.js verdict 2>/dev/null </dev/null); fi
    if echo "$V" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const v=JSON.parse(s);const noNether=!/fortress|nether/.test(v.world||'')&&(v.playedMinutes||0)>=60&&!(v.reachedAtMinute||{}).nether;process.exit(v.done||noNether||(v.reasons||[]).some(r=>/death|loop|stranded/.test(r))?0:1)}catch{process.exit(1)}})"; then
      echo "attention on $p"; echo "$V" | head -30; exit 0
    fi
  done
  sleep 60
done
