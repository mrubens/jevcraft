'use strict';
// Controlled movement on a COPY of the failed mu7sfld6 ruined-portal world.
// Setup teleport/materials/time are recorded; this is not natural acceptance.
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const mineflayer = require('mineflayer'), { pathfinder, goals } = require('mineflayer-pathfinder'), { Vec3 } = require('vec3');
const { compatibilityPlugin } = require('../src/compatibility'), { configureMovements } = require('../src/movement');
const { damagingTerrain, supportCell } = require('../src/terrain');
const { Task, navigate, surveyRoute } = require('../src/skills'), { waitFor, inventory } = require('../src/work');
const id = Date.now().toString(36), username = `Lava${id}`, directory = path.join(__dirname, '..', 'artifacts', `lava-route-${id}`);
fs.mkdirSync(directory, { recursive: true });
const log = value => { const line = JSON.stringify({ at: new Date().toISOString(), ...value }); console.log(line); fs.appendFileSync(path.join(directory, 'events.jsonl'), line + '\n'); };
const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25579, version: '26.1', username, auth: 'offline' });
bot.loadPlugin(compatibilityPlugin); bot.loadPlugin(pathfinder);
const task = new Task('controlled ruined portal route'), timeout = setTimeout(() => task.cancel(), 240000);
bot.on('death', () => { log({ death: true }); task.cancel(); });
bot.once('spawn', async () => {
  let observer;
  try {
    await bot.waitForChunksToLoad(); configureMovements(bot);
    const start = new Vec3(-341, 76, 6), target = new Vec3(-346, 74, 7);
    const commands = [`tp ${username} -340.5 76 6.5`, `give ${username} minecraft:diamond_pickaxe 1`,
      `give ${username} minecraft:cobblestone 64`, 'time set day'];
    fs.writeFileSync(path.join(directory, 'setup.json'), JSON.stringify(commands, null, 2));
    log({ scenario: 'controlled route through copied ruined portal terrain', username, commands, directory });
    await waitFor(task, () => fs.existsSync(path.join(directory, 'setup-ready')), 180000);
    await waitFor(task, () => inventory(bot).diamond_pickaxe === 1 && bot.entity.position.distanceTo(start.offset(.5, 0, .5)) < .2);
    await bot.waitForChunksToLoad();
    let minimumHealth = bot.health, hazardousContact = false;
    observer = () => {
      minimumHealth = Math.min(minimumHealth, bot.health);
      hazardousContact ||= [supportCell(bot.entity.position), bot.entity.position.floored(), bot.entity.position.offset(0, 1, 0).floored()]
        .some(p => damagingTerrain.has(bot.blockAt(p)?.name));
    };
    bot.on('physicsTick', observer);
    bot.on('navigation_stall', detail => log({ navigationStall: detail }));
    for (const p of [target, start, target]) {
      const destination = new goals.GoalBlock(p.x, p.y, p.z);
      const route = await surveyRoute(bot, task, bot.pathfinder.movements, destination, 3000);
      log({ target: p, route: { status: route.status, nodes: route.path?.map(n => ({ x: n.x, y: n.y, z: n.z })) } });
      assert.equal(route.status, 'success');
      assert(!route.path.some(n => damagingTerrain.has(bot.blockAt(new Vec3(n.x, n.y - 1, n.z))?.name)));
      await navigate(bot, task, destination, { timeoutMs: 30000, stallMs: 6000 });
      assert.equal(hazardousContact, false); assert.equal(minimumHealth, 20);
      log({ arrived: p, position: bot.entity.position, health: bot.health });
    }
    log({ result: 'PASS', minimumHealth, hazardousContact, directory });
  } catch (err) { log({ result: 'FAIL', error: err.stack, position: bot.entity?.position, health: bot.health }); process.exitCode = 1; }
  finally {
    if (observer) bot.removeListener('physicsTick', observer);
    clearTimeout(timeout); bot.pathfinder.setGoal(null); bot.quit(); setTimeout(() => process.exit(process.exitCode || 0), 300);
  }
});
bot.on('error', err => { log({ result: 'FAIL', error: err.message }); clearTimeout(timeout); bot.quit(); setTimeout(() => process.exit(1), 300); });
