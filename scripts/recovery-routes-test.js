'use strict';
// Controlled death and drop relocation. Fixture commands belong only in the
// explicitly selected isolated server console, never a player's live world.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const mineflayer = require('mineflayer'), { pathfinder } = require('mineflayer-pathfinder'), { Vec3 } = require('vec3');
const { compatibilityPlugin } = require('../src/compatibility'), { configureMovements } = require('../src/movement');
const { Task, navigate, countOf } = require('../src/skills');
const { recoverItems, recordDeath, observeAliveInventory } = require('../src/recovery');
const { waitFor } = require('../src/work');
const port = Number(process.env.MC_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535 || [25565, 25577].includes(port)) throw new Error('Explicit isolated MC_PORT required');
const id = Date.now().toString(36), x = Number(process.env.RECOVERY_TEST_X || 1600);
const directory = path.resolve('artifacts', `recovery-routes-${id}`);
fs.mkdirSync(directory, { recursive: true });
const log = value => { const row = JSON.stringify({ at: new Date().toISOString(), ...value }); console.log(row); fs.appendFileSync(path.join(directory, 'events.jsonl'), row + '\n'); };
const connect = prefix => {
  const b = mineflayer.createBot({ host: '127.0.0.1', port, username: prefix + id, version: '26.1', auth: 'offline' });
  b.loadPlugin(compatibilityPlugin); b.loadPlugin(pathfinder); return b;
};
const bot = connect('Rec'), witness = connect('See');
const task = new Task('recover reachable death drops'), state = {};
const save = () => fs.writeFileSync(path.join(directory, 'recovery.json'), JSON.stringify(state, null, 2));
const timer = setTimeout(() => task.cancel(), 5 * 60000);
let deaths = 0, active = false, placed = 0, broken = 0;
const collected = [];
bot.on('physicsTick', () => observeAliveInventory(bot));
bot.on('death', () => { deaths++; recordDeath(bot, state); save(); });
bot.on('blockPlaced', () => { if (active) placed++; });
bot.on('diggingCompleted', () => { if (active) broken++; });
for (const b of [bot, witness]) b.on('error', e => log({ error: e.message }));
witness._client.on('collect', packet => {
  if (packet.collectorEntityId === witness.players[bot.username]?.entity?.id) {
    const name = witness.entities[packet.collectedEntityId]?.getDroppedItem?.()?.name;
    collected.push({ name, count: packet.pickupItemCount });
  }
});
const ready = async b => { await new Promise(r => b.once('spawn', r)); await b.waitForChunksToLoad(); configureMovements(b); };
const dropped = name => Object.values(witness.entities).find(e => e.getDroppedItem?.()?.name === name && e.position.distanceTo(new Vec3(x + 8, 64, .5)) < 16);
(async () => {
  try {
    await Promise.all([ready(bot), ready(witness)]);
    const setup = ['gamerule minecraft:keep_inventory false', 'time set day',
      `forceload add ${x - 16} -16 ${x + 32} 16`, `fill ${x - 5} 64 -8 ${x + 20} 70 8 air`, `fill ${x - 5} 61 -8 ${x + 20} 63 8 stone`,
      `gamemode survival ${bot.username}`, `gamemode spectator ${witness.username}`,
      `spawnpoint ${bot.username} ${x} 64 0`, `tp ${bot.username} ${x + 8.5} 64 .5`, `tp ${witness.username} ${x + 8.5} 67 .5`,
      `give ${bot.username} oak_log 12`, `give ${bot.username} oak_planks 8`];
    fs.writeFileSync(path.join(directory, 'setup.json'), JSON.stringify(setup, null, 2));
    log({ phase: 'setup', directory, username: bot.username, witness: witness.username });
    await waitFor(task, () => fs.existsSync(path.join(directory, 'ready')), 180000);
    await waitFor(task, () => countOf(bot, 'oak_log') === 12 && countOf(bot, 'oak_planks') === 8, 10000);
    observeAliveInventory(bot);
    log({ phase: 'kill', command: `kill ${bot.username}`, directory });
    await waitFor(task, () => deaths === 1 && bot.health > 0 && bot.isAlive && dropped('oak_log') && dropped('oak_planks'), 30000);
    assert.deepEqual(state.recovery.inventoryBeforeDeath, { oak_log: 12, oak_planks: 8 });
    const logs = dropped('oak_log'), planks = dropped('oak_planks');
    assert(logs.uuid && planks.uuid);
    const relocate = [`fill ${x + 5} 64 -1 ${x + 7} 67 1 bedrock`, `fill ${x + 6} 64 0 ${x + 6} 65 0 air`,
      `tp ${logs.uuid} ${x + 6.5} 64 .5`, `tp ${planks.uuid} ${x + 10.5} 64 .5`];
    fs.writeFileSync(path.join(directory, 'relocate.json'), JSON.stringify(relocate, null, 2));
    log({ phase: 'relocate', directory, drops: [logs, planks].map(e => ({ name: e.getDroppedItem().name, uuid: e.uuid })) });
    await waitFor(task, () => fs.existsSync(path.join(directory, 'relocated')), 60000);
    await waitFor(task, () => bot.blockAt(new Vec3(x + 5, 64, 0))?.name === 'bedrock' &&
      dropped('oak_log')?.position.distanceTo(new Vec3(x + 6.5, 64, .5)) < 1 &&
      dropped('oak_planks')?.position.distanceTo(new Vec3(x + 10.5, 64, .5)) < 1, 5000);
    const original = { canDig: bot.pathfinder.movements.canDig, scaffolding: [...bot.pathfinder.movements.scafoldingBlocks] };
    active = true;
    const attempted = [];
    const travel = async (b, t, g, options) => { attempted.push({ x: g.x, y: g.y, z: g.z }); await navigate(b, t, g, options); };
    assert(await recoverItems(bot, task, state.recovery, save, travel));
    assert.equal(countOf(bot, 'oak_planks'), 8); assert.equal(countOf(bot, 'oak_log'), 0);
    assert.equal(state.recovery.recovered.oak_planks, 8);
    assert.equal(attempted.length, 1); assert.equal(attempted[0].x, x + 10);
    assert(collected.some(p => p.name === 'oak_planks' && p.count === 8), 'independent recipient pickup packet');
    assert(dropped('oak_log'), 'unreachable stack remains intact');
    assert.equal(await recoverItems(bot, task, state.recovery, save, travel), false);
    assert.equal(state.recovery.status, 'finished');
    assert.equal(bot.pathfinder.movements.canDig, original.canDig);
    assert.deepEqual(bot.pathfinder.movements.scafoldingBlocks, original.scaffolding);
    assert.equal(placed, 0); assert.equal(broken, 0); assert.equal(deaths, 1); assert.equal(bot.health, 20);
    log({ result: 'PASS', recovered: state.recovery.recovered, trappedStackLeft: true, attempted, independentlyCollected: collected,
      placed, broken, health: bot.health, controlledDeaths: deaths, directory });
  } catch (e) { log({ result: 'FAIL', error: e.stack, recovery: state.recovery, position: bot.entity?.position, directory }); process.exitCode = 1; }
  finally { clearTimeout(timer); bot.pathfinder.setGoal(null); bot.clearControlStates(); bot.quit(); witness.quit(); setTimeout(() => process.exit(process.exitCode || 0), 500); }
})();
