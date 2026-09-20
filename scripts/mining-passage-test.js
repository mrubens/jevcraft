'use strict';
// Controlled reproduction of the one-block entrance in natural run mu93udp8.
// Only setup uses commands. An independent client observes excavation and loot.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const mineflayer = require('mineflayer'), { pathfinder, goals } = require('mineflayer-pathfinder'), { Vec3 } = require('vec3');
const { compatibilityPlugin } = require('../src/compatibility'), { configureMovements } = require('../src/movement');
const { Task, countOf, surveyRoute, navigate } = require('../src/skills');
const { dig, waitFor, inventory } = require('../src/work');
const { approachDryMining, miningMovement } = require('../src/mining-access');
const { collectNearbyDrops } = require('../src/drop-collection');
const port = Number(process.env.MC_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535 || [25565, 25577, 25579, 25580, 25582].includes(port)) throw new Error('Explicit isolated fixture MC_PORT required');
const id = Date.now().toString(36), x = Number(process.env.MINING_TEST_X || 5200);
const pickupOnly = process.env.MINING_TEST_PICKUP === '1';
const directory = path.resolve('artifacts', `mining-passage-${id}`); fs.mkdirSync(directory, { recursive: true });
const log = event => { const row = JSON.stringify({ at: new Date().toISOString(), ...event }); console.log(row); fs.appendFileSync(path.join(directory, 'events.jsonl'), row + '\n'); };
const connect = prefix => { const b = mineflayer.createBot({ host: '127.0.0.1', port, username: prefix + id, version: '26.1', auth: 'offline' }); b.loadPlugin(compatibilityPlugin); b.loadPlugin(pathfinder); return b; };
const bot = connect('Mine'), observer = connect('Watch'), task = new Task('open local mining passage');
let active = false, minimumHealth = 20, deaths = 0, commands = 0, pickups = 0;
const positions = [], changes = [];
observer.on('entityMoved', e => { if (active && e.username === bot.username) positions.push({ ...e.position }); });
observer.on('blockUpdate', (old, block) => { if (active && block && Math.abs(block.position.x - x) < 20 && Math.abs(block.position.z) < 20 && old?.name !== block.name)
  changes.push({ before: old?.name, after: block.name, position: { ...block.position } }); });
for (const b of [bot, observer]) {
  b.on('error', error => log({ error: error.message })); b.on('death', () => { deaths++; task.cancel(); });
  const write = b._client.write; b._client.write = function (name, packet, ...args) { if (active && name.startsWith('chat_command')) commands++; return write.call(this, name, packet, ...args); };
}
bot.on('physicsTick', () => { if (active) minimumHealth = Math.min(minimumHealth, bot.health); });
const ready = async b => { await new Promise((resolve, reject) => { b.once('spawn', resolve); b.once('error', reject); }); await b.waitForChunksToLoad(); configureMovements(b); };
const timer = setTimeout(() => task.cancel(), 5 * 60000);
(async () => {
  try {
    await Promise.all([ready(bot), ready(observer)]);
    observer.on('playerCollect', (collector, item) => { if (active && collector.username === bot.username && item.getDroppedItem?.()?.name === 'cobblestone') pickups++; });
    const setup = [`forceload add ${x - 16} -16 ${x + 16} 16`, `fill ${x - 10} 63 -10 ${x + 10} 72 10 air`,
      `fill ${x - 10} 63 -10 ${x + 10} 63 10 stone`,
      // Bedrock sides force a single doorway. A transparent roof allows the
      // independent observer to see the bot while excluding daylight hazards.
      `fill ${x - 2} 64 -3 ${x + 2} 66 3 bedrock`, `fill ${x - 1} 64 -2 ${x + 1} 65 2 air`,
      `fill ${x - 2} 66 -3 ${x + 2} 66 3 glass`,
      `fill ${x} 64 3 ${x} 65 3 air`, `setblock ${x} 64 3 grass_block`,
      `setblock ${x} 64 -1 stone`, `setblock ${x + 1} 64 -1 stone`,
      `gamemode survival ${bot.username}`, `gamemode creative ${observer.username}`,
      `give ${bot.username} wooden_pickaxe 1`,
      ...(pickupOnly ? [`give ${observer.username} cobblestone 1`] : []),
      `tp ${bot.username} ${x + .5} 64 4.5`, `tp ${observer.username} ${x + (pickupOnly ? 1.5 : .5)} ${pickupOnly ? 64 : 67} ${pickupOnly ? 2.5 : .5}`];
    fs.writeFileSync(path.join(directory, 'setup.json'), JSON.stringify(setup, null, 2)); log({ phase: 'setup', pickupOnly, directory });
    await waitFor(task, () => fs.existsSync(path.join(directory, 'ready')), 180000);
    await waitFor(task, () => Math.abs(bot.entity.position.x - x - .5) < .1 && bot.entity.position.y === 64, 10000);
    configureMovements(bot);
    const movement = bot.pathfinder.movements, entrance = new Vec3(x, 64, 3), first = new Vec3(x, 64, -1);
    const policy = miningMovement(bot);
    const blocked = await surveyRoute(bot, task, movement, new goals.GoalBlock(x, 64, 1), 400);
    policy.restore(); assert.notEqual(blocked.status, 'success', 'The unchanged doorway reproduces the inaccessible mining stance');
    active = true;
    if (pickupOnly) {
      await observer.lookAt(new Vec3(x + .5, 64.5, -2.5), true);
      await observer.tossStack(observer.inventory.items().find(i => i.name === 'cobblestone'));
      await waitFor(task, () => Object.values(bot.entities).some(e => e.getDroppedItem?.()?.name === 'cobblestone'), 3000);
    } else {
      await approachDryMining(bot, task, first, { navigate, dig });
      await dig(bot, task, first, { requiredTool: 'wooden_pickaxe' });
    }
    assert(await collectNearbyDrops(bot, task, 'cobblestone', { before: 0, origin: first, waitForSpawnMs: 1000, allowExcavation: true }));
    await waitFor(task, () => pickups > 0, 5000);
    assert.equal(bot.blockAt(entrance).name, 'air');
    assert.equal(countOf(bot, 'cobblestone'), 1);
    assert(changes.some(c => c.before === 'grass_block' && c.after === 'air' && c.position.z === 3));
    assert(changes.every(c => ['grass_block', 'stone'].includes(c.before) && c.after === 'air'), JSON.stringify(changes));
    assert.equal(changes.filter(c => c.before === 'stone').length, pickupOnly ? 0 : 1, 'No unplanned tunnel excavation');
    assert.equal(minimumHealth, 20); assert.equal(deaths, 0); assert.equal(commands, 0);
    log({ result: 'PASS', pickupOnly, inventory: inventory(bot), position: bot.entity.position, independentlyObservedPickups: pickups,
      positionPackets: positions.length, changes, minimumHealth, deaths, commands, directory });
  } catch (error) { log({ result: 'FAIL', error: error.stack, position: bot.entity?.position, changes, directory }); process.exitCode = 1; }
  finally { clearTimeout(timer); for (const b of [bot, observer]) { b.pathfinder.setGoal(null); b.clearControlStates(); b.quit(); } setTimeout(() => process.exit(process.exitCode || 0), 500); }
})();
