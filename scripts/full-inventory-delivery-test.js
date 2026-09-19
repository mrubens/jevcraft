'use strict';
// Controlled full inventory on a narrow ledge. All terrain/grants/teleports
// are applied externally to an isolated server, not through the bot.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const mineflayer = require('mineflayer'), { pathfinder } = require('mineflayer-pathfinder'), { Vec3 } = require('vec3');
const { compatibilityPlugin } = require('../src/compatibility'), { configureMovements } = require('../src/movement');
const { Task, countOf } = require('../src/skills'), { deliver } = require('../src/delivery');
const { waitFor, inventory } = require('../src/work');
const port = Number(process.env.MC_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535 || [25565, 25577].includes(port)) throw new Error('Explicit isolated MC_PORT required');
const id = Date.now().toString(36), x = Number(process.env.DELIVERY_TEST_X || 1800), directory = path.resolve('artifacts', `full-inventory-delivery-${id}`);
fs.mkdirSync(directory, { recursive: true });
const log = value => { const row = JSON.stringify({ at: new Date().toISOString(), ...value }); console.log(row); fs.appendFileSync(path.join(directory, 'events.jsonl'), row + '\n'); };
const connect = prefix => { const b = mineflayer.createBot({ host: '127.0.0.1', port, username: prefix + id, version: '26.1', auth: 'offline' }); b.loadPlugin(compatibilityPlugin); b.loadPlugin(pathfinder); return b; };
const bot = connect('Give'), receiver = connect('Take'), task = new Task('give part of a stack with full inventory');
const timer = setTimeout(() => task.cancel(), 4 * 60000);
let active = false, lowest = 72, deaths = 0, singleDrops = 0, wholeDrops = 0;
const originalWrite = bot._client.write;
bot._client.write = function (name, packet, ...args) {
  if (active && name === 'block_dig') { if (packet.status === 4) singleDrops++; if (packet.status === 3) wholeDrops++; }
  return originalWrite.call(this, name, packet, ...args);
};
for (const b of [bot, receiver]) {
  b.on('error', e => log({ error: e.message })); b.on('death', () => { deaths++; task.cancel(); });
  b.on('physicsTick', () => { if (active) lowest = Math.min(lowest, b.entity.position.y); });
}
const ready = async b => { await new Promise(r => b.once('spawn', r)); await b.waitForChunksToLoad(); configureMovements(b); };
(async () => {
  try {
    await Promise.all([ready(bot), ready(receiver)]);
    const commands = [`forceload add ${x - 16} -16 ${x + 16} 16`, `fill ${x - 4} 64 -4 ${x + 10} 76 4 air`,
      `fill ${x - 4} 61 -4 ${x + 10} 63 4 stone`, `fill ${x - 2} 71 0 ${x + 7} 71 0 stone`,
      `gamemode survival ${bot.username}`, `gamemode survival ${receiver.username}`,
      `tp ${bot.username} ${x + .5} 72 .5`, `tp ${receiver.username} ${x + 4.5} 72 .25`,
      `give ${bot.username} pumpkin 17`, `give ${bot.username} stone_axe 35`];
    fs.writeFileSync(path.join(directory, 'setup.json'), JSON.stringify(commands, null, 2)); log({ phase: 'setup', directory, bot: bot.username, receiver: receiver.username });
    await waitFor(task, () => fs.existsSync(path.join(directory, 'ready')), 180000);
    await waitFor(task, () => countOf(bot, 'pumpkin') === 17 && countOf(bot, 'stone_axe') === 35 && bot.entity.position.y === 72 && receiver.entity.position.y === 72, 10000);
    assert.equal(bot.inventory.firstEmptyInventorySlot(), null); assert.equal(bot.inventory.items().length, 36);
    assert.equal(receiver.inventory.items().length, 0);
    active = true;
    let delivered = 0;
    for (const count of [1, 5]) {
      const goal = { item: 'pumpkin', count, from: receiver.username };
      const save = () => fs.writeFileSync(path.join(directory, `goal-${count}.json`), JSON.stringify(goal, null, 2));
      assert(await deliver(bot, task, goal, save)); delivered += count;
      await waitFor(task, () => countOf(receiver, 'pumpkin') === delivered, 5000);
      assert.equal(countOf(bot, 'pumpkin'), 17 - delivered);
      assert.equal(goal.delivered, count); assert(!goal.pendingDelivery);
      assert.equal(countOf(bot, 'stone_axe'), 35); assert.equal(countOf(receiver, 'stone_axe'), 0);
      assert.equal(bot.inventory.items().length, 36); assert.equal(bot.inventory.firstEmptyInventorySlot(), null);
      const saved = JSON.parse(fs.readFileSync(path.join(directory, `goal-${count}.json`)));
      assert(await deliver(bot, task, saved, save));
      assert.equal(singleDrops, delivered, 'resuming completed delivery sends no extra items');
      log({ delivered: count, totalReceived: delivered, carried: inventory(bot), occupiedSlots: 36, evidence: goal.deliveryEvidence });
    }
    assert.equal(wholeDrops, 0); assert.equal(singleDrops, 6); assert.equal(deaths, 0);
    assert(lowest >= 72); assert.equal(bot.health, 20); assert.equal(receiver.health, 20);
    log({ result: 'PASS', singleDrops, wholeDrops, totalReceived: delivered, remainingPumpkins: countOf(bot, 'pumpkin'),
      reservedAxes: countOf(bot, 'stone_axe'), minimumHeight: lowest, independentReceiverInventory: inventory(receiver), directory });
  } catch (e) { log({ result: 'FAIL', error: e.stack, bot: inventory(bot), receiver: inventory(receiver), directory }); process.exitCode = 1; }
  finally { clearTimeout(timer); bot.pathfinder.setGoal(null); bot.clearControlStates(); bot.quit(); receiver.quit(); setTimeout(() => process.exit(process.exitCode || 0), 500); }
})();
