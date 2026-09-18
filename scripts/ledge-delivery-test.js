'use strict';
// Controlled one-block-wide ledge. Setup grants/teleports are recorded and
// external; actual delivery must be observed by both clients.
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const mineflayer = require('mineflayer');
const { pathfinder } = require('mineflayer-pathfinder');
const { compatibilityPlugin } = require('../src/compatibility');
const { configureMovements } = require('../src/movement');
const { Task, countOf } = require('../src/skills');
const { deliver } = require('../src/delivery');
const { inventory, waitFor } = require('../src/work');
const id = Date.now().toString(36), site = Number(process.env.LEDGE_SITE || 1500);
if (!Number.isInteger(site)) throw new Error('LEDGE_SITE must be an integer');
const directory = path.join(__dirname, '..', 'artifacts', `ledge-delivery-${id}`);
fs.mkdirSync(directory, { recursive: true });
const log = data => { const line = JSON.stringify({ at: new Date().toISOString(), ...data }); console.log(line); fs.appendFileSync(path.join(directory, 'events.jsonl'), line + '\n'); };
function connect(username) {
  const bot = mineflayer.createBot({ host: process.env.MC_HOST || '127.0.0.1', port: Number(process.env.MC_PORT || 25567), username, version: '26.1', auth: 'offline' });
  bot.loadPlugin(compatibilityPlugin); bot.loadPlugin(pathfinder);
  return bot;
}
const bot = connect(`Give${id}`), receiver = connect(`Take${id}`);
const task = new Task('ledge', 'deliver on a narrow ledge');
const timer = setTimeout(() => task.cancel(), 240000);
bot.on('handover', data => log({ handover: data }));
for (const client of [bot, receiver]) client.on('error', e => log({ error: e.message }));
async function ready(client) { await new Promise((resolve, reject) => { client.once('spawn', resolve); client.once('error', reject); }); await client.waitForChunksToLoad(); configureMovements(client); }
(async () => {
  try {
    await Promise.all([ready(bot), ready(receiver)]);
    const setupFile = path.join(directory, 'setup-ready');
    const commands = [`tp ${bot.username} ${site + 0.5} 64 ${site + 0.5}`,
      `tp ${receiver.username} ${site + 4.5} 64 ${site + 0.25}`,
      `fill ${site - 2} 71 ${site} ${site + 7} 71 ${site} minecraft:stone`,
      `tp ${bot.username} ${site + 0.5} 72 ${site + 0.5}`,
      `tp ${receiver.username} ${site + 4.5} 72 ${site + 0.25}`,
      `give ${bot.username} minecraft:stick 32`, `give ${bot.username} minecraft:stone_axe 5`];
    fs.writeFileSync(path.join(directory, 'setup.json'), JSON.stringify(commands));
    log({ phase: 'setup', scenario: 'controlled ledge delivery', commands, setupFile, directory });
    await waitFor(task, () => fs.existsSync(setupFile), 180000);
    await waitFor(task, () => countOf(bot, 'stone_axe') === 5 && bot.entity.position.y === 72 && receiver.entity.position.y === 72);
    assert.equal(bot.game.gameMode, 'survival'); assert.equal(receiver.inventory.items().length, 0);
    let lowest = 72;
    const observe = () => { lowest = Math.min(lowest, bot.entity.position.y, receiver.entity.position.y); };
    bot.on('physicsTick', observe);
    for (const [item, count] of [['stick', 32], ['stone_axe', 5]]) {
      const goal = { item, count, from: receiver.username };
      assert(await deliver(bot, task, goal, () => fs.writeFileSync(path.join(directory, `${item}.json`), JSON.stringify(goal))));
      await waitFor(task, () => countOf(receiver, item) === count);
      assert.equal(countOf(bot, item), 0);
      assert.equal(goal.delivered, count);
      assert(goal.deliveryEvidence.length > 0);
      log({ delivered: item, count, position: bot.entity.position, receiverPosition: receiver.entity.position, evidence: goal.deliveryEvidence });
    }
    bot.removeListener('physicsTick', observe);
    assert(lowest >= 72, 'Both players must remain on the ledge');
    assert.equal(bot.health, 20);
    log({ result: 'PASS', receiverInventory: inventory(receiver), minimumHeight: lowest, directory });
  } catch (err) { log({ result: 'FAIL', error: err.stack, inventory: inventory(bot), receiverInventory: inventory(receiver), directory }); process.exitCode = 1; }
  finally { clearTimeout(timer); bot.pathfinder.setGoal(null); bot.quit(); receiver.quit(); setTimeout(() => process.exit(process.exitCode || 0), 500); }
})();
