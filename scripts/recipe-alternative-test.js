'use strict';
// Controlled recipe-choice check. Prepared flowers and terrain are recorded;
// no item grants, bot operator commands, or full-acceptance claims.
require('../src/env').loadEnv();
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const mineflayer = require('mineflayer');
const { pathfinder } = require('mineflayer-pathfinder');
const { compatibilityPlugin } = require('../src/compatibility');
const { configureMovements } = require('../src/movement');
const { TypeSafe } = require('../src/typesafe');
const { Task } = require('../src/skills');
const { GoalStore, interpret } = require('../src/objectives');
const { catalogPlan, runGoal, inventory } = require('../src/work');
const id = Date.now().toString(36), username = `Dye${id}`;
const directory = path.join(__dirname, '..', 'artifacts', `recipe-alternative-${id}`);
fs.mkdirSync(directory, { recursive: true });
const setupFile = path.join(directory, 'setup-ready');
const log = value => { const line = JSON.stringify({ at: new Date().toISOString(), ...value }); console.log(line); fs.appendFileSync(path.join(directory, 'events.jsonl'), line + '\n'); };
const bot = mineflayer.createBot({ host: process.env.MC_HOST || 'localhost', port: Number(process.env.MC_PORT || 25567), username, version: '26.1', auth: 'offline' });
bot.loadPlugin(compatibilityPlugin); bot.loadPlugin(pathfinder);
const task = new Task('recipe', 'craft two red dye');
const timer = setTimeout(() => task.cancel(), 300000);
bot.on('error', err => log({ error: err.message }));
bot.on('death', () => task.cancel());
bot.once('spawn', async () => {
  try {
    configureMovements(bot); await bot.waitForChunksToLoad();
    const commands = [`tp ${username} 1100.5 64 1100.5`,
      'fill 1095 63 1095 1105 63 1105 minecraft:stone replace minecraft:grass_block',
      'setblock 1118 64 1100 minecraft:poppy', 'setblock 1118 64 1101 minecraft:poppy'];
    fs.writeFileSync(path.join(directory, 'setup.json'), JSON.stringify(commands));
    log({ phase: 'setup', commands, setupFile, directory });
    const deadline = Date.now() + 180000;
    while (!fs.existsSync(setupFile)) { task.check(); if (Date.now() > deadline) throw new Error('Setup timed out'); await new Promise(r => setTimeout(r, 100)); }
    assert.equal(bot.game.gameMode, 'survival'); assert.deepEqual(inventory(bot), {});
    const client = new TypeSafe();
    const spec = await interpret(client, `${username} craft two red dye`, 'TestPlayer', username, { registry: bot.registry });
    assert.equal(spec.item, 'red_dye'); assert.equal(spec.count, 2); assert.equal(spec.deliver, false);
    const plan = catalogPlan(bot, spec.item, spec.count, {});
    log({ initialInventory: {}, position: bot.entity.position, spec, generalObservation: bot._catalogObservation.nearby,
      recipeObservations: bot._recipeObservations, plan });
    assert(!bot._catalogObservation.nearby.includes('poppy'), 'The fixture must reproduce the crowded general observation');
    assert.equal(plan[0].drops, 'poppy', 'Choose the observed ingredient instead of an unseen rose bush');
    const goal = { ...spec, version: 1, scenario: 'controlled recipe alternatives', initialInventory: {} };
    const result = await runGoal(bot, task, goal, new GoalStore(path.join(directory, 'goal.json')), { decisionClient: client,
      onStep: g => log({ step: g.step, inventory: inventory(bot), error: g.lastError }) });
    assert(result.ok); assert.equal(inventory(bot).red_dye, 2);
    log({ result: 'PASS', inventory: inventory(bot), directory });
  } catch (err) { log({ result: 'FAIL', error: err.stack, directory }); process.exitCode = 1; }
  finally { clearTimeout(timer); bot.quit(); setTimeout(() => process.exit(process.exitCode || 0), 500); }
});
