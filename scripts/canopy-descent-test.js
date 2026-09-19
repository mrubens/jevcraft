'use strict';
// Controlled crown -> trunk -> ground descent; independent block observation.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const mineflayer = require('mineflayer'), { pathfinder } = require('mineflayer-pathfinder');
const { compatibilityPlugin } = require('../src/compatibility'), { configureMovements } = require('../src/movement');
const { Task } = require('../src/skills'), { explore, waitFor } = require('../src/work');
const port = Number(process.env.MC_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535 || [25565, 25577].includes(port)) throw new Error('Explicit isolated MC_PORT required');
const id = Date.now().toString(36), x = Number(process.env.CANOPY_TEST_X || 3520), directory = path.resolve('artifacts', `canopy-descent-${id}`);
fs.mkdirSync(directory, { recursive: true });
const log = event => { const row = JSON.stringify({ at: new Date().toISOString(), ...event }); console.log(row); fs.appendFileSync(path.join(directory, 'events.jsonl'), row + '\n'); };
const connect = prefix => { const b = mineflayer.createBot({ host: '127.0.0.1', port, username: prefix + id, version: '26.1', auth: 'offline' }); b.loadPlugin(compatibilityPlugin); b.loadPlugin(pathfinder); return b; };
const bot = connect('Fall'), observer = connect('Watch'), task = new Task('short drops off a tree');
let active = false, minimumHealth = 20, deaths = 0, commands = 0;
const changes = [], landings = [], positions = [];
observer.on('blockUpdate', (old, block) => {
  if (active && block && Math.abs(block.position.x - x) < 24 && Math.abs(block.position.z) < 16 && old?.name !== block.name)
    changes.push({ before: old?.name, after: block.name, position: { ...block.position } });
});
observer.on('entityMoved', entity => { if (active && entity.username === bot.username) positions.push({ ...entity.position }); });
bot.on('health', () => { if (active) minimumHealth = Math.min(minimumHealth, bot.health); });
for (const b of [bot, observer]) {
  b.on('error', e => log({ error: e.message })); b.on('death', () => { deaths++; task.cancel(); });
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
const timer = setTimeout(() => task.cancel(), 4 * 60000);
(async () => {
  try {
    await Promise.all([ready(bot), ready(observer)]);
    const setup = [`forceload add ${x - 16} -16 ${x + 32} 16`, `fill ${x - 12} 64 -12 ${x + 24} 80 12 air`,
      `fill ${x - 12} 62 -12 ${x + 24} 62 12 bedrock`, `fill ${x - 12} 63 -12 ${x + 24} 63 12 grass_block`,
      `setblock ${x + 1} 63 0 dirt`, `fill ${x + 1} 64 0 ${x + 1} 68 0 spruce_log`,
      `setblock ${x} 71 0 spruce_leaves[persistent=true]`,
      `gamemode survival ${bot.username}`, `gamemode survival ${observer.username}`,
      `tp ${bot.username} ${x + .5} 72 .5`, `tp ${observer.username} ${x + 8.5} 64 5.5`];
    fs.writeFileSync(path.join(directory, 'setup.json'), JSON.stringify(setup, null, 2)); log({ phase: 'setup', directory });
    await waitFor(task, () => fs.existsSync(path.join(directory, 'ready')), 180000);
    await waitFor(task, () => bot.entity.position.y === 72 && bot.entity.position.x > x, 10000);
    assert.equal(bot.inventory.items().length, 0);
    const goal = { request: 'look for food animals' }; active = true;
    for (let step = 0; step < 6 && bot.entity.position.y > 64; step++) {
      await explore(bot, task, goal, () => {}, 'food animals', { surfaceOnly: true });
      landings.push({ position: { ...bot.entity.position }, step: structuredClone(goal.step) });
    }
    await waitFor(task, () => bot.entity.onGround && bot.entity.position.y === 64, 5000);
    assert.equal(landings[0].step.action, 'descend_canopy'); assert.equal(landings[0].position.y, 69, 'Uses the full three-block drop');
    assert(positions.some(p => Math.abs(p.y - 69) < .05), 'Independent client saw the trunk landing');
    assert(changes.length > 0 && changes.every(c => c.before === 'spruce_log' && c.after === 'air'), JSON.stringify(changes));
    assert.equal(minimumHealth, 20); assert.equal(deaths, 0); assert.equal(commands, 0);
    log({ result: 'PASS', landings, changes, observedPositionPackets: positions.length, minimumHealth, deaths, commands, directory });
  } catch (error) { log({ result: 'FAIL', error: error.stack, changes, landings, position: bot.entity?.position, directory }); process.exitCode = 1; }
  finally { clearTimeout(timer); for (const b of [bot, observer]) { b.pathfinder.setGoal(null); b.clearControlStates(); b.quit(); } setTimeout(() => process.exit(process.exitCode || 0), 500); }
})();
