'use strict';
// Controlled ledge, staircase and supplies on an isolated server. Real
// Survival digging, falling entities and pickups; not natural-start acceptance.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const mineflayer = require('mineflayer'), { pathfinder } = require('mineflayer-pathfinder'), { Vec3 } = require('vec3');
const { compatibilityPlugin } = require('../src/compatibility'), { configureMovements } = require('../src/movement');
const { Task, countOf } = require('../src/skills'), { runGoal, waitFor, inventory } = require('../src/work');
const port = Number(process.env.MC_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535 || [25565, 25577].includes(port)) throw new Error('Explicit isolated MC_PORT required');
const id = Date.now().toString(36), x = Number(process.env.DROP_TEST_X || 3100), directory = path.resolve('artifacts', `drop-collection-${id}`);
fs.mkdirSync(directory, { recursive: true });
const log = event => { const row = JSON.stringify({ at: new Date().toISOString(), ...event }); console.log(row); fs.appendFileSync(path.join(directory, 'events.jsonl'), row + '\n'); };
const connect = prefix => { const b = mineflayer.createBot({ host: '127.0.0.1', port, username: prefix + id, version: '26.1', auth: 'offline' }); b.loadPlugin(compatibilityPlugin); b.loadPlugin(pathfinder); return b; };
const bot = connect('Loot'), observer = connect('Watch'), task = new Task('falling loot');
let active = false, deaths = 0, commands = 0, minimumHealth = 20;
const changes = [], pickups = [], drops = {}, errors = [];
observer.on('blockUpdate', (old, block) => {
  if (active && block && Math.abs(block.position.x - x) <= 12 && Math.abs(block.position.z) <= 8 && old?.name !== block.name)
    changes.push({ position: { ...block.position }, before: old?.name, after: block.name });
});
observer._client.on('collect', packet => { if (active) pickups.push(packet); });
bot.on('physicsTick', () => {
  if (!active) return;
  minimumHealth = Math.min(minimumHealth, bot.health);
  for (const e of Object.values(bot.entities)) {
    const item = e.getDroppedItem?.()?.name;
    if (!item) continue;
    const track = drops[e.id] ||= { item, high: e.position.y, low: e.position.y };
    track.high = Math.max(track.high, e.position.y); track.low = Math.min(track.low, e.position.y);
  }
});
for (const b of [bot, observer]) {
  b.on('error', e => log({ error: e.message })); b.on('death', () => { deaths++; task.cancel(); });
  const write = b._client.write;
  b._client.write = function (name, packet, ...args) { if (active && name.startsWith('chat_command')) commands++; return write.call(this, name, packet, ...args); };
}
const timer = setTimeout(() => task.cancel(), 4 * 60000);
const ready = async b => { await new Promise(r => b.once('spawn', r)); await b.waitForChunksToLoad(); configureMovements(b); };
const obtain = async item => {
  const goal = { kind: 'obtain', item, count: 1, deliver: false };
  const result = await runGoal(bot, task, goal, { save: g => fs.writeFileSync(path.join(directory, `${item}-goal.json`), JSON.stringify(g, null, 2)) }, {
    maxSteps: 8, survival: { state: {}, step: async () => false }, recoveryAdviser: { recordFailure() {}, suggest: async () => false },
    onStep: g => { if (g.lastError) errors.push(g.lastError); log({ item, step: g.step, error: g.lastError, position: bot.entity.position, inventory: inventory(bot) }); },
  });
  assert(result.ok, result.reason); assert.equal(countOf(bot, item), 1);
};
(async () => {
  try {
    await Promise.all([ready(bot), ready(observer)]);
    const setup = [`forceload add ${x - 16} -16 ${x + 16} 16`, `fill ${x - 10} 60 -8 ${x + 12} 73 8 air`,
      `fill ${x - 10} 58 -8 ${x + 12} 59 8 bedrock`, `fill ${x - 2} 60 -2 ${x + 1} 63 2 bedrock`,
      `fill ${x + 2} 60 2 ${x + 2} 62 2 bedrock`, `fill ${x + 3} 60 2 ${x + 3} 61 2 bedrock`, `setblock ${x + 4} 60 2 bedrock`,
      `setblock ${x + 3} 63 0 stone`, `gamemode survival ${bot.username}`, `gamemode survival ${observer.username}`,
      `tp ${bot.username} ${x + .5} 64 .5`, `tp ${observer.username} ${x - .5} 64 -.5`,
      `give ${bot.username} stone_pickaxe 1`, `give ${bot.username} oak_planks 8`, `give ${observer.username} raw_iron 1`];
    fs.writeFileSync(path.join(directory, 'setup.json'), JSON.stringify(setup, null, 2)); log({ phase: 'setup', directory });
    await waitFor(task, () => fs.existsSync(path.join(directory, 'ready')), 180000);
    await waitFor(task, () => countOf(bot, 'oak_planks') === 8 && countOf(observer, 'raw_iron') === 1 && bot.entity.position.y === 64, 10000);
    active = true;
    await obtain('cobblestone');
    assert(bot.entity.position.y < 62, 'Pickup must reach the lower floor');
    await observer.lookAt(new Vec3(x + 5.5, 65, .5), true);
    const iron = observer.inventory.items().find(i => i.name === 'raw_iron');
    await observer.tossStack(iron);
    await waitFor(task, () => Object.values(bot.entities).some(e => e.getDroppedItem?.()?.name === 'raw_iron'), 2000);
    await obtain('raw_iron');
    await new Promise(r => setTimeout(r, 200));
    assert.deepEqual(changes, [{ position: { x: x + 3, y: 63, z: 0 }, before: 'stone', after: 'air' }]);
    assert.equal(countOf(bot, 'oak_planks'), 8); assert.equal(errors.length, 0, errors.join('; '));
    assert.equal(deaths, 0); assert.equal(commands, 0); assert.equal(minimumHealth, 20);
    for (const item of ['cobblestone', 'raw_iron']) {
      const track = Object.entries(drops).find(([, d]) => d.item === item && d.high - d.low > 2);
      assert(track, `${item} must actually fall more than two blocks`);
      assert(pickups.some(p => p.collectedEntityId === Number(track[0]) && p.collectorEntityId === bot.entity.id), `${item} independently collected by the worker`);
    }
    log({ result: 'PASS', changes, drops, pickups, errors, deaths, commands, minimumHealth, inventory: inventory(bot), directory });
  } catch (error) { log({ result: 'FAIL', error: error.stack, changes, drops, pickups, errors, position: bot.entity?.position, directory }); process.exitCode = 1; }
  finally { clearTimeout(timer); for (const b of [bot, observer]) { b.pathfinder.setGoal(null); b.clearControlStates(); b.quit(); } setTimeout(() => process.exit(process.exitCode || 0), 500); }
})();
