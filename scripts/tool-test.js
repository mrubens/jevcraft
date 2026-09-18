'use strict';
// Controlled tool-mechanics trial: empty Survival inventory, ordinary gathering,
// crafting, placement and mining. Recycle cobblestone to wear the first tool.
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const mineflayer = require('mineflayer');
const { pathfinder, goals } = require('mineflayer-pathfinder');
const { compatibilityPlugin } = require('../src/compatibility');
const { configureMovements } = require('../src/movement');
const { Task, navigate, countOf, equipBestTool } = require('../src/skills');
const { acquireStep, inventory, planningInventory, place, dig, waitFor } = require('../src/work');
const id = Date.now().toString(36);
const directory = path.join(__dirname, '..', 'artifacts', `tools-${id}`);
fs.mkdirSync(directory, { recursive: true });
const log = value => { console.log(JSON.stringify(value)); fs.appendFileSync(path.join(directory, 'events.jsonl'), JSON.stringify(value) + '\n'); };
const bot = mineflayer.createBot({ host: process.env.MC_HOST || '127.0.0.1', port: Number(process.env.MC_PORT || 25567),
  version: '26.1', username: `Tool${id}`, auth: 'offline' });
bot.loadPlugin(compatibilityPlugin); bot.loadPlugin(pathfinder);
const task = new Task('tools', 'wear and replace a wooden pickaxe');
const timeout = setTimeout(() => { task.cancel(); bot.pathfinder.setGoal(null); bot.stopDigging(); }, 360000);
bot.on('navigation_stall', details => log({ navigationStall: details }));
bot.on('navigation_recovery', details => log({ navigationRecovery: details }));
bot.on('death', () => task.cancel());
bot.on('error', err => log({ error: err.message }));
bot.once('spawn', async () => {
  try {
    await bot.waitForChunksToLoad(); configureMovements(bot);
    if (process.env.TOOL_SETUP_FILE) {
      log({ awaitingControlledSetup: bot.username, setupFile: process.env.TOOL_SETUP_FILE, position: bot.entity.position });
      await waitFor(task, () => fs.existsSync(process.env.TOOL_SETUP_FILE), 60000);
      await bot.waitForChunksToLoad();
    }
    assert.equal(bot.game.gameMode, 'survival'); assert.equal(bot.inventory.items().length, 0);
    log({ scenario: 'controlled pickaxe wear and replacement, no bot-issued world commands', setup: process.env.TOOL_SETUP_FILE ? 'external fixture setup; see setup record' : 'existing world', initialInventory: {},
      position: bot.entity.position, difficulty: bot.game.difficulty, directory });
    const goal = {};
    let plankKind;
    const ensure = async (item, count) => {
      for (let step = 0; step < 100; step++) {
        if (await acquireStep(bot, task, item, count, goal, () => {})) return;
        if (goal.step.action === 'craft' && goal.step.item.endsWith('_planks')) plankKind = goal.step.item;
        log({ acquiring: item, step: goal.step, inventory: inventory(bot), position: bot.entity.position });
      }
      throw new Error(`Acquisition exceeded 100 steps for ${item}`);
    };
    await ensure('wooden_pickaxe', 1);
    await ensure('cobblestone', 1);
    await ensure(plankKind || 'oak_planks', 3); await ensure('stick', 2);
    const tools = () => bot.inventory.items().filter(i => i.name === 'wooden_pickaxe');
    const maximum = bot.registry.itemsByName.wooden_pickaxe.maxDurability;
    let workCell, standingCell;
    const recycle = async () => {
      // Travel can spend scaffolding. Reobserve before each placement, and
      // return to a fixed station instead of drifting one block per use.
      await ensure('cobblestone', 1);
      if (standingCell) await navigate(bot, task, new goals.GoalBlock(standingCell.x, standingCell.y, standingCell.z));
      const feet = bot.entity.position.floored();
      const candidates = [];
      for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) {
        if (!x && !z) continue;
        const p = feet.offset(x, 0, z);
        if (bot.blockAt(p)?.name === 'air' && bot.blockAt(p.offset(0, 1, 0))?.name === 'air' &&
          bot.blockAt(p.offset(0, -1, 0))?.name !== 'magma_block' && bot.blockAt(p.offset(0, -1, 0))?.boundingBox === 'block') candidates.push(p);
      }
      candidates.sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position));
      const p = workCell || candidates[0];
      if (!p) throw new Error('No inspected adjacent work cell for cobblestone recycling');
      workCell ||= p; standingCell ||= feet;
      const before = countOf(bot, 'cobblestone');
      await place(bot, task, p, 'cobblestone');
      await equipBestTool(bot, bot.blockAt(p));
      await dig(bot, task, p);
      await navigate(bot, task, new goals.GoalBlock(p.x, p.y, p.z));
      await waitFor(task, () => countOf(bot, 'cobblestone') >= before);
    };
    for (let uses = 0; maximum - tools()[0].durabilityUsed >= 8; uses++) {
      assert(uses < maximum);
      await recycle();
      if (uses % 10 === 0) log({ wear: tools()[0].durabilityUsed, maximum, health: bot.health });
    }
    const worn = tools()[0].durabilityUsed;
    assert.equal(planningInventory(bot).wooden_pickaxe, 0);
    log({ replacementNeeded: true, durabilityUsed: worn, remaining: maximum - worn });
    await ensure('wooden_pickaxe', 1);
    assert.equal(tools().length, 2);
    assert(tools().some(i => i.durabilityUsed === worn));
    assert(tools().some(i => i.durabilityUsed === 0));
    await recycle();
    assert.equal(bot.heldItem.name, 'wooden_pickaxe');
    assert(bot.heldItem.durabilityUsed > 0 && bot.heldItem.durabilityUsed < worn);
    assert(tools().some(i => i.durabilityUsed === worn), 'worn tool must remain unused after replacement');
    log({ result: 'PASS', tools: tools().map(i => ({ name: i.name, durabilityUsed: i.durabilityUsed })),
      inventory: inventory(bot), health: bot.health, directory });
  } catch (err) { log({ result: 'FAIL', error: err.message, position: bot.entity?.position, directory }); process.exitCode = 1; }
  finally {
    clearTimeout(timeout); bot.pathfinder.setGoal(null); bot.clearControlStates(); bot.quit();
    setTimeout(() => process.exit(process.exitCode || 0), 500);
  }
});
