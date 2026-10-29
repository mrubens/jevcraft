'use strict';
// The pickup, fuzzed (2026-10-29, the user: 'Can we do something to fuzz all of the different pickup situations in an
// arena or something? ... Makes me nervous that this part doesn't work reliably'). Each case builds a small scene in the
// sky over the arena's overworld, summons a diamond where the case puts it, and runs the bot's own pickup
// (drop-collection.js collectNearbyDrops, allowExcavation as the mining callers pass it). The column is taken or not,
// the seconds, and the pickup's own words; a table by case at the end.
//   ARENA_DIR=$HOME/Code/jevcraft/.test-combat MC_PORT=25574 PICKUP_TRIALS=3 node scripts/pickup-drill.js [case ...]
const fs = require('fs'), path = require('path');
const mineflayer = require('mineflayer');
const { pathfinder } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { compatibilityPlugin } = require('../src/compatibility');
const { configureMovements } = require('../src/movement');
const { Task } = require('../src/skills');

const port = Number(process.env.MC_PORT || 25574);
if ([25565, 25570, 25576, 25577, 25578, 25579].includes(port) || (port >= 25581 && port <= 25610)) throw new Error('The pickup drill needs the arena port');
const consolePath = process.env.ARENA_CONSOLE || path.join(process.env.ARENA_DIR || path.join(__dirname, '..', '.test-combat'), 'console.in');
const username = process.env.ARENA_USER || 'ArenaJev';
const trials = Number(process.env.PICKUP_TRIALS || 3);
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function command(line) { fs.writeFileSync(consolePath, line + '\n'); await sleep(150); }
const log = data => console.log(JSON.stringify({ at: new Date().toISOString(), ...data }));
const X = 300, Z = 300, G = 150; // the floor's top at y G, the bot's feet at G + 1

// Each case: build(dx) -> the drop's cell (relative to the bot's cell) and any setup; dx the trial's random turn.
const CASES = {
  flat3: () => ({ at: [3, 0, 0] }),
  flat6: () => ({ at: [6, 0, 1] }),
  diagonal: () => ({ at: [2, 0, 2] }),
  under_feet: () => ({ at: [0, 0, 0] }),
  step_up1: () => ({ at: [3, 1, 0], fill: [[3, 0, 0, 3, 0, 0, 'stone']] }),
  ledge_up3: () => ({ at: [2, 3, 0], fill: [[2, 0, 0, 2, 2, 0, 'stone']] }),
  ledge_up3_far: () => ({ at: [4, 3, 0], fill: [[3, 0, -1, 5, 2, 1, 'stone']] }),
  pit_down2: () => ({ at: [2, -2, 0], fill: [[2, -2, 0, 2, -1, 0, 'air']] }),
  pit_down3_diag: () => ({ at: [-2, -3, -2], fill: [[-2, -3, -2, -2, -1, -2, 'air']] }),
  pit_down3_shaft: () => ({ at: [-2, -3, -2], fill: [[-2, -3, -2, -2, -1, -2, 'air'], [-1, -3, -2, -1, -1, -2, 'air']] }),
  behind_wall: () => ({ at: [3, 0, 0], fill: [[2, 0, -2, 2, 2, 2, 'stone']] }),
  walled_in: () => ({ at: [3, 0, 0], fill: [[2, -1, -1, 4, 2, 1, 'stone'], [3, 0, 0, 3, 1, 0, 'air']] }),
  in_water: () => ({ at: [2, 0, 0], fill: [[1, -1, -1, 3, 0, 1, 'water']] }),
  deep_water: () => ({ at: [3, -2, 0], fill: [[2, -3, -1, 4, 0, 1, 'water']] }),
  // A dug ore's cells flooded, one wide and two deep, beside the bot (full-123, 2026-10-29 21:3xZ: 'the raw iron lies in
  // water 1 under the bot: swum down to', then 'No route', 'reached, not picked up').
  water_shaft: () => ({ at: [1, -1, 0], fill: [[1, -1, 0, 1, 0, 0, 'water']] }),
  water_shaft_deep: () => ({ at: [1, -2, 0], fill: [[1, -2, 0, 1, 0, 0, 'water']] }),
  tunnel_corner: () => ({ at: [3, 0, 3], fill: [[-1, -1, -1, 4, 3, 4, 'stone'], [0, 0, 0, 3, 1, 0, 'air'], [3, 0, 0, 3, 1, 3, 'air']] }),
  full_inventory: () => ({ at: [2, 0, 0], full: true }),
  on_gravel_pillar: () => ({ at: [2, 2, 0], fill: [[2, 0, 0, 2, 1, 0, 'gravel']] }),
  // Ore mined by the bot's own in-passing dig, then the pickup as the mining callers run it: the drop pops out of the
  // block with its own push and lands where it lands (the live misses' shape).
  ore_wall_eye: () => ({ at: [2, 1, 0], ore: 'diamond_ore', fill: [[2, -1, -2, 3, 3, 2, 'stone']] }),
  ore_wall_feet: () => ({ at: [2, 0, 0], ore: 'diamond_ore', fill: [[2, -1, -2, 3, 3, 2, 'stone']] }),
  ore_behind_one: () => ({ at: [3, 1, 0], ore: 'diamond_ore', fill: [[2, -1, -2, 4, 3, 2, 'stone']] }),
  ore_overhead_shaft: () => ({ at: [0, 3, 1], ore: 'diamond_ore', fill: [[-2, -1, -2, 2, 5, 2, 'stone'], [0, 0, 0, 0, 2, 0, 'air']] }),
  ore_below_ledge: () => ({ at: [2, -2, 0], ore: 'diamond_ore', fill: [[1, -3, -1, 3, -1, 1, 'stone'], [1, -1, 0, 1, -1, 0, 'air']] }),
  ore_from_stair: () => ({ at: [2, 3, 0], ore: 'diamond_ore', stand: [0, 1, 0], fill: [[-1, -1, -2, 3, 5, 2, 'stone'], [0, 1, 0, 0, 3, 0, 'air'], [1, 2, 0, 1, 4, 0, 'air']] }),
};

