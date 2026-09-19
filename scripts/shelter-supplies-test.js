'use strict';
// Controlled Survival regression: a stale elevated plan, carried spruce wood,
// and ordinary low-ground dirt gathering. Not natural Survival acceptance.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const mineflayer = require('mineflayer'), { pathfinder } = require('mineflayer-pathfinder'), { Vec3 } = require('vec3');
const { compatibilityPlugin } = require('../src/compatibility'), { configureMovements } = require('../src/movement');
const { Task } = require('../src/skills'), { createSurvival, inventory, waitFor } = require('../src/work');
const { reservedForConstruction } = require('../src/build-sites'), shelter = require('../src/shelter');
const port = Number(process.env.MC_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535 || [25565, 25577].includes(port)) throw new Error('Explicit isolated MC_PORT required');
const id = Date.now().toString(36), x = 3600, directory = path.resolve('artifacts', `shelter-supplies-${id}`);
fs.mkdirSync(directory, { recursive: true });
const log = event => { const row = JSON.stringify({ at: new Date().toISOString(), ...event }); console.log(row); fs.appendFileSync(path.join(directory, 'events.jsonl'), row + '\n'); };
const connect = prefix => { const b = mineflayer.createBot({ host: '127.0.0.1', port, username: prefix + id, version: '26.1', auth: 'offline' }); b.loadPlugin(compatibilityPlugin); b.loadPlugin(pathfinder); return b; };
const bot = connect('Hut'), observer = connect('Watch'), task = new Task('reconsider shelter and use carried wood');
let active = false, minimumHealth = 20, deaths = 0, commands = 0, goal;
const changes = [], states = [];
observer.on('blockUpdate', (old, block) => {
  if (active && block && Math.abs(block.position.x - x) < 30 && Math.abs(block.position.z) < 30 && old?.name !== block.name)
    changes.push({ before: old?.name, after: block.name, position: { ...block.position } });
});
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
const save = () => {
  fs.writeFileSync(path.join(directory, 'goal.json'), JSON.stringify(goal, null, 2));
  const state = { step: goal.step, action: goal.survivalAction, position: { ...bot.entity.position }, inventory: inventory(bot) };
  states.push(structuredClone(state)); log(state);
};
const timer = setTimeout(() => task.cancel(), 5 * 60000);
(async () => {
  try {
    await Promise.all([ready(bot), ready(observer)]);
    const setup = [`forceload add ${x - 32} -32 ${x + 32} 32`, `fill ${x - 16} 64 -16 ${x + 16} 82 16 air`,
      `fill ${x - 16} 62 -16 ${x + 16} 62 16 bedrock`, `fill ${x - 16} 63 -16 ${x + 16} 63 16 dirt`,
      `gamemode survival ${bot.username}`, `gamemode survival ${observer.username}`,
      `tp ${bot.username} ${x + .5} 64 .5`, `tp ${observer.username} ${x + 9.5} 64 5.5`,
      `give ${bot.username} spruce_log 1`, `give ${bot.username} stripped_spruce_wood 2`,
      `give ${bot.username} spruce_planks 4`, `give ${bot.username} dirt 1`];
    fs.writeFileSync(path.join(directory, 'setup.json'), JSON.stringify(setup, null, 2)); log({ phase: 'setup', directory });
    await waitFor(task, () => fs.existsSync(path.join(directory, 'ready')), 180000);
    await waitFor(task, () => inventory(bot).spruce_planks === 4 && bot.entity.position.distanceTo(new Vec3(x + .5, 64, .5)) < .2, 10000);
    const old = { origin: { x: x + 1, y: 79, z: 1 }, dimension: bot.game.dimension };
    goal = { request: 'get me 16 cobblestone', kind: 'obtain', item: 'cobblestone', count: 16, survival: { shelters: [old] } };
    let survival = createSurvival(bot, { state: goal.survival });
    bot._constructionProtection = block => reservedForConstruction(goal, block.position) ? 100 : 0;
    bot.pathfinder.movements.exclusionAreasBreak.push(bot._constructionProtection);
    active = true;
    for (let step = 0; step < 32; step++) {
      await survival.refugeStep(task, goal, save);
      const refuge = survival.currentShelter();
      if (refuge && shelter.inside(bot, refuge) && shelter.sealed(bot, refuge)) break;
    }
    const refuge = survival.currentShelter();
    assert(refuge && shelter.inside(bot, refuge) && shelter.sealed(bot, refuge));
    assert.equal(refuge.origin.y, 64); assert.notDeepEqual(refuge.origin, old.origin);
    assert(states.some(s => s.step?.action === 'craft' && s.step.item === 'spruce_planks'));
    assert(states.some(s => s.step?.action === 'mine' && s.step.minimumY === 63));
    assert.equal(inventory(bot).spruce_log || 0, 0);
    assert.equal(inventory(bot).stripped_spruce_wood || 0, 0);
    await waitFor(task, () => shelter.sealed(observer, refuge), 5000);
    assert(changes.some(c => c.before === 'dirt' && c.after === 'air' && c.position.y === 63));
    assert(changes.some(c => c.after === 'spruce_planks'));
    const firstSealed = { ...refuge.origin };
    // Persist/reload, then open and reseal without losing the original request.
    survival = createSurvival(bot, { state: JSON.parse(fs.readFileSync(path.join(directory, 'goal.json'))).survival });
    goal.survival = survival.state;
    await survival.leave(task, goal, save, survival.currentShelter());
    for (let step = 0; step < 8; step++) {
      await survival.refugeStep(task, goal, save);
      if (shelter.inside(bot, survival.currentShelter()) && shelter.sealed(bot, survival.currentShelter())) break;
    }
    assert(shelter.inside(bot, survival.currentShelter()) && shelter.sealed(bot, survival.currentShelter()));
    assert.deepEqual(survival.currentShelter().origin, firstSealed);
    assert.equal(goal.request, 'get me 16 cobblestone');
    assert(goal.survival.shelters.some(s => s.origin.y === 79), 'Old work remains protected');
    assert.equal(minimumHealth, 20); assert.equal(deaths, 0); assert.equal(commands, 0);
    log({ result: 'PASS', origin: firstSealed, inventory: inventory(bot), observedBlockChanges: changes.length, minimumHealth, deaths, commands, directory });
  } catch (error) { log({ result: 'FAIL', error: error.stack, changes, position: bot.entity?.position, directory }); process.exitCode = 1; }
  finally { clearTimeout(timer); for (const b of [bot, observer]) { b.pathfinder.setGoal(null); b.clearControlStates(); b.quit(); } setTimeout(() => process.exit(process.exitCode || 0), 500); }
})();
