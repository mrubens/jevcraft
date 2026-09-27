#!/bin/sh
# Start a midgame trial from a stage snapshot (checkpoint.sh keeps one the
# first time each trial reaches the Nether or a fortress), so the later
# stages are tried many times an hour instead of a few times a day. The
# snapshot least started from goes first.
#   sh scripts/trials/start-stage.sh <port> <nether|fortress>
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
PORT=$1; STAGE=$2
[ -n "$PORT" ] && [ -n "$STAGE" ] || { echo "usage: start-stage.sh <port> <nether|fortress>"; exit 1; }
DIR="$ROOT/.trial-checkpoints/stages/$STAGE"
[ -d "$DIR" ] || { echo "no $STAGE snapshots yet"; exit 1; }
BEST=""; BESTN=999999
for S in "$DIR"/*/; do
  S=${S%/}; [ -d "$S/world" ] && [ -d "$S/state" ] || continue
  N=$(cat "$S/started" 2>/dev/null || echo 0)
  if [ "$N" -lt "$BESTN" ]; then BEST=$S; BESTN=$N; fi
done
[ -n "$BEST" ] || { echo "no usable $STAGE snapshot"; exit 1; }
SRC=$(basename "$BEST" | sed -E 's/^mid-//; s/-[0-9]{6}$//')
K=$((BESTN + 1))
# A name already used (a snapshot started by hand, a counter behind) is
# passed over: midgame.js refuses a trial name that exists.
while [ -e "$ROOT/artifacts/midgame-mid-$SRC-$STAGE-$K.log" ]; do K=$((K + 1)); done
NAME="mid-$SRC-$STAGE-$K"
echo "$K" > "$BEST/started"
cd "$ROOT" && MIDGAME_PORT=$PORT node scripts/midgame.js start "$NAME" "$BEST/world" "$BEST/state"
