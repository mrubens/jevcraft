'use strict';
// Controlled worn tool, accessible stone and a world table. Real Survival
// replacement, reconnect and combined delivery; not natural-start acceptance.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const mineflayer = require('mineflayer'), { pathfinder } = require('mineflayer-pathfinder');
const { compatibilityPlugin } = require('../src/compatibility'), { configureMovements } = require('../src/movement');
const { Task, countOf } = require('../src/skills'), { GoalStore } = require('../src/objectives');
const { runGoal, waitFor, inventory } = require('../src/work');
const port = Number(process.env.MC_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535 || [25565, 25577].includes(port)) throw new Error('Explicit isolated MC_PORT required');
const id = Date.now().toString(36), x = Number(process.env.TOOL_TEST_X || 3200), directory = path.resolve('artifacts', `tool-request-recovery-${id}`);
fs.mkdirSync(directory, { recursive: true });
const log = event => { const row = JSON.stringify({ at: new Date().toISOString(), ...event }); console.log(row); fs.appendFileSync(path.join(directory, 'events.jsonl'), row + '\n'); };
let task = new Task('replace worn tool during request'), bot, observer, active = false, paused = false, deaths = 0, commands = 0, minimumHealth = 20;
const mined = [], placements = [], crafted = {}, errors = [];
const connect = username => {
  const b = mineflayer.createBot({ host: '127.0.0.1', port, username, version: '26.1', auth: 'offline' });
  b.loadPlugin(compatibilityPlugin); b.loadPlugin(pathfinder);
  b.on('death', () => { deaths++; task.cancel(); }); b.on('error', e => log({ error: e.message }));
  b.on('health', () => { if (active && b === bot) minimumHealth = Math.min(minimumHealth, b.health); });
  const write = b._client.write;
  b._client.write = function (name, packet, ...args) { if (active && name.startsWith('chat_command')) commands++; return write.call(this, name, packet, ...args); };
  return b;
};
const ready = async b => {
  await new Promise(r => b.once('spawn', r)); await b.waitForChunksToLoad(); configureMovements(b);
  // Compatibility installs the final crafting implementation during spawn.
  const craft = b.craft; assert.equal(typeof craft, 'function');
  b.craft = async function (recipe, count, table) {
    await craft.call(this, recipe, count, table); const name = b.registry.items[recipe.result.id].name;
    crafted[name] = (crafted[name] || 0) + recipe.result.count * count;
  };
};
const timer = setTimeout(() => task.cancel(), 5 * 60000);
(async () => {
  try {
    bot = connect(`Tool${id}`); observer = connect(`Take${id}`);
    observer.on('blockUpdate', (old, block) => {
      if (!active || !block || Math.abs(block.position.x - x) > 12 || Math.abs(block.position.z) > 8 || old?.name === block.name) return;
      if (block.name === 'air') mined.push({ block: old?.name, position: { ...block.position } });
      else placements.push({ block: block.name, position: { ...block.position } });
    });
    await Promise.all([ready(bot), ready(observer)]);
    const damage = bot.registry.itemsByName.wooden_pickaxe.maxDurability - 1;
    const setup = [`forceload add ${x - 16} -16 ${x + 16} 16`, `fill ${x - 10} 64 -8 ${x + 12} 72 8 air`,
      `fill ${x - 10} 61 -8 ${x + 12} 63 8 bedrock`, `fill ${x + 3} 64 -3 ${x + 3} 66 3 stone`, `setblock ${x + 1} 64 2 crafting_table`,
      `gamemode survival ${bot.username}`, `gamemode survival ${observer.username}`,
      `tp ${bot.username} ${x + .5} 64 .5`, `tp ${observer.username} ${x - 3.5} 64 3.5`,
      `give ${bot.username} wooden_pickaxe[damage=${damage}] 1`, `give ${bot.username} cobblestone 2`, `give ${bot.username} stick 2`];
    fs.writeFileSync(path.join(directory, 'setup.json'), JSON.stringify(setup, null, 2)); log({ phase: 'setup', directory });
    await waitFor(task, () => fs.existsSync(path.join(directory, 'ready')), 180000);
    await waitFor(task, () => countOf(bot, 'stick') === 2 && bot.entity.position.y === 64, 10000);
    assert.equal(bot.inventory.items().find(i => i.name === 'wooden_pickaxe').durabilityUsed, damage);
    assert.equal(countOf(bot, 'crafting_table'), 0);
    let goal = { version: 1, kind: 'bundle', request: 'Give me eight cobblestone and a furnace', from: observer.username,
      requesterPosition: { ...observer.entity.position }, tasks: [
        { kind: 'obtain', item: 'cobblestone', count: 8, deliver: true }, { kind: 'obtain', item: 'furnace', count: 1, deliver: true }] };
    const store = new GoalStore(path.join(directory, 'goal.json'));
    const options = { maxSteps: 80, survival: { state: {}, step: async () => false }, recoveryAdviser: { recordFailure() {}, suggest: async () => false },
      onStep: g => {
        minimumHealth = Math.min(minimumHealth, bot.health);
        if (g.lastError) errors.push(g.lastError);
        log({ step: g.step, error: g.lastError, inventory: inventory(bot) });
        if (!paused && countOf(bot, 'wooden_pickaxe') === 0 && countOf(bot, 'cobblestone') === 3) { paused = true; task.cancel(); }
      } };
    active = true;
    await assert.rejects(runGoal(bot, task, goal, store, options), { name: 'Cancelled' });
    assert(paused); assert.equal(mined.length, 1); assert.equal(countOf(bot, 'wooden_pickaxe'), 0);
    const username = bot.username, ended = new Promise(r => bot.once('end', r)); bot.quit(); await ended;
    bot = connect(username); await ready(bot); task = new Task('resume original combined request'); goal = store.read();
    assert.equal(goal.request, 'Give me eight cobblestone and a furnace');
    const result = await runGoal(bot, task, goal, store, options); assert(result.ok, result.reason);
    await waitFor(task, () => countOf(observer, 'cobblestone') === 8 && countOf(observer, 'furnace') === 1, 5000);
    assert.deepEqual(crafted, { stone_pickaxe: 1, furnace: 1 }); assert.equal(mined.length, 17); assert(mined.every(m => m.block === 'stone'));
    assert.equal(placements.length, 0); assert.equal(errors.length, 0, errors.join('; ')); assert.equal(countOf(bot, 'stone_pickaxe'), 1);
    assert.equal(countOf(bot, 'cobblestone'), 0); assert.equal(deaths, 0); assert.equal(commands, 0); assert.equal(minimumHealth, 20);
    log({ result: 'PASS', resumedAfterToolBroke: true, crafted, mined: mined.length, placements, errors, deaths, commands, minimumHealth,
      independentlyReceived: inventory(observer), remainingInventory: inventory(bot), directory });
  } catch (error) { log({ result: 'FAIL', error: error.stack, crafted, mined, placements, errors, inventory: bot && inventory(bot), directory }); process.exitCode = 1; }
  finally { clearTimeout(timer); for (const b of [bot, observer].filter(Boolean)) { b.pathfinder.setGoal(null); b.clearControlStates(); b.quit(); } setTimeout(() => process.exit(process.exitCode || 0), 500); }
})();
