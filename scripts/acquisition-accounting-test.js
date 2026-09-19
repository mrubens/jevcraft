'use strict';
// Controlled supplies on an isolated server; actual Survival mining, station
// construction, smelting and delivery. Not natural-start acceptance.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const mineflayer = require('mineflayer'), { pathfinder } = require('mineflayer-pathfinder');
const { compatibilityPlugin } = require('../src/compatibility'), { configureMovements } = require('../src/movement');
const { Task, countOf } = require('../src/skills'), { GoalStore } = require('../src/objectives');
const { runGoal, waitFor, inventory } = require('../src/work');
const port = Number(process.env.MC_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535 || [25565, 25577].includes(port)) throw new Error('Explicit isolated MC_PORT required');
const id = Date.now().toString(36), x = Number(process.env.ACCOUNTING_TEST_X || 2800), directory = path.resolve('artifacts', `acquisition-accounting-${id}`);
fs.mkdirSync(directory, { recursive: true });
const log = value => { const row = JSON.stringify({ at: new Date().toISOString(), ...value }); console.log(row); fs.appendFileSync(path.join(directory, 'events.jsonl'), row + '\n'); };
const connect = prefix => { const b = mineflayer.createBot({ host: '127.0.0.1', port, username: prefix + id, version: '26.1', auth: 'offline' }); b.loadPlugin(compatibilityPlugin); b.loadPlugin(pathfinder); return b; };
const bot = connect('Make'), receiver = connect('Take');
let task = new Task('balanced acquisition'), paused = false, active = false, deaths = 0;
const inputs = [], fuels = [], crafted = {}, mined = {}, placements = [];
receiver.on('blockUpdate', (old, block) => {
  if (!active || !block || block.position.x < x - 8 || block.position.x > x + 8 || Math.abs(block.position.z) > 8) return;
  if (old?.name !== block.name && block.name === 'furnace') placements.push({ ...block.position });
  if (old?.name !== block.name && ['iron_ore', 'stone'].includes(old?.name) && block.name === 'air') mined[old.name] = (mined[old.name] || 0) + 1;
});
for (const b of [bot, receiver]) { b.on('error', e => log({ error: e.message })); b.on('death', () => { deaths++; task.cancel(); }); }
const timer = setTimeout(() => task.cancel(), 9 * 60000);
const ready = async b => { await new Promise(r => b.once('spawn', r)); await b.waitForChunksToLoad(); configureMovements(b); };
(async () => {
  try {
    await Promise.all([ready(bot), ready(receiver)]);
    const commands = [`forceload add ${x - 16} -16 ${x + 16} 16`, `fill ${x - 8} 64 -8 ${x + 8} 72 8 air`,
      `fill ${x - 8} 61 -8 ${x + 8} 63 8 bedrock`, `setblock ${x + 2} 64 2 crafting_table`,
      `fill ${x - 3} 64 4 ${x + 4} 64 4 stone`,
      `fill ${x - 3} 64 -4 ${x + 3} 64 -4 iron_ore`,
      `gamemode survival ${bot.username}`, `gamemode survival ${receiver.username}`,
      `tp ${bot.username} ${x + .5} 64 .5`, `tp ${receiver.username} ${x - 3.5} 64 3.5`,
      `give ${bot.username} stone_pickaxe 1`, `give ${bot.username} raw_iron 9`,
      `give ${bot.username} cobblestone 8`, `give ${bot.username} birch_planks 21`];
    fs.writeFileSync(path.join(directory, 'setup.json'), JSON.stringify(commands, null, 2)); log({ phase: 'setup', directory });
    await waitFor(task, () => fs.existsSync(path.join(directory, 'ready')), 180000);
    await waitFor(task, () => countOf(bot, 'birch_planks') === 21 && bot.entity.position.x > x && bot.entity.position.y === 64, 10000);
    const nativeCraft = bot.craft, nativeOpen = bot.openFurnace;
    bot.craft = async function (recipe, count, table) {
      await nativeCraft.call(this, recipe, count, table); const name = bot.registry.items[recipe.result.id].name;
      crafted[name] = (crafted[name] || 0) + recipe.result.count * count;
    };
    bot.openFurnace = async function (block) {
      const window = await nativeOpen.call(this, block), putInput = window.putInput, putFuel = window.putFuel;
      window.putInput = async (...args) => { await putInput.apply(window, args); inputs.push({ item: bot.registry.items[args[0]].name, count: args[2] }); };
      window.putFuel = async (...args) => { await putFuel.apply(window, args); fuels.push({ item: bot.registry.items[args[0]].name, count: args[2] }); };
      return window;
    };
    let goal = { version: 1, kind: 'bundle', request: 'Give me eight stone, two iron chestplates and four birch planks', from: receiver.username,
      requesterPosition: { ...receiver.entity.position }, tasks: [
        { kind: 'obtain', item: 'stone', count: 8, deliver: true },
        { kind: 'obtain', item: 'iron_chestplate', count: 2, deliver: true },
        { kind: 'obtain', item: 'birch_planks', count: 4, deliver: true }] };
    const store = new GoalStore(path.join(directory, 'goal.json'));
    const options = { maxSteps: 80, survival: { state: {}, step: async () => false }, recoveryAdviser: { recordFailure: () => {}, suggest: async () => false },
      onStep: g => {
        log({ step: g.step, inventory: inventory(bot), error: g.lastError });
        if (!paused && countOf(bot, 'furnace') === 1) { paused = true; task.cancel(); }
      } };
    active = true;
    await assert.rejects(runGoal(bot, task, goal, store, options), { name: 'Cancelled' });
    assert(paused); assert.equal(crafted.furnace, 1);
    goal = store.read(); task = new Task('resume balanced acquisition');
    const result = await runGoal(bot, task, goal, store, options); assert(result.ok, result.reason);
    await waitFor(task, () => goal.tasks.every(child => countOf(receiver, child.item) === child.count), 5000);
    for (const child of goal.tasks) assert.equal(child.delivered, child.count);
    assert.deepEqual(inputs.toSorted((a, b) => a.item.localeCompare(b.item)), [{ item: 'cobblestone', count: 8 }, { item: 'raw_iron', count: 16 }]);
    assert(fuels.every(f => f.item === 'birch_planks'));
    const fuelUsed = fuels.reduce((sum, f) => sum + f.count, 0);
    assert(fuelUsed >= 16 && fuelUsed <= 17, 'Two furnace batches stay within the shared fuel budget');
    assert.deepEqual(crafted, { furnace: 1, iron_chestplate: 2 });
    assert.equal(placements.length, 1); assert.equal(mined.iron_ore, 7); assert.equal(mined.stone, 8);
    assert.equal(countOf(bot, 'raw_iron'), 0); assert.equal(countOf(bot, 'birch_planks'), 21 - fuelUsed - 4);
    assert.equal(deaths, 0); assert.equal(bot.health, 20);
    log({ result: 'PASS', inputs, fuels, crafted, mined, placements, deaths, health: bot.health,
      independentlyReceived: inventory(receiver), remainingInventory: inventory(bot), resumed: true, directory });
  } catch (e) { log({ result: 'FAIL', error: e.stack, inputs, fuels, crafted, mined, inventory: inventory(bot), position: bot.entity?.position, directory }); process.exitCode = 1; }
  finally { clearTimeout(timer); bot.pathfinder.setGoal(null); bot.clearControlStates(); bot.quit(); receiver.quit(); setTimeout(() => process.exit(process.exitCode || 0), 500); }
})();
