'use strict';
// The stage save start-stage.sh starts from, and a listing of them
// (scripts/lib/stage-select.js says the rule). Reads the saves; never edits.
//   node scripts/trials/stage-pick.js <nether|fortress>     print the pick: "<stage>\t<snapshot dir>" on stdout, the rule and why on stderr
//   node scripts/trials/stage-pick.js --list [stage ...]    every save with its health, hunger, food points, source world, starts
// STAGE_ANY=1 (or --any) keeps the old pick: the least started save. JEV_ROOT reads another checkout's saves.
const path = require('node:path');
const { readStage, choose, listing } = require('../lib/stage-select');

async function main() {
  const argv = process.argv.slice(2), root = process.env.JEV_ROOT ? path.resolve(process.env.JEV_ROOT) : path.join(__dirname, '..', '..');
  const any = argv.includes('--any') || process.env.STAGE_ANY === '1';
  const names = argv.filter(a => !a.startsWith('--'));
  const stages = {};
  for (const s of new Set([...(names.length ? names : ['fortress', 'nether']), 'nether'])) stages[s] = await readStage(root, s);
  if (argv.includes('--list')) {
    for (const s of names.length ? names : ['fortress', 'nether']) console.log(listing(stages, s, { any }) + '\n');
    return;
  }
  const stage = names[0];
  if (!stage) { console.error('usage: stage-pick.js <nether|fortress> | --list [stage ...]'); process.exit(2); }
  const pick = choose(stages, stage, { any });
  if (pick.error) { console.error(pick.error); process.exit(1); }
  console.error(`stage-pick: ${pick.rule}: ${pick.why}`);
  console.log(`${pick.stage}\t${pick.snapshot.dir}`);
}
main().catch(err => { console.error(err.stack || err); process.exit(1); });
