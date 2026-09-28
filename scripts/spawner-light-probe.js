'use strict';
// Whether light stops a blaze spawner, as the 26.1.2 jar says it does (note
// 606): a live blaze spawner on a brick floor along a netherrack wall, a
// probe player in creative ten blocks off (within the spawner's sixteen,
// not hurt by what comes), and the blazes that spawn counted over a round
// in each of three lights: none; the torches lightPlan chooses (every open
// cell within four of the cage, one below to one above, at 12 or more);
// and the same but for one torch left out, so a few cells stay dark.
//   MC_PORT=25576 ARENA_CONSOLE=... node scripts/spawner-light-probe.js [seconds]
const mineflayer = require('mineflayer'); const fs = require('fs'); const path = require('path');
const { Vec3 } = require('vec3');
const { arenaDir } = require('./lib/arena');
const T = require('../src/blaze-tactics');
const CONSOLE = process.env.ARENA_CONSOLE || path.join(arenaDir(), 'console.in');
const say = l => fs.appendFileSync(CONSOLE, l + '\n');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const seconds = Number(process.argv[2] || 60);
const PORT = Number(process.env.MC_PORT || 25574);
const NAME = 'LightProbe', D = 'minecraft:the_nether', X = 1500, Y = 100, Z = 1500;
const run = c => say(`execute in ${D} run ${c}`);
const cage = new Vec3(X, Y + 1, Z);
const bot = mineflayer.createBot({ host: '127.0.0.1', port: PORT, username: NAME, version: '26.1', auth: 'offline' });
const build = () => {
  run(`forceload add ${X - 32} ${Z - 32} ${X + 32} ${Z + 32}`);
  run(`fill ${X - 12} ${Y - 3} ${Z - 12} ${X + 12} ${Y + 12} ${Z + 14} minecraft:netherrack`);
  run(`fill ${X - 11} ${Y + 1} ${Z - 5} ${X + 11} ${Y + 11} ${Z + 13} minecraft:air`);
  run(`fill ${X - 11} ${Y} ${Z - 5} ${X + 11} ${Y} ${Z + 13} minecraft:nether_bricks`);
  run(`setblock ${X} ${Y + 1} ${Z} minecraft:spawner{SpawnData:{entity:{id:"minecraft:blaze"}}}`);
  run(`kill @e[type=minecraft:blaze,x=${X - 12},y=${Y - 3},z=${Z - 12},dx=24,dy=16,dz=27]`);
};
async function round(label, torches) {
  build();
  await sleep(1500);
  for (const t of torches) run(`setblock ${t.cell.x} ${t.cell.y} ${t.cell.z} minecraft:${t.against.y === -1 ? 'torch' : `wall_torch[facing=${t.against.x === 1 ? 'west' : t.against.x === -1 ? 'east' : t.against.z === 1 ? 'north' : 'south'}]`}`);
  await sleep(1500);
  const seen = new Set();
  const onSpawn = e => { if (e.name === 'blaze') seen.add(e.id); };
  bot.on('entitySpawn', onSpawn);
  const t0 = Date.now();
  while (Date.now() - t0 < seconds * 1000) {
    // Taken away as they come, so the spawner's six about never caps it.
    run(`kill @e[type=minecraft:blaze,x=${X - 12},y=${Y - 3},z=${Z - 12},dx=24,dy=16,dz=27]`);
    await sleep(2000);
  }
  bot.removeListener('entitySpawn', onSpawn);
  const out = { label, torches: torches.length, seconds, blazes: seen.size };
  console.log(JSON.stringify(out));
  return out;
}
bot.once('spawn', async () => {
  say(`gamemode creative ${NAME}`); say('difficulty normal'); say('gamerule minecraft:spawn_mobs false');
  build();
  run(`tp ${NAME} ${X + 0.5} ${Y + 1} ${Z + 10.5}`);
  await sleep(3000);
  await bot.waitForChunksToLoad();
  const plan = T.lightPlan(bot, cage);
  console.log(JSON.stringify({ cells: plan.cells, torches: plan.torches.length, dark: plan.dark.length }));
  const results = [await round('dark', []), await round('lit', plan.torches), await round('all but one torch', plan.torches.slice(1))];
  const rest = T.lightPlan(bot, cage);
  console.log(JSON.stringify({ summary: results, darkCellsWithOneLeftOut: rest.cells - rest.alreadyLit }));
  run(`fill ${X - 12} ${Y - 3} ${Z - 12} ${X + 12} ${Y + 12} ${Z + 14} minecraft:air`);
  bot.quit(); setTimeout(() => process.exit(0), 300);
});
