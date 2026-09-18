'use strict';
// Controlled navigation test around an observed stationary hostile.
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { compatibilityPlugin } = require('../src/compatibility');
const { configureMovements } = require('../src/movement');
const { checkThreats } = require('../src/danger');
const { Task, navigate, surveyRoute } = require('../src/skills');
const id = Date.now().toString(36), username = `Route${id}`;
const directory = path.join(__dirname, '..', 'artifacts', `hostile-route-${id}`);
fs.mkdirSync(directory, { recursive: true });
const setupFile = path.join(directory, 'setup-ready');
const log = value => { const line = JSON.stringify({ at: new Date().toISOString(), ...value }); console.log(line); fs.appendFileSync(path.join(directory, 'events.jsonl'), line + '\n'); };
const bot = mineflayer.createBot({ host: process.env.MC_HOST || '127.0.0.1', port: Number(process.env.MC_PORT || 25567), username, version: '26.1', auth: 'offline' });
bot.loadPlugin(compatibilityPlugin); bot.loadPlugin(pathfinder);
const task = new Task('navigation', 'walk around observed hostile');
const timer = setTimeout(() => task.cancel(), 240000);
bot.on('error', err => log({ error: err.message }));
bot.once('spawn', async () => {
  let observe;
  try {
    const movements = configureMovements(bot); await bot.waitForChunksToLoad();
    const commands = [`tp ${username} 1200.5 64 1200.5`, 'difficulty normal', 'time set 1000',
      'summon minecraft:zombie 1220.5 64 1200.5 {NoAI:1b,Invulnerable:1b,PersistenceRequired:1b,Silent:1b,Tags:["navigation_threat_test"]}'];
    fs.writeFileSync(path.join(directory, 'setup.json'), JSON.stringify(commands));
    log({ phase: 'setup', commands, setupFile, directory });
    const deadline = Date.now() + 180000;
    while (!fs.existsSync(setupFile)) { task.check(); if (Date.now() > deadline) throw new Error('Setup timed out'); await new Promise(r => setTimeout(r, 100)); }
    assert.equal(bot.game.difficulty, 'normal'); assert.equal(bot.game.gameMode, 'survival');
    const target = Object.values(bot.entities).find(e => e.name === 'zombie' && e.position.distanceTo(new Vec3(1220.5, 64, 1200.5)) < 2);
    assert(target, 'The hostile must actually be observed');
    const goal = new goals.GoalBlock(1240, 64, 1200);
    const baseline = await surveyRoute(bot, task, new Movements(bot), goal, 5000);
    const route = await surveyRoute(bot, task, movements, goal, 5000);
    // Postprocessed path points already use block centers.
    const minDistance = points => Math.min(...points.map(p => new Vec3(p.x, p.y, p.z).distanceTo(target.position)));
    assert.equal(baseline.status, 'success'); assert.equal(route.status, 'success');
    assert(minDistance(baseline.path) < 12); assert(minDistance(route.path) >= 12);
    log({ baselineMinimum: minDistance(baseline.path), safeRouteMinimum: minDistance(route.path),
      observedHostiles: Object.values(bot.entities).filter(e => e.name === 'zombie').map(e => ({ id: e.id, position: e.position })),
      route: route.path.map(p => ({ x: p.x, y: p.y, z: p.z })) });
    let closest = Infinity;
    observe = setInterval(() => { closest = Math.min(closest, bot.entity.position.distanceTo(target.position)); }, 20);
    task.interruptCheck = () => checkThreats(bot);
    await navigate(bot, task, goal, { timeoutMs: 45000 });
    assert(closest >= 11.5, `Execution cut inside the observed buffer: ${closest}`);
    assert.equal(bot.health, 20);
    log({ result: 'PASS', closest, position: bot.entity.position, health: bot.health, directory });
  } catch (err) { log({ result: 'FAIL', error: err.stack, directory }); process.exitCode = 1; }
  finally { clearInterval(observe); clearTimeout(timer); bot.quit(); setTimeout(() => process.exit(process.exitCode || 0), 500); }
});
