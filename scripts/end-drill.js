'use strict';
// An End fight drill on the arena server (note 1342): a kit as a trial
// carries it in, staged through the arena's console pipe (no operator), the
// bot set on the main island and the fight run as the live bot runs it
// (fightEndStep, Jev answering). It ends at the dragon's death, the bot's,
// or END_MINUTES (25). What it came to is the last line: minutes, deaths,
// crystals down, the dragon's health, the bot's lowest health.
//
// The arena's End is fought once: restore the world from
// .arena-backup/arena-pre-end (server stopped) for a fresh dragon.
//   END_KIT='stone_sword,bow,arrow:1,cobblestone:128,iron_pickaxe' \
//     ARENA_DIR=$HOME/Code/jevcraft/.test-combat MC_PORT=25574 node scripts/end-drill.js
const fs = require('fs'), path = require('path');
const mineflayer = require('mineflayer'), { pathfinder } = require('mineflayer-pathfinder');
const { compatibilityPlugin } = require('../src/compatibility');
const { configureMovements } = require('../src/movement');
const { Task, navigate, countOf } = require('../src/skills');
const { prepareCombatGear } = require('../src/mob-hunt');
const { fightEndStep } = require('../src/end-combat');
const { watchGameProgress, gameStep, dimension } = require('../src/game-progress');
const { waitFor, inventory } = require('../src/work');
const { arenaDir } = require('./lib/arena');

const port = Number(process.env.MC_PORT || 25574);
if ([25565, 25570, 25576, 25577, 25578, 25579].includes(port) || (port >= 25581 && port <= 25610)) throw new Error('The End drill needs the arena port');
require('../src/env').loadEnv(); const { TypeSafe } = require('../src/typesafe');
const consolePath = process.env.ARENA_CONSOLE || path.join(arenaDir(), 'console.in');
const username = process.env.ARENA_USER || 'ArenaJev';
const minutes = Number(process.env.END_MINUTES || 25);
const kit = (process.env.END_KIT || 'stone_sword,bow,arrow:1,cobblestone:128,iron_pickaxe').split(',').map(s => s.trim()).filter(Boolean)
  .map(s => { const [item, n] = s.split(':'); return { item, count: Number(n || 1) }; });
const id = Date.now().toString(36), directory = path.join(__dirname, '..', 'artifacts', `end-drill-${id}`);
fs.mkdirSync(directory, { recursive: true });
const log = data => { const line = JSON.stringify({ at: new Date().toISOString(), ...data }); console.log(line); fs.appendFileSync(path.join(directory, 'events.jsonl'), line + '\n'); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function command(line) { fs.writeFileSync(consolePath, line + '\n'); await sleep(150); }

const bot = mineflayer.createBot({ host: '127.0.0.1', port, username, version: '26.1', auth: 'offline' });
bot.loadPlugin(compatibilityPlugin); bot.loadPlugin(pathfinder);
const task = new Task('End drill'), client = new TypeSafe();
const timer = setTimeout(() => task.cancel(), minutes * 60000);
const started = Date.now();
let goal, detach, deaths = 0, lowest = 20, finishing = false;
const save = () => fs.writeFileSync(path.join(directory, 'goal.json'), JSON.stringify(goal, null, 2));
const summary = result => ({ result, minutes: Math.round((Date.now() - started) / 6000) / 10, deaths, lowestHealth: Math.round(lowest * 10) / 10,
  crystalsDown: goal?.endCombat?.destroyedCrystals?.length || 0, dragon: goal?.endCombat?.dragon ?? null, shots: goal?.endCombat?.shots?.length || 0,
  arrowsLeft: countOf(bot, 'arrow'), kit: process.env.END_KIT || null, milestones: Object.keys(goal?.gameProgress?.milestones || {}) });
bot.on('death', () => { deaths++; log({ death: true, position: bot.entity?.position }); task.cancel(); });
bot.on('health', () => { lowest = Math.min(lowest, bot.health); });
bot.on('error', err => log({ error: err.message }));
bot.on('end', reason => { if (!finishing) { log({ result: 'FAIL', reason: `Disconnected: ${reason}` }); process.exit(1); } });
bot.once('spawn', async () => {
  try {
    await bot.waitForChunksToLoad(); configureMovements(bot);
    for (const line of [`clear ${username}`, `effect clear ${username}`, `gamemode survival ${username}`, `experience set ${username} 0 levels`,
      ...kit.map(k => `give ${username} ${k.item} ${k.count}`), `execute in minecraft:the_end run tp ${username} 0.5 63 45.5`]) await command(line);
    fs.writeFileSync(path.join(directory, 'kit.json'), JSON.stringify(kit));
    await waitFor(task, () => dimension(bot) === 'end', 30000);
    await bot.waitForChunksToLoad();
    goal = { kind: 'win', request: 'Jev defeat the dragon and return alive', controlled: true };
    detach = watchGameProgress(bot, goal, save); save();
    log({ phase: 'staged', inventory: inventory(bot), position: bot.entity.position });
    await prepareCombatGear(bot, task, goal, save, { acquireStep: async () => { throw new Error('nothing is made in the drill'); } }).catch(err => log({ gear: err.message }));
    await waitFor(task, () => Object.values(bot.entities).some(e => e.name === 'ender_dragon'), 60000);
    for (let step = 0; step < 2000 && !goal.gameProgress?.milestones?.dragon_defeated; step++) {
      await gameStep(bot, task, goal, save, { fight_dragon: (b, t, g, s) => fightEndStep(b, t, g, s, { navigate }, client) });
      if (step % 10 === 0) log({ step: goal.step?.action, health: bot.health, food: bot.food, dragon: goal.endCombat?.dragon, crystalsDown: goal.endCombat?.destroyedCrystals?.length, arrows: countOf(bot, 'arrow') });
    }
    log({ summary: summary(goal.gameProgress?.milestones?.dragon_defeated ? 'WON' : 'STOPPED') });
  } catch (err) {
    log({ summary: summary(deaths ? 'DIED' : task.cancelled ? 'TIME' : 'FAIL'), error: String(err.message || err).slice(0, 300) });
  } finally {
    finishing = true; detach?.(); clearTimeout(timer); try { bot.pathfinder.setGoal(null); bot.clearControlStates(); } catch (_) {}
    bot.quit(); setTimeout(() => process.exit(0), 500);
  }
});
