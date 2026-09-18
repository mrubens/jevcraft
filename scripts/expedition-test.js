'use strict';
// Controlled preparation check: stop before ore acquisition and verify the
// actual carried tools, spare wood and portable table. Not full acceptance.
require('../src/env').loadEnv();
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const mineflayer = require('mineflayer');
const { pathfinder } = require('mineflayer-pathfinder');
const { compatibilityPlugin } = require('../src/compatibility');
const { configureMovements } = require('../src/movement');
const { Task, pickaxeTier } = require('../src/skills');
const { TypeSafe } = require('../src/typesafe');
const { GoalStore, interpret } = require('../src/objectives');
const { runGoal, inventory } = require('../src/work');
const id = Date.now().toString(36), username = `Exp${id}`;
const directory = path.join(__dirname, '..', 'artifacts', `expedition-${id}`);
fs.mkdirSync(directory, { recursive: true });
const setupFile = path.join(directory, 'setup-ready');
const log = value => { const line = JSON.stringify({ at: new Date().toISOString(), ...value }); console.log(line); fs.appendFileSync(path.join(directory, 'events.jsonl'), line + '\n'); };
const bot = mineflayer.createBot({ host: process.env.MC_HOST || 'localhost', port: Number(process.env.MC_PORT || 25567), username, version: '26.1', auth: 'offline' });
bot.loadPlugin(compatibilityPlugin); bot.loadPlugin(pathfinder);
const task = new Task('expedition', 'prepare for catalog ore acquisition');
const timer = setTimeout(() => task.cancel(), 420000);
bot.on('death', () => { log({ death: true }); task.cancel(); });
bot.on('error', err => log({ error: err.message }));
bot.once('spawn', async () => {
  try {
    configureMovements(bot); await bot.waitForChunksToLoad();
    const commands = [`tp ${username} 900.5 64 900.5`,
      'fill 904 64 900 907 67 900 minecraft:oak_log keep',
      'fill 914 63 896 914 63 903 minecraft:stone replace minecraft:grass_block'];
    fs.writeFileSync(path.join(directory, 'setup.json'), JSON.stringify(commands));
    log({ phase: 'setup', username, setupFile, commands, directory });
    const deadline = Date.now() + 180000;
    while (!fs.existsSync(setupFile)) { task.check(); if (Date.now() >= deadline) throw new Error('Fixture setup timed out'); await new Promise(r => setTimeout(r,100)); }
    assert.equal(bot.game.gameMode, 'survival'); assert.equal(bot.inventory.items().length, 0);
    const client = new TypeSafe();
    const spec = await interpret(client, `${username} collect 1 lapis lazuli for yourself`, 'TestPlayer', username, { registry: bot.registry });
    assert.equal(spec.kind, 'obtain'); assert.equal(spec.item, 'lapis_lazuli');
    const goal = { ...spec, version: 1, scenario: 'controlled preparation only', initialInventory: {} };
    log({ initial: { position: bot.entity.position, inventory: {}, difficulty: bot.game.difficulty }, spec });
    try {
      await runGoal(bot, task, goal, new GoalStore(path.join(directory, 'goal.json')), { decisionClient: client,
        onStep: g => { log({ step: g.step, inventory: inventory(bot), error: g.lastError }); if (g.expeditionReady) task.cancel(); } });
    } catch (err) { if (err.name !== 'Cancelled' || !goal.expeditionReady) throw err; }
    const actual = inventory(bot);
    assert(goal.expeditionReady); assert(pickaxeTier(bot) >= 2);
    assert(actual.oak_log >= 8); assert(actual.crafting_table >= 1);
    assert(!actual.lapis_lazuli, 'The check stops before ore acquisition');
    log({ result: 'PASS', inventory: actual, directory });
  } catch (err) { log({ result: 'FAIL', error: err.stack, directory }); process.exitCode = 1; }
  finally { clearTimeout(timer); bot.quit(); setTimeout(() => process.exit(process.exitCode || 0), 500); }
});
