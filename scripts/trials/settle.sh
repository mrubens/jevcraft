#!/bin/sh
# Every first-days trial that is done: promoted to a midgame trial when it
# ended with no death and an iron pickaxe; otherwise a fresh first-days
# trial on its port (its deaths are listed, to be looked into).
#   sh scripts/trials/settle.sh
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT" || exit 1
next() { node -e "const t=JSON.parse(require('fs').readFileSync('artifacts/first-days-trials.json','utf8'));console.log(Math.max(...t.map(x=>Number(x.world.replace('first-days-',''))||0))+1)"; }
for d in .clean-run .clean-run-*; do
  grep -q '^level-name=first-days-' "$d/server.properties" 2>/dev/null || continue
  PORT=$(sed -n 's/^server-port=//p' "$d/server.properties")
  V=$(FIRST_DAYS_PORT=$PORT node scripts/first-days.js verdict 2>/dev/null)
  STATE=$(echo "$V" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const v=JSON.parse(s);const died=v.reasons.some(r=>/death/.test(r));if(!v.done&&!died){console.log('running');return}console.log(died?'died:'+v.world+':'+v.reasons.filter(r=>/death/.test(r)).join(','):v.reachedAt&&'iron_pickaxe' in v.reachedAt?'promote':'weak:'+v.world)}catch{console.log('running')}})")
  case "$STATE" in
    running) ;;
    promote) sh scripts/trials/promote.sh "$PORT" a 2>&1 | tail -1 ;;
    *) echo "$PORT $STATE"; FIRST_DAYS_PORT=$PORT node scripts/first-days.js start "first-days-$(next)" 2>&1 | tail -1 ;;
  esac
done
