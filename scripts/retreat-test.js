'use strict';
// Controlled Normal arena; independent observation of an unarmed retreat.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const mineflayer = require('mineflayer'), { pathfinder } = require('mineflayer-pathfinder');
const { compatibilityPlugin } = require('../src/compatibility'), { configureMovements } = require('../src/movement');
const { Task } = require('../src/skills'), { createSurvival, waitFor } = require('../src/work');
const { immediateThreat } = require('../src/danger');
const port = Number(process.env.MC_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535 || [25565, 25577, 25579, 25580, 25582].includes(port)) throw new Error('Explicit isolated fixture MC_PORT required');
const id = Date.now().toString(36), x = Number(process.env.RETREAT_TEST_X || 4800), directory = path.resolve('artifacts', `retreat-${id}`);
fs.mkdirSync(directory, { recursive: true });
const log = event => { const row = JSON.stringify({ at: new Date().toISOString(), ...event }); console.log(row); fs.appendFileSync(path.join(directory, 'events.jsonl'), row + '\n'); };
const connect = prefix => { const b = mineflayer.createBot({ host: '127.0.0.1', port, username: prefix + id, version: '26.1', auth: 'offline', respawn: false }); b.loadPlugin(compatibilityPlugin); b.loadPlugin(pathfinder); return b; };
const bot = connect('Retreat'), observer = connect('Watch'), task = new Task('survive close-range pursuit');
let active = false, minimumHealth = 20, deaths = 0, commands = 0, strikes = 0, witnessedHits = 0, target;
const positions = [], changes = [];
observer.on('entityMoved', e => { if (active && e.username === bot.username) positions.push({ ...e.position }); });
observer.on('entityHurt', e => { if (active && e.id === target?.id) witnessedHits++; });
observer.on('blockUpdate', (old, block) => { if (active && block && Math.abs(block.position.x - x) < 40 && Math.abs(block.position.z) < 40 && old?.name !== block.name) changes.push({ before: old?.name, after: block.name, position: { ...block.position } }); });
for (const b of [bot, observer]) {
  b.on('error', error => log({ error: error.message })); b.on('death', () => { deaths++; task.cancel(); });
  const write = b._client.write; b._client.write = function (name, packet, ...args) { if (active && name.startsWith('chat_command')) commands++; return write.call(this, name, packet, ...args); };
}
bot.on('health', () => { if (active) minimumHealth = Math.min(minimumHealth, bot.health); });
const ready = async b => { await new Promise((resolve, reject) => { b.once('spawn', resolve); b.once('error', reject); }); await b.waitForChunksToLoad(); configureMovements(b); };
const timer = setTimeout(() => task.cancel(), 4 * 60000);
(async () => {
  try {
    await Promise.all([ready(bot), ready(observer)]);
    const attack = bot.attack; bot.attack = function (...args) { strikes++; return attack.apply(this, args); };
    const setup = [`forceload add ${x - 48} -48 ${x + 48} 48`, `fill ${x - 40} 70 -40 ${x + 40} 73 40 air`,
      `fill ${x - 40} 68 -40 ${x + 40} 69 40 stone`, `fill ${x - 40} 74 -40 ${x + 40} 74 40 sea_lantern`,
      'difficulty normal', `gamemode survival ${bot.username}`, `gamemode creative ${observer.username}`,
      `tp ${observer.username} ${x + 5.5} 70 -10.5`, `tp ${bot.username} ${x + .5} 70 .5`];
    fs.writeFileSync(path.join(directory, 'setup.json'), JSON.stringify(setup, null, 2)); log({ phase: 'setup', directory });
    await waitFor(task, () => fs.existsSync(path.join(directory, 'ready')), 180000);
    await waitFor(task, () => Math.abs(bot.entity.position.x - x - .5) < 1, 10000);
    assert.equal(bot.inventory.items().length, 0); assert.equal(bot.game.difficulty, 'normal'); assert.equal(bot.game.gameMode, 'survival');
    const spawn = [`summon zombie ${x + 2.5} 70 .5 {PersistenceRequired:1b,Tags:["jev_retreat_${id}"]}`];
    fs.writeFileSync(path.join(directory, 'mobs.json'), JSON.stringify(spawn, null, 2)); log({ phase: 'spawn', directory });
    await waitFor(task, () => !!(target = Object.values(bot.entities).find(e => e.name === 'zombie' && e.position.distanceTo(bot.entity.position) < 4)), 60000);
    const start = bot.entity.position.clone(), goal = { kind: 'obtain', request: 'get me dirt', item: 'dirt', count: 32 };
    const survival = createSurvival(bot), save = () => fs.writeFileSync(path.join(directory, 'goal.json'), JSON.stringify(goal, null, 2));
    active = true; const started = Date.now();
    await survival.step(task, goal, save);
    assert(strikes > 0, 'The close hostile triggered a knockback swing');
    assert(bot.entity.position.distanceTo(start) >= 6, 'The same survival turn actually retreated');
    assert(target.position.distanceTo(bot.entity.position) > 8, 'Escaped close attack range');
    log({ phase: 'first_escape', position: { ...bot.entity.position }, distance: target.position.distanceTo(bot.entity.position), strikes, minimumHealth });
    let escapes = 1;
    while (Date.now() - started < 15000) {
      task.check();
      if (immediateThreat(bot)) { await survival.step(task, goal, save); escapes++; }
      else await bot.waitForTicks(2);
    }
    assert(positions.some(p => Math.hypot(p.x - start.x, p.z - start.z) >= 6), 'Independent client observed the retreat');
    assert(witnessedHits > 0, 'Independent client observed a successful hit');
    assert.equal(deaths, 0); assert.equal(commands, 0); assert.equal(changes.length, 0, 'Retreat did not excavate or build');
    assert(minimumHealth >= 10, 'Escaped before losing most of the initial health'); assert.equal(goal.item, 'dirt');
    log({ result: 'PASS', escapes, strikes, witnessedHits, minimumHealth, health: bot.health, deaths, commands, observedPositionPackets: positions.length, position: { ...bot.entity.position }, directory });
  } catch (error) { log({ result: 'FAIL', error: error.stack, position: bot.entity?.position, minimumHealth, deaths, strikes, witnessedHits, changes, directory }); process.exitCode = 1; }
  finally { clearTimeout(timer); for (const b of [bot, observer]) { b.pathfinder.setGoal(null); b.clearControlStates(); b.quit(); } setTimeout(() => process.exit(process.exitCode || 0), 500); }
})();
