#!/bin/sh
# Keeps a trial's bot running: a bot whose flight record has gone quiet for
# 60 s (or that is gone) is stopped and started again on the same state,
# logging to the current trial's log. Leaves the bot alone while a trial is
# starting or the server is down. The bot runs from the port's arm
# (scripts/lib/arms.js): ROOT's checkout, or a pinned baseline's.
#   sh scripts/trials/supervisor.sh 25582 &
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
PORT=$1
[ -n "$PORT" ] || { echo "usage: supervisor.sh <port>"; exit 1; }
if [ "$PORT" = 25581 ]; then SERVER="$ROOT/.clean-run"; else SERVER="$ROOT/.clean-run-$PORT"; fi
ID="127_0_0_1-$PORT-Jev"
PIDF="$ROOT/.bot-state/pids/127.0.0.1-$PORT-Jev.pid"
NODE=$(command -v node)
log() { echo "$(date '+%H:%M:%S') [$PORT] $*"; }
while :; do
  sleep 15
  [ -f "${PIDF%.pid}.starting" ] && continue
  lsof -tiTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 || continue
  WORLD=$(sed -n 's/^level-name=//p' "$SERVER/server.properties")
  if [ -f "$ROOT/artifacts/midgame-$WORLD.log" ]; then OUT="$ROOT/artifacts/midgame-$WORLD.log"
  elif [ -f "$ROOT/artifacts/first-days-$WORLD.log" ]; then OUT="$ROOT/artifacts/first-days-$WORLD.log"
  else continue; fi
  BOT=$(cat "$PIDF" 2>/dev/null)
  if [ -n "$BOT" ] && kill -0 "$BOT" 2>/dev/null; then
    LAST=$(ls -t "$ROOT/.bot-state/flight/$ID"-*.jsonl 2>/dev/null | head -1)
    [ -n "$LAST" ] || continue
    AGE=$(( $(date +%s) - $(stat -f %m "$LAST") ))
    [ "$AGE" -lt 60 ] && continue
    log "flight record quiet ${AGE}s; restarting bot $BOT"
    kill "$BOT" 2>/dev/null; sleep 5; kill -9 "$BOT" 2>/dev/null
  else
    log "no bot; starting one"
  fi
  # The bot runs from the port's arm (.bot-state/arms/<port>, scripts/lib/arms.js:
  # main unless a baseline checkout is named), so a restart keeps it on its arm.
  STARTED=$(cd "$ROOT" && "$NODE" scripts/lib/arms.js launch "$PORT" "$OUT" 2>&1) || { log "not started: $STARTED"; sleep 30; continue; }
  log "started $STARTED"
  sleep 30
done
