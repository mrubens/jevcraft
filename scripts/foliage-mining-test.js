'use strict';
// Controlled, fully leaf-covered resource. Commands set up terrain only;
// the empty Survival bot must discover, approach, mine and collect the log.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const mineflayer = require('mineflayer'), { pathfinder } = require('mineflayer-pathfinder'), { Vec3 } = require('vec3');
const { compatibilityPlugin } = require('../src/compatibility'), { configureMovements } = require('../src/movement');
const { Task, countOf } = require('../src/skills'), { acquireStep, waitFor, inventory } = require('../src/work');
const { dryMiningPositions } = require('../src/mining-access');
const port = Number(process.env.MC_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535 || [25565, 25577].includes(port)) throw new Error('Explicit isolated MC_PORT required');
const id = Date.now().toString(36), x = Number(process.env.FOLIAGE_TEST_X || 3400), directory = path.resolve('artifacts', `foliage-mining-${id}`);
const overhang = process.env.FOLIAGE_TEST_OVERHANG === '1', start = new Vec3(x + (overhang ? -2.55 : .5), 64, .5);
fs.mkdirSync(directory, { recursive: true });
const log = event => { const row = JSON.stringify({ at: new Date().toISOString(), ...event }); console.log(row); fs.appendFileSync(path.join(directory, 'events.jsonl'), row + '\n'); };
const connect = prefix => { const b = mineflayer.createBot({ host: '127.0.0.1', port, username: prefix + id, version: '26.1', auth: 'offline' }); b.loadPlugin(compatibilityPlugin); b.loadPlugin(pathfinder); return b; };
const bot = connect('Leaf'), observer = connect('Watch'), task = new Task('collect covered resource');
let active = false, minimumHealth = 20, deaths = 0, commands = 0, collected = 0;
const changes = [];
observer.on('blockUpdate', (old, block) => {
  if (active && block && Math.abs(block.position.x - x) < 16 && Math.abs(block.position.z) < 16 && old?.name !== block.name)
    changes.push({ before: old?.name, after: block.name, position: { ...block.position } });
});
bot.on('health', () => { if (active) minimumHealth = Math.min(minimumHealth, bot.health); });
for (const b of [bot, observer]) {
  b.on('error', e => log({ error: e.message })); b.on('death', () => { deaths++; task.cancel(); });
  const write = b._client.write;
  b._client.write = function (name, packet, ...args) { if (active && name.startsWith('chat_command')) commands++; return write.call(this, name, packet, ...args); };
}
const ready = async b => { await new Promise(r => b.once('spawn', r)); await b.waitForChunksToLoad(); configureMovements(b); };
const timer = setTimeout(() => task.cancel(), 4 * 60000);
(async () => {
  try {
    await Promise.all([ready(bot), ready(observer)]);
    observer.on('playerCollect', (collector, item) => {
      if (active && collector.username === bot.username && item.getDroppedItem?.()?.name === 'cherry_log') collected++;
    });
    const setup = [`forceload add ${x - 16} -16 ${x + 16} 16`, `fill ${x - 10} 64 -10 ${x + 12} 80 10 air`,
      `fill ${x - 10} 62 -10 ${x + 12} 62 10 bedrock`, `fill ${x - 10} 63 -10 ${x + 12} 63 10 grass_block`,
      `setblock ${x - 4} 63 0 dirt`,
      `fill ${x - 7} 64 -3 ${x - 1} 68 3 cherry_leaves[persistent=true]`, `setblock ${x - 4} 64 0 cherry_log`,
      ...(overhang ? [`fill ${x - 3} 64 0 ${x - 3} 65 0 air`] : []),
      `gamemode survival ${bot.username}`, `gamemode survival ${observer.username}`,
      `tp ${bot.username} ${start.x} ${start.y} ${start.z}`, `tp ${observer.username} ${x + .5} 64 6.5`];
    fs.writeFileSync(path.join(directory, 'setup.json'), JSON.stringify(setup, null, 2)); log({ phase: 'setup', overhang, directory });
    await waitFor(task, () => fs.existsSync(path.join(directory, 'ready')), 180000);
    await waitFor(task, () => bot.entity.position.distanceTo(start) < .1, 10000);
    assert.equal(bot.inventory.items().length, 0);
    assert.equal(dryMiningPositions(bot, new Vec3(x - 4, 64, 0)).length, 0);
    const goal = { kind: 'obtain', item: 'cherry_log', count: 1, request: 'get one cherry log', status: 'running' };
    active = true;
    for (let step = 0; step < 4 && !countOf(bot, 'cherry_log'); step++)
      await acquireStep(bot, task, 'cherry_log', 1, goal, () => fs.writeFileSync(path.join(directory, 'goal.json'), JSON.stringify(goal, null, 2)));
    await waitFor(task, () => collected > 0, 3000);
    assert.equal(countOf(bot, 'cherry_log'), 1); assert.equal(collected, 1);
    assert.equal(changes.filter(c => c.before === 'cherry_log').length, 1);
    assert(changes.some(c => c.before === 'cherry_leaves'));
    if (overhang) assert(changes.some(c => c.before === 'cherry_leaves' && c.position.x === x - 4 && c.position.y === 65 && c.position.z === 0),
      'Clear the observed leaf overhang blocking the eye ray after arrival');
    assert(changes.every(c => ['cherry_log', 'cherry_leaves'].includes(c.before) && c.after === 'air'), JSON.stringify(changes));
    assert.equal(minimumHealth, 20); assert.equal(deaths, 0); assert.equal(commands, 0);
    log({ result: 'PASS', overhang, changes, inventory: inventory(bot), independentlyObservedPickups: collected, position: bot.entity.position,
      minimumHealth, deaths, commands, directory });
  } catch (error) { log({ result: 'FAIL', error: error.stack, changes, position: bot.entity?.position, directory }); process.exitCode = 1; }
  finally { clearTimeout(timer); for (const b of [bot, observer]) { b.pathfinder.setGoal(null); b.clearControlStates(); b.quit(); } setTimeout(() => process.exit(process.exitCode || 0), 500); }
})();
