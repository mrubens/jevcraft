'use strict';
// Controlled water-crossing fixture. Setup is recorded; never acceptance.
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const mineflayer = require('mineflayer'), { pathfinder, goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { compatibilityPlugin } = require('../src/compatibility');
const { configureMovements } = require('../src/movement');
const { Task, navigate, countOf } = require('../src/skills');
const { surfaceMovement } = require('../src/surface');
const { dryStanding } = require('../src/mining-access');
const { waitFor } = require('../src/work');
const port = Number(process.env.MC_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535 || [25565, 25577].includes(port)) throw new Error('Choose an explicit isolated test MC_PORT');
const id = `swim-${Date.now().toString(36)}`, username = `Swim${id.slice(5)}`, directory = path.join(__dirname, '..', 'artifacts', id);
fs.mkdirSync(directory, { recursive: true });
const log = data => { const line = JSON.stringify({ at: new Date().toISOString(), ...data }); console.log(line); fs.appendFileSync(path.join(directory, 'events.jsonl'), line + '\n'); };
const bot = mineflayer.createBot({ host: '127.0.0.1', port, username, version: '26.1', auth: 'offline' });
bot.loadPlugin(compatibilityPlugin); bot.loadPlugin(pathfinder);
const task = new Task('controlled water crossing'), timer = setTimeout(() => task.cancel(), 4 * 60000);
let deaths = 0, placed = 0, phase;
bot.on('death', () => { deaths++; task.cancel(); });
bot.on('error', error => log({ error: error.message }));
bot.on('physicsTick', () => {
  if (!phase) return;
  if (bot.entity.isInWater) phase.waterTicks++;
  if (bot.entity.isInWater && !bot.entity.onGround) phase.swimmingTicks++;
  phase.minimumHealth = Math.min(phase.minimumHealth, bot.health);
  phase.minimumOxygen = Math.min(phase.minimumOxygen, bot.oxygenLevel);
});
bot.on('blockUpdate', (before, after) => {
  if (phase && after?.name === 'cobblestone' && before?.name !== after.name &&
    after.position.x >= -2 && after.position.x <= 27 && Math.abs(after.position.z) <= 3) placed++;
});
bot.on('navigation_stall', details => log({ stall: details }));
bot.once('spawn', async () => {
  try {
    await bot.waitForChunksToLoad(); configureMovements(bot);
    const commands = ['gamerule minecraft:spawn_mobs false', 'forceload add -2 -3 27 3',
      'fill -2 77 -3 27 84 3 air', 'fill -2 77 -2 27 80 2 stone',
      'fill -2 80 -3 27 84 -3 bedrock', 'fill -2 80 3 27 84 3 bedrock',
      'fill 3 80 -2 7 80 2 water', 'fill 15 78 -2 20 80 2 water',
      `give ${username} cobblestone 64`, `tp ${username} 0.5 81 0.5`];
    fs.writeFileSync(path.join(directory, 'setup.json'), JSON.stringify(commands, null, 2));
    log({ phase: 'setup', username, port, directory, commands: path.join(directory, 'setup.json'), ready: path.join(directory, 'ready') });
    await waitFor(task, () => fs.existsSync(path.join(directory, 'ready')), 180000);
    await waitFor(task, () => countOf(bot, 'cobblestone') === 64 && bot.entity.position.distanceTo(new Vec3(0.5, 81, .5)) < 1, 10000);
    const results = [];
    for (const [name, x, exploration] of [['shallow_puddle', 11, false], ['deep_surface_crossing', 24, true]]) {
      phase = { name, waterTicks: 0, swimmingTicks: 0, minimumHealth: bot.health, minimumOxygen: bot.oxygenLevel };
      const policy = exploration ? surfaceMovement(bot) : null;
      try { await navigate(bot, task, new goals.GoalBlock(x, 81, 0), { timeoutMs: 30000, stallMs: 6000 }); }
      finally { policy?.restore(); }
      assert(phase.waterTicks > 0, 'Fixture must actually enter water');
      if (exploration) assert(phase.swimmingTicks > 0, 'Deep crossing must swim rather than walk on the pool floor');
      assert(dryStanding(bot, bot.entity.position), 'Must climb onto the far bank');
      assert.equal(phase.minimumHealth, 20); assert(phase.minimumOxygen >= 18);
      assert.equal(countOf(bot, 'cobblestone'), 64); assert.equal(placed, 0); assert.equal(deaths, 0);
      results.push({ ...phase, position: { ...bot.entity.position } }); log({ phaseResult: results.at(-1) });
    }
    log({ result: 'PASS', scenario: 'controlled shallow and deep crossings without bridging', results, placed, deaths, directory });
  } catch (error) { log({ result: 'FAIL', error: error.stack, position: bot.entity?.position, phase, placed, deaths, directory }); process.exitCode = 1; }
  finally { clearTimeout(timer); bot.pathfinder.setGoal(null); bot.clearControlStates(); bot.quit(); setTimeout(() => process.exit(process.exitCode || 0), 300); }
});
