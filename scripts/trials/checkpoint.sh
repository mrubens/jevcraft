#!/bin/sh
# Checkpoints of a running trial every five minutes: the server saves the
# world (save-all flush, which only writes it to disk), then the world folder
# and the bot's state files are copied to .trial-checkpoints/<world>/<time>/.
# Any of them can be started again as a midgame trial, on the code of the
# day, to try the same moment again:
#   MIDGAME_PORT=<port> node scripts/midgame.js start mid-<n>-r1 \
#     .trial-checkpoints/<world>/<time>/world .trial-checkpoints/<world>/<time>/state
# Keeps the last twelve (an hour) per world.
#   sh scripts/trials/checkpoint.sh 25582 25585 ... &
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
while :; do
  for PORT in "$@"; do
    if [ "$PORT" = 25581 ]; then SERVER="$ROOT/.clean-run"; else SERVER="$ROOT/.clean-run-$PORT"; fi
    lsof -tiTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 || continue
    [ -f "$ROOT/.bot-state/pids/127.0.0.1-$PORT-Jev.starting" ] && continue
    WORLD=$(sed -n 's/^level-name=//p' "$SERVER/server.properties")
    [ -d "$SERVER/$WORLD" ] || continue
    echo "save-all flush" > "$SERVER/console.in"
    sleep 4
    AT=$(date -u +%H%M%S)
    DEST="$ROOT/.trial-checkpoints/$WORLD/$AT"
    mkdir -p "$DEST/state"
    cp -R "$SERVER/$WORLD" "$DEST/world" 2>/dev/null
    rm -f "$DEST/world/session.lock"
    cp "$ROOT/.bot-state/127_0_0_1-$PORT-Jev"*.json "$DEST/state/" 2>/dev/null
    N=$(ls -1d "$ROOT/.trial-checkpoints/$WORLD"/* | wc -l)
    [ "$N" -gt 12 ] && ls -1d "$ROOT/.trial-checkpoints/$WORLD"/* | sort | head -n $((N - 12)) | while read old; do rm -rf "$old"; done
  done
  sleep 300
done
