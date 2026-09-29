#!/bin/sh
# The live critic: every 20 minutes a headless Claude reads what each running
# trial did in its last minutes (scripts/trials/recent.js, progress-audit,
# trail maps) and writes up the dumb things it sees to artifacts/critic/.
# Read-only tools only. Stop by creating artifacts/critic/stop.
#   sh scripts/trials/critic.sh [minutes-between]
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT" || exit 1
EVERY=${1:-20}
mkdir -p artifacts/critic
while [ ! -f artifacts/critic/stop ]; do
  out=artifacts/critic/critic-$(date -u +%Y%m%dT%H%MZ).md
  "${CLAUDE_BIN:-/Users/matt/.local/bin/claude}" -p --model claude-opus-5-5 --allowedTools "Read" "Grep" "Glob" "Bash(node scripts/*)" "Bash(ls:*)" < scripts/trials/critic-prompt.md > "$out.tmp" 2>&1
  mv "$out.tmp" "$out"
  sleep $((EVERY * 60))
done
