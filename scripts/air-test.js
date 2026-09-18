'use strict';
// A real swimming check in an existing world. No commands or grants during
// the check. Label prepared pools with ACCEPT_SCENARIO=controlled.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mineflayer = require('mineflayer');
const { pathfinder, goals } = require('mineflayer-pathfinder');
const { configureMovements } = require('../src/movement');
const { compatibilityPlugin } = require('../src/compatibility');
const { Task, navigate } = require('../src/skills');
const { maintainVitals, needsAir } = require('../src/vitals');
const id = Date.now().toString(36);
const directory = path.join(__dirname, '..', 'artifacts', `air-${id}`);
fs.mkdirSync(directory, { recursive: true });
const log = value => { const line = JSON.stringify({ at: new Date().toISOString(), ...value }); console.log(line); fs.appendFileSync(path.join(directory, 'events.jsonl'), `${line}\n`); };
const bot = mineflayer.createBot({ host: process.env.MC_HOST || 'localhost', port: Number(process.env.MC_PORT || 25568),
  username: `Air${id}`, version: process.env.MC_VERSION || '26.1', auth: 'offline' });
bot.loadPlugin(compatibilityPlugin); bot.loadPlugin(pathfinder);
const task = new Task('air-test', 'verify underwater recovery');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let minimumHealth = 20;
bot.on('health', () => { minimumHealth = Math.min(minimumHealth, bot.health); log({ health: bot.health, oxygen: bot.oxygenLevel }); });
bot.on('death', () => task.cancel());
bot.on('error', err => log({ error: err.message }));
const deadline = setTimeout(() => { task.cancel(); bot.pathfinder.setGoal(null); bot.clearControlStates(); }, 240000);
bot.once('spawn', async () => {
  try {
    configureMovements(bot);
    await bot.waitForChunksToLoad(); await bot.waitForTicks(40);
    assert.equal(bot.game.gameMode, 'survival');
    assert.equal(bot.inventory.items().length, 0);
    log({ initial: { position: bot.entity.position, difficulty: bot.game.difficulty, inventory: [], scenario: process.env.ACCEPT_SCENARIO || 'natural' } });
    const water = bot.findBlocks({ matching: bot.registry.blocksByName.water.id, maxDistance: 128, count: 64,
      useExtraInfo: b => bot.blockAt(b.position.offset(0, 1, 0))?.name === 'air' &&
        bot.blockAt(b.position.offset(0, -1, 0))?.name === 'water',
    });
    let target;
    for (const p of water) {
      const g = new goals.GoalNear(p.x, p.y + 1, p.z, 2);
      if (bot.pathfinder.getPathTo(bot.pathfinder.movements, g, 500).status === 'success') { target = p; break; }
    }
    log({ observedPools: water.length });
    assert(target, 'No reachable deep water observed near spawn');
    log({ target });
    await navigate(bot, task, new goals.GoalNear(target.x, target.y + 1, target.z, 2));
    for (let dive = 1; dive <= 3; dive++) {
      const approachDeadline = Date.now() + 15000;
      while (Math.hypot(bot.entity.position.x - target.x - 0.5, bot.entity.position.z - target.z - 0.5) > 0.25) {
        task.check(); assert(Date.now() < approachDeadline, 'Could not enter the observed water column');
        await bot.lookAt(target.offset(0.5, 0.5, 0.5), true);
        bot.setControlState('forward', true); bot.setControlState('jump', true);
        await sleep(50);
      }
      bot.clearControlStates(); bot.setControlState('sneak', true);
      while (bot.entity.position.y > target.y - 0.95) { task.check(); await sleep(50); }
      bot.clearControlStates();
      while (!needsAir(bot)) { task.check(); await sleep(50); }
      log({ dive, phase: 'low-air', oxygen: bot.oxygenLevel, position: bot.entity.position });
      await maintainVitals(bot, task, action => log({ dive, action }));
      assert.equal(bot.oxygenLevel, 20);
      log({ dive, phase: 'recovered', oxygen: bot.oxygenLevel, health: bot.health, position: bot.entity.position });
    }
    assert.equal(minimumHealth, 20, 'The swimming check must finish without damage');
    log({ result: 'PASS', minimumHealth });
  } catch (err) { log({ result: 'FAIL', error: err.message }); process.exitCode = 1; }
  finally { clearTimeout(deadline); bot.clearControlStates(); bot.quit(); setTimeout(() => process.exit(process.exitCode || 0), 500); }
});
