'use strict';
// A saved scene replayed in the arena and the mining stand looked for (mining-access.js approachDryMining), as the
// mine step does: SCENE is a JSON list of [x, y, z, block] read from a trial world (scripts/region-map.js), placed at
// the arena's sky shifted by DX/DY/DZ (DIM=the_nether: the arena's Nether, unshifted); the bot stood at STAND; each target in TARGETS (x,y,z;x,y,z) tried in turn.
//   SCENE=scene.json STAND=87,82,-209 TARGETS=89,82,-211 MC_PORT=25574 node scripts/stem-drill.js
const fs = require('fs'), path = require('path');
const mineflayer = require('mineflayer');
const { pathfinder } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { compatibilityPlugin } = require('../src/compatibility');
const { configureMovements } = require('../src/movement');
const { Task, navigate } = require('../src/skills');

const port = Number(process.env.MC_PORT || 25574);
if (port !== 25574 && !process.env.ARENA_DIR) throw new Error('The stem drill needs the arena port');
const consolePath = path.join(process.env.ARENA_DIR || path.join(__dirname, '..', '.test-combat'), 'console.in');
const username = 'ArenaJev';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const DIM = process.env.DIM || 'overworld';
async function command(line) { fs.writeFileSync(consolePath, line + '\n'); await sleep(60); }
const inDim = line => DIM === 'overworld' ? line : `execute in minecraft:${DIM} run ${line}`;
const scene = JSON.parse(fs.readFileSync(process.env.SCENE, 'utf8'));
const [DX, DY, DZ] = process.env.DIM === 'the_nether' ? [0, 0, 0] : [300 - 90, 150 - 80, 300 + 210];
const stand = process.env.STAND.split(',').map(Number), targets = process.env.TARGETS.split(';').map(t => t.split(',').map(Number));
const shift = ([x, y, z]) => new Vec3(x + DX, y + DY, z + DZ);

const bot = mineflayer.createBot({ host: '127.0.0.1', port, username, version: '26.1', auth: 'offline' });
bot.loadPlugin(compatibilityPlugin); bot.loadPlugin(pathfinder);
bot.on('error', e => console.log('error', e.message));
bot.once('spawn', async () => {
  configureMovements(bot);
  for (const line of [`clear ${username}`, `gamemode survival ${username}`, `effect give ${username} resistance 600 5 true`, `effect give ${username} saturation 600 1 true`]) await command(line);
  const xs = scene.map(c => c[0]), ys = scene.map(c => c[1]), zs = scene.map(c => c[2]);
  const lo = shift([Math.min(...xs), Math.min(...ys), Math.min(...zs)]), hi = shift([Math.max(...xs), Math.max(...ys), Math.max(...zs)]);
  await command(inDim(`forceload add ${lo.x} ${lo.z} ${hi.x} ${hi.z}`)); await sleep(2000);
  await command(inDim(`fill ${lo.x} ${lo.y - 1} ${lo.z} ${hi.x} ${lo.y - 1} ${hi.z} netherrack`));
  for (const [x, y, z, b] of scene) { const p = shift([x, y, z]); await command(inDim(`setblock ${p.x} ${p.y} ${p.z} minecraft:${b}`)); }
  await command(`give ${username} minecraft:iron_pickaxe 1`); await command(`give ${username} minecraft:iron_axe 1`); await command(`give ${username} minecraft:netherrack 32`);
  for (const t of targets) {
    const s = shift(stand); await command(inDim(`tp ${username} ${s.x + 0.5} ${s.y} ${s.z + 0.5}`)); await sleep(2500);
    const p = shift(t), block = bot.blockAt(p);
    const ma = require('../src/mining-access');
    const here = bot.entity.position;
    const cands = ma.dryMiningPositions(bot, p).map(q => `${q.x - DX},${q.y - DY},${q.z - DZ}`);
    let result = 'reached';
    try { await ma.approachDryMining(bot, new Task('stem_drill', 'drill'), p, { navigate, dig: async b => bot.dig(b) }); }
    catch (e) { result = String(e.message).slice(0, 160); }
    console.log(JSON.stringify({ target: t, block: block?.name, from: [here.x - DX, here.y - DY, here.z - DZ], reachHere: ma.miningReach(bot, here, p), standHere: ma.dryStanding(bot, here), candidates: cands, result, at: [bot.entity.position.x - DX, bot.entity.position.y - DY, bot.entity.position.z - DZ].map(v => Math.round(v * 10) / 10) }));
  }
  bot.quit(); setTimeout(() => process.exit(0), 500);
});
