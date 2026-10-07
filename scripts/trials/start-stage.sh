#!/bin/sh
# Start a midgame trial from a stage snapshot (checkpoint.sh keeps one the
# first time each trial reaches the Nether or a fortress), so the later
# stages are tried many times an hour instead of a few times a day.
# Selection (scripts/lib/stage-select.js): a fortress start prefers saves
# kept at health 20 and hunger 18 or more with 40+ food points, one source
# world after another before any repeats, and falls back to the nether stage
# when fewer than three qualify; the rule and why are printed. The saves are
# only read. A save whose player stands on a span one or two blocks wide over
# lava is not a start, and a save started STAGE_MAX_PER_HOUR (4) times in the
# hour rests (note 641). STAGE_ANY=1 keeps the old pick, the save least started from.
#   sh scripts/trials/start-stage.sh <port> <nether|fortress|stronghold|dragon>   (stronghold: at its stronghold with the eyes, note 1398; dragon: on entering the End, note 1402)
#   sh scripts/trials/start-stage.sh --list [nether|fortress]   the saves with health, hunger, food points, source world, starts
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
if [ "$1" = "--list" ]; then shift; exec node "$ROOT/scripts/trials/stage-pick.js" --list "$@"; fi
PORT=$1; STAGE=$2
[ -n "$PORT" ] && [ -n "$STAGE" ] || { echo "usage: start-stage.sh <port> <nether|fortress|stronghold|dragon> | --list [stage]"; exit 1; }
[ -d "$ROOT/.trial-checkpoints/stages/$STAGE" ] || { echo "no $STAGE snapshots yet"; exit 1; }
# The port's arm (two-arm trials, scripts/lib/arms.js, note 666): a save the
# other arm started and this one has not is taken first, and the start is
# logged with the arm and the stage asked for.
ARM=$(cd "$ROOT" && node scripts/lib/arms.js name "$PORT" 2>&1) || { echo "the arm of $PORT cannot carry a bot: $ARM"; exit 1; }
ASKED=$STAGE
PICK=$(STAGE_PORT=$PORT STAGE_ARM=$ARM node "$ROOT/scripts/trials/stage-pick.js" "$STAGE") || { echo "no usable $STAGE snapshot"; exit 1; }
# A fortress start with too few good saves is a nether start: the pick says which.
STAGE=$(printf '%s' "$PICK" | cut -f1); BEST=$(printf '%s' "$PICK" | cut -f2)
BESTN=$(cat "$BEST/started" 2>/dev/null || echo 0)
[ -n "$BEST" ] || { echo "no usable $STAGE snapshot"; exit 1; }
SRC=$(basename "$BEST" | sed -E 's/^mid-//; s/-[0-9]{6}$//')
K=$((BESTN + 1))
# A name already used (a snapshot started by hand, a counter behind) is
# passed over: midgame.js refuses a trial name that exists.
while [ -e "$ROOT/artifacts/midgame-mid-$SRC-$STAGE-$K.log" ]; do K=$((K + 1)); done
NAME="mid-$SRC-$STAGE-$K"
echo "$K" > "$BEST/started"
# The start is logged beside the saves (not in one) for the hourly rest the
# pick gives a save started from often (scripts/lib/stage-select.js).
printf '%s\t%s\t%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$STAGE" "$(basename "$BEST")" "$ARM" "$ASKED" >>"$ROOT/.trial-checkpoints/stage-starts.log"
cd "$ROOT" && MIDGAME_PORT=$PORT node scripts/midgame.js start "$NAME" "$BEST/world" "$BEST/state"
