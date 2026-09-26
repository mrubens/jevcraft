#!/bin/sh
# A passed first-days trial becomes a midgame source: the bot and server on
# the port are stopped (the server saves the world), the world is copied to
# .trial-sources/<world> and the bot's state to .bot-state/archive-<id>-<ms>.
# Prints the archive path.
#   sh scripts/trials/harvest.sh 25583
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
PORT=$1
if [ "$PORT" = 25581 ]; then SERVER="$ROOT/.clean-run"; else SERVER="$ROOT/.clean-run-$PORT"; fi
ID="127_0_0_1-$PORT-Jev"
PIDF="$ROOT/.bot-state/pids/127.0.0.1-$PORT-Jev.pid"
WORLD=$(sed -n 's/^level-name=//p' "$SERVER/server.properties")
touch "${PIDF%.pid}.starting"
BOT=$(cat "$PIDF" 2>/dev/null); [ -n "$BOT" ] && kill "$BOT" 2>/dev/null && sleep 4
SRV=$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null)
if [ -n "$SRV" ]; then
  echo stop > "$SERVER/console.in"
  i=0; while kill -0 "$SRV" 2>/dev/null && [ $i -lt 60 ]; do sleep 1; i=$((i + 1)); done
fi
rm -f "${PIDF%.pid}.starting"
lsof -tiTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 && { echo "server on $PORT still up" >&2; exit 1; }
mkdir -p "$ROOT/.trial-sources"
rm -rf "$ROOT/.trial-sources/$WORLD" && cp -R "$SERVER/$WORLD" "$ROOT/.trial-sources/$WORLD"
ARC="$ROOT/.bot-state/archive-$ID-$(date +%s)000"
mkdir -p "$ARC" && cp "$ROOT/.bot-state/$ID"*.json "$ARC/"
echo ".trial-sources/$WORLD ${ARC#$ROOT/}"
