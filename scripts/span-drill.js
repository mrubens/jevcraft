'use strict';
// A walk along a one-wide span with a turn, high over the arena's flat
// ground (note 1350): the live bot's movements and navigate, as the walk to a
// portal at a span's end goes (work.js enterPortal: GoalNear the portal,
// within one). 25591 (2026-10-06 05:15Z) walked its own span of cobblestone
// to its portal over the warped forest and fell from y 54 to the lava at 30,
// a block short of the frame, the span's cell beside its feet. Staged through
// the arena's console pipe; each run: the span built, the bot set at its
// start, the walk asked, a fall counted when the feet drop four below it.
//   ARENA_DIR=$HOME/Code/jevcraft/.test-combat MC_PORT=25574 SPAN_RUNS=8 node scripts/span-drill.js
const fs = require('fs'), path = require('path');
const mineflayer = require('mineflayer'), { pathfinder, goals } = require('mineflayer-pathfinder');
const { compatibilityPlugin } = require('../src/compatibility');
const { configureMovements } = require('../src/movement');
const { Task, navigate } = require('../src/skills');
const { arenaDir } = require('./lib/arena');

const port = Number(process.env.MC_PORT || 25574);
if (port !== 25574 && !process.env.ARENA_PORT_OK) throw new Error('The span drill runs on the arena port');
const consolePath = path.join(arenaDir(), 'console.in');
const username = process.env.ARENA_USER || 'ArenaJev';
const runs = Number(process.env.SPAN_RUNS || 8);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const command = async line => { fs.writeFileSync(consolePath, line + '\n'); await sleep(150); };
// The span: from (X, Y, Z) six east, then six north, a pad of 3x3 at each end.
const X = 3000, Y = 120, Z = 3000;
const bot = mineflayer.createBot({ host: '127.0.0.1', port, username, version: '26.1', auth: 'offline' });
bot.loadPlugin(compatibilityPlugin); bot.loadPlugin(pathfinder);
bot.once('spawn', async () => {
  const out = [];
  try {
    await bot.waitForChunksToLoad(); configureMovements(bot);
    await command(`gamemode survival ${username}`);
    for (let n = 1; n <= runs; n++) {
      await command(`execute in minecraft:overworld run fill ${X - 2} ${Y - 1} ${Z - 8} ${X + 9} ${Y + 3} ${Z + 2} air`);
      await command(`execute in minecraft:overworld run fill ${X - 1} ${Y - 1} ${Z - 1} ${X + 1} ${Y - 1} ${Z + 1} cobblestone`);
      await command(`execute in minecraft:overworld run fill ${X + 2} ${Y - 1} ${Z} ${X + 6} ${Y - 1} ${Z} cobblestone`);
      await command(`execute in minecraft:overworld run fill ${X + 6} ${Y - 1} ${Z - 1} ${X + 6} ${Y - 1} ${Z - 6} cobblestone`);
      await command(`execute in minecraft:overworld run fill ${X + 5} ${Y - 1} ${Z - 7} ${X + 7} ${Y - 1} ${Z - 7} cobblestone`);
      // SPAN_PORTAL=1: 25591's own approach, rebuilt (2026-10-06 05:15Z): a span
      // down x 29 from z 49 to 51, cells at (28, 52) and (29, 52), and the portal's
      // frame on z 53 (obsidian x 27 to 30, its sheet x 28 and 29), walked to the
      // portal cell within one, as enterPortal walks.
      if (process.env.SPAN_PORTAL) {
        await command(`execute in minecraft:overworld run fill ${X - 3} ${Y - 2} ${Z - 10} ${X + 6} ${Y + 5} ${Z + 6} air`);
        const bx = X - 29, bz = Z - 49; // the map's (29, 53, 49) at the drill's (X, Y-1, Z)
        const P = (x, y, z) => `${x + bx} ${y - 53 + Y - 1} ${z + bz}`;
        await command(`execute in minecraft:overworld run fill ${P(29, 53, 46)} ${P(29, 53, 51)} cobblestone`);
        await command(`execute in minecraft:overworld run fill ${P(28, 53, 52)} ${P(29, 53, 52)} cobblestone`);
        await command(`execute in minecraft:overworld run fill ${P(27, 53, 53)} ${P(30, 53, 53)} obsidian`);
        await command(`execute in minecraft:overworld run fill ${P(27, 54, 53)} ${P(27, 56, 53)} obsidian`);
        await command(`execute in minecraft:overworld run fill ${P(30, 54, 53)} ${P(30, 56, 53)} obsidian`);
        await command(`execute in minecraft:overworld run fill ${P(27, 57, 53)} ${P(30, 57, 53)} obsidian`);
        await command(`execute in minecraft:overworld run fill ${P(28, 54, 53)} ${P(29, 56, 53)} nether_portal[axis=x]`);
        process.env.SPAN_GOAL = P(28, 54, 53);
        process.env.SPAN_START = P(29, 54, 46);
      }
      await command(`effect give ${username} minecraft:resistance 5 255 true`);
      const start = (process.env.SPAN_START || `${X} ${Y} ${Z}`).split(' ').map(Number);
      await command(`execute in minecraft:overworld run tp ${username} ${start[0] + 0.5} ${start[1]} ${start[2] + 0.5} 0 0`);
      await sleep(1500);
      await bot.waitForChunksToLoad();
      const task = new Task('span drill');
      let fell = false, lowest = bot.entity.position.y;
      const watch = setInterval(() => { lowest = Math.min(lowest, bot.entity.position.y); if (bot.entity.position.y < Y - 4) { fell = true; task.cancel(); } }, 50);
      const started = Date.now();
      let error = null;
      const g = (process.env.SPAN_GOAL || `${X + 6} ${Y} ${Z - 7}`).split(' ').map(Number);
      try { await navigate(bot, task, new goals.GoalNear(g[0], g[1], g[2], 1), { timeoutMs: 20000 }); }
      catch (err) { error = String(err.message || err).slice(0, 120); }
      clearInterval(watch);
      const p = bot.entity.position;
      const r = { run: n, fell, arrived: !fell && Math.hypot(p.x - (Number((process.env.SPAN_GOAL || `${X + 6} ${Y} ${Z - 7}`).split(' ')[0]) + 0.5), p.z - (Number((process.env.SPAN_GOAL || `${X + 6} ${Y} ${Z - 7}`).split(' ')[2]) + 0.5)) <= 1.8, seconds: Math.round((Date.now() - started) / 100) / 10, end: [p.x, p.y, p.z].map(v => Math.round(v * 10) / 10), error };
      out.push(r); console.log(JSON.stringify(r));
      if (fell) { await command(`effect give ${username} minecraft:slow_falling 30 0 true`); await sleep(500); }
    }
  } catch (err) { console.log(JSON.stringify({ error: String(err.stack || err).slice(0, 300) })); }
  console.log(JSON.stringify({ summary: { runs: out.length, fell: out.filter(r => r.fell).length, arrived: out.filter(r => r.arrived).length } }));
  bot.quit(); setTimeout(() => process.exit(0), 500);
});
