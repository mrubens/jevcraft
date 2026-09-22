'use strict';
// Why does the bot ignore that mob? The arena had it stand still with a
// wither skeleton five blocks away and no action at all, so this asks the
// danger layer, entity by entity, what it thinks it is looking at.
//
//   MC_PORT=25574 node scripts/threat-probe.js wither_skeleton
const path = require('path');
const fs = require('fs');
const mineflayer = require('mineflayer');
const { pathfinder } = require('mineflayer-pathfinder');
const { compatibilityPlugin } = require('../src/compatibility');
const { hostileEntities, threats, immediateThreat } = require('../src/danger');
const { observedDead } = require('../src/mob-policy');

const port = Number(process.env.MC_PORT || 25574);
if ([25565, 25570, 25577, 25579].includes(port)) throw new Error('Not on a live world');
const entity = process.argv[2] || 'wither_skeleton';
const consolePath = process.env.ARENA_CONSOLE || path.join(__dirname, '..', '.test-combat', 'console.in');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const command = async line => { fs.writeFileSync(consolePath, line + '\n'); await sleep(200); };
const stand = process.env.ARENA_PROBE_AT || '3000.5 77 3000.5';
const [sx, sy, sz] = stand.split(/\s+/).map(Number);
const spawn = process.env.ARENA_PROBE_SPAWN || `${sx + 5} ${sy} ${sz}`;
const bot = mineflayer.createBot({ host: '127.0.0.1', port, username: 'Probe', version: '26.1', auth: 'offline' });
bot.loadPlugin(compatibilityPlugin); bot.loadPlugin(pathfinder);

bot.once('spawn', async () => {
  await bot.waitForChunksToLoad();
  await command('op Probe');
  await command('gamerule doMobSpawning false');
  await command('execute in minecraft:the_nether run forceload add 2900 2900 3100 3100');
  await sleep(600);
  // A small sealed pad of its own, away from the drill arenas.
  if (!process.env.ARENA_PROBE_AT) {
    await command('execute in minecraft:the_nether run fill 2990 70 2990 3010 84 3010 minecraft:netherrack');
    await command('execute in minecraft:the_nether run fill 2991 77 2991 3009 81 3009 minecraft:air');
  }
  await command(`execute in minecraft:the_nether run kill @e[type=!minecraft:player,x=${sx - 12},y=${sy - 6},z=${sz - 12},dx=24,dy=14,dz=24]`);
  // Somewhere else to stand: the corridor drill had the bot ignore a mob
  // the open pad answered at once, so the pad must be able to become the
  // corridor. ARENA_PROBE_AT="2042.5 77 2003.5" stands in the real one.
  await command(`execute in minecraft:the_nether run tp Probe ${stand}`);
  await sleep(1500);
  await bot.waitForChunksToLoad();
  console.log(JSON.stringify({ dimension: bot.game.dimension, gameMode: bot.game.gameMode, difficulty: bot.game.difficulty, at: bot.entity.position }));
  await command(`execute in minecraft:the_nether run summon minecraft:${entity} ${spawn} {PersistenceRequired:1b,Tags:["probe"]}`);
  await sleep(2000);

  for (let round = 0; round < 8; round++) {
    const all = Object.values(bot.entities).filter(e => e.name === entity);
    const hostile = hostileEntities(bot, 32);
    const seen = threats(bot, 32);
    const now = immediateThreat(bot);
    console.log(JSON.stringify({
      round,
      // Everything the world says about it, then everything the danger
      // layer concludes: the disagreement between the two is the bug.
      entities: all.map(e => ({ id: e.id, name: e.name, distance: Math.round(e.position.distanceTo(bot.entity.position) * 10) / 10,
        health: e.metadata?.[9], metadataSet: Object.keys(e.metadata || {}).length, dead: observedDead(bot, e), valid: e.isValid })),
      countedHostile: hostile.length,
      threats: seen.map(t => ({ name: t.entity.name, distance: Math.round(t.distance * 10) / 10, visible: t.visible })),
      immediate: now ? { name: now.entity.name, distance: Math.round(now.distance * 10) / 10 } : null,
      botHealth: bot.health,
      // The room itself: a mob that will not path needs somewhere to walk.
      headroom: [0, 1, 2, 3].map(dy => bot.blockAt(bot.entity.position.offset(0, dy, 0))?.name),
    }));
    await sleep(2500);
  }
  await command('execute in minecraft:the_nether run kill @e[tag=probe]');
  bot.quit();
  setTimeout(() => process.exit(0), 400);
});
bot.on('error', err => { console.log(JSON.stringify({ error: err.message })); });
