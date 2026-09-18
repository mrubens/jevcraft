'use strict';
require('../src/env').loadEnv();
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const mineflayer = require('mineflayer');
const { pathfinder } = require('mineflayer-pathfinder');
const { TypeSafe } = require('../src/typesafe');
const { compatibilityPlugin } = require('../src/compatibility');
const { configureMovements } = require('../src/movement');
const { Task } = require('../src/skills');
const { GoalStore, interpret, verifyHouse } = require('../src/objectives');
const { runGoal, inventory, createSurvival } = require('../src/work');
const shelter = require('../src/shelter');
const id = Date.now().toString(36), username = `Build${id}`;
const directory = path.join(__dirname, '..', 'artifacts', `creative-house-${id}`);
fs.mkdirSync(directory, { recursive: true });
const store = new GoalStore(path.join(directory, 'goal.json'));
const log = value => { console.log(JSON.stringify(value)); fs.appendFileSync(path.join(directory, 'events.jsonl'), JSON.stringify(value) + '\n'); };
const bot = mineflayer.createBot({ host: process.env.MC_HOST || '127.0.0.1', port: Number(process.env.MC_PORT || 25567), username, version: '26.1', auth: 'offline' });
bot.loadPlugin(compatibilityPlugin); bot.loadPlugin(pathfinder);
const task = new Task('test', 'Creative house progress and reusable home');
const timer = setTimeout(() => task.cancel(), 300000);
bot.once('spawn', async () => {
  try {
    configureMovements(bot); await bot.waitForChunksToLoad();
    log({ scenario: 'controlled-creative', setupRequired: `gamemode creative ${username}`, setupFile: path.join(directory, 'ready') });
    const deadline = Date.now() + 180000;
    while (!fs.existsSync(path.join(directory, 'ready'))) {
      task.check(); if (Date.now() > deadline) throw new Error('Setup deadline exceeded');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(bot.game.gameMode, 'creative');
    const spec = await interpret(new TypeSafe(), `${username} build a gold block house`, 'TestPlayer', username, { registry: bot.registry });
    assert.equal(spec.kind, 'house'); assert.equal(spec.material, 'gold_block');
    const goal = { ...spec, version: 1, scenario: 'controlled-creative', initialInventory: inventory(bot) };
    const survival = createSurvival(bot);
    const result = await runGoal(bot, task, goal, store, { decisionClient: new TypeSafe(), survival,
      onStep: g => log({ step: g.step, stalls: g.stalls, error: g.lastError, position: bot.entity.position }) });
    assert(result.ok, result.reason); assert(verifyHouse(bot, goal.blueprint).ok);
    const refuge = survival.currentShelter();
    assert.equal(refuge.kind, 'house');
    for (let n = 0; n < 8 && !(shelter.inside(bot, refuge) && shelter.sealed(bot, refuge)); n++) {
      await survival.refugeStep(task, goal, () => store.save(goal));
    }
    assert(shelter.inside(bot, refuge) && shelter.sealed(bot, refuge));
    await survival.leave(task, goal, () => store.save(goal), refuge);
    assert(!shelter.inside(bot, refuge)); assert(verifyHouse(bot, goal.blueprint).ok);
    log({ result: 'PASS', scenario: 'controlled-creative', origin: goal.blueprint.origin,
      verifiedBlocks: goal.blueprint.blocks.length, refugeReused: true, inventory: inventory(bot) });
  } catch (err) { log({ result: 'FAIL', error: err.stack }); process.exitCode = 1; }
  finally { clearTimeout(timer); bot.quit(); setTimeout(() => process.exit(process.exitCode || 0), 500); }
});
bot.on('error', err => log({ error: err.message }));
