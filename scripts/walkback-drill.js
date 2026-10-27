'use strict';
// The walk back for the drops, the live way (note 2287): the bot is kitted, a zombie that cannot move or pick things up
// stands two blocks from where it dies, it dies, comes back to life 40 blocks off, walks back to the death cell and runs
// the real pickup (drop-collection.js collectNearbyDrops) for each thing it dropped. DRILL_MODE=old runs the pickup as
// it was (drops near a hostile filtered out), DRILL_MODE=new as the walk back now does (hostilesOk). Each run says what
// was dropped, what the pickup took, and the pickup's own line of why when it took nothing (note 2285).
//   ARENA_DIR=$HOME/Code/jevcraft/.test-combat MC_PORT=25574 DRILL_MODE=new node scripts/walkback-drill.js
const fs = require('fs'), path = require('path');
const mineflayer = require('mineflayer');
const { pathfinder, goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { compatibilityPlugin } = require('../src/compatibility');
const port = Number(process.env.MC_PORT || 25574);
if ([25565, 25570, 25576, 25577, 25578, 25579].includes(port) || (port >= 25581 && port <= 25610)) throw new Error('The walk-back drill needs the arena port');
const consolePath = path.join(process.env.ARENA_DIR || path.join(__dirname, '..', '.test-combat'), 'console.in');
const username = process.env.ARENA_USER || 'ArenaJev';
const MODE = process.env.DRILL_MODE === 'old' ? 'old' : 'new', RUNS = Number(process.env.DRILL_RUNS || 2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function command(line) { fs.writeFileSync(consolePath, line + '\n'); await sleep(250); }
const log = data => console.log(JSON.stringify({ at: new Date().toISOString(), mode: MODE, ...data }));
const KIT = ['iron_sword', 'iron_pickaxe', 'shield', 'cooked_beef', 'raw_iron'];
const WORN = { head: 'iron_helmet', chest: 'iron_chestplate', legs: 'iron_leggings', feet: 'iron_boots' };
const DEATH = new Vec3(100, 70, 100), RESPAWN = new Vec3(140, 70, 100);
const count = (bot, name) => bot.inventory.items().filter(i => i.name === name).reduce((n, i) => n + i.count, 0) + [5, 6, 7, 8, 45].filter(s => bot.inventory.slots?.[s]?.name === name).length;
const task = { check() {}, cancelled: false, label: 'walkback-drill' };

const bot = mineflayer.createBot({ host: '127.0.0.1', port, username, version: '26.1', auth: 'offline' });
bot.loadPlugin(compatibilityPlugin);
bot.loadPlugin(pathfinder);
bot.on('error', e => log({ error: e.message }));
bot.on('kicked', r => log({ kicked: String(r).slice(0, 200) }));

async function run(n) {
  for (const c of ['gamerule spawn_mobs false', 'gamerule advance_time false', 'gamerule keep_inventory false', 'gamerule immediate_respawn true', 'time set noon', 'weather clear', 'difficulty normal',
    `gamemode survival ${username}`, 'kill @e[type=zombie]', 'kill @e[type=item]', 'fill 85 60 85 155 69 115 stone', 'fill 85 70 85 155 80 115 air',
    `clear ${username}`, ...Object.entries(WORN).map(([slot, item]) => `item replace entity ${username} armor.${slot} with ${item}`),
    ...KIT.map(i => `give ${username} ${i} ${i === 'cooked_beef' ? 8 : i === 'raw_iron' ? 4 : 1}`), `effect give ${username} instant_health 1 5`,
    `spawnpoint ${username} ${RESPAWN.x} ${RESPAWN.y} ${RESPAWN.z}`, `tp ${username} ${DEATH.x + 0.5} ${DEATH.y} ${DEATH.z + 0.5}`,
    `summon zombie ${DEATH.x + 2.5} ${DEATH.y} ${DEATH.z + 0.5} {NoAI:1b,PersistenceRequired:1b,CanPickUpLoot:0b,Silent:1b}`]) await command(c);
  await sleep(2000);
  const before = Object.fromEntries([...KIT, ...Object.values(WORN)].map(i => [i, count(bot, i)]));
  const respawned = new Promise(r => bot.once('respawn', r));
  await command(`kill ${username}`);
  await Promise.race([respawned, sleep(8000)]); await sleep(2500);
  const lying = Object.values(bot.entities).filter(e => { try { return e.getDroppedItem?.(); } catch (_) { return false; } }).length;
  log({ run: n, dropped: before, at: bot.entity.position.floored(), itemsSeenFromRespawn: lying });
  // The walk back, sprinted, as the corpse run's legs go.
  bot.pathfinder.movements.allowSprinting = true;
  const t0 = Date.now();
  // The walk the corpse run's legs make (skills.js navigate, sprinted; hostilesOk as the walk back now passes it, note 2288).
  try { await require('../src/skills').navigate(bot, task, new goals.GoalNear(DEATH.x, DEATH.y, DEATH.z, 3), { timeoutMs: 30000, stallMs: 8000, sprint: true, hostilesOk: MODE === 'new' }); }
  catch (e) { log({ run: n, walk: String(e.message).slice(0, 120) }); }
  // The walk is not what is drilled: where the arena's pathing fails, the bot is put three blocks from the death cell.
  const reached = bot.entity.position.distanceTo(DEATH) <= 4;
  log({ run: n, walkReachedTheSpot: reached });
  if (!reached) { await command(`tp ${username} ${DEATH.x - 2.5} ${DEATH.y} ${DEATH.z + 0.5}`); await sleep(1500); }
  log({ run: n, walkedSeconds: Math.round((Date.now() - t0) / 100) / 10, at: bot.entity.position.floored() });
  const { collectNearbyDrops } = require('../src/drop-collection');
  const got = {};
  for (const name of [...Object.values(WORN), ...KIT]) {
    const had = count(bot, name);
    try { await collectNearbyDrops(bot, task, name, { origin: DEATH, radius: 12, timeoutMs: 12000, allowExcavation: true, hostilesOk: MODE === 'new' }); }
    catch (e) { log({ run: n, item: name, error: String(e.message).slice(0, 120) }); }
    got[name] = count(bot, name) - had;
  }
  const left = Object.values(bot.entities).map(e => { let it = null; try { it = e.getDroppedItem?.(); } catch (_) {} return it && e.position ? `${it.name}x${it.count}@${Math.round(e.position.distanceTo(DEATH) * 10) / 10}/${Math.round(e.position.distanceTo(bot.entity.position) * 10) / 10}` : null; }).filter(Boolean);
  log({ run: n, stillLying: left, botAt: bot.entity.position.floored() });
  for (const name of Object.keys(got)) got[name] = count(bot, name);
  const total = Object.values(got).reduce((a, b) => a + b, 0), wanted = Object.values(before).reduce((a, b) => a + b, 0);
  log({ run: n, got, total, of: wanted });
  return { total, wanted };
}

bot.once('spawn', async () => {
  require('../src/movement').configureMovements(bot);
  await sleep(2000);
  const results = [];
  for (let n = 1; n <= RUNS; n++) results.push(await run(n));
  log({ summary: results });
  bot.quit(); setTimeout(() => process.exit(0), 1000);
});
