#!/bin/sh
# Puts a watching player in Spectator on Jev as soon as they join any trial
# server, through the server's console. Only the watcher is touched; Jev
# gets nothing.
#   sh scripts/trials/spectate.sh DoloresDoodle &
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
NAME=$1
[ -n "$NAME" ] || { echo "usage: spectate.sh <player>"; exit 1; }
seen() { grep -c "$NAME joined the game" "$1/logs/latest.log" 2>/dev/null || echo 0; }
while :; do
  for DIR in "$ROOT"/.clean-run "$ROOT"/.clean-run-*; do
    [ -p "$DIR/console.in" ] || continue
    KEY=$(echo "$DIR" | tr -c 'a-zA-Z0-9\n' _)
    now=$(seen "$DIR"); eval "was=\${S_$KEY:-0}"
    # A new log (a restarted server) starts the count again.
    [ "$now" -lt "$was" ] && was=0
    if [ "$now" -gt "$was" ]; then
      sleep 1
      printf 'gamemode spectator %s\nspectate Jev %s\n' "$NAME" "$NAME" > "$DIR/console.in"
      echo "$(date '+%H:%M:%S') $NAME on $(basename "$DIR"): spectating Jev"
    fi
    eval "S_$KEY=$now"
  done
  sleep 2
done
