'use strict';
// Controlled mining pocket: an empty shelter reservation must not trap its owner.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const mineflayer = require('mineflayer'), { pathfinder, goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { compatibilityPlugin } = require('../src/compatibility'), { configureMovements } = require('../src/movement');
const { Task, surveyRoute } = require('../src/skills'), { createSurvival, waitFor } = require('../src/work');
const { reservedForConstruction } = require('../src/build-sites'), shelter = require('../src/shelter');
const port = Number(process.env.MC_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535 || [25565, 25577, 25579, 25580].includes(port)) throw new Error('Explicit isolated fixture MC_PORT required');
const id = Date.now().toString(36), x = Number(process.env.SHELTER_TEST_X || 4600);
const directory = path.resolve('artifacts', `shelter-approach-${id}`); fs.mkdirSync(directory, { recursive: true });
const log = event => { const row = JSON.stringify({ at: new Date().toISOString(), ...event }); console.log(row); fs.appendFileSync(path.join(directory, 'events.jsonl'), row + '\n'); };
const connect = prefix => { const b = mineflayer.createBot({ host: '127.0.0.1', port, username: prefix + id, version: '26.1', auth: 'offline' }); b.loadPlugin(compatibilityPlugin); b.loadPlugin(pathfinder); return b; };
const bot = connect('Escape'), observer = connect('Watch'), task = new Task('escape reservation and finish shelter');
let active = false, minimumHealth = 20, deaths = 0, commands = 0;
const positions = [], changes = [];
observer.on('entityMoved', e => { if (active && e.username === bot.username) positions.push({ ...e.position }); });
observer.on('blockUpdate', (old, block) => { if (active && block && Math.abs(block.position.x - x) < 20 && Math.abs(block.position.z) < 20 && old?.name !== block.name) changes.push({ before: old?.name, after: block.name, position: { ...block.position } }); });
for (const b of [bot, observer]) {
  b.on('error', error => log({ error: error.message })); b.on('death', () => { deaths++; task.cancel(); });
  const write = b._client.write; b._client.write = function (name, packet, ...args) { if (active && name.startsWith('chat_command')) commands++; return write.call(this, name, packet, ...args); };
}
bot.on('physicsTick', () => { if (active) minimumHealth = Math.min(minimumHealth, bot.health); });
const ready = async b => { await new Promise((resolve, reject) => { b.once('spawn', resolve); b.once('error', reject); }); await b.waitForChunksToLoad(); configureMovements(b); };
const timer = setTimeout(() => task.cancel(), 6 * 60000);
(async () => {
  try {
    await Promise.all([ready(bot), ready(observer)]);
    const setup = [`forceload add ${x - 32} -32 ${x + 32} 32`, `fill ${x - 12} 63 -12 ${x + 12} 75 12 air`,
      `fill ${x - 12} 63 -12 ${x + 12} 68 12 stone`, `fill ${x - 12} 69 -12 ${x + 12} 69 12 dirt`,
      `fill ${x - 2} 67 -2 ${x + 2} 69 2 stone`, `fill ${x} 67 0 ${x} 68 0 air`,
      `gamemode survival ${bot.username}`, `gamemode survival ${observer.username}`,
      `give ${bot.username} wooden_pickaxe 1`, `give ${bot.username} oak_planks 5`,
      `tp ${observer.username} ${x + 6.5} 70 4.5`, `tp ${bot.username} ${x + .5} 67 .5`];
    fs.writeFileSync(path.join(directory, 'setup.json'), JSON.stringify(setup, null, 2)); log({ phase: 'setup', directory });
    await waitFor(task, () => fs.existsSync(path.join(directory, 'ready')), 180000);
    await waitFor(task, () => Math.abs(bot.entity.position.x - x - .5) < 1, 10000);
    configureMovements(bot);
    const refuge = { origin: { x, y: 70, z: 0 }, dimension: 'overworld' }, state = { shelters: [refuge] };
    const goal = { kind: 'obtain', request: 'get me oak wood', item: 'oak_log', count: 1, survival: state };
    const survival = createSurvival(bot, { state }), save = () => fs.writeFileSync(path.join(directory, 'goal.json'), JSON.stringify(goal, null, 2));
    bot._constructionProtection = b => reservedForConstruction(goal, b.position) ? 100 : 0;
    const original = bot.pathfinder.movements.exclusionAreasBreak = [bot._constructionProtection];
    assert(shelter.materialStock(bot) < shelter.missingShell(bot, refuge).length);
    assert.equal((await surveyRoute(bot, task, bot.pathfinder.movements, new goals.GoalBlock(x, 70, 0), 500)).status, 'noPath', 'Reservation reproduces the trap');
    active = true;
    await survival.refugeStep(task, goal, save);
    assert(shelter.inside(bot, refuge), 'Exit the pocket before starting to gather');
    assert.equal(bot.pathfinder.movements.exclusionAreasBreak, original);
    await waitFor(task, () => positions.some(p => p.y >= 70), 5000);
    log({ phase: 'escaped', position: { ...bot.entity.position }, minimumHealth, observedPositionPackets: positions.length });
    for (let n = 0; n < 45 && !survival.currentShelter()?.verifiedAt; n++) await survival.refugeStep(task, goal, save);
    const finished = survival.currentShelter(); assert(finished?.verifiedAt); assert(shelter.inside(bot, finished)); assert(shelter.sealed(bot, finished));
    await waitFor(task, () => shelter.sealed(observer, finished), 5000);
    assert(changes.some(c => c.before === 'stone' && c.after === 'air'), 'Witness saw the excavated exit');
    assert.equal(goal.item, 'oak_log'); assert.equal(deaths, 0); assert.equal(commands, 0); assert.equal(minimumHealth, 20);
    log({ result: 'PASS', refuge: finished, position: { ...bot.entity.position }, minimumHealth, deaths, commands, observedPositionPackets: positions.length, changes, directory });
  } catch (error) { log({ result: 'FAIL', error: error.stack, position: bot.entity?.position, minimumHealth, changes, directory }); process.exitCode = 1; }
  finally { clearTimeout(timer); for (const b of [bot, observer]) { b.pathfinder.setGoal(null); b.clearControlStates(); b.quit(); } setTimeout(() => process.exit(process.exitCode || 0), 500); }
})();
