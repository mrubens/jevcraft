#!/bin/sh
# Returns when a trial on one of the ports needs attention: its verdict is
# done, or it failed by a death or a loop. A first-days milestone missed by
# its minute is a pace note, not a reason to stop: the world can still be a
# midgame source if it gets there with no death or loop.
#   sh scripts/trials/watch.sh 25582 25583 ...   (or auto)
# Midgame trials by default; TRIAL=first-days for first-days trials.
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
TRIAL=${TRIAL:-midgame}
cd "$ROOT" || exit 1
# auto: every server whose world is of this kind (mid- or first-days-).
ports() {
  if [ "$1" = auto ]; then
    PREFIX=$([ "$TRIAL" = midgame ] && echo mid- || echo first-days-)
    for d in "$ROOT"/.clean-run "$ROOT"/.clean-run-*; do
      grep -q "^level-name=$PREFIX" "$d/server.properties" 2>/dev/null && sed -n 's/^server-port=//p' "$d/server.properties"
    done
  else echo "$@"; fi
}
while :; do
  for p in $(ports "$@"); do
    if [ "$TRIAL" = midgame ]; then V=$(MIDGAME_PORT=$p node scripts/midgame.js verdict 2>/dev/null)
    else V=$(FIRST_DAYS_PORT=$p node scripts/first-days.js verdict 2>/dev/null); fi
    if echo "$V" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const v=JSON.parse(s);process.exit(v.done||(v.reasons||[]).some(r=>/death|loop/.test(r))?0:1)}catch{process.exit(1)}})"; then
      echo "attention on $p"; echo "$V" | head -30; exit 0
    fi
  done
  sleep 60
done
