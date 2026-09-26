#!/bin/sh
# The moment before a death, tried again N times on the code of the day:
# a kept ring (.trial-checkpoints/deaths/<world>-<time>/, checkpoint.sh) is
# started as N short midgame trials, one per free port from 25601, from the
# snapshot BACK places before the last (default 2, about a minute and a
# half before the death). Each is judged as a midgame trial (verdict on its
# port); how many live the minutes that killed the original is the measure
# of a fix, since no replay is exact (the bot's timing and the server's
# randomness differ every run).
#   sh scripts/trials/retry.sh .trial-checkpoints/deaths/mid-215-a-172342 3
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
KEPT=$1; N=${2:-3}; BACK=${BACK:-2}
cd "$ROOT" || exit 1
SNAP=$(ls -1d "$KEPT"/* | sort | tail -n "$BACK" | head -1)
[ -d "$SNAP/world" ] || { echo "no snapshot in $KEPT"; exit 1; }
NAME=$(basename "$KEPT" | sed 's/^mid-//; s/-[0-9]*$//')
i=0; PORT=25601
while [ $i -lt "$N" ] && [ $PORT -le 25620 ]; do
  if ! lsof -tiTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1 && [ -d "$ROOT/.clean-run-$PORT" ]; then
    i=$((i + 1))
    WORLD="retry-$NAME-$(basename "$SNAP")-$i"
    rm -rf "$ROOT/.clean-run-$PORT/$WORLD"
    MIDGAME_PORT=$PORT node scripts/midgame.js start "$WORLD" "$SNAP/world" "$SNAP/state" 2>&1 | tail -1
    pgrep -f "supervisor.sh $PORT" >/dev/null || { nohup sh scripts/trials/supervisor.sh $PORT >> artifacts/supervisors/$PORT.log 2>&1 & }
  fi
  PORT=$((PORT + 1))
done
