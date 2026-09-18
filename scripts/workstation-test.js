'use strict';
// Controlled workstation regression, with externally recorded setup grants.
// This verifies inventory/placement mechanics, not natural survival acceptance.
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Vec3 } = require('vec3');
const mineflayer = require('mineflayer');
const { pathfinder, goals } = require('mineflayer-pathfinder');
const { compatibilityPlugin } = require('../src/compatibility');
const { configureMovements } = require('../src/movement');
const { Task, navigate, countOf } = require('../src/skills');
const { acquireStep, inventory, place, waitFor } = require('../src/work');
const site = Number(process.env.WORKSTATION_SITE || 1300);
if (!Number.isInteger(site)) throw new Error('WORKSTATION_SITE must be an integer');
const id = Date.now().toString(36), username = `Bench${id}`;
const directory = path.join(__dirname, '..', 'artifacts', `workstation-${id}`);
fs.mkdirSync(directory, { recursive: true });
const setupFile = path.join(directory, 'setup-ready');
const log = value => { const line = JSON.stringify({ at: new Date().toISOString(), ...value }); console.log(line); fs.appendFileSync(path.join(directory, 'events.jsonl'), line + '\n'); };
const bot = mineflayer.createBot({ host: process.env.MC_HOST || '127.0.0.1', port: Number(process.env.MC_PORT || 25567), username, version: '26.1', auth: 'offline' });
bot.loadPlugin(compatibilityPlugin); bot.loadPlugin(pathfinder);
const task = new Task('workstations', 'verify portable and requested crafting stations');
const timer = setTimeout(() => task.cancel(), 300000);
bot.on('error', err => log({ error: err.message }));
bot.on('death', () => task.cancel());
bot.once('spawn', async () => {
  try {
    configureMovements(bot); await bot.waitForChunksToLoad();
    const existingTable = new Vec3(site + 12, 64, site), existingFurnace = new Vec3(site + 14, 64, site);
    const commands = [`tp ${username} ${site + 0.5} 64 ${site + 0.5}`,
      `setblock ${existingTable.x} 64 ${site} minecraft:crafting_table`,
      `setblock ${existingFurnace.x} 64 ${site} minecraft:furnace`,
      ...Object.entries({ crafting_table: 1, oak_planks: 24, stick: 4, cobblestone: 11 }).map(([name, count]) => `give ${username} minecraft:${name} ${count}`)];
    fs.writeFileSync(path.join(directory, 'setup.json'), JSON.stringify(commands));
    log({ scenario: 'controlled workstation mechanics; setup grants and teleport', phase: 'setup', username, setupFile, commands, directory });
    await waitFor(task, () => fs.existsSync(setupFile), 180000);
    await bot.waitForChunksToLoad();
    await waitFor(task, () => countOf(bot, 'oak_planks') === 24);
    assert.equal(bot.game.gameMode, 'survival');
    assert.equal(bot.blockAt(existingTable)?.name, 'crafting_table');
    assert.equal(bot.blockAt(existingFurnace)?.name, 'furnace');
    const goal = { preparingExpedition: true };
    const ensure = async (item, count) => {
      for (let i = 0; i < 6; i++) {
        if (await acquireStep(bot, task, item, count, goal, () => {})) return;
        log({ acquiring: item, step: goal.step, inventory: inventory(bot), position: bot.entity.position });
      }
      throw new Error(`No carried ${item} after six acquisition steps`);
    };
    await ensure('wooden_pickaxe', 1);
    assert.equal(countOf(bot, 'crafting_table'), 1, 'Retrieve our table immediately during preparation');
    assert(bot.entity.position.distanceTo(existingTable) > 4, 'Use the carried table locally instead of returning to a distant bench');
    await navigate(bot, task, new goals.GoalBlock(site - 12, 64, site));
    await ensure('stone_pickaxe', 1);
    assert.equal(countOf(bot, 'crafting_table'), 1, 'The same bench travels with us for the second tool');
    assert.equal(bot._ownedWorkstations.size, 0, 'Both placed tables were retrieved');
    await navigate(bot, task, new goals.GoalBlock(site + 10, 64, site));
    await ensure('chest', 1);
    assert.equal(bot.blockAt(existingTable)?.name, 'crafting_table', 'Reuse a nearby player table without collecting it');
    assert.equal(countOf(bot, 'crafting_table'), 1);
    // A station in the world can satisfy a recipe dependency, but a direct
    // request for that station must produce a carried item.
    await place(bot, task, new Vec3(site + 10, 64, site + 2), 'crafting_table');
    await waitFor(task, () => countOf(bot, 'crafting_table') === 0);
    assert.equal(countOf(bot, 'crafting_table'), 0);
    await ensure('crafting_table', 1);
    await ensure('furnace', 1);
    assert.equal(countOf(bot, 'crafting_table'), 1);
    assert.equal(countOf(bot, 'furnace'), 1);
    assert.equal(bot.blockAt(existingTable)?.name, 'crafting_table');
    assert.equal(bot.blockAt(existingFurnace)?.name, 'furnace');
    log({ result: 'PASS', inventory: inventory(bot), health: bot.health, directory });
  } catch (err) { log({ result: 'FAIL', error: err.stack, inventory: inventory(bot), directory }); process.exitCode = 1; }
  finally { clearTimeout(timer); bot.pathfinder.setGoal(null); bot.clearControlStates(); bot.quit(); setTimeout(() => process.exit(process.exitCode || 0), 500); }
});