const bot = mineflayer.createBot({ host: '127.0.0.1', port, username, version: '26.1', auth: 'offline' });
bot.loadPlugin(compatibilityPlugin); bot.loadPlugin(pathfinder);
bot.on('error', e => log({ error: e.message }));
bot.on('kicked', r => log({ kicked: String(r).slice(0, 200) }));

const rel = (o, [a, b, c]) => o.offset(a, b, c);
async function stage(name) {
  const spec = CASES[name]();
  for (const line of [`clear ${username}`, `effect clear ${username}`, `gamemode survival ${username}`, `kill @e[type=item,x=${X},y=${G},z=${Z},distance=..40]`, `tp ${username} ${X + 0.5} ${G + 1} ${Z + 0.5}`]) await command(line);
  await command(`fill ${X - 9} ${G - 6} ${Z - 9} ${X + 9} ${G} ${Z + 9} stone`);
  await command(`fill ${X - 9} ${G + 1} ${Z - 9} ${X + 9} ${G + 8} ${Z + 9} air`);
  const o = new Vec3(X, G + 1, Z);
  for (const [x1, y1, z1, x2, y2, z2, block] of spec.fill || []) await command(`fill ${X + x1} ${G + 1 + y1} ${Z + z1} ${X + x2} ${G + 1 + y2} ${Z + z2} ${block}`);
  await command(`give ${username} minecraft:iron_pickaxe 1`);
  await command(`give ${username} minecraft:cobblestone 32`);
  if (spec.full) for (const n of ['dirt', 'andesite', 'diorite', 'granite', 'tuff', 'gravel', 'sand', 'oak_planks', 'birch_planks', 'spruce_planks', 'stick', 'coal', 'cobbled_deepslate', 'oak_log', 'birch_log', 'spruce_log', 'torch', 'flint', 'bone', 'string', 'feather', 'leather', 'wheat_seeds', 'rotten_flesh', 'spider_eye', 'gunpowder', 'redstone', 'lapis_lazuli', 'raw_copper', 'clay_ball', 'brick', 'paper', 'egg']) await command(`give ${username} minecraft:${n} 7`);
  await command(`tp ${username} ${X + 0.5} ${G + 1} ${Z + 0.5}`);
  for (let i = 0; i < 40 && !(bot.entity?.onGround); i++) await sleep(100);
  await bot.waitForChunksToLoad?.(); await sleep(600);
  if (spec.stand) { const s2 = rel(o, spec.stand); await command(`tp ${username} ${s2.x + 0.5} ${s2.y} ${s2.z + 0.5}`); await sleep(800); }
  const at = rel(o, spec.at);
  const had = bot.inventory.items().filter(i => i.name === 'diamond').reduce((s, i) => s + i.count, 0);
  if (spec.ore) { await command(`setblock ${at.x} ${at.y} ${at.z} minecraft:${spec.ore}`); await sleep(500); }
  else { await command(`summon item ${at.x + 0.5} ${at.y + 0.2} ${at.z + 0.5} {Item:{id:"minecraft:diamond",count:1},PickupDelay:10}`); await sleep(700); }
  return { at, full: !!spec.full, ore: !!spec.ore, had };
}

