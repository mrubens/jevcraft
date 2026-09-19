'use strict';
// Only an isolated, externally prepared server. The worker sends no commands.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const mineflayer = require('mineflayer'), { pathfinder, goals } = require('mineflayer-pathfinder'), { Vec3 } = require('vec3');
const { compatibilityPlugin } = require('../src/compatibility'), { configureMovements } = require('../src/movement');
const { Task, countOf, navigate } = require('../src/skills');
const { acquireStep, smelt, waitFor, inventory } = require('../src/work');
const port = Number(process.env.MC_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535 || [25565, 25577].includes(port)) throw new Error('Explicit isolated MC_PORT required');
const id = Date.now().toString(36), x = Number(process.env.WORKSTATION_TEST_X || 1900), directory = path.resolve('artifacts', `workstation-access-${id}`);
fs.mkdirSync(directory, { recursive: true });
const log = value => { const row = JSON.stringify({ at: new Date().toISOString(), ...value }); console.log(row); fs.appendFileSync(path.join(directory, 'events.jsonl'), row + '\n'); };
const connect = prefix => { const b = mineflayer.createBot({ host: '127.0.0.1', port, username: prefix + id, version: '26.1', auth: 'offline' }); b.loadPlugin(compatibilityPlugin); b.loadPlugin(pathfinder); return b; };
const bot = connect('Bench'), observer = connect('See'), task = new Task('workstation alternatives');
let activeTask = task, active = false, digs = 0, deaths = 0, inputs = 0;
const opens = [], placements = [], originalWrite = bot._client.write;
const sealedTable = new Vec3(x + 2, 64, 0), table = new Vec3(x + 9, 64, 0), sealedFurnace = new Vec3(x + 2, 64, 3), furnace = new Vec3(x + 9, 64, 3);
bot._client.write = function (name, packet, ...args) {
  if (active && name === 'block_dig' && [0, 2].includes(packet.status)) digs++;
  if (active && name === 'block_place') {
    const block = bot.blockAt(packet.location);
    if (['crafting_table', 'furnace'].includes(block?.name)) opens.push({ name: block.name, position: { ...block.position } });
  }
  return originalWrite.call(this, name, packet, ...args);
};
observer.on('blockUpdate', (old, block) => {
  if (active && block?.name === 'crafting_table' && old?.name !== block.name) placements.push({ ...block.position });
});
for (const b of [bot, observer]) { b.on('error', e => log({ error: e.message })); b.on('death', () => { deaths++; activeTask.cancel(); }); }
const timer = setTimeout(() => activeTask.cancel(), 5 * 60000);
const ready = async b => { await new Promise(r => b.once('spawn', r)); await b.waitForChunksToLoad(); configureMovements(b); };
const prepare = async (name, commands) => {
  fs.writeFileSync(path.join(directory, `${name}.json`), JSON.stringify(commands, null, 2)); log({ phase: name, directory });
  await waitFor(task, () => fs.existsSync(path.join(directory, `${name}-ready`)), 180000);
};
(async () => {
  try {
    await Promise.all([ready(bot), ready(observer)]);
    await prepare('setup', [`forceload add ${x - 16} -16 ${x + 32} 16`,
      `fill ${x - 6} 64 -6 ${x + 18} 72 9 air`, `fill ${x - 6} 61 -6 ${x + 18} 63 9 stone`,
      `fill ${x + 1} 64 -1 ${x + 3} 67 4 stone`,
      ...[sealedTable, table].map(p => `setblock ${p.x} ${p.y} ${p.z} crafting_table`),
      ...[sealedFurnace, furnace].map(p => `setblock ${p.x} ${p.y} ${p.z} furnace`),
      `gamemode survival ${bot.username}`, `gamemode survival ${observer.username}`,
      `tp ${bot.username} ${x + .5} 64 .5`, `tp ${observer.username} ${x - 3.5} 64 6.5`,
      `give ${bot.username} oak_planks 20`, `give ${bot.username} sand 2`, `give ${bot.username} cobblestone 64`]);
    await waitFor(task, () => countOf(bot, 'oak_planks') === 20 && bot.entity.position.x > x && bot.entity.position.y === 64, 10000);
    active = true;
    await acquireStep(bot, task, 'chest', 1, {}, () => {});
    assert.equal(countOf(bot, 'chest'), 1);
    assert.deepEqual(opens[0], { name: 'crafting_table', position: { ...table } });
    log({ phase: 'alternate table', opens, inventory: inventory(bot) });
    await navigate(bot, task, new goals.GoalBlock(x, 64, 0));
    const goal = {}, save = () => fs.writeFileSync(path.join(directory, 'furnace-goal.json'), JSON.stringify(goal, null, 2));
    const stopped = activeTask = new Task('pause furnace after first output'), originalOpen = bot.openFurnace;
    bot.openFurnace = async block => {
      const window = await originalOpen.call(bot, block), put = window.putInput, take = window.takeOutput;
      window.putInput = async (...args) => { inputs++; return put.apply(window, args); };
      window.takeOutput = async () => { await take.call(window); if (activeTask === stopped) stopped.cancel(); };
      return window;
    };
    await assert.rejects(smelt(bot, stopped, { item: 'glass', from: 'sand', count: 2 }, goal, save), { name: 'Cancelled' });
    assert.equal(countOf(bot, 'glass'), 1); assert.deepEqual(goal.smelting.position, { ...furnace });
    activeTask = task;
    await smelt(bot, task, goal.smelting, goal, save);
    assert.equal(countOf(bot, 'glass'), 2); assert.equal(inputs, 1); assert(!goal.smelting);
    assert(opens.filter(o => o.name === 'furnace').every(o => new Vec3(o.position.x, o.position.y, o.position.z).equals(furnace)));
    log({ phase: 'alternate furnace and resume', opens, inputs, inventory: inventory(bot) });
    active = false;
    await prepare('portable', [`tp ${bot.username} ${x + .5} 64 .5`, `give ${bot.username} crafting_table 1`]);
    await waitFor(task, () => countOf(bot, 'crafting_table') === 1 && bot.entity.position.x < x + 1, 10000);
    active = true;
    await acquireStep(bot, task, 'chest', 2, {}, () => {});
    await waitFor(task, () => placements.length === 1, 3000);
    assert.equal(countOf(bot, 'chest'), 2); assert.equal(bot._ownedWorkstations.size, 1);
    assert(bot.entity.position.distanceTo(table) > 4); assert.equal(countOf(bot, 'crafting_table'), 0);
    assert.equal(countOf(bot, 'cobblestone'), 64); assert.equal(digs, 0); assert.equal(deaths, 0); assert.equal(bot.health, 20);
    assert(opens.every(o => !sealedTable.equals(o.position) && !sealedFurnace.equals(o.position)), 'never activate a sealed station');
    for (let dx = 1; dx <= 3; dx++) for (let y = 64; y <= 67; y++) for (let z = -1; z <= 4; z++) {
      const p = new Vec3(x + dx, y, z), expected = p.equals(sealedTable) ? 'crafting_table' : p.equals(sealedFurnace) ? 'furnace' : 'stone';
      assert.equal(observer.blockAt(p)?.name, expected, `enclosure preserved at ${p}`);
    }
    assert.equal(observer.blockAt(table)?.name, 'crafting_table'); assert.equal(observer.blockAt(furnace)?.name, 'furnace');
    log({ result: 'PASS', opens, independentlyObservedPlacements: placements, digs, deaths, health: bot.health, inventory: inventory(bot), directory });
  } catch (e) { log({ result: 'FAIL', error: e.stack, inventory: inventory(bot), position: bot.entity?.position, directory }); process.exitCode = 1; }
  finally { clearTimeout(timer); bot.pathfinder.setGoal(null); bot.clearControlStates(); bot.quit(); observer.quit(); setTimeout(() => process.exit(process.exitCode || 0), 500); }
})();
