'use strict';
require('../src/env').loadEnv();
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mineflayer = require('mineflayer');
const { pathfinder } = require('mineflayer-pathfinder');
const { configureMovements } = require('../src/movement');
const { compatibilityPlugin } = require('../src/compatibility');
const { TypeSafe } = require('../src/typesafe');
const { GoalStore } = require('../src/objectives');
const { Task } = require('../src/skills');
const { runIdle, inventory } = require('../src/work');
const { foodSupply } = require('../src/foraging');
const id = Date.now().toString(36);
const directory = path.join(__dirname, '..', 'artifacts', `food-${id}`);
fs.mkdirSync(directory, { recursive: true });
const store = new GoalStore(path.join(directory, 'goal.json'));
const log = entry => { const line = JSON.stringify({ at: new Date().toISOString(), ...entry }); console.log(line); fs.appendFileSync(path.join(directory, 'events.jsonl'), line + '\n'); };
const bot = mineflayer.createBot({ host: process.env.MC_HOST || 'localhost', port: Number(process.env.MC_PORT || 25567),
  username: `Food${id}`, version: '26.1', auth: 'offline' });
bot.loadPlugin(compatibilityPlugin); bot.loadPlugin(pathfinder);
const task = new Task('food', 'gather a food reserve');
const timeout = setTimeout(() => { task.cancel(); bot.pathfinder.setGoal(null); bot.clearControlStates(); }, 300000);
let minimumHealth = 20;
bot.on('health', () => { minimumHealth = Math.min(minimumHealth, bot.health); log({ health: bot.health, food: bot.food }); });
bot.on('death', () => { log({ death: true }); task.cancel(); });
bot.on('error', err => log({ error: err.message }));
bot.once('spawn', async () => {
  try {
    configureMovements(bot); await bot.waitForChunksToLoad();
    assert.equal(bot.inventory.items().length, 0); assert.equal(bot.game.gameMode, 'survival');
    log({ initial: { inventory: {}, position: bot.entity.position, difficulty: bot.game.difficulty, scenario: process.env.ACCEPT_SCENARIO || 'controlled' } });
    const goal = { version: 1, kind: 'survive', request: 'Maintain a food reserve between requests', stockFood: true, status: 'running' };
    await runIdle(bot, task, goal, store, { decisionClient: new TypeSafe(), until: () => foodSupply(bot) >= 12,
      onStep: g => log({ action: g.survivalAction, decision: g.decisions?.at(-1)?.path, error: g.lastError, foodReserve: foodSupply(bot), inventory: inventory(bot), position: bot.entity.position }) });
    assert(foodSupply(bot) >= 12);
    assert.equal(minimumHealth, 20);
    log({ result: 'PASS', minimumHealth, foodReserve: foodSupply(bot), inventory: inventory(bot) });
  } catch (err) { log({ result: 'FAIL', error: err.stack }); process.exitCode = 1; }
  finally { clearTimeout(timeout); bot.quit(); setTimeout(() => process.exit(process.exitCode || 0), 500); }
});
