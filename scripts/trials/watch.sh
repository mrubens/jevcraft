#!/bin/sh
# Returns when a trial on one of the ports needs attention: its verdict is
# done (passed, timed out, or failed already by a death or a loop).
#   sh scripts/trials/watch.sh 25582 25583 ...
# Midgame trials by default; TRIAL=first-days for first-days trials.
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
TRIAL=${TRIAL:-midgame}
cd "$ROOT" || exit 1
while :; do
  for p in "$@"; do
    if [ "$TRIAL" = midgame ]; then V=$(MIDGAME_PORT=$p node scripts/midgame.js verdict 2>/dev/null)
    else V=$(FIRST_DAYS_PORT=$p node scripts/first-days.js verdict 2>/dev/null); fi
    if echo "$V" | grep -qE '"(done|failedAlready)": true'; then echo "attention on $p"; echo "$V" | head -30; exit 0; fi
  done
  sleep 60
done
