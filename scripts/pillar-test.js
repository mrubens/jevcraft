'use strict';
// Controlled mechanics only: console setup supplies a pillar and a pickaxe.
// No setup commands run in the player world or natural acceptance worlds.
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const mineflayer = require('mineflayer'), { pathfinder, goals } = require('mineflayer-pathfinder'), { Vec3 } = require('vec3');
const { compatibilityPlugin } = require('../src/compatibility'), { configureMovements } = require('../src/movement');
const { pillarDescent, descendPillar } = require('../src/pillar-recovery');
const { Task, navigate } = require('../src/skills'), { waitFor, inventory } = require('../src/work');
const id = Date.now().toString(36), username = `Pillar${id}`;
const directory = path.join(__dirname, '..', 'artifacts', `pillar-${id}`);
fs.mkdirSync(directory, { recursive: true });
const log = data => { const line = JSON.stringify({ at: new Date().toISOString(), ...data }); console.log(line); fs.appendFileSync(path.join(directory, 'events.jsonl'), line + '\n'); };
const bot = mineflayer.createBot({ host: '127.0.0.1', port: Number(process.env.MC_PORT || 25578), username, version: '26.1', auth: 'offline' });
bot.loadPlugin(compatibilityPlugin); bot.loadPlugin(pathfinder);
const task = new Task('controlled pillar descent'), timer = setTimeout(() => task.cancel(), 180000);
bot.once('spawn', async () => {
  try {
    await bot.waitForChunksToLoad(); configureMovements(bot);
    const commands = ['fill -3 60 -3 3 70 3 air', 'fill -3 63 -3 3 63 3 stone', 'fill 0 64 0 0 66 0 cobblestone',
      `tp ${username} 0.5 67 0.5`, `give ${username} minecraft:stone_pickaxe 1`];
    fs.writeFileSync(path.join(directory, 'setup.json'), JSON.stringify(commands, null, 2));
    log({ scenario: 'controlled three-block pillar descent', username, commands, directory });
    await waitFor(task, () => fs.existsSync(path.join(directory, 'setup-ready')), 120000);
    await waitFor(task, () => inventory(bot).stone_pickaxe === 1 && Math.abs(bot.entity.position.y - 67) < .1);
    await bot.waitForChunksToLoad();
    const health = bot.health, goal = { request: 'escape a pillar' };
    for (let i = 0; i < 3; i++) {
      assert(pillarDescent(bot, goal), 'An observed supported descent is available');
      assert(await descendPillar(bot, task, goal, () => {}));
      assert(Math.abs(bot.entity.position.y - (66 - i)) < .1);
      assert.equal(bot.health, health);
      log({ step: goal.step, position: bot.entity.position, health: bot.health });
    }
    assert.equal(pillarDescent(bot, goal), null, 'Do not continue into ordinary ground');
    await navigate(bot, task, new goals.GoalBlock(2, 64, 0));
    log({ result: 'PASS', position: bot.entity.position, health: bot.health, inventory: inventory(bot), directory });
  } catch (err) { log({ result: 'FAIL', error: err.stack, position: bot.entity?.position }); process.exitCode = 1; }
  finally { clearTimeout(timer); bot.pathfinder.setGoal(null); bot.quit(); setTimeout(() => process.exit(process.exitCode || 0), 300); }
});
bot.on('error', err => {
  log({ result: 'FAIL', error: err.message }); clearTimeout(timer); process.exitCode = 1;
  bot.quit(); setTimeout(() => process.exit(1), 300);
});
