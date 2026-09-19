'use strict';
// Controlled fall fixture: platform/air/granted bucket/teleport are recorded.
// Only ordinary item use can create the landing water. Not acceptance.
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const mineflayer = require('mineflayer'), { pathfinder } = require('mineflayer-pathfinder');
const { compatibilityPlugin } = require('../src/compatibility'), { configureMovements } = require('../src/movement');
const { Task, countOf } = require('../src/skills');
const { fallDanger, recoverFall } = require('../src/fall-recovery');
const { waitFor } = require('../src/work');
const port = Number(process.env.MC_PORT || 25579);
if ([25565, 25577].includes(port)) throw new Error('Fall fixture cannot use an interactive server port');
const id = Date.now().toString(36), username = `Fall${id}`, directory = path.join(__dirname, '..', 'artifacts', `fall-${id}`);
fs.mkdirSync(directory, { recursive: true });
const log = row => { const line = JSON.stringify({ at: new Date().toISOString(), ...row }); console.log(line); fs.appendFileSync(path.join(directory, 'events.jsonl'), line + '\n'); };
const bot = mineflayer.createBot({ host: '127.0.0.1', port, username, auth: 'offline', version: '26.1' });
bot.loadPlugin(compatibilityPlugin); bot.loadPlugin(pathfinder);
const task = new Task('controlled fall'), goal = {}, timer = setTimeout(() => task.cancel(), 300000);
const save = () => fs.writeFileSync(path.join(directory, 'goal.json'), JSON.stringify(goal, null, 2));
let minimumHealth = 20, deaths = 0, finishing = false, started = false;
bot.on('error', err => log({ error: err.message }));
bot.on('death', () => { deaths++; log({ death: true, position: bot.entity.position }); task.cancel(); });
bot.on('health', () => { minimumHealth = Math.min(minimumHealth, bot.health); log({ health: bot.health, position: bot.entity.position }); });
bot.on('fall_recovery', evidence => log({ evidence }));
bot.on('physicsTick', () => { if (started) log({ position: bot.entity.position, velocity: bot.entity.velocity, ground: bot.entity.onGround, held: bot.heldItem?.name }); });
bot.on('end', reason => { if (!finishing) { log({ result: 'FAIL', reason, directory }); clearTimeout(timer); process.exitCode = 1; } });
bot.once('spawn', async () => {
  try {
    configureMovements(bot); await bot.waitForChunksToLoad();
    const p = bot.entity.position.floored().offset(0, 72, 0), { x, y, z } = p;
    const commands = ['gamerule minecraft:spawn_mobs false',
      `fill ${x-8} ${y-40} ${z-8} ${x+8} ${y+3} ${z+8} air`,
      `fill ${x-8} ${y-41} ${z-8} ${x+8} ${y-41} ${z+8} stone`,
      `fill ${x-1} ${y-1} ${z-1} ${x+1} ${y-1} ${z+1} stone`,
      `give ${username} water_bucket`, `tp ${username} ${x+.5} ${y} ${z+.5}`];
    fs.writeFileSync(path.join(directory, 'setup.json'), JSON.stringify(commands, null, 2));
    fs.writeFileSync(path.join(directory, 'launch.json'), JSON.stringify([`fill ${x-1} ${y-1} ${z-1} ${x+1} ${y-1} ${z+1} air`], null, 2));
    log({ phase: 'setup', username, port, commands: path.join(directory, 'setup.json'), ready: path.join(directory, 'ready'), directory });
    await waitFor(task, () => fs.existsSync(path.join(directory, 'ready')), 180000);
    await waitFor(task, () => countOf(bot, 'water_bucket') === 1 && bot.entity.position.distanceTo(p.offset(.5, 0, .5)) < .2 && bot.entity.onGround, 30000);
    assert.equal(bot.game.gameMode, 'survival'); assert.equal(bot.game.difficulty, 'normal');
    started = true; log({ phase: 'armed', launch: path.join(directory, 'launch.json'), start: bot.entity.position, groundY: y - 40 });
    while (!fallDanger(bot)) { task.check(); await new Promise(r => setTimeout(r, 10)); }
    assert(await recoverFall(bot, task, goal, save));
    assert.equal(deaths, 0); assert.equal(minimumHealth, 20); assert.equal(countOf(bot, 'water_bucket'), 1);
    assert.equal(goal.fallRecoveries.length, 1); assert(goal.fallRecoveries[0].bucketRecovered);
    log({ result: 'PASS', scenario: 'controlled forty-block fall with placed water and recovered bucket', deaths, minimumHealth,
      recovery: goal.fallRecoveries[0], directory });
  } catch (err) { log({ result: 'FAIL', error: err.stack, position: bot.entity?.position, health: bot.health, deaths, directory }); process.exitCode = 1; }
  finally { finishing = true; started = false; clearTimeout(timer); bot.clearControlStates(); bot.quit(); setTimeout(() => process.exit(process.exitCode || 0), 500); }
});
