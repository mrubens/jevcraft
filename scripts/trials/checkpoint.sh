#!/bin/sh
# A ring of recent snapshots for each running trial, kept when Jev dies, to
# start the same moment again on the code of the day. Every CHECKPOINT_S
# seconds (30) the server writes the world to disk (save-all flush: nothing
# in the game changes) and the world folder and the bot's state files are
# copied to .trial-checkpoints/<world>/ring/<time>/; the last CHECKPOINT_KEEP
# (10) are kept. When the server log shows a new death, the ring is copied
# to .trial-checkpoints/deaths/<world>-<time>/ before it can be overwritten.
# Start one again as a midgame trial:
#   MIDGAME_PORT=<port> node scripts/midgame.js start mid-<n>-r1 \
#     .trial-checkpoints/deaths/<world>-<time>/<snapshot>/world .trial-checkpoints/deaths/<world>-<time>/<snapshot>/state
#   sh scripts/trials/checkpoint.sh 25582 25585 ... &
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
EVERY=${CHECKPOINT_S:-30}; KEEP=${CHECKPOINT_KEEP:-10}
BASE="$ROOT/.trial-checkpoints"
deaths() { grep -cE ' Jev (was|died|fell|drowned|blew|burned|hit the|tried|walked into|suffocated|experienced|went|froze|starved|withered|discovered)' "$1/logs/latest.log" 2>/dev/null; }
while :; do
  for PORT in "$@"; do
    if [ "$PORT" = 25581 ]; then SERVER="$ROOT/.clean-run"; else SERVER="$ROOT/.clean-run-$PORT"; fi
    lsof -tiTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 || continue
    [ -f "$ROOT/.bot-state/pids/127.0.0.1-$PORT-Jev.starting" ] && continue
    WORLD=$(sed -n 's/^level-name=//p' "$SERVER/server.properties")
    [ -d "$SERVER/$WORLD" ] || continue
    RING="$BASE/$WORLD/ring"
    # A death since the last round: keep the ring as it stood before it.
    NOW=$(deaths "$SERVER"); NOW=${NOW:-0}
    SEEN_FILE="$BASE/$WORLD/deaths-seen"; SEEN=$(cat "$SEEN_FILE" 2>/dev/null || echo "$NOW")
    [ "$NOW" -lt "$SEEN" ] && SEEN=0
    if [ "$NOW" -gt "$SEEN" ] && [ -d "$RING" ]; then
      KEPT="$BASE/deaths/$WORLD-$(date -u +%H%M%S)"
      mkdir -p "$KEPT" && cp -R "$RING"/* "$KEPT"/ && echo "$(date -u +%H:%M:%S) death on $WORLD: kept $(ls "$KEPT" | wc -l | tr -d ' ') snapshots in $KEPT"
    fi
    mkdir -p "$BASE/$WORLD"; echo "$NOW" > "$SEEN_FILE"
    echo "save-all flush" > "$SERVER/console.in"
    sleep 2
    AT=$(date -u +%H%M%S)
    DEST="$RING/$AT"
    mkdir -p "$DEST/state"
    cp -R "$SERVER/$WORLD" "$DEST/world" 2>/dev/null
    rm -f "$DEST/world/session.lock"
    cp "$ROOT/.bot-state/127_0_0_1-$PORT-Jev"*.json "$DEST/state/" 2>/dev/null
    N=$(ls -1d "$RING"/* | wc -l)
    [ "$N" -gt "$KEEP" ] && ls -1d "$RING"/* | sort | head -n $((N - KEEP)) | while read old; do rm -rf "$old"; done
  done
  sleep "$EVERY"
done
