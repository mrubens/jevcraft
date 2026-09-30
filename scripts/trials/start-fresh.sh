#!/bin/sh
# Start a midgame trial from a first-days source under the first name of
# the form mid-<n>-<letters> that no trial has used on any port.
#   sh scripts/trials/start-fresh.sh <port> <source number>
#   sh scripts/trials/start-fresh.sh <port> pair [fallback source number]
# `pair` (two-arm trials, scripts/lib/arms.js, note 666): the source this
# port's arm owes the other arm, the oldest fresh start there in the last six
# hours not yet started here as often; with none owed, the fallback source, or
# nothing started.
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
PORT=$1; N=$2
[ -n "$PORT" ] && [ -n "$N" ] || { echo "usage: start-fresh.sh <port> <source number> | <port> pair [fallback]"; exit 1; }
if [ "$N" = pair ]; then
  OWED=$(cd "$ROOT" && node scripts/lib/arms.js owed-fresh "$PORT") || exit 1
  if [ -n "$OWED" ]; then echo "pair: source $OWED is owed by this port's arm"; N=$OWED
  elif [ -n "$3" ]; then echo "pair: nothing owed; source $3"; N=$3
  else echo "pair: nothing owed and no fallback source; nothing started"; exit 1; fi
fi
SRC=".trial-sources/first-days-$N"
[ -f "$ROOT/$SRC.archive" ] || { echo "no source $SRC"; exit 1; }
cd "$ROOT" || exit 1
for A in a b c d e f g h i j k m n p q r s t u v w x y z; do
  for B in "" a b c d e f g h i j k m n p q r s t u v w x y z; do
    W="mid-$N-$A$B"
    [ -f "artifacts/midgame/$W.json" ] && continue
    ls -d .clean-run*/"$W" >/dev/null 2>&1 && continue
    MIDGAME_PORT=$PORT node scripts/midgame.js start "$W" "$SRC" "$(cat "$SRC.archive")"
    exit $?
  done
done
echo "no free name for $N"; exit 1
