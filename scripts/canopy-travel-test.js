'use strict';
// Controlled leaf crown and supported descent, with independent observation.
// This verifies movement mechanics, not fresh natural-world acceptance.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const mineflayer = require('mineflayer'), { pathfinder } = require('mineflayer-pathfinder');
const { compatibilityPlugin } = require('../src/compatibility'), { configureMovements } = require('../src/movement');
const { Task } = require('../src/skills'), { explore, waitFor } = require('../src/work');
const port = Number(process.env.MC_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535 || [25565, 25577].includes(port)) throw new Error('Explicit isolated MC_PORT required');
const id = Date.now().toString(36), x = Number(process.env.CANOPY_TEST_X || 3360), directory = path.resolve('artifacts', `canopy-travel-${id}`);
fs.mkdirSync(directory, { recursive: true });
const log = event => { const row = JSON.stringify({ at: new Date().toISOString(), ...event }); console.log(row); fs.appendFileSync(path.join(directory, 'events.jsonl'), row + '\n'); };
const connect = prefix => { const b = mineflayer.createBot({ host: '127.0.0.1', port, username: prefix + id, version: '26.1', auth: 'offline' }); b.loadPlugin(compatibilityPlugin); b.loadPlugin(pathfinder); return b; };
const bot = connect('Leaf'), observer = connect('Watch'), task = new Task('leave leaf canopy');
let active = false, minimumHealth = 20, deaths = 0, commands = 0;
const changes = [], routes = [];
observer.on('blockUpdate', (old, block) => {
  if (active && block && Math.abs(block.position.x - x) < 24 && Math.abs(block.position.z) < 16 && old?.name !== block.name)
    changes.push({ before: old?.name, after: block.name, position: { ...block.position } });
});
bot.on('health', () => { if (active) minimumHealth = Math.min(minimumHealth, bot.health); });
bot.on('path_update', route => {
  if (!active) return;
  routes.push({ status: route.status, breaks: (route.path || []).flatMap(p => p.toBreak || []).map(p => ({ position: { ...p }, block: bot.blockAt(p)?.name })) });
});
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
    const leaf = 'spruce_leaves[persistent=true]', setup = [`forceload add ${x - 16} -16 ${x + 32} 16`,
      `fill ${x - 12} 64 -12 ${x + 24} 80 12 air`, `fill ${x - 12} 62 -12 ${x + 24} 62 12 bedrock`,
      `fill ${x - 12} 63 -12 ${x + 24} 63 12 grass_block`, `setblock ${x} 63 0 dirt`, `fill ${x} 64 0 ${x} 68 0 spruce_log`,
      `fill ${x - 2} 69 -2 ${x + 2} 69 2 ${leaf}`,
      `fill ${x - 2} 70 -2 ${x + 2} 72 -2 ${leaf}`, `fill ${x - 2} 70 2 ${x + 2} 72 2 ${leaf}`,
      `fill ${x - 2} 70 -1 ${x - 2} 72 1 ${leaf}`, `fill ${x + 2} 70 -1 ${x + 2} 72 1 ${leaf}`,
      ...[3, 4, 5, 6, 7].map(dx => `setblock ${x + dx} ${71 - dx} 0 ${leaf}`),
      `gamemode survival ${bot.username}`, `gamemode survival ${observer.username}`,
      `tp ${bot.username} ${x + .5} 70 .5`, `tp ${observer.username} ${x + 12.5} 64 5.5`];
    fs.writeFileSync(path.join(directory, 'setup.json'), JSON.stringify(setup, null, 2)); log({ phase: 'setup', directory });
    await waitFor(task, () => fs.existsSync(path.join(directory, 'ready')), 180000);
    await waitFor(task, () => bot.entity.position.y === 70 && bot.entity.position.x > x, 10000);
    assert.equal(bot.inventory.items().length, 0);
    const original = { canDig: bot.pathfinder.movements.canDig, exclusionAreasBreak: bot.pathfinder.movements.exclusionAreasBreak };
    const goal = {}; active = true;
    await explore(bot, task, goal, () => {}, 'food animals', { surfaceOnly: true });
    await waitFor(task, () => bot.entity.onGround && bot.entity.position.y === 64, 5000);
    await new Promise(r => setTimeout(r, 150));
    assert(changes.length > 0, 'The exit required clearing leaf cover');
    assert(changes.every(c => c.before === 'spruce_leaves' && c.after === 'air'), JSON.stringify(changes));
    assert(routes.flatMap(r => r.breaks).every(b => b.block === 'spruce_leaves'));
    assert.equal(minimumHealth, 20); assert.equal(deaths, 0); assert.equal(commands, 0);
    assert.equal(bot.pathfinder.movements.canDig, original.canDig);
    assert.equal(bot.pathfinder.movements.exclusionAreasBreak, original.exclusionAreasBreak);
    log({ result: 'PASS', changes, position: bot.entity.position, minimumHealth, deaths, commands, directory });
  } catch (error) { log({ result: 'FAIL', error: error.stack, changes, routes: routes.slice(-5), position: bot.entity?.position, directory }); process.exitCode = 1; }
  finally { clearTimeout(timer); for (const b of [bot, observer]) { b.pathfinder.setGoal(null); b.clearControlStates(); b.quit(); } setTimeout(() => process.exit(process.exitCode || 0), 500); }
})();
