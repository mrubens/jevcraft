'use strict';
// Prepared terrain and externally induced hunger isolate the real hunting,
// dependency, furnace and eating mechanics. This is not endurance acceptance.
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
const { runIdle, inventory, createSurvival } = require('../src/work');
const { foodSupply } = require('../src/foraging');
const id = Date.now().toString(36), username = `Cook${id}`;
const site = Number(process.env.COOK_SITE || 600);
assert(Number.isInteger(site) && site >= 100 && site <= 10000);
const directory = path.join(__dirname, '..', 'artifacts', `cooking-${id}`);
fs.mkdirSync(directory, { recursive: true });
const store = new GoalStore(path.join(directory, 'goal.json'));
const log = value => { const line = JSON.stringify({ at: new Date().toISOString(), ...value }); console.log(line); fs.appendFileSync(path.join(directory, 'events.jsonl'), line + '\n'); };
const bot = mineflayer.createBot({ host: process.env.MC_HOST || 'localhost', port: Number(process.env.MC_PORT || 25567), username, version: '26.1', auth: 'offline' });
bot.loadPlugin(compatibilityPlugin); bot.loadPlugin(pathfinder);
const task = new Task('food', 'hunt, cook and eat chicken');
const timeout = setTimeout(() => { task.cancel(); bot.pathfinder.setGoal(null); bot.clearControlStates(); }, 600000);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let minimumHealth = 20, minimumFood = 20;
bot.on('health', () => { minimumHealth = Math.min(minimumHealth, bot.health); minimumFood = Math.min(minimumFood, bot.food); log({ health: bot.health, food: bot.food }); });
bot.on('death', () => { log({ death: true }); task.cancel(); });
bot.on('error', err => log({ error: err.message }));
const setupFile = path.join(directory, 'setup-ready');
async function until(predicate, label, timeoutMs = 180000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) { task.check(); if (Date.now() >= deadline) throw new Error(`Timed out: ${label}`); await sleep(100); }
}
bot.once('spawn', async () => {
  try {
    configureMovements(bot); await bot.waitForChunksToLoad();
    log({ phase: 'setup', username, setupFile, commands: [
      'difficulty normal', 'time set day', `tp ${username} ${site + 0.5} 64 ${site + 0.5}`,
      `fill ${site + 4} 64 ${site} ${site + 4} 69 ${site} minecraft:oak_log keep`,
      `fill ${site + 6} 63 ${site - 4} ${site + 6} 63 ${site + 7} minecraft:stone replace minecraft:grass_block`,
      ...[0, 1, 2, 3].map(i => `summon minecraft:chicken ${site + i} 64 ${site + 4}`),
    ], directory });
    await until(() => fs.existsSync(setupFile), 'external setup');
    assert.equal(bot.inventory.items().length, 0); assert.equal(bot.game.gameMode, 'survival');
    assert.equal(bot.game.difficulty, 'normal');
    log({ initial: { inventory: {}, position: bot.entity.position, difficulty: bot.game.difficulty, scenario: 'controlled hunting, cooking and induced hunger' } });
    const goal = { version: 1, kind: 'survive', request: 'Maintain a safe food reserve', stockFood: true, status: 'running' };
    const client = new TypeSafe(), survival = createSurvival(bot, { client });
    let eatingStart, cookedBefore, eatingEvidence;
    const onStep = g => {
      const observed = inventory(bot);
      if (eatingStart !== undefined && (observed.cooked_chicken || 0) < cookedBefore && bot.food > eatingStart) {
        eatingEvidence ||= { foodBefore: eatingStart, foodAfter: bot.food, cookedBefore, cookedAfter: observed.cooked_chicken || 0 };
      }
      log({ action: g.survivalAction, step: g.step, decision: g.decisions?.at(-1)?.path,
        error: g.lastError, foodReserve: foodSupply(bot), inventory: observed, position: bot.entity.position });
    };
    await runIdle(bot, task, goal, store, { decisionClient: client, survival, onStep, until: () => foodSupply(bot) >= 12 });
    assert((inventory(bot).cooked_chicken || 0) >= 2);
    cookedBefore = inventory(bot).cooked_chicken;
    log({ check: 'hunted, crafted prerequisites and cooked at least two chickens from empty inventory', pass: true, inventory: inventory(bot) });
    const hungerStarted = path.join(directory, 'hunger-started');
    log({ phase: 'hunger', command: `effect give ${username} minecraft:hunger 20 100 true`, readyFile: hungerStarted });
    await until(() => fs.existsSync(hungerStarted), 'external hunger setup');
    await until(() => bot.food <= 16, 'externally induced hunger', 30000);
    const hungerCleared = path.join(directory, 'hunger-cleared');
    log({ phase: 'clear_hunger', command: `effect clear ${username} minecraft:hunger`, readyFile: hungerCleared });
    await until(() => fs.existsSync(hungerCleared), 'fixture hunger effect cleared', 30000);
    const foodBefore = bot.food; eatingStart = foodBefore;
    log({ eatingStart: { food: foodBefore, inventory: inventory(bot) } });
    await runIdle(bot, task, goal, store, { decisionClient: client, survival, onStep,
      until: () => !!eatingEvidence });
    assert.equal(minimumHealth, 20);
    log({ result: 'PASS', minimumHealth, minimumFood, foodBefore, foodAfter: bot.food, eatingEvidence, inventory: inventory(bot), directory });
  } catch (err) { log({ result: 'FAIL', error: err.stack, directory }); process.exitCode = 1; }
  finally { clearTimeout(timeout); bot.quit(); setTimeout(() => process.exit(process.exitCode || 0), 500); }
});
