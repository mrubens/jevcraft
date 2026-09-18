'use strict';
// Diagnostic on retained terrain, NOT fresh-start survival acceptance. Recreate
// the upstream collision dimensions using ordinary movement, then repair them.
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const mineflayer = require('mineflayer');
const { Vec3 } = require('vec3');
const { pathfinder, goals } = require('mineflayer-pathfinder');
const { compatibilityPlugin, fixPlayerDimensions } = require('../src/compatibility');
const { configureMovements } = require('../src/movement');
const { surfaceMovement } = require('../src/surface');
const { navigate, Task } = require('../src/skills');
if (!process.env.MC_PORT || !process.env.MC_USERNAME || !process.env.NAV_START || !process.env.NAV_TARGET) {
  throw new Error('Set MC_PORT, MC_USERNAME, NAV_START=x,y,z (solid floor with a step to +z), NAV_TARGET=x,y,z');
}
function coordinate(value) {
  const parts = value.split(',').map(Number);
  assert(parts.length === 3 && parts.every(Number.isInteger));
  return new Vec3(...parts);
}
const start = coordinate(process.env.NAV_START), target = coordinate(process.env.NAV_TARGET);
const directory = path.join(__dirname, '..', 'artifacts', `navigation-${Date.now().toString(36)}`);
fs.mkdirSync(directory, { recursive: true });
const log = value => { console.log(JSON.stringify(value)); fs.appendFileSync(path.join(directory, 'events.jsonl'), JSON.stringify(value) + '\n'); };
const bot = mineflayer.createBot({ host: process.env.MC_HOST || '127.0.0.1', port: Number(process.env.MC_PORT),
  username: process.env.MC_USERNAME, version: '26.1', auth: 'offline' });
bot.loadPlugin(compatibilityPlugin); bot.loadPlugin(pathfinder);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const task = new Task('diagnostic', 'reproduce and recover from collision corrections');
let corrections = 0, recoveries = 0;
bot.on('forcedMove', () => { corrections++; });
bot.on('navigation_recovery', details => { recoveries++; log({ recovery: details }); });
bot.on('navigation_stall', details => log({ navigationStall: details }));
bot.on('death', () => task.cancel());
const timeout = setTimeout(() => task.cancel(), 120000);
bot.once('spawn', async () => {
  let policy;
  try {
    await bot.waitForChunksToLoad(); configureMovements(bot);
    log({ scenario: 'retained-world collision diagnostic', directory, start: bot.entity.position,
      gameMode: bot.game.gameMode, difficulty: bot.game.difficulty, health: bot.health });
    policy = surfaceMovement(bot);
    const walk = p => navigate(bot, task, new goals.GoalBlock(p.x, p.y, p.z), { timeoutMs: 30000, stallMs: 7000 });
    await walk(start);
    assert.equal(bot.blockAt(start.offset(0, 0, 1)).boundingBox, 'block', 'reproduction needs a step to the south');
    const before = corrections;
    bot.physics.playerHalfWidth = 0.3; bot.physics.playerHeight = 1.8;
    await bot.lookAt(start.offset(0.5, 1.62, 1.5), true);
    bot.setControlState('forward', true);
    const until = Date.now() + 4000;
    while (corrections - before < 8 && Date.now() < until) { task.check(); await sleep(50); }
    bot.clearControlStates();
    fixPlayerDimensions(bot.physics);
    assert(corrections - before >= 8, 'must reproduce repeated corrections before testing recovery');
    log({ reproduced: true, corrections: corrections - before, position: bot.entity.position, onGround: bot.entity.onGround });
    await walk(target);
    assert(recoveries > 0, 'navigation must recover without external recentering');
    log({ recoveredAndArrived: true, position: bot.entity.position, health: bot.health });
    const fixedCorrections = corrections, previousRecoveries = recoveries;
    await walk(start);
    await walk(target);
    assert.equal(corrections, fixedCorrections, 'fixed dimensions must prevent corrections on the repeat route');
    assert.equal(recoveries, previousRecoveries);
    log({ result: 'PASS', repeatedRouteCorrections: 0, position: bot.entity.position, health: bot.health, directory });
  } catch (err) { log({ result: 'FAIL', error: err.message, position: bot.entity?.position, directory }); process.exitCode = 1; }
  finally {
    clearTimeout(timeout); policy?.restore(); fixPlayerDimensions(bot.physics);
    bot.pathfinder.setGoal(null); bot.clearControlStates(); bot.quit();
    setTimeout(() => process.exit(process.exitCode || 0), 500);
  }
});
bot.on('error', err => log({ error: err.message }));
