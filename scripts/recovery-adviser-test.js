'use strict';
// Controlled fault-injection test: three synthetic navigation failures, a real
// Jev recovery judgment, real recovery movement, and the original come goal verified.
// Console setup in this script is test-only and never available to the adviser.
require('../src/env').loadEnv();
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const mineflayer = require('mineflayer');
const { pathfinder } = require('mineflayer-pathfinder');
const { compatibilityPlugin } = require('../src/compatibility');
const { configureMovements } = require('../src/movement');
const { Task } = require('../src/skills');
const { runGoal, waitFor } = require('../src/work');
const { GoalStore } = require('../src/objectives');
const id = Date.now().toString(36), username = `Advice${id}`, player = `Guest${id}`;
const directory = path.join(__dirname, '..', 'artifacts', `adviser-${id}`);
fs.mkdirSync(directory, { recursive: true });
const log = data => { const line = JSON.stringify({ at: new Date().toISOString(), ...data }); console.log(line); fs.appendFileSync(path.join(directory, 'events.jsonl'), line + '\n'); };
const options = { host: '127.0.0.1', port: Number(process.env.MC_PORT || 25567), version: '26.1', auth: 'offline' };
const bot = mineflayer.createBot({ ...options, username }), receiver = mineflayer.createBot({ ...options, username: player });
bot.loadPlugin(compatibilityPlugin); bot.loadPlugin(pathfinder); receiver.loadPlugin(compatibilityPlugin);
const task = new Task('adviser trial', 'Jev come here');
let finishing = false;
const timer = setTimeout(() => task.cancel(), 240000);
for (const client of [bot, receiver]) {
  client.on('error', err => log({ client: client.username, error: err.message }));
  client.on('end', reason => { if (!finishing) { task.cancel(); log({ disconnect: client.username, reason }); process.exitCode = 1; } });
}
bot.on('recovery_advice', record => log({ advice: record }));
bot.on('recovery_result', record => log({ recovery: record }));
bot.once('spawn', async () => {
  try {
    await bot.waitForChunksToLoad(); configureMovements(bot);
    const commands = [`gamemode survival ${username}`, `tp ${username} 3000.5 64 3000.5`, `tp ${player} 3009.5 64 3000.5`];
    fs.writeFileSync(path.join(directory, 'setup.json'), JSON.stringify(commands, null, 2));
    log({ scenario: 'controlled navigation fault injection, real LLM and movement; not natural acceptance', directory, commands });
    await waitFor(task, () => fs.existsSync(path.join(directory, 'setup-ready')), 180000);
    await waitFor(task, () => Math.abs(bot.entity.position.x - 3000.5) < 0.2 && bot.players[player]?.entity?.position.x > 3009, 10000);
    await bot.waitForChunksToLoad();
    const start = bot.entity.position.clone(), goto = bot.pathfinder.goto.bind(bot.pathfinder);
    let injected = 0;
    bot.pathfinder.goto = async destination => {
      if (injected < 3) { injected++; throw new Error('Navigation made no progress on the direct approach; try a different nearby approach'); }
      return goto(destination);
    };
    const goal = { version: 1, kind: 'come', from: player, target: player, request: 'Jev come here', scenario: 'controlled adviser fault injection' };
    const result = await runGoal(bot, task, goal, new GoalStore(path.join(directory, 'goal.json')), { maxSteps: 30,
      onStep: g => log({ step: g.step, recoveryAction: g.recoveryAction, error: g.lastError, position: bot.entity.position }) });
    assert(result.ok, result.reason); assert.equal(injected, 3);
    const record = goal.recoveryAdvice.history.find(h => h.source === 'jev' && h.outcome?.startsWith('Recovery actions completed'));
    assert(record, 'A real Jev recovery plan must have executed successfully');
    assert(record.steps.some(s => s.kind === 'relocate'), 'Test must exercise real repositioning');
    assert.equal(goal.kind, 'come'); assert.equal(goal.request, 'Jev come here');
    const distance = bot.entity.position.distanceTo(bot.players[player].entity.position);
    assert(distance <= 3); assert(bot.entity.position.distanceTo(start) > 5);
    log({ result: 'PASS', model: record.model, advice: record.diagnosis, actions: record.steps, distanceToPlayer: distance,
      position: bot.entity.position, health: bot.health, directory });
  } catch (err) { log({ result: 'FAIL', error: err.stack, position: bot.entity?.position, directory }); process.exitCode = 1; }
  finally { finishing = true; clearTimeout(timer); bot.pathfinder.setGoal(null); bot.quit(); receiver.quit(); setTimeout(() => process.exit(process.exitCode || 0), 500); }
});
