'use strict';
// Controlled low-ceiling excavation fixture. Grants, teleport and terrain setup
// are recorded separately; this verifies movement mechanics, not acceptance.
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const mineflayer = require('mineflayer');
const { pathfinder } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { compatibilityPlugin } = require('../src/compatibility');
const { configureMovements } = require('../src/movement');
const { Task, navigate } = require('../src/skills');
const { dig, waitFor } = require('../src/work');
const { returnToSurface } = require('../src/surface');
const id = Date.now().toString(36), username = `Climb${id}`;
const directory = path.join(__dirname, '..', 'artifacts', `ascent-${id}`);
fs.mkdirSync(directory, { recursive: true });
const log = data => { const line = JSON.stringify({ at: new Date().toISOString(), ...data }); console.log(line); fs.appendFileSync(path.join(directory, 'events.jsonl'), line + '\n'); };
const bot = mineflayer.createBot({ host: process.env.MC_HOST || '127.0.0.1', port: Number(process.env.MC_PORT || 25567), username, version: '26.1', auth: 'offline' });
bot.loadPlugin(compatibilityPlugin); bot.loadPlugin(pathfinder);
const task = new Task('ascent', 'climb an inspected staircase through solid rock');
const timer = setTimeout(() => task.cancel(), 240000);
bot.on('error', err => log({ error: err.message }));
bot.once('spawn', async () => {
  try {
    await bot.waitForChunksToLoad();
    const loadCommand = `tp ${username} 2202.5 80 2202.5`;
    log({ phase: 'load-fixture', command: loadCommand, directory });
    fs.writeFileSync(path.join(directory, 'load-command.txt'), loadCommand + '\n');
    await waitFor(task, () => Math.abs(bot.entity.position.x - 2202.5) < 1 && bot.blockAt(new Vec3(2212, 76, 2212)), 180000);
    const commands = ['fill 2200 64 2200 2212 76 2212 minecraft:stone',
      'fill 2202 65 2202 2202 66 2202 minecraft:air',
      `gamemode survival ${username}`, `give ${username} minecraft:stone_pickaxe 1`,
      `tp ${username} 2202.5 65 2202.5`];
    const ready = path.join(directory, 'setup-ready');
    fs.writeFileSync(path.join(directory, 'setup.json'), JSON.stringify(commands, null, 2));
    log({ scenario: 'controlled low-ceiling staircase', commands, ready, directory });
    await waitFor(task, () => fs.existsSync(ready), 180000);
    await waitFor(task, () => bot.entity.position.distanceTo(new Vec3(2202.5, 65, 2202.5)) < 0.2 && bot.inventory.items().some(i => i.name === 'stone_pickaxe'));
    configureMovements(bot);
    assert.equal(bot.game.gameMode, 'survival');
    const mining = { target: { x: 2205, y: 10, z: 2205 }, steps: 30, visited: {} };
    // Resume between full-route surveys to directly exercise the bounded
    // fallback. Seven real steps must each clear jump headroom and gain height.
    const goal = { tunnel: mining, surfaceReturn: { attempts: 0, visited: {}, ascent: { steps: 1, visited: {} } } };
    const save = () => fs.writeFileSync(path.join(directory, 'goal.json'), JSON.stringify(goal, null, 2));
    for (let n = 0; n < 7; n++) {
      const start = bot.entity.position.floored();
      await returnToSurface(bot, task, goal, save, { dig, navigate });
      assert.equal(bot.entity.position.floored().y, start.y + 1);
      assert.equal(goal.tunnel.steps, 30);
      assert.equal(bot.blockAt(bot.entity.position.floored().offset(0, -1, 0)).name, 'stone');
      log({ step: n + 1, position: bot.entity.position, health: bot.health, tool: bot.inventory.items().find(i => i.name === 'stone_pickaxe')?.durabilityUsed });
    }
    assert.equal(bot.health, 20);
    assert.equal(bot.entity.position.floored().y, 72);
    assert(bot.inventory.items().find(i => i.name === 'stone_pickaxe').durabilityUsed >= 14);
    log({ result: 'PASS', observedStairSteps: 7, position: bot.entity.position, health: bot.health, directory });
  } catch (err) { log({ result: 'FAIL', error: err.stack, position: bot.entity?.position, directory }); process.exitCode = 1; }
  finally { clearTimeout(timer); bot.pathfinder.setGoal(null); bot.quit(); setTimeout(() => process.exit(process.exitCode || 0), 500); }
});
