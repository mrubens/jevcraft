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
  username: process.env.MC_USERNAME || `Food${id}`, version: '26.1', auth: 'offline' });
bot.loadPlugin(compatibilityPlugin); bot.loadPlugin(pathfinder);
const task = new Task('food', 'gather a food reserve');
const timeout = setTimeout(() => { task.cancel(); bot.pathfinder.setGoal(null); bot.clearControlStates(); }, Number(process.env.FOOD_TIMEOUT_MS || 300000));
let minimumHealth = 20, deaths = 0, interval, finishing = false;
bot.on('health', () => { minimumHealth = Math.min(minimumHealth, bot.health); log({ health: bot.health, food: bot.food }); });
bot.on('death', () => { deaths++; log({ death: true }); task.cancel(); });
bot.on('error', err => log({ error: err.message }));
bot.on('end', reason => {
  if (!finishing) {
    log({ result: 'FAIL', reason: `Disconnected: ${reason}`, directory });
    clearTimeout(timeout); clearInterval(interval); process.exitCode = 1;
  }
});
bot.once('spawn', async () => {
  try {
    configureMovements(bot); await bot.waitForChunksToLoad();
    assert.equal(bot.inventory.items().length, 0); assert.equal(bot.game.gameMode, 'survival');
    log({ initial: { inventory: {}, position: bot.entity.position, difficulty: bot.game.difficulty, timeOfDay: bot.time.timeOfDay,
      username: bot.username, scenario: process.env.ACCEPT_SCENARIO || 'controlled' }, directory });
    const goal = { version: 1, kind: 'survive', request: 'Maintain a food reserve between requests', stockFood: true,
      preparingExpedition: process.env.FOOD_EXPEDITION === '1', status: 'running' };
    interval = setInterval(() => log({ position: bot.entity.position, timeOfDay: bot.time.timeOfDay,
      inventory: inventory(bot), action: goal.survivalAction, error: goal.lastError }), 5000);
    await runIdle(bot, task, goal, store, { decisionClient: new TypeSafe(), until: () => foodSupply(bot) >= 12,
      onStep: g => log({ action: g.survivalAction, decision: g.decisions?.at(-1)?.path, error: g.lastError, foodReserve: foodSupply(bot), inventory: inventory(bot), position: bot.entity.position }) });
    assert(foodSupply(bot) >= 12);
    assert.equal(deaths, 0); assert.equal(minimumHealth, 20);
    log({ result: 'PASS', minimumHealth, deaths, foodReserve: foodSupply(bot), inventory: inventory(bot), directory });
  } catch (err) { log({ result: 'FAIL', error: err.stack }); process.exitCode = 1; }
  finally { finishing = true; clearTimeout(timeout); clearInterval(interval); bot.quit(); setTimeout(() => process.exit(process.exitCode || 0), 500); }
});
