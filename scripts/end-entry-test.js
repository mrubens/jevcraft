'use strict';
// Controlled End-entry mechanics. The fixture records its platform, lava,
// frame ring, Eye grants and teleport; this is not a fresh winning run.
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const mineflayer = require('mineflayer'), { pathfinder } = require('mineflayer-pathfinder'), { Vec3 } = require('vec3');
const { compatibilityPlugin } = require('../src/compatibility');
const { configureMovements } = require('../src/movement');
const { Task, navigate, countOf } = require('../src/skills');
const { observedPortal, frameOffsets } = require('../src/stronghold');
const { enterEnd, activePortal } = require('../src/end-portal');
const { gameStep, watchGameProgress, dimension } = require('../src/game-progress');
const { waitFor, inventory } = require('../src/work');
const id = Date.now().toString(36), username = `End${id}`, directory = path.join(__dirname, '..', 'artifacts', `end-entry-${id}`);
fs.mkdirSync(directory, { recursive: true });
const log = data => { const line = JSON.stringify({ at: new Date().toISOString(), ...data }); console.log(line); fs.appendFileSync(path.join(directory, 'events.jsonl'), line + '\n'); };
const bot = mineflayer.createBot({ host: '127.0.0.1', port: Number(process.env.MC_PORT || 25579), username, version: '26.1', auth: 'offline' });
bot.loadPlugin(compatibilityPlugin); bot.loadPlugin(pathfinder);
const task = new Task('controlled End entry'), timer = setTimeout(() => task.cancel(), 360000);
let goal, deaths = 0, thrownEyes = 0, minimumHealth = 20, finishing = false, detach;
const save = () => fs.writeFileSync(path.join(directory, 'goal.json'), JSON.stringify(goal, null, 2));
bot.on('death', () => { deaths++; task.cancel(); });
bot.on('health', () => { minimumHealth = Math.min(minimumHealth, bot.health); });
bot.on('entitySpawn', e => { if (e.name === 'eye_of_ender') thrownEyes++; });
bot.on('error', err => log({ error: err.message }));
bot.on('end', reason => { if (!finishing) { log({ result: 'FAIL', reason: `Disconnected: ${reason}`, directory }); clearTimeout(timer); process.exitCode = 1; } });
bot.once('spawn', async () => {
  try {
    await bot.waitForChunksToLoad(); configureMovements(bot);
    const center = bot.entity.position.floored().offset(0, 32, 0), { x, y, z } = center;
    const commands = ['gamerule minecraft:spawn_mobs false', 'time set 1000',
      `fill ${x-8} ${y-1} ${z-8} ${x+8} ${y-1} ${z+8} stone`,
      `fill ${x-8} ${y} ${z-8} ${x+8} ${y+5} ${z+8} air`,
      `fill ${x-1} ${y-1} ${z-1} ${x+1} ${y-1} ${z+1} lava`,
      ...frameOffsets.map((o, i) => `setblock ${x+o.x} ${y} ${z+o.z} end_portal_frame[facing=${o.facing},eye=${i < 2}]`),
      `give ${username} ender_eye 10`, `tp ${username} ${x-4+.5} ${y} ${z+.5}`];
    fs.writeFileSync(path.join(directory, 'setup.json'), JSON.stringify(commands, null, 2));
    const ready = path.join(directory, 'ready');
    log({ phase: 'setup', username, center, commands, ready, directory });
    await waitFor(task, () => fs.existsSync(ready), 180000);
    await waitFor(task, () => countOf(bot, 'ender_eye') === 10 && bot.entity.position.distanceTo(center.offset(-3.5, 0, .5)) < .3);
    assert.equal(bot.game.gameMode, 'survival'); assert.equal(bot.game.difficulty, 'normal');
    const portal = observedPortal(bot); assert(portal); assert.equal(activePortal(bot, center), false);
    goal = { kind: 'win', request: 'Jev beat Minecraft', endPortal: portal,
      gameProgress: { version: 1, startedAt: Date.now(), milestones: { stronghold_located: { ...portal, at: Date.now() } } } };
    detach = watchGameProgress(bot, goal, save); save();
    for (let step = 0; step < 16 && dimension(bot) === 'overworld'; step++) {
      await gameStep(bot, task, goal, save, { enter_end: (b, t, g, s) => enterEnd(b, t, g, s, { navigate }) });
      log({ step: goal.step, portal: goal.endPortal, dimension: dimension(bot), inventory: inventory(bot), position: bot.entity.position, health: bot.health });
    }
    assert.equal(dimension(bot), 'end');
    await bot.waitForChunksToLoad();
    await waitFor(task, () => bot.entity.position.y > 40 && bot.entity.position.y < 80, 10000);
    assert.equal(countOf(bot, 'ender_eye'), 0); assert.equal(goal.endPortal.insertions.length, 10);
    assert.equal(thrownEyes, 0); assert.equal(deaths, 0); assert.equal(minimumHealth, 20);
    assert(goal.gameProgress.milestones.end_entered); assert.equal(goal.gameProgress.milestones.dragon_defeated, undefined);
    log({ result: 'PASS', scenario: 'controlled lava-backed frame activation and living End entry', username, dimension: dimension(bot),
      position: bot.entity.position, inventory: inventory(bot), minimumHealth, deaths, thrownEyes, directory,
      limitations: 'No natural Eye acquisition, portal-room discovery, dragon combat or return verified' });
  } catch (err) { log({ result: 'FAIL', error: err.stack, position: bot.entity?.position, deaths, directory }); process.exitCode = 1; }
  finally { finishing = true; detach?.(); clearTimeout(timer); bot.pathfinder.setGoal(null); bot.clearControlStates(); bot.quit(); setTimeout(() => process.exit(process.exitCode || 0), 500); }
});
