'use strict';
// Controlled Survival crafting and staged delivery. The receiver stores the
// first load, then the builder resumes from its serialized checkpoint.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const mineflayer = require('mineflayer'), { pathfinder } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { compatibilityPlugin } = require('../src/compatibility');
const { configureMovements } = require('../src/movement');
const { Task, countOf } = require('../src/skills');
const { GoalStore } = require('../src/objectives');
const { runGoal, waitFor, inventory } = require('../src/work');
const port = Number(process.env.MC_PORT);
if (!Number.isInteger(port) || [25565, 25577].includes(port)) throw new Error('Explicit isolated MC_PORT required');
const id = Date.now().toString(36), directory = path.resolve('artifacts', `bundle-capacity-${id}`);
fs.mkdirSync(directory, { recursive: true });
const log = data => { const row = JSON.stringify({ at: new Date().toISOString(), ...data }); console.log(row); fs.appendFileSync(path.join(directory, 'events.jsonl'), row + '\n'); };
const connect = prefix => { const b = mineflayer.createBot({ host: '127.0.0.1', port, username: prefix + id, version: '26.1', auth: 'offline' }); b.loadPlugin(compatibilityPlugin); b.loadPlugin(pathfinder); return b; };
const bot = connect('Load'), receiver = connect('Keep');
let task = new Task('carrying batches'), paused = false, maxSlots = 0;
const timer = setTimeout(() => task.cancel(), 12 * 60000);
const ready = async b => { await new Promise(r => b.once('spawn', r)); await b.waitForChunksToLoad(); configureMovements(b); };
for (const b of [bot, receiver]) b.on('error', error => log({ error: error.message }));
(async () => {
  try {
    await Promise.all([ready(bot), ready(receiver)]);
    const x = Number(process.env.BUNDLE_TEST_X || 1100);
    const setup = [`forceload add ${x - 16} -16 ${x + 32} 32`, `fill ${x - 8} 61 -8 ${x + 16} 63 16 stone`, `fill ${x - 8} 64 -8 ${x + 16} 70 16 air`,
      `setblock ${x - 2} 64 2 chest`, `setblock ${x + 2} 64 2 crafting_table`,
      `tp ${bot.username} ${x + 2.5} 64 .5`, `tp ${receiver.username} ${x + .5} 64 .5`, `give ${bot.username} oak_log 64`];
    fs.writeFileSync(path.join(directory, 'setup.json'), JSON.stringify(setup, null, 2)); log({ phase: 'setup', directory, bot: bot.username, receiver: receiver.username });
    await waitFor(task, () => fs.existsSync(path.join(directory, 'ready')), 180000); await bot.waitForChunksToLoad();
    let goal = { kind: 'bundle', version: 1, request: 'Give me 40 wooden axes and two chests', from: receiver.username, requesterPosition: { ...receiver.entity.position },
      tasks: [{ kind: 'obtain', item: 'wooden_axe', count: 40, deliver: true }, { kind: 'obtain', item: 'chest', count: 2, deliver: true }] };
    const store = new GoalStore(path.join(directory, 'goal.json'));
    const options = { survival: { state: {}, step: async () => false }, recoveryAdviser: { recordFailure: () => {}, suggest: async () => false },
      onStep: g => {
        maxSlots = Math.max(maxSlots, bot.inventory.items().length);
        log({ step: g.step, delivered: g.tasks.map(t => t.delivered || 0), inventory: inventory(bot), error: g.lastError });
        if (!paused && g.tasks[0].delivered > 0 && g.tasks[0].delivered < 40) { paused = true; task.cancel(); }
      } };
    await assert.rejects(runGoal(bot, task, goal, store, options), { name: 'Cancelled' });
    const firstLoad = goal.tasks[0].delivered;
    assert(paused); await waitFor(new Task('pickup'), () => countOf(receiver, 'wooden_axe') === firstLoad, 5000);
    const chestBlock = receiver.blockAt(new Vec3(x - 2, 64, 2));
    const chest = await receiver.openChest(chestBlock);
    try { await chest.deposit(receiver.registry.itemsByName.wooden_axe.id, null, firstLoad); }
    finally { chest.close(); }
    await waitFor(new Task('store'), () => countOf(receiver, 'wooden_axe') === 0, 5000);
    goal = store.read(); task = new Task('resume carrying batches');
    const result = await runGoal(bot, task, goal, store, options); assert(result.ok, result.reason);
    await waitFor(task, () => countOf(receiver, 'wooden_axe') === 40 - firstLoad && countOf(receiver, 'chest') === 2, 5000);
    const stored = await receiver.openChest(chestBlock);
    try { assert.equal(stored.containerItems().filter(i => i.name === 'wooden_axe').reduce((n, i) => n + i.count, 0), firstLoad); }
    finally { stored.close(); }
    assert(maxSlots <= 30); assert.equal(goal.tasks[0].delivered, 40); assert.equal(goal.tasks[1].delivered, 2);
    log({ result: 'PASS', firstLoad, secondLoad: 40 - firstLoad, chests: 2, maxSlots, independentReceiverVerification: true, directory });
  } catch (error) { log({ result: 'FAIL', error: error.stack, inventory: inventory(bot), receiver: inventory(receiver), directory }); process.exitCode = 1; }
  finally { clearTimeout(timer); bot.pathfinder.setGoal(null); bot.quit(); receiver.quit(); setTimeout(() => process.exit(process.exitCode || 0), 500); }
})();
