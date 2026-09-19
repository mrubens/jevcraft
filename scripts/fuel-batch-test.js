'use strict';
// Exact controlled supplies on an isolated server, followed by ordinary Survival
// smelting/crafting/delivery. This does not satisfy natural-start acceptance.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const mineflayer = require('mineflayer'), { pathfinder } = require('mineflayer-pathfinder');
const { compatibilityPlugin } = require('../src/compatibility'), { configureMovements } = require('../src/movement');
const { Task, countOf } = require('../src/skills'), { GoalStore } = require('../src/objectives');
const { runGoal, waitFor, inventory } = require('../src/work');
const port = Number(process.env.MC_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535 || [25565, 25577].includes(port)) throw new Error('Explicit isolated MC_PORT required');
const id = Date.now().toString(36), x = Number(process.env.FUEL_BATCH_X || 2400), directory = path.resolve('artifacts', `fuel-batch-${id}`);
fs.mkdirSync(directory, { recursive: true });
const log = value => { const row = JSON.stringify({ at: new Date().toISOString(), ...value }); console.log(row); fs.appendFileSync(path.join(directory, 'events.jsonl'), row + '\n'); };
const connect = prefix => { const b = mineflayer.createBot({ host: '127.0.0.1', port, username: prefix + id, version: '26.1', auth: 'offline' }); b.loadPlugin(compatibilityPlugin); b.loadPlugin(pathfinder); return b; };
const bot = connect('Fuel'), receiver = connect('Take');
let task = new Task('shared fuel batch'), active = false, paused = false, digs = 0, deaths = 0, firstArmorIngots;
const inputs = [], fuels = [], crafted = {};
const originalWrite = bot._client.write;
bot._client.write = function (name, packet, ...args) {
  if (active && name === 'block_dig' && [0, 2].includes(packet.status)) digs++;
  return originalWrite.call(this, name, packet, ...args);
};
for (const b of [bot, receiver]) { b.on('error', e => log({ error: e.message })); b.on('death', () => { deaths++; task.cancel(); }); }
const timer = setTimeout(() => task.cancel(), 8 * 60000);
const ready = async b => { await new Promise(r => b.once('spawn', r)); await b.waitForChunksToLoad(); configureMovements(b); };
(async () => {
  try {
    await Promise.all([ready(bot), ready(receiver)]);
    const commands = [`forceload add ${x - 16} -16 ${x + 16} 16`, `fill ${x - 8} 64 -8 ${x + 8} 72 8 air`,
      `fill ${x - 8} 61 -8 ${x + 8} 63 8 stone`, `setblock ${x + 2} 64 0 furnace`, `setblock ${x + 2} 64 2 crafting_table`,
      `gamemode survival ${bot.username}`, `gamemode survival ${receiver.username}`,
      `tp ${bot.username} ${x + .5} 64 .5`, `tp ${receiver.username} ${x - 3.5} 64 .5`,
      `give ${bot.username} iron_pickaxe 1`, `give ${bot.username} raw_iron 24`, `give ${bot.username} birch_planks 24`];
    fs.writeFileSync(path.join(directory, 'setup.json'), JSON.stringify(commands, null, 2)); log({ phase: 'setup', directory });
    await waitFor(task, () => fs.existsSync(path.join(directory, 'ready')), 180000);
    await waitFor(task, () => countOf(bot, 'birch_planks') === 24 && bot.entity.position.x > x && bot.entity.position.y === 64, 10000);
    const nativeCraft = bot.craft, nativeOpen = bot.openFurnace;
    bot.craft = async function (recipe, count, table) {
      const name = bot.registry.items[recipe.result.id].name;
      if (/^iron_(helmet|chestplate|leggings|boots)$/.test(name) && firstArmorIngots === undefined) {
        firstArmorIngots = countOf(bot, 'iron_ingot'); assert.equal(firstArmorIngots, 24);
      }
      await nativeCraft.call(this, recipe, count, table); crafted[name] = (crafted[name] || 0) + recipe.result.count * count;
    };
    bot.openFurnace = async function (block) {
      const window = await nativeOpen.call(this, block), putInput = window.putInput, putFuel = window.putFuel;
      window.putInput = async (...args) => { await putInput.apply(window, args); inputs.push(args[2]); };
      window.putFuel = async (...args) => { await putFuel.apply(window, args); fuels.push({ item: bot.registry.items[args[0]].name, count: args[2] }); };
      window.on('update', () => {
        if (!paused && window.outputItem()?.name === 'iron_ingot') { paused = true; log({ phase: 'stop', input: window.inputItem()?.count, output: window.outputItem()?.count }); task.cancel(); }
      });
      return window;
    };
    let goal = { version: 1, kind: 'bundle', request: 'Give me full iron armor and eight birch planks', from: receiver.username,
      requesterPosition: { ...receiver.entity.position }, tasks: [
        ...['helmet', 'chestplate', 'leggings', 'boots'].map(piece => ({ kind: 'obtain', item: `iron_${piece}`, count: 1, deliver: true })),
        { kind: 'obtain', item: 'birch_planks', count: 8, deliver: true }] };
    const store = new GoalStore(path.join(directory, 'goal.json'));
    const options = { maxSteps: 30, survival: { state: {}, step: async () => false }, recoveryAdviser: { recordFailure: () => {}, suggest: async () => false },
      onStep: g => { log({ step: g.step, inventory: inventory(bot), error: g.lastError }); } };
    active = true;
    await assert.rejects(runGoal(bot, task, goal, store, options), { name: 'Cancelled' });
    assert(paused); goal = store.read(); assert(goal.batchWork.smelting);
    task = new Task('resume full armor smelt');
    const result = await runGoal(bot, task, goal, store, options); assert(result.ok, result.reason);
    await waitFor(task, () => goal.tasks.every(child => countOf(receiver, child.item) === child.count), 5000);
    for (const child of goal.tasks) assert.equal(child.delivered, child.count);
    assert.deepEqual(inputs, [24]); assert.deepEqual(fuels, [{ item: 'birch_planks', count: 16 }]);
    assert.deepEqual(crafted, { iron_helmet: 1, iron_chestplate: 1, iron_leggings: 1, iron_boots: 1 });
    assert.equal(countOf(bot, 'birch_planks'), 0); assert.equal(firstArmorIngots, 24);
    assert.equal(digs, 0); assert.equal(deaths, 0); assert.equal(bot.health, 20);
    log({ result: 'PASS', inputs, fuels, crafted, firstArmorIngots, digs, deaths, health: bot.health,
      independentlyReceived: inventory(receiver), remainingInventory: inventory(bot), resumed: true, directory });
  } catch (e) { log({ result: 'FAIL', error: e.stack, inputs, fuels, crafted, inventory: inventory(bot), position: bot.entity?.position, directory }); process.exitCode = 1; }
  finally { clearTimeout(timer); bot.pathfinder.setGoal(null); bot.clearControlStates(); bot.quit(); receiver.quit(); setTimeout(() => process.exit(process.exitCode || 0), 500); }
})();
