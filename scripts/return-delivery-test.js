'use strict';
// Supplied stair/ledge fixture: ordinary Survival return travel and a one-block
// height difference at handover, independently checked by the recipient.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const mineflayer = require('mineflayer'), { pathfinder } = require('mineflayer-pathfinder'), { Vec3 } = require('vec3');
const { compatibilityPlugin } = require('../src/compatibility'), { configureMovements } = require('../src/movement');
const { Task, countOf } = require('../src/skills'), { deliver } = require('../src/delivery');
const { inventory, waitFor } = require('../src/work');
const port = Number(process.env.MC_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535 || [25565, 25577].includes(port)) throw new Error('Explicit isolated MC_PORT required');
const uphill = process.env.DELIVERY_TEST_UPHILL === '1', id = Date.now().toString(36), x = uphill ? 3880 : 3800;
const directory = path.resolve('artifacts', `return-delivery-${id}`); fs.mkdirSync(directory, { recursive: true });
const log = data => { const row = JSON.stringify({ at: new Date().toISOString(), ...data }); console.log(row); fs.appendFileSync(path.join(directory, 'events.jsonl'), row + '\n'); };
const connect = prefix => { const b = mineflayer.createBot({ host: '127.0.0.1', port, username: prefix + id, version: '26.1', auth: 'offline' }); b.loadPlugin(compatibilityPlugin); b.loadPlugin(pathfinder); return b; };
const bot = connect('Give'), receiver = connect('Take'), task = new Task('return from below and deliver');
let active = false, minimumHealth = 20, deaths = 0, commands = 0, start;
const changes = [], positions = [], handovers = [];
bot.on('handover', event => { handovers.push(event); log({ handover: event }); });
receiver.on('entityMoved', entity => { if (active && entity.username === bot.username) positions.push({ ...entity.position }); });
receiver.on('blockUpdate', (old, block) => {
  if (active && block && block.position.x >= x - 2 && block.position.x <= x + 28 && Math.abs(block.position.z) <= 2 && old?.name !== block.name)
    changes.push({ before: old?.name, after: block.name, position: { ...block.position } });
});
for (const b of [bot, receiver]) {
  b.on('error', e => log({ error: e.message })); b.on('death', () => { deaths++; task.cancel(); });
  b.on('health', () => { if (active) minimumHealth = Math.min(minimumHealth, b.health); });
  const write = b._client.write;
  b._client.write = function (name, packet, ...args) { if (active && name.startsWith('chat_command')) commands++; return write.call(this, name, packet, ...args); };
}
const ready = async b => {
  await new Promise((resolve, reject) => {
    const cleanup = () => { b.removeListener('spawn', spawned); b.removeListener('error', failed); b.removeListener('end', ended); };
    const spawned = () => { cleanup(); resolve(); }, failed = error => { cleanup(); reject(error); };
    const ended = reason => failed(new Error(`Disconnected before fixture spawn: ${reason}`));
    b.once('spawn', spawned); b.once('error', failed); b.once('end', ended);
  });
  await b.waitForChunksToLoad(); configureMovements(b);
};
const timer = setTimeout(() => task.cancel(), 5 * 60000);
(async () => {
  try {
    await Promise.all([ready(bot), ready(receiver)]);
    const setup = [`forceload add ${x - 16} -16 ${x + 32} 16`,
      `kill @e[type=minecraft:item,x=${x - 2},y=48,z=-2,dx=30,dy=29,dz=4]`, `fill ${x - 2} 49 -2 ${x + 28} 76 2 air`,
      `fill ${x - 2} 48 -2 ${x + 28} 48 2 bedrock`];
    for (let step = 0; step <= (uphill ? 21 : 23); step++) setup.push(`setblock ${x + step} ${48 + step} 0 stone`);
    setup.push(...(uphill ? [`fill ${x + 22} 69 0 ${x + 24} 69 0 stone`, `setblock ${x + 25} 70 0 stone`] : [`fill ${x + 24} 70 0 ${x + 25} 70 0 stone`]),
      `gamemode survival ${bot.username}`, `gamemode survival ${receiver.username}`,
      `tp ${bot.username} ${x + .5} 49 .5`, `tp ${receiver.username} ${x + 25.5} 71 .5`, `give ${bot.username} cobblestone 17`);
    fs.writeFileSync(path.join(directory, 'setup.json'), JSON.stringify(setup, null, 2)); log({ phase: 'setup', uphill, directory });
    await waitFor(task, () => fs.existsSync(path.join(directory, 'ready')), 180000);
    await waitFor(task, () => countOf(bot, 'cobblestone') === 17 && bot.entity.position.distanceTo(new Vec3(x + .5, 49, .5)) < .2 && receiver.entity.position.y === 71, 10000);
    assert.equal(receiver.inventory.items().length, 0); assert.equal(bot.game.gameMode, 'survival');
    start = { ...bot.entity.position }; active = true;
    const goal = { kind: 'obtain', item: 'cobblestone', count: 16, from: receiver.username, request: 'give me 16 cobblestone' };
    const save = () => fs.writeFileSync(path.join(directory, 'goal.json'), JSON.stringify(goal, null, 2));
    assert(await deliver(bot, task, goal, save));
    await waitFor(task, () => countOf(receiver, 'cobblestone') === 16, 5000);
    assert.equal(countOf(bot, 'cobblestone'), 1); assert.equal(goal.delivered, 16); assert(!goal.pendingDelivery);
    const handover = handovers.find(e => e.event === 'start');
    assert.equal(handover.position.y - handover.recipient.y, uphill ? -1 : 1);
    assert(positions.length > 10 && positions.some(p => p.y >= 70), 'Independent receiver observed the ascent');
    assert.equal(changes.length, 0, 'Return route preserves terrain and delivery supplies');
    const saved = JSON.parse(fs.readFileSync(path.join(directory, 'goal.json'))), before = handovers.length;
    assert(await deliver(bot, task, saved, save)); assert.equal(handovers.length, before, 'Completed checkpoint never throws twice');
    assert.equal(minimumHealth, 20); assert.equal(deaths, 0); assert.equal(commands, 0);
    log({ result: 'PASS', uphill, start, handover, receiverInventory: inventory(receiver), botInventory: inventory(bot), observedMovementPackets: positions.length,
      minimumHealth, deaths, commands, directory });
  } catch (error) { log({ result: 'FAIL', uphill, error: error.stack, changes, position: bot.entity?.position, botInventory: inventory(bot), receiverInventory: inventory(receiver), directory }); process.exitCode = 1; }
  finally { clearTimeout(timer); for (const b of [bot, receiver]) { b.pathfinder.setGoal(null); b.clearControlStates(); b.quit(); } setTimeout(() => process.exit(process.exitCode || 0), 500); }
})();
