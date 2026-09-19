'use strict';
// Controlled water-covered obsidian and dry bank; no natural acceptance claim.
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const mineflayer = require('mineflayer');
const { pathfinder } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { compatibilityPlugin } = require('../src/compatibility');
const { configureMovements } = require('../src/movement');
const { Task, countOf } = require('../src/skills');
const { acquireStep, waitFor, inventory } = require('../src/work');
const id = Date.now().toString(36), username = `Dry${id}`;
const directory = path.join(__dirname, '..', 'artifacts', `dry-mining-${id}`);
fs.mkdirSync(directory, { recursive: true });
const log = data => { const line = JSON.stringify({ at: new Date().toISOString(), ...data }); console.log(line); fs.appendFileSync(path.join(directory, 'events.jsonl'), line + '\n'); };
const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25574, username, version: '26.1', auth: 'offline' });
bot.loadPlugin(compatibilityPlugin); bot.loadPlugin(pathfinder);
const task = new Task('dry mining', 'collect water-covered obsidian from a dry bank');
const timer = setTimeout(() => task.cancel(), 240000);
bot.on('error', err => log({ error: err.message }));
bot.once('spawn', async () => {
  let observe;
  try {
    await bot.waitForChunksToLoad(); configureMovements(bot);
    const commands = ['fill 22 62 -2 30 64 2 minecraft:glass', 'setblock 24 63 0 minecraft:obsidian',
      'setblock 24 64 0 minecraft:water', `tp ${username} 28.5 65 0.5`, `give ${username} minecraft:diamond_pickaxe 1`];
    const ready = path.join(directory, 'setup-ready');
    fs.writeFileSync(path.join(directory, 'setup.json'), JSON.stringify(commands, null, 2));
    log({ scenario: 'controlled water-covered obsidian', commands, ready, directory });
    await waitFor(task, () => fs.existsSync(ready), 180000);
    await waitFor(task, () => bot.entity.position.y === 65 && countOf(bot, 'diamond_pickaxe') === 1);
    assert.equal(bot.game.gameMode, 'survival'); assert.equal(countOf(bot, 'obsidian'), 0);
    assert.equal(bot.blockAt(new Vec3(24, 63, 0)).name, 'obsidian');
    assert.equal(bot.blockAt(new Vec3(24, 64, 0)).name, 'water');
    let minimumAir = 20, submergedHead = false;
    observe = () => {
      minimumAir = Math.min(minimumAir, bot.oxygenLevel);
      submergedHead ||= bot.blockAt(bot.entity.position.offset(0, 1.62, 0).floored())?.name === 'water';
    };
    bot.on('physicsTick', observe);
    const goal = {}, save = () => fs.writeFileSync(path.join(directory, 'goal.json'), JSON.stringify(goal, null, 2));
    await acquireStep(bot, task, 'obsidian', 1, goal, save);
    await waitFor(task, () => countOf(bot, 'obsidian') === 1, 5000);
    assert.equal(minimumAir, 20); assert.equal(submergedHead, false); assert.equal(bot.health, 20);
    log({ result: 'PASS', minimumAir, submergedHead, position: bot.entity.position, inventory: inventory(bot), health: bot.health, directory });
  } catch (err) { log({ result: 'FAIL', error: err.stack, position: bot.entity?.position, inventory: inventory(bot), directory }); process.exitCode = 1; }
  finally { if (observe) bot.removeListener('physicsTick', observe); clearTimeout(timer); bot.pathfinder.setGoal(null); bot.quit(); setTimeout(() => process.exit(process.exitCode || 0), 500); }
});
