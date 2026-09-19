'use strict';
// Controlled supplies and sealed stations on an isolated server. Recipes,
// station placement, stop/resume, smelting, and delivery use ordinary Survival.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const mineflayer = require('mineflayer'), { pathfinder } = require('mineflayer-pathfinder'), { Vec3 } = require('vec3');
const { compatibilityPlugin } = require('../src/compatibility'), { configureMovements } = require('../src/movement');
const { Task, countOf } = require('../src/skills'), { GoalStore } = require('../src/objectives');
const { runGoal, waitFor, inventory } = require('../src/work');
const port = Number(process.env.MC_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535 || [25565, 25577].includes(port)) throw new Error('Explicit isolated MC_PORT required');
const id = Date.now().toString(36), x = Number(process.env.STATION_TEST_X || 2100), directory = path.resolve('artifacts', `station-replacement-${id}`);
fs.mkdirSync(directory, { recursive: true });
const log = value => { const row = JSON.stringify({ at: new Date().toISOString(), ...value }); console.log(row); fs.appendFileSync(path.join(directory, 'events.jsonl'), row + '\n'); };
const connect = prefix => { const b = mineflayer.createBot({ host: '127.0.0.1', port, username: prefix + id, version: '26.1', auth: 'offline' }); b.loadPlugin(compatibilityPlugin); b.loadPlugin(pathfinder); return b; };
const bot = connect('Make'), receiver = connect('Take'), stations = ['crafting_table', 'furnace'];
let task = new Task('make replacement stations'), paused = false, active = false, digs = 0, deaths = 0, fuelLoaded = 0;
const crafted = {}, placements = [], inputs = [], opens = [];
const sealedTable = new Vec3(x + 2, 64, 0), sealedFurnace = new Vec3(x + 2, 64, 3), originalWrite = bot._client.write;
bot._client.write = function (name, packet, ...args) {
  if (active && name === 'block_dig' && [0, 2].includes(packet.status)) digs++;
  if (active && name === 'block_place') { const block = bot.blockAt(packet.location); if (stations.includes(block?.name)) opens.push({ name: block.name, position: { ...block.position } }); }
  return originalWrite.call(this, name, packet, ...args);
};
receiver.on('blockUpdate', (old, block) => { if (active && stations.includes(block?.name) && old?.name !== block.name) placements.push({ name: block.name, position: { ...block.position } }); });
for (const b of [bot, receiver]) { b.on('error', e => log({ error: e.message })); b.on('death', () => { deaths++; task.cancel(); }); }
const timer = setTimeout(() => task.cancel(), 5 * 60000);
const ready = async b => { await new Promise(r => b.once('spawn', r)); await b.waitForChunksToLoad(); configureMovements(b); };
(async () => {
  try {
    await Promise.all([ready(bot), ready(receiver)]);
    const commands = [`forceload add ${x - 16} -16 ${x + 16} 16`, `fill ${x - 8} 64 -8 ${x + 12} 72 10 air`,
      `fill ${x - 8} 61 -8 ${x + 12} 63 10 stone`, `fill ${x + 1} 64 -1 ${x + 3} 67 4 stone`,
      `setblock ${sealedTable.x} 64 0 crafting_table`, `setblock ${sealedFurnace.x} 64 3 furnace`,
      `gamemode survival ${bot.username}`, `gamemode survival ${receiver.username}`,
      `tp ${bot.username} ${x + .5} 64 .5`, `tp ${receiver.username} ${x - 3.5} 64 3.5`,
      `give ${bot.username} oak_log 6`, `give ${bot.username} sand 4`, `give ${bot.username} cobblestone 8`];
    fs.writeFileSync(path.join(directory, 'setup.json'), JSON.stringify(commands, null, 2)); log({ phase: 'setup', directory });
    await waitFor(task, () => fs.existsSync(path.join(directory, 'ready')), 180000);
    await waitFor(task, () => countOf(bot, 'oak_log') === 6 && bot.entity.position.x > x && bot.entity.position.y === 64, 10000);
    assert.equal(countOf(bot, 'crafting_table'), 0); assert.equal(countOf(bot, 'furnace'), 0);
    const nativeCraft = bot.craft, nativeOpen = bot.openFurnace;
    bot.craft = async function (recipe, count, table) { await nativeCraft.call(this, recipe, count, table); const name = bot.registry.items[recipe.result.id].name; crafted[name] = (crafted[name] || 0) + recipe.result.count * count; };
    bot.openFurnace = async function (block) {
      const window = await nativeOpen.call(this, block), putInput = window.putInput, putFuel = window.putFuel;
      window.putInput = async (...args) => { await putInput.apply(window, args); inputs.push(args[2]); };
      window.putFuel = async (...args) => { await putFuel.apply(window, args); fuelLoaded += args[2]; };
      return window;
    };
    let goal = { version: 1, kind: 'bundle', request: 'Give me a chest and four glass', from: receiver.username, requesterPosition: { ...receiver.entity.position },
      tasks: [{ kind: 'obtain', item: 'chest', count: 1, deliver: true }, { kind: 'obtain', item: 'glass', count: 4, deliver: true }] };
    const store = new GoalStore(path.join(directory, 'goal.json'));
    const options = { maxSteps: 30, survival: { state: {}, step: async () => false }, recoveryAdviser: { recordFailure: () => {}, suggest: async () => false },
      onStep: g => {
        log({ step: g.step, inventory: inventory(bot), error: g.lastError });
        if (!paused && countOf(bot, 'furnace') === 1) { paused = true; task.cancel(); }
      } };
    active = true;
    await assert.rejects(runGoal(bot, task, goal, store, options), { name: 'Cancelled' });
    assert(paused); assert.equal(crafted.crafting_table, 1); assert.equal(crafted.furnace, 1);
    goal = store.read(); task = new Task('resume with replacement furnace');
    const result = await runGoal(bot, task, goal, store, options); assert(result.ok, result.reason);
    await waitFor(task, () => countOf(receiver, 'chest') === 1 && countOf(receiver, 'glass') === 4, 5000);
    assert.deepEqual(inputs, [4]); assert.equal(fuelLoaded, 3); assert.equal(crafted.crafting_table, 1); assert.equal(crafted.furnace, 1);
    assert.equal(placements.filter(p => p.name === 'crafting_table').length, 1); assert.equal(placements.filter(p => p.name === 'furnace').length, 1);
    assert(opens.every(o => !sealedTable.equals(o.position) && !sealedFurnace.equals(o.position)), 'never activate the sealed stations');
    for (let dx = 1; dx <= 3; dx++) for (let y = 64; y <= 67; y++) for (let z = -1; z <= 4; z++) {
      const p = new Vec3(x + dx, y, z), expected = p.equals(sealedTable) ? 'crafting_table' : p.equals(sealedFurnace) ? 'furnace' : 'stone';
      assert.equal(receiver.blockAt(p)?.name, expected, `enclosure preserved at ${p}`);
    }
    assert.equal(digs, 0); assert.equal(deaths, 0); assert.equal(bot.health, 20);
    assert.equal(goal.tasks[0].delivered, 1); assert.equal(goal.tasks[1].delivered, 4);
    log({ result: 'PASS', crafted, placements, inputs, fuelLoaded, digs, deaths, health: bot.health,
      independentlyReceived: inventory(receiver), remainingInventory: inventory(bot), resumed: true, directory });
  } catch (e) { log({ result: 'FAIL', error: e.stack, inventory: inventory(bot), position: bot.entity?.position, directory }); process.exitCode = 1; }
  finally { clearTimeout(timer); bot.pathfinder.setGoal(null); bot.clearControlStates(); bot.quit(); receiver.quit(); setTimeout(() => process.exit(process.exitCode || 0), 500); }
})();
