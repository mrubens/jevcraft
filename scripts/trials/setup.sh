#!/bin/sh
# Trial servers from scratch: Java 25 and the 26.1.2 vanilla server jar in
# ../.tools beside the repo, and N server folders: .clean-run (25581) and
# .clean-run-<port> for 25582 onward. Safe to run again; it only fills gaps.
#   sh scripts/trials/setup.sh 12
set -e
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
TOOLS=$(cd "$ROOT/.." && pwd)/.tools
N=${1:-4}
mkdir -p "$TOOLS"
if [ ! -x "$TOOLS/jdk25/bin/java" ]; then
  curl -sL -o "$TOOLS/jdk25.tar.gz" "https://api.adoptium.net/v3/binary/latest/25/ga/mac/aarch64/jdk/hotspot/normal/eclipse"
  mkdir -p "$TOOLS/jdk25x" && tar xzf "$TOOLS/jdk25.tar.gz" -C "$TOOLS/jdk25x"
  mv "$TOOLS"/jdk25x/*/Contents/Home "$TOOLS/jdk25" && rm -rf "$TOOLS/jdk25x" "$TOOLS/jdk25.tar.gz"
fi
JAR="$TOOLS/server-26.1.2.jar"
if [ ! -f "$JAR" ]; then
  META=$(curl -s https://piston-meta.mojang.com/mc/game/version_manifest_v2.json | python3 -c "import json,sys;print([v['url'] for v in json.load(sys.stdin)['versions'] if v['id']=='26.1.2'][0])")
  curl -s "$META" | python3 -c "import json,sys;d=json.load(sys.stdin)['downloads']['server'];print(d['url']);print(d['sha1'])" > "$TOOLS/server.txt"
  curl -sL -o "$JAR" "$(sed -n 1p "$TOOLS/server.txt")"
  echo "$(sed -n 2p "$TOOLS/server.txt")  $JAR" | shasum -c
fi
# Fabric with ServerReplay, which records Jev from join to leave (the
# recordings land in <server>/recordings/players, for ReplayMod).
FABRIC="$TOOLS/fabric-server-26.1.2.jar"
if [ ! -f "$FABRIC" ]; then
  I=$(curl -s https://meta.fabricmc.net/v2/versions/installer | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['version'])")
  curl -sL -o "$FABRIC" "https://meta.fabricmc.net/v2/versions/loader/26.1.2/0.19.5/$I/server/jar"
fi
if [ ! -d "$TOOLS/mods" ]; then
  mkdir -p "$TOOLS/mods"
  # fabric-api, fabric-language-kotlin (ServerReplay's two requirements), ServerReplay
  for proj in P7dR8mSH Ha28R6CL qCvSZ8ra; do
    curl -s "https://api.modrinth.com/v2/project/$proj/version" | python3 -c "
import json,sys
for v in json.load(sys.stdin):
  if '26.1.2' in v['game_versions'] and 'fabric' in v['loaders']:
    f=[f for f in v['files'] if f['primary']][0];print(f['url'],f['filename'],f['hashes']['sha1']);break"
  done | while read u f s; do curl -sL -o "$TOOLS/mods/$f" "$u"; echo "$s  $TOOLS/mods/$f" | shasum -c; done
fi
mkdir -p "$ROOT/.trial-sources" "$ROOT/.bot-state" "$ROOT/artifacts"
i=0
while [ $i -lt "$N" ]; do
  PORT=$((25581 + i))
  if [ $PORT = 25581 ]; then DIR="$ROOT/.clean-run"; else DIR="$ROOT/.clean-run-$PORT"; fi
  mkdir -p "$DIR"
  echo "eula=true" > "$DIR/eula.txt"
  [ -f "$DIR/server.properties" ] || cat > "$DIR/server.properties" <<PROPS
server-port=$PORT
online-mode=false
difficulty=normal
gamemode=survival
spawn-protection=0
level-name=world
motd=Jev trial $PORT
enable-command-block=false
allow-flight=true
PROPS
  mkdir -p "$DIR/mods" "$DIR/config/server-replay"
  cp "$TOOLS"/mods/*.jar "$DIR/mods/"
  echo "serverJar=$JAR" > "$DIR/fabric-server-launcher.properties"
  cat > "$DIR/config/server-replay/config.json" <<CFG
{
  "world_name": "Jev trial $PORT",
  "server_name": "trial $PORT",
  "automatically_record": true,
  "player_predicate": { "type": "has_name", "names": ["Jev"] }
}
CFG
  sed -e "s|^JAVA=.*|JAVA=\${JAVA:-$TOOLS/jdk25/bin/java}|" -e "s|^JAR=.*|JAR=\${SERVER_JAR:-$FABRIC}|" \
    "$ROOT/scripts/server/start.sh.example" > "$DIR/start.sh"
  i=$((i + 1))
done
echo "$N trial servers ready (25581-$((25581 + N - 1)))."
