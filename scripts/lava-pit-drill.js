'use strict';
// full-11's death pit (25588, 2026-10-27 20:55:49Z), block for block from its saved world, 200 east and south on the
// arena: a lava pool one deep on stone, water a step west and a block up at its edge. ArenaJev is put where full-11
// burned, (527.3, 64.6, 605.7), with what it carried (128 cobblestone, 2 lava buckets, 2 buckets, an iron pickaxe),
// and the real lava escape runs (lava-escape.js escape through survival's controller). Each run: the way taken, the
// seconds in lava, the health left. SRC picks the code (the worktree's by default).
//   ARENA_DIR=$HOME/Code/jevcraft/.test-combat MC_PORT=25574 node scripts/lava-pit-drill.js
const fs = require('fs'), path = require('path');
const mineflayer = require('mineflayer');
const { pathfinder } = require('mineflayer-pathfinder');
const SRC = process.env.SRC || path.join(__dirname, '..', 'src');
const { compatibilityPlugin } = require(path.join(SRC, 'compatibility'));
const port = Number(process.env.MC_PORT || 25574);
if (port !== 25574) throw new Error('The lava-pit drill needs the arena port');
const consolePath = path.join(process.env.ARENA_DIR || path.join(__dirname, '..', '.test-combat'), 'console.in');
const username = 'ArenaJev', RUNS = Number(process.env.DRILL_RUNS || 3);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const send = async lines => { for (let i = 0; i < lines.length; i += 40) { fs.writeFileSync(consolePath, lines.slice(i, i + 40).join('\n') + '\n'); await sleep(400); } };
const log = data => console.log(JSON.stringify({ at: new Date().toISOString(), src: SRC.includes('worktrees') ? 'new' : 'old', ...data }));
const PIT = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'lava-pit-full11.json'), 'utf8'));
// The water in the saved map came after the death (placed beside the lava it turns the bot's cell to obsidian): the
// pit as it burned is the lava alone, the water cells left as air (WITH_WATER=1 puts them back).
const solid = PIT.filter(c => !/(air|water|lava)$/.test(c)), air = PIT.filter(c => /air$/.test(c) || (!process.env.WITH_WATER && /water$/.test(c))).map(c => c.replace(/minecraft:water$/, 'minecraft:air')), fluid = PIT.filter(c => /lava$/.test(c) || (process.env.WITH_WATER && /water$/.test(c)));
const lines = [];
const bot = mineflayer.createBot({ host: '127.0.0.1', port, username, version: '26.1', auth: 'offline' });
bot.loadPlugin(compatibilityPlugin); bot.loadPlugin(pathfinder);
bot.on('error', e => log({ error: e.message }));
const logOrig = console.log;

async function run(n) {
  await send([`gamemode spectator ${username}`, `tp ${username} 527.5 72 605.5`]); await sleep(4000);
  await send(['gamerule spawn_mobs false', 'difficulty peaceful', 'time set noon', 'kill @e[type=item]', 'fill 518 60 596 537 75 615 stone', 'fill 518 69 596 537 75 615 air']);
  await send(solid); await send(air); await send(fluid); await sleep(2500);
  await send([`clear ${username}`, `give ${username} cobblestone 128`, `give ${username} lava_bucket 2`, `give ${username} bucket 2`, `give ${username} iron_pickaxe 1`,
    `give ${username} cooked_mutton 3`, `tp ${username} ${process.env.START || "527.3 64.6 605.7"}`, `gamemode survival ${username}`, `effect give ${username} instant_health 1 5`]);
  await sleep(1500);
  const { createSurvival } = require(path.join(SRC, 'work'));
  const { Task } = require(path.join(SRC, 'skills'));
  const goal = { version: 1, kind: 'win', request: 'beat the game', survival: {} };
  bot._goal = goal;
  const survival = createSurvival(bot, {});
  const inLava = () => [0, 1].some(dy => /lava/.test(bot.blockAt(bot.entity.position.floored().offset(0, dy, 0))?.name || ''));
  // As full-11 was (its work preempted 'digging stone'): a dig of the stone beside the head begun and not awaited
  // (DIGGING=1), the escape run while it goes on.
  if (process.env.DIGGING) {
    const { Vec3 } = require('vec3');
    const wall = [[-1, 1, 0], [0, 1, -1], [1, 1, 0], [0, 1, 1], [-1, 0, 0], [0, 0, -1]].map(([x, y, z]) => bot.entity.position.floored().offset(x, y, z)).find(p => /stone|diorite|gravel|cobblestone/.test(bot.blockAt(p)?.name || ''));
    if (wall) { const pick = bot.inventory.items().find(i => i.name === 'iron_pickaxe'); if (pick) await bot.equip(pick, 'hand').catch(() => {}); bot.dig(bot.blockAt(wall)).catch(() => {}); await sleep(150); log({ run: n, digging: wall, targetDigBlock: !!bot.targetDigBlock }); }
  }
  // An equip that does not come back (EQUIP_HANG=ms), as full-11's inventory was 9 seconds before it burned.
  const realEquip = bot.equip.bind(bot);
  if (process.env.EQUIP_HANG) bot.equip = (...a) => new Promise(r => setTimeout(() => r(realEquip(...a)), Number(process.env.EQUIP_HANG)));
  const t0 = Date.now(), hp0 = bot.health;
  log({ run: n, start: bot.entity.position.floored(), inLava: inLava(), feet: bot.blockAt(bot.entity.position.floored())?.name, health: hp0 });
  lines.length = 0; console.log = (...a) => { const s = a.join(' '); if (/lava|escape|\[body\]/i.test(s)) lines.push(s.slice(0, 240)); };
  try { await require(path.join(SRC, 'lava-escape')).escape(survival, new Task('lava-drill'), goal, () => {}); }
  catch (err) { lines.push(`threw: ${err.message}`); }
  finally { console.log = logOrig; bot.equip = realEquip; }
  let out = !inLava(); const waitUntil = Date.now() + 3000;
  while (!out && Date.now() < waitUntil && !bot.isDead) { await sleep(200); out = !inLava(); }
  log({ run: n, out, seconds: Math.round((Date.now() - t0) / 100) / 10, health: Math.round(bot.health * 10) / 10, at: bot.entity.position.floored(), lines });
  if (bot.health <= 0 || bot.isDead) await sleep(4000);
  return { out, health: Math.round(bot.health * 10) / 10 };
}
bot.once('spawn', async () => {
  require(path.join(SRC, 'movement')).configureMovements(bot);
  await sleep(2000);
  const results = [];
  for (let n = 1; n <= RUNS; n++) results.push(await run(n));
  log({ summary: results });
  bot.quit(); setTimeout(() => process.exit(0), 1000);
});
