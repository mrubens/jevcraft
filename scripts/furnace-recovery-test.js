'use strict';
// Controlled Survival batch: stop mid-smelt, remove fuel in fixture setup, then
// resume with logs. The bot must craft fuel and recover the original furnace.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const mineflayer = require('mineflayer'), { pathfinder } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { compatibilityPlugin } = require('../src/compatibility');
const { configureMovements } = require('../src/movement');
const { Task, countOf } = require('../src/skills');
const { smelt, waitFor } = require('../src/work');
const port = Number(process.env.MC_PORT);
if (!Number.isInteger(port) || [25565, 25577].includes(port)) throw new Error('Explicit isolated MC_PORT required');
const id = Date.now().toString(36), directory = path.resolve('artifacts', `furnace-recovery-${id}`);
const wood = process.env.FURNACE_TEST_WOOD || 'oak', logItem = `${wood}_log`, fuelItem = `${wood}_planks`;
fs.mkdirSync(directory, { recursive: true });
const log = data => { const row = JSON.stringify({ at: new Date().toISOString(), ...data }); console.log(row); fs.appendFileSync(path.join(directory, 'events.jsonl'), row + '\n'); };
const bot = mineflayer.createBot({ host: '127.0.0.1', port, username: 'Furn' + id, version: '26.1', auth: 'offline' });
bot.loadPlugin(compatibilityPlugin); bot.loadPlugin(pathfinder);
const task = new Task('furnace recovery'); let goal = { request: 'make four glass', kind: 'obtain' };
const save = () => fs.writeFileSync(path.join(directory, 'goal.json'), JSON.stringify(goal, null, 2));
const timer = setTimeout(() => task.cancel(), 180000);
(async () => {
  try {
    await new Promise(r => bot.once('spawn', r)); await bot.waitForChunksToLoad(); configureMovements(bot);
    const x = Number(process.env.FURNACE_TEST_X || 900);
    const setup = [`forceload add ${x - 16} -16 ${x + 16} 16`, `fill ${x - 5} 61 -5 ${x + 5} 63 5 stone`, `fill ${x - 5} 64 -5 ${x + 5} 70 5 air`,
      `setblock ${x + 2} 64 0 furnace`, `tp ${bot.username} ${x + .5} 64 .5`, `give ${bot.username} sand 4`, `give ${bot.username} ${fuelItem} 3`, `give ${bot.username} ${logItem} 1`];
    fs.writeFileSync(path.join(directory, 'setup.json'), JSON.stringify(setup, null, 2)); log({ phase: 'setup', directory, bot: bot.username });
    await waitFor(task, () => fs.existsSync(path.join(directory, 'ready')), 180000); await bot.waitForChunksToLoad();
    const interrupted = new Task('stop mid smelt');
    const cancel = setTimeout(() => interrupted.cancel(), 1800);
    try { await assert.rejects(smelt(bot, interrupted, { item: 'glass', from: 'sand', count: 4, fuelItem }, goal, save), error => { log({ phase: 'interruption', error: error.stack }); return error.name === 'Cancelled'; }); }
    finally { clearTimeout(cancel); }
    assert(goal.smelting); assert.equal(goal.smelting.fuelItem, fuelItem); assert.equal(countOf(bot, 'sand'), 0);
    goal = JSON.parse(fs.readFileSync(path.join(directory, 'goal.json')));
    const p = goal.smelting.position;
    fs.writeFileSync(path.join(directory, 'remove-fuel.json'), JSON.stringify([`item replace block ${p.x} ${p.y} ${p.z} container.1 with air`, `data merge block ${p.x} ${p.y} ${p.z} {lit_time_remaining:0s}`], null, 2));
    log({ phase: 'removeFuel', position: p, directory });
    await waitFor(task, () => fs.existsSync(path.join(directory, 'fuel-removed')), 60000);
    let iterations = 0;
    while (goal.smelting && iterations++ < 12) {
      await smelt(bot, task, goal.smelting, goal, save);
      log({ phase: 'resume', iterations, missingSupply: goal.smelting?.missingSupply, inventory: bot.inventory.items().map(i => ({ name: i.name, count: i.count })) });
    }
    assert.equal(countOf(bot, 'glass'), 4); assert(!goal.smelting);
    assert.equal(countOf(bot, logItem), 0, 'made missing fuel from the granted log');
    assert(countOf(bot, fuelItem) >= 1, 'unused fuel remains reserved for later recipes');
    assert.equal(countOf(bot, 'sand'), 0, 'did not gather or load a duplicate input batch');
    log({ result: 'PASS', glass: 4, fuelItem, spareFuel: countOf(bot, fuelItem), health: bot.health, directory });
  } catch (error) { log({ result: 'FAIL', error: error.stack, directory }); process.exitCode = 1; }
  finally { clearTimeout(timer); bot.quit(); setTimeout(() => process.exit(process.exitCode || 0), 500); }
})();
