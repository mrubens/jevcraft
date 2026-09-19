'use strict';
// Controlled regression: a snow-covered site and granted dirt, no tools. This
// tests clearing/sealing, not natural gathering or a full night of survival.
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const mineflayer = require('mineflayer'), { pathfinder } = require('mineflayer-pathfinder'), { Vec3 } = require('vec3');
const { compatibilityPlugin } = require('../src/compatibility');
const { configureMovements } = require('../src/movement');
const { Task } = require('../src/skills');
const { waitFor, inventory, createSurvival } = require('../src/work');
const shelter = require('../src/shelter');
const id = Date.now().toString(36), username = `Snow${id}`, directory = path.join(__dirname, '..', 'artifacts', `snow-shelter-${id}`);
fs.mkdirSync(directory, { recursive: true });
const log = data => { const line = JSON.stringify({ at: new Date().toISOString(), ...data }); console.log(line); fs.appendFileSync(path.join(directory, 'events.jsonl'), line + '\n'); };
const bot = mineflayer.createBot({ host: '127.0.0.1', port: Number(process.env.MC_PORT || 25579), username, version: '26.1', auth: 'offline' });
bot.loadPlugin(compatibilityPlugin); bot.loadPlugin(pathfinder);
const task = new Task('controlled snow shelter'), timer = setTimeout(() => task.cancel(), 300000);
let goal, minimumHealth = 20, deaths = 0, finishing = false;
const save = () => fs.writeFileSync(path.join(directory, 'goal.json'), JSON.stringify(goal, null, 2));
bot.on('death', () => { deaths++; task.cancel(); });
bot.on('health', () => { minimumHealth = Math.min(minimumHealth, bot.health); });
bot.on('error', err => log({ error: err.message }));
bot.on('end', reason => { if (!finishing) { log({ result: 'FAIL', reason: `Disconnected: ${reason}`, directory }); clearTimeout(timer); process.exitCode = 1; } });
bot.once('spawn', async () => {
  try {
    await bot.waitForChunksToLoad(); configureMovements(bot);
    const center = bot.entity.position.floored().offset(0, 48, 0), { x, y, z } = center;
    const commands = ['gamerule minecraft:spawn_mobs false', 'time set 14000',
      `fill ${x-5} ${y-1} ${z-5} ${x+5} ${y-1} ${z+5} stone`,
      `fill ${x-5} ${y} ${z-5} ${x+5} ${y+4} ${z+5} air`,
      `fill ${x-2} ${y} ${z-2} ${x+2} ${y} ${z+2} snow[layers=1]`,
      `give ${username} dirt 40`, `tp ${username} ${x+.5} ${y+.125} ${z+.5}`];
    fs.writeFileSync(path.join(directory, 'setup.json'), JSON.stringify(commands, null, 2));
    const ready = path.join(directory, 'ready');
    log({ phase: 'setup', username, center, commands, ready, directory });
    await waitFor(task, () => fs.existsSync(ready), 180000);
    await waitFor(task, () => inventory(bot).dirt === 40 && bot.entity.position.distanceTo(center.offset(.5, .125, .5)) < .2);
    assert.equal(bot.game.gameMode, 'survival'); assert.equal(bot.game.difficulty, 'normal');
    assert.equal(bot.blockAt(center.offset(1, 0, 0)).name, 'snow');
    const refuge = { origin: { ...center }, dimension: bot.game.dimension };
    goal = { kind: 'survive', request: 'Take shelter', survival: { shelters: [refuge] } };
    const survival = createSurvival(bot, { state: goal.survival });
    await survival.refugeStep(task, goal, save);
    assert(shelter.inside(bot, refuge)); assert(shelter.sealed(bot, refuge));
    assert.equal(bot.blockAt(center.offset(1, 0, 0)).name, 'dirt');
    assert.equal(deaths, 0); assert.equal(minimumHealth, 20);
    assert(!bot.inventory.items().some(i => i.name.endsWith('_shovel')));
    log({ result: 'PASS', scenario: 'controlled snow clearing and verified shelter without tools', username,
      origin: center, position: bot.entity.position, inventory: inventory(bot), minimumHealth, deaths, directory });
  } catch (err) { log({ result: 'FAIL', error: err.stack, position: bot.entity?.position, deaths, directory }); process.exitCode = 1; }
  finally { finishing = true; clearTimeout(timer); bot.pathfinder.setGoal(null); bot.clearControlStates(); bot.quit(); setTimeout(() => process.exit(process.exitCode || 0), 500); }
});
