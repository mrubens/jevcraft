#!/bin/sh
# The arena server (.test-combat, port 25574) from scratch and running: the
# same 26.1.2 vanilla jar and Java 25 as the trial servers (../.tools, made
# by setup.sh), no mods, a flat overworld (the drills are carved into the
# Nether, where every fight that killed the bot happened). The folder lives
# in the main checkout, so every worktree's arena.js finds the same server.
# No player is an operator: the arena stages everything through the
# console pipe, console.in, and reads deaths from logs/arena-console.log.
#   sh scripts/trials/arena-start.sh          # makes the folder if missing, then runs
#   MC_PORT=25574 ARENA_JEV=1 node scripts/arena.js blaze_open_eight
set -e
HERE=$(cd "$(dirname "$0")/../.." && pwd)
ROOT=$(cd "$(git -C "$HERE" rev-parse --path-format=absolute --git-common-dir)/.." && pwd)
TOOLS=$(cd "$ROOT/.." && pwd)/.tools
DIR=${ARENA_DIR:-$ROOT/.test-combat}
# A second arena beside the first (ARENA_DIR, ARENA_PORT) runs drills in parallel.
PORT=${ARENA_PORT:-25574}
JAVA=${JAVA:-$TOOLS/jdk25/bin/java}
JAR=${SERVER_JAR:-$TOOLS/server-26.1.2.jar}
[ -x "$JAVA" ] && [ -f "$JAR" ] || { echo "No Java 25 or server jar in $TOOLS; run scripts/trials/setup.sh first" >&2; exit 1; }
mkdir -p "$DIR/logs"
echo "eula=true" > "$DIR/eula.txt"
[ -f "$DIR/server.properties" ] || cat > "$DIR/server.properties" <<PROPS
server-port=$PORT
online-mode=false
difficulty=normal
gamemode=survival
spawn-protection=0
level-name=arena
level-type=minecraft\:flat
generate-structures=false
motd=Jev arena $PORT
enable-command-block=false
allow-flight=true
view-distance=6
simulation-distance=6
pause-when-empty-seconds=0
max-tick-time=60000
PROPS
if lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then echo "Something already listens on $PORT" >&2; exit 1; fi
cd "$DIR"
[ -p console.in ] || mkfifo console.in
# The console pipe held open by tail, so a write never blocks; everything
# the server says kept in logs/arena-console.log for the arena's death causes.
tail -f console.in | "$JAVA" -Xms1G -Xmx2G -jar "$JAR" nogui 2>&1 | tee -a logs/arena-console.log
