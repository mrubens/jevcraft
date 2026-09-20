'use strict';
// Isolated supplied ledges: ordinary Survival chest crafting/placement and
// storage delivery, independently inspected by the recipient client.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const mineflayer = require('mineflayer'), { pathfinder } = require('mineflayer-pathfinder'), { Vec3 } = require('vec3');
const { compatibilityPlugin } = require('../src/compatibility'), { configureMovements } = require('../src/movement');
const { Task, countOf } = require('../src/skills'), { deliver } = require('../src/delivery');
const { waitFor } = require('../src/work');
const port = Number(process.env.MC_PORT), existing = process.env.CHEST_TEST_EXISTING === '1';
if (!Number.isInteger(port) || port < 1 || port > 65535 || [25565, 25577, 25579, 25580, 25582].includes(port)) throw new Error('Explicit isolated fixture MC_PORT required');
const id = Date.now().toString(36), x = existing ? 5640 : 5600, directory = path.resolve('artifacts', `chest-delivery-${id}`);
fs.mkdirSync(directory, { recursive: true });
const log = event => { const row = JSON.stringify({ at: new Date().toISOString(), ...event }); console.log(row); fs.appendFileSync(path.join(directory, 'events.jsonl'), row + '\n'); };
const connect = prefix => { const b = mineflayer.createBot({ host: '127.0.0.1', port, username: prefix + id, version: '26.1', auth: 'offline' }); b.loadPlugin(compatibilityPlugin); b.loadPlugin(pathfinder); return b; };
const bot = connect('Give'), receiver = connect('Take'), task = new Task('chest handover on a narrow step');
let active = false, minimumHealth = 20, deaths = 0, commands = 0, drops = 0;
const changes = [], chats = [], chest = new Vec3(x + 1, 62, 1);
const ready = async b => {
  await new Promise((resolve, reject) => { b.once('spawn', resolve); b.once('error', reject); b.once('end', reason => reject(new Error(`Fixture connection ended: ${reason}`))); });
  await b.waitForChunksToLoad(); configureMovements(b);
};
const readiness = [bot, receiver].map(ready);
bot.on('handover', e => { if (e.event === 'start') drops++; });
receiver.on('chat', (username, message) => { if (active && username === bot.username) chats.push(message); });
receiver.on('blockUpdate', (old, block) => { if (active && block && Math.abs(block.position.x - x) < 5 && Math.abs(block.position.z) < 5 && old?.name !== block.name) changes.push({ before: old?.name, after: block.name, position: { ...block.position } }); });
for (const b of [bot, receiver]) {
  b.on('error', e => log({ error: e.message })); b.on('death', () => { deaths++; task.cancel(); });
  b.on('physicsTick', () => { if (active) minimumHealth = Math.min(minimumHealth, b.health); });
  const write = b._client.write; b._client.write = function (name, packet, ...args) { if (active && name.startsWith('chat_command')) commands++; return write.call(this, name, packet, ...args); };
}
const timer = setTimeout(() => task.cancel(), 5 * 60000);
(async () => {
  try {
    await Promise.all(readiness);
    const setup = ['time set day', `forceload add ${x - 16} -16 ${x + 16} 16`,
      `fill ${x - 4} 60 -4 ${x + 4} 68 4 air`, `fill ${x - 4} 59 -4 ${x + 4} 59 4 bedrock`,
      `setblock ${x} 63 0 stone`, `setblock ${x + 1} 62 0 stone`, `setblock ${x + 1} 61 1 stone`,
      `setblock ${x - 1} 64 0 crafting_table`, `setblock ${x - 1} 65 0 bedrock`,
      `gamemode survival ${bot.username}`, `gamemode survival ${receiver.username}`,
      `tp ${bot.username} ${x + .5} 64 .5`, `tp ${receiver.username} ${x + 1.5} 63 .5`,
      `give ${bot.username} oak_planks ${existing ? 16 : 24}`];
    if (existing) setup.push(`setblock ${chest.x} ${chest.y} ${chest.z} chest`,
      `item replace block ${chest.x} ${chest.y} ${chest.z} container.0 with diamond 3`,
      `item replace block ${chest.x} ${chest.y} ${chest.z} container.1 with oak_planks 5`);
    fs.writeFileSync(path.join(directory, 'setup.json'), JSON.stringify(setup, null, 2)); log({ phase: 'setup', existing, directory });
    await waitFor(task, () => fs.existsSync(path.join(directory, 'ready')), 180000);
    await waitFor(task, () => countOf(bot, 'oak_planks') === (existing ? 16 : 24) && bot.entity.position.distanceTo(new Vec3(x + .5, 64, .5)) < .1 && receiver.entity.position.distanceTo(new Vec3(x + 1.5, 63, .5)) < .1, 10000);
    assert.equal(receiver.inventory.items().length, 0); assert.equal(bot.game.gameMode, 'survival'); active = true;
    const goal = { kind: 'obtain', deliver: true, item: 'oak_planks', count: 16, from: receiver.username };
    let pendingCheckpoint;
    const save = () => {
      fs.writeFileSync(path.join(directory, 'goal.json'), JSON.stringify(goal, null, 2));
      if (goal.pendingChestDelivery) pendingCheckpoint = structuredClone(goal);
    };
    let done = false;
    for (let step = 0; step < 12 && !done; step++) done = await deliver(bot, task, goal, save);
    assert(done); assert.equal(goal.delivered, 16); assert(!goal.pendingChestDelivery); assert(!goal.pendingDelivery);
    assert.equal(goal.deliveryMode, 'chest'); assert.equal(drops, 0); assert.equal(countOf(bot, 'oak_planks'), 0);
    assert.equal(countOf(bot, 'chest'), 0); assert.equal(bot.blockAt(chest).name, 'chest');
    assert.deepEqual(goal.deliveryEvidence.map(e => ({ method: e.method, count: e.count, position: e.position })), [{ method: 'chest', count: 16, position: { ...chest } }]);
    const inspect = async () => {
      const w = await receiver.openContainer(receiver.blockAt(chest));
      if (receiver._syncWindow) await receiver._syncWindow(w);
      const items = w.containerItems().map(i => ({ name: i.name, count: i.count })); w.close(); return items;
    };
    const contents = await inspect();
    assert.equal(contents.filter(i => i.name === 'oak_planks').reduce((n, i) => n + i.count, 0), existing ? 21 : 16);
    assert.equal(contents.filter(i => i.name === 'diamond').reduce((n, i) => n + i.count, 0), existing ? 3 : 0);
    assert(pendingCheckpoint);
    fs.writeFileSync(path.join(directory, 'pre-confirmation-checkpoint.json'), JSON.stringify(pendingCheckpoint, null, 2));
    assert(await deliver(bot, task, pendingCheckpoint, () => {}));
    assert.equal(pendingCheckpoint.delivered, 16); assert(!pendingCheckpoint.pendingChestDelivery);
    assert.deepEqual(await inspect(), contents, 'Reopening a checkpoint saved before confirmation cannot deposit twice');
    assert(await deliver(bot, task, JSON.parse(JSON.stringify(goal)), save)); assert.deepEqual(await inspect(), contents);
    assert.equal(countOf(receiver, 'oak_planks'), 0, 'Stored items are not falsely reported as a player pickup');
    assert(changes.every(c => c.after === 'chest' && c.position.x === chest.x && c.position.y === chest.y && c.position.z === chest.z));
    assert.equal(changes.length, existing ? 0 : 1); assert.equal(minimumHealth, 20); assert.equal(deaths, 0); assert.equal(commands, 0);
    log({ result: 'PASS', existing, contents, changes, chats, minimumHealth, deaths, commands, drops, evidence: goal.deliveryEvidence, directory });
  } catch (error) { log({ result: 'FAIL', error: error.stack, position: bot.entity?.position, changes, chats, drops, directory }); process.exitCode = 1; }
  finally { clearTimeout(timer); for (const b of [bot, receiver]) { b.pathfinder.setGoal(null); b.clearControlStates(); b.quit(); } setTimeout(() => process.exit(process.exitCode || 0), 500); }
})();