async function trial(name, n) {
  const { at, full, ore, had } = await stage(name);
  const count = () => bot.inventory.items().filter(i => i.name === 'diamond').reduce((s, i) => s + i.count, 0);
  const before = had, started = Date.now();
  const lines = [];
  const orig = console.log; console.log = (...a) => { const s = a.join(' '); if (/^\[(drops|room|loot|climb ore)\]/.test(s)) lines.push(s.slice(0, 220)); };
  let error = null;
  try {
    const task = new Task('pickup_drill', 'the pickup drill');
    if (ore) {
      bot._goal = { kind: 'win' };
      const dug = await require('../src/opportunistic-mining').mineWithinReach(bot, task, { now: Date.now() + 10000, label: 'in the drill' });
      lines.push(`[drill] in-passing dug ${dug}`);
    }
    await require('../src/drop-collection').collectNearbyDrops(bot, task, 'diamond', { origin: bot.entity.position.clone(), radius: 8, timeoutMs: 15000, waitForSpawnMs: 1000, allowExcavation: true });
  } catch (e) { error = String(e.message || e).slice(0, 160); }
  finally { console.log = orig; }
  for (let i = 0; i < 10 && count() === before; i++) await sleep(100);
  const taken = count() > before;
  const r = { case: name, trial: n, taken, seconds: Math.round((Date.now() - started) / 100) / 10, drop: `${at.x - X},${at.y - G - 1},${at.z - Z}`, full, error, said: lines.slice(-3) };
  log(r);
  return r;
}

// PICKUP_LAG=1: the event loop held 2 to 5 s at random every few seconds, as the live bots' were on 2026-10-29 with seven
// runs and the ship suites on the machine (stall-profiler's '[lag] event loop held').
if (process.env.PICKUP_LAG === '1') setInterval(() => { if (Math.random() < 0.5) { const until = Date.now() + 2000 + Math.random() * 3000; while (Date.now() < until) { /* held */ } } }, 4000).unref();
bot.once('spawn', async () => {
  configureMovements(bot);
  await sleep(1500);
  const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(CASES);
  const results = [];
  for (const name of names) for (let n = 1; n <= trials; n++) {
    try { results.push(await trial(name, n)); } catch (e) { log({ case: name, trial: n, crashed: String(e.message || e).slice(0, 200) }); results.push({ case: name, taken: false, seconds: null, error: 'crashed' }); }
  }
  const table = {};
  for (const r of results) { const t = table[r.case] ||= { taken: 0, of: 0, seconds: [] }; t.of++; if (r.taken) { t.taken++; t.seconds.push(r.seconds); } }
  console.log('\ncase                 taken   mean s');
  for (const [k, t] of Object.entries(table)) console.log(`${k.padEnd(20)} ${`${t.taken}/${t.of}`.padEnd(7)} ${t.seconds.length ? (t.seconds.reduce((a, b) => a + b, 0) / t.seconds.length).toFixed(1) : '-'}`);
  bot.quit(); setTimeout(() => process.exit(0), 500);
});
