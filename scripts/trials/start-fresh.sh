#!/bin/sh
# Start a midgame trial from a first-days source under the first name of
# the form mid-<n>-<letters> that no trial has used on any port.
#   sh scripts/trials/start-fresh.sh <port> <source number>
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
PORT=$1; N=$2
[ -n "$PORT" ] && [ -n "$N" ] || { echo "usage: start-fresh.sh <port> <source number>"; exit 1; }
SRC=".trial-sources/first-days-$N"
[ -f "$ROOT/$SRC.archive" ] || { echo "no source $SRC"; exit 1; }
cd "$ROOT" || exit 1
for A in a b c d e f g h i j k m n p q r s t u v w x y z; do
  for B in "" a b c d e f g h; do
    W="mid-$N-$A$B"
    [ -f "artifacts/midgame/$W.json" ] && continue
    ls -d .clean-run*/"$W" >/dev/null 2>&1 && continue
    MIDGAME_PORT=$PORT node scripts/midgame.js start "$W" "$SRC" "$(cat "$SRC.archive")"
    exit $?
  done
done
echo "no free name for $N"; exit 1
