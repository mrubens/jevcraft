'use strict';
// A ruined portal two obsidian short, finished by the real portal step (note 2318): a frame along x at (300, 70, 300),
// eight of its ten standing, its two bottom slots empty; a lava pool of four sources nine blocks off and water four
// off; ArenaJev with a water bucket, an empty bucket, flint and steel, an iron pickaxe and food, its portal plan the
// ruin. Each run calls work.js portalStep until a nether_portal block stands in the frame or SECONDS pass; it says
// what was cast, the steps taken and the errors met. SRC picks the code: the worktree's (default) or another checkout's.
//   ARENA_DIR=$HOME/Code/jevcraft/.test-combat MC_PORT=25574 node scripts/ruin-cast-drill.js
//   SRC=$HOME/Code/jevcraft/src ... (the main checkout's code, before the note)
const fs = require('fs'), path = require('path');
const mineflayer = require('mineflayer');
const { pathfinder } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const SRC = process.env.SRC || path.join(__dirname, '..', 'src');
const { compatibilityPlugin } = require(path.join(SRC, 'compatibility'));
const port = Number(process.env.MC_PORT || 25574);
if (port !== 25574 && !process.env.ARENA_PORT_OK) throw new Error('The ruin-cast drill needs the arena port');
const consolePath = path.join(process.env.ARENA_DIR || path.join(__dirname, '..', '.test-combat'), 'console.in');
const username = process.env.ARENA_USER || 'ArenaJev', RUNS = Number(process.env.DRILL_RUNS || 2), SECONDS = Number(process.env.SECONDS || 300);
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function command(line) { fs.writeFileSync(consolePath, line + '\n'); await sleep(250); }
const log = data => console.log(JSON.stringify({ at: new Date().toISOString(), src: SRC.includes('worktrees') ? 'new' : 'old', ...data }));
const O = new Vec3(300, 70, 300);
// The minimal frame along x: bottom (1,0),(2,0), top (1,4),(2,4), sides (0,1..3),(3,1..3).
const SLOTS = [[1, 0], [2, 0], [1, 4], [2, 4], [0, 1], [0, 2], [0, 3], [3, 1], [3, 2], [3, 3]].map(([u, y]) => O.offset(u, y, 0));
const EMPTY = [SLOTS[0], SLOTS[1]];

const bot = mineflayer.createBot({ host: '127.0.0.1', port, username, version: '26.1', auth: 'offline' });
bot.loadPlugin(compatibilityPlugin);
bot.loadPlugin(pathfinder);
bot.on('error', e => log({ error: e.message }));
bot.on('kicked', r => log({ kicked: String(r).slice(0, 200) }));

async function run(n) {
  // The site loaded first: commands at unloaded ground say 'That position is not loaded' and do nothing.
  await command(`gamemode spectator ${username}`); await command(`tp ${username} 301.5 75 297.5`); await sleep(4000);
  for (const c of ['gamerule spawn_mobs false', 'gamerule advance_time false', 'time set noon', 'weather clear', 'difficulty peaceful',
    'kill @e[type=item]', 'fill 285 60 285 320 69 320 stone', 'fill 285 70 285 320 85 320 air',
    ...SLOTS.filter(p => !EMPTY.some(q => q.equals(p))).map(p => `setblock ${p.x} ${p.y} ${p.z} obsidian`),
    'fill 309 69 299 310 69 300 lava', 'fill 296 69 304 297 69 305 water',
    `clear ${username}`, `give ${username} water_bucket 1`, `give ${username} bucket 1`, `give ${username} flint_and_steel 1`, `give ${username} iron_pickaxe 1`,
    `give ${username} cooked_beef 16`, `give ${username} cobblestone 64`, `effect give ${username} instant_health 1 5`,
    `tp ${username} 301.5 70 297.5`, `gamemode survival ${username}`]) await command(c);
  await sleep(3000);
  const work = require(path.join(SRC, 'work'));
  const { Task } = require(path.join(SRC, 'skills'));
  const goal = { version: 1, kind: 'win', request: 'beat the game', survival: {},
    landmarks: [{ kind: 'ruined_portal', x: 301, y: 70, z: 300, obsidian: 8, dimension: 'overworld', at: Date.now() }],
    portalMethod: { kind: 'ruin', at: { x: 301, y: 70, z: 300 }, key: 'ruin_0', chosenAt: Date.now(), activeMs: 0, reasked: 0 } };
  bot._goal = goal;
  const task = new Task('ruin-cast');
  const started = Date.now(), steps = {}, errors = {};
  let calls = 0, lit = false;
  const portalBlock = () => [O.offset(1, 1, 0), O.offset(2, 1, 0), O.offset(1, 2, 0)].some(p => bot.blockAt(p)?.name === 'nether_portal');
  while (Date.now() - started < SECONDS * 1000) {
    if (portalBlock()) { lit = true; break; }
    calls++;
    try { await work.portalStep(bot, task, goal, () => {}, null); }
    catch (err) { const k = String(err.message).replace(/-?\d+/g, 'N').slice(0, 100); errors[k] = (errors[k] || 0) + 1; await sleep(500); }
    const a = goal.step?.action || 'none'; steps[a] = (steps[a] || 0) + 1;
    if (calls % 20 === 0) log({ run: n, calls, seconds: Math.round((Date.now() - started) / 1000), step: goal.step?.action, frameCast: !!goal.portalFrame?.cast, standing: SLOTS.filter(p => bot.blockAt(p)?.name === 'obsidian').length });
  }
  lit = lit || portalBlock();
  const standing = SLOTS.filter(p => bot.blockAt(p)?.name === 'obsidian').length;
  log({ run: n, lit, standing, seconds: Math.round((Date.now() - started) / 1000), calls, frameCast: !!goal.portalFrame?.cast, steps, errors });
  return { lit, standing };
}

bot.once('spawn', async () => {
  require(path.join(SRC, 'movement')).configureMovements(bot);
  await sleep(2000);
  const results = [];
  for (let n = 1; n <= RUNS; n++) results.push(await run(n));
  log({ summary: results });
  bot.quit(); setTimeout(() => process.exit(0), 1000);
});
