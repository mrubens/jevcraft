'use strict';
// Controlled lake, empty inventory; independent shore and shelter observation.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const mineflayer = require('mineflayer'), { pathfinder } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { compatibilityPlugin } = require('../src/compatibility'), { configureMovements } = require('../src/movement');
const { Task } = require('../src/skills'), { createSurvival, waitFor } = require('../src/work');
const { dryStanding } = require('../src/mining-access'), shelter = require('../src/shelter');
const port = Number(process.env.MC_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535 || [25565, 25577].includes(port)) throw new Error('Explicit isolated MC_PORT required');
const id = Date.now().toString(36), x = Number(process.env.SHORE_TEST_X || 4400), directory = path.resolve('artifacts', `shore-recovery-${id}`);
fs.mkdirSync(directory, { recursive: true });
const log = event => { const row = JSON.stringify({ at: new Date().toISOString(), ...event }); console.log(row); fs.appendFileSync(path.join(directory, 'events.jsonl'), row + '\n'); };
const connect = prefix => { const b = mineflayer.createBot({ host: '127.0.0.1', port, username: prefix + id, version: '26.1', auth: 'offline' }); b.loadPlugin(compatibilityPlugin); b.loadPlugin(pathfinder); return b; };
const bot = connect('Shore'), observer = connect('Watch'), task = new Task('reach shore then build shelter');
let active = false, minimumHealth = 20, minimumOxygen = 20, deaths = 0, commands = 0;
const changes = [], positions = [];
observer.on('blockUpdate', (old, block) => {
  if (active && block && Math.abs(block.position.x - x) < 32 && Math.abs(block.position.z) < 32 && old?.name !== block.name)
    changes.push({ before: old?.name, after: block.name, position: { ...block.position } });
});
observer.on('entityMoved', e => { if (active && e.username === bot.username) positions.push({ ...e.position }); });
bot.on('physicsTick', () => { if (active) { minimumHealth = Math.min(minimumHealth, bot.health); minimumOxygen = Math.min(minimumOxygen, bot.oxygenLevel); } });
for (const b of [bot, observer]) {
  b.on('error', e => log({ error: e.message })); b.on('death', () => { deaths++; task.cancel(); });
  const write = b._client.write;
  b._client.write = function (name, packet, ...args) { if (active && name.startsWith('chat_command')) commands++; return write.call(this, name, packet, ...args); };
}
const ready = async b => {
  await new Promise((resolve, reject) => { b.once('spawn', resolve); b.once('error', reject); b.once('end', reason => reject(new Error(reason))); });
  await b.waitForChunksToLoad(); configureMovements(b);
};
const timer = setTimeout(() => task.cancel(), 6 * 60000);
(async () => {
  try {
    await Promise.all([ready(bot), ready(observer)]);
    const setup = [`forceload add ${x - 32} -32 ${x + 32} 32`, `fill ${x - 28} 63 -28 ${x + 28} 72 28 air`,
      `fill ${x - 28} 58 -28 ${x + 28} 61 28 stone`, `fill ${x - 28} 62 -28 ${x + 28} 62 28 dirt`,
      `fill ${x - 20} 59 -20 ${x + 20} 62 20 water`,
      `gamemode survival ${bot.username}`, `gamemode survival ${observer.username}`,
      `tp ${observer.username} ${x + 24.5} 63 24.5`, `tp ${bot.username} ${x + .5} 62.2 .5`];
    fs.writeFileSync(path.join(directory, 'setup.json'), JSON.stringify(setup, null, 2)); log({ phase: 'setup', directory });
    await waitFor(task, () => fs.existsSync(path.join(directory, 'ready')), 180000);
    await waitFor(task, () => Math.abs(bot.entity.position.x - x - .5) < 1, 10000);
    assert.equal(bot.inventory.items().length, 0);
    const goal = { kind: 'obtain', request: 'get me oak wood', item: 'oak_log', count: 1 };
    const survival = createSurvival(bot), save = () => fs.writeFileSync(path.join(directory, 'goal.json'), JSON.stringify(goal, null, 2));
    goal.survival = survival.state; active = true;
    assert.equal(shelter.shelterSites(bot, goal).length, 0, 'No local shelter site exists from the center of the lake');
    await survival.refugeStep(task, goal, save);
    assert(dryStanding(bot, bot.entity.position)); assert.equal(goal.step.action, 'reach_shore');
    assert(goal.shoreRecovery.landed); assert.equal(changes.length, 0, 'Swim without excavating or bridging');
    assert(positions.some(p => Math.abs(p.x - x) > 20 || Math.abs(p.z) > 20), 'Independent observer saw shore arrival');
    log({ phase: 'reached_shore', position: { ...bot.entity.position }, observedPositionPackets: positions.length, minimumHealth, minimumOxygen });
    for (let n = 0; n < 45 && !survival.currentShelter()?.verifiedAt; n++) await survival.refugeStep(task, goal, save);
    const refuge = survival.currentShelter(); assert(refuge?.verifiedAt); assert(shelter.sealed(bot, refuge));
    await waitFor(task, () => shelter.sealed(observer, refuge), 5000);
    assert.equal(goal.item, 'oak_log'); assert.equal(minimumHealth, 20); assert(minimumOxygen >= 18); assert.equal(deaths, 0); assert.equal(commands, 0);
    log({ result: 'PASS', position: { ...bot.entity.position }, refuge, changes, observedPositionPackets: positions.length, minimumHealth, minimumOxygen, deaths, commands, directory });
  } catch (error) { log({ result: 'FAIL', error: error.stack, changes, position: bot.entity?.position, minimumHealth, minimumOxygen, directory }); process.exitCode = 1; }
  finally { clearTimeout(timer); for (const b of [bot, observer]) { b.pathfinder.setGoal(null); b.clearControlStates(); b.quit(); } setTimeout(() => process.exit(process.exitCode || 0), 500); }
})();
