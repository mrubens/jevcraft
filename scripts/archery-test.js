'use strict';
// Controlled bow/crystal mechanics with recorded grants and constructed
// pillars. No result from this fixture counts as natural progression.
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const mineflayer = require('mineflayer'), { pathfinder } = require('mineflayer-pathfinder'), { Vec3 } = require('vec3');
const { compatibilityPlugin } = require('../src/compatibility');
const { configureMovements } = require('../src/movement');
const { Task, countOf } = require('../src/skills');
const { aimAtEntity, shootBow } = require('../src/projectiles');
const { waitFor, inventory } = require('../src/work');
const { decideTree } = require('../src/decisions');
// Resolve the explicit fixture endpoint BEFORE loading model credentials:
// .env also contains the user's interactive Minecraft connection.
const fixturePort = Number(process.env.MC_PORT || 25579);
if ([25565, 25577].includes(fixturePort)) throw new Error('Archery fixtures cannot use an interactive server port');
require('../src/env').loadEnv(); const { TypeSafe } = require('../src/typesafe');
const id = Date.now().toString(36), username = `Bow${id}`, directory = path.join(__dirname, '..', 'artifacts', `archery-${id}`);
fs.mkdirSync(directory, { recursive: true });
const log = data => { const line = JSON.stringify({ at: new Date().toISOString(), ...data }); console.log(line); fs.appendFileSync(path.join(directory, 'events.jsonl'), line + '\n'); };
const bot = mineflayer.createBot({ host: '127.0.0.1', port: fixturePort, username, version: '26.1', auth: 'offline' });
bot.loadPlugin(compatibilityPlugin); bot.loadPlugin(pathfinder);
const task = new Task('controlled archery'), timer = setTimeout(() => task.cancel(), 360000), client = new TypeSafe();
let deaths = 0, minimumHealth = 20, finishing = false;
const explosions = [];
bot._client.on('explosion', packet => { explosions.push({ at: Date.now(), center: packet.center }); log({ explosion: packet.center }); });
bot.on('death', () => { deaths++; task.cancel(); });
bot.on('health', () => { minimumHealth = Math.min(minimumHealth, bot.health); });
bot.on('error', err => log({ error: err.message }));
bot.on('end', reason => { if (!finishing) { log({ result: 'FAIL', reason: `Disconnected: ${reason}`, directory }); clearTimeout(timer); process.exitCode = 1; } });
bot.once('spawn', async () => {
  try {
    await bot.waitForChunksToLoad(); configureMovements(bot);
    const p = bot.entity.position.floored().offset(0, 60, 0), { x, y, z } = p;
    const targets = [p.offset(22, 0, -18), p.offset(30, 28, 16), p.offset(-24, 18, 8)];
    const commands = ['gamerule minecraft:spawn_mobs false', 'time set 1000',
      `forceload add ${x-36} ${z-36} ${x+36} ${z+36}`,
      `fill ${x-6} ${y-1} ${z-6} ${x+6} ${y-1} ${z+6} stone`,
      `give ${username} bow`, `give ${username} arrow 32`, `tp ${username} ${x+.5} ${y} ${z+.5}`];
    for (const [i, t] of targets.entries()) {
      if (i === 2) {
        for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
          // EndSpikeFeature, radius 2: obsidian ends below the center bedrock;
          // the 5x5 cage starts level with that bedrock, one below the crystal.
          if (dx*dx+dz*dz <= 5) commands.push(`fill ${t.x+dx} ${y-1} ${t.z+dz} ${t.x+dx} ${t.y-2} ${t.z+dz} obsidian`);
          for (let dy = 0; dy <= 3; dy++) if (Math.abs(dx) === 2 || Math.abs(dz) === 2 || dy === 3) {
            commands.push(`setblock ${t.x+dx} ${t.y-1+dy} ${t.z+dz} iron_bars`);
          }
        }
      }
      commands.push(`setblock ${t.x} ${t.y-1} ${t.z} bedrock`, `summon end_crystal ${t.x+.5} ${t.y} ${t.z+.5}`);
    }
    fs.writeFileSync(path.join(directory, 'setup.json'), JSON.stringify(commands, null, 2));
    const ready = path.join(directory, 'ready');
    log({ phase: 'setup', username, targets, commandFile: path.join(directory, 'setup.json'), ready, directory });
    await waitFor(task, () => fs.existsSync(ready), 180000);
    await waitFor(task, () => countOf(bot, 'arrow') === 32 && bot.entity.position.distanceTo(p.offset(.5, 0, .5)) < .3, 30000);
    await bot.waitForChunksToLoad();
    assert.equal(bot.game.gameMode, 'survival'); assert.equal(bot.game.difficulty, 'normal');
    const destroyed = [], shots = [], candidates = Object.values(bot.entities).filter(e => e.name === 'end_crystal');
    assert.equal(candidates.length, 3);
    for (let attempt = 0; attempt < 16 && destroyed.length < 3; attempt++) {
      const remaining = candidates.filter(e => !destroyed.includes(e.id)), tree = {};
      for (const target of remaining) if (bot.entities[target.id] === target && aimAtEntity(bot, target)) {
        tree[`shoot_${target.id}`] = { description: { action: 'Shoot this observed crystal along a clear computed arc',
          position: { ...target.position }, distance: target.position.distanceTo(bot.entity.position) }, run: () => target };
      }
      if (!Object.keys(tree).length) throw new Error('No clear trajectory to the remaining fixture crystals');
      const decision = await decideTree(client, { state: { task: 'Destroy the observed healing crystals with the bow',
        arrows: countOf(bot, 'arrow'), health: bot.health }, tree });
      const target = decision.action.run(), before = Date.now();
      log({ decision: { path: decision.path, judgments: decision.judgments }, target: target.id });
      const shot = await shootBow(bot, task, target); shots.push(shot); log({ shot });
      await new Promise(r => setTimeout(r, Math.ceil(shot.ticks * 50) + 500)); task.check();
      const exploded = explosions.some(e => e.at >= before && new Vec3(e.center.x, e.center.y, e.center.z).distanceTo(target.position) < 3);
      if (exploded && bot.entities[target.id] !== target) { destroyed.push(target.id); log({ confirmedCrystalExplosion: target.id }); }
    }
    assert.equal(destroyed.length, 3); assert.equal(deaths, 0); assert.equal(minimumHealth, 20);
    log({ result: 'PASS', scenario: 'controlled ground/elevated/caged crystal bow shots', destroyed, shots: shots.length,
      minimumHealth, deaths, inventory: inventory(bot), directory });
  } catch (err) { log({ result: 'FAIL', error: err.stack, position: bot.entity?.position, deaths, directory }); process.exitCode = 1; }
  finally { finishing = true; clearTimeout(timer); bot.pathfinder.setGoal(null); bot.clearControlStates(); bot.quit(); setTimeout(() => process.exit(process.exitCode || 0), 500); }
});
