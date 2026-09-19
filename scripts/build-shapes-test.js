'use strict';
// Controlled Creative construction: test arbitrary advisor geometry, not a
// shape-specific executor or natural resource gathering acceptance.
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const mineflayer = require('mineflayer'), { pathfinder } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { compatibilityPlugin } = require('../src/compatibility');
const { configureMovements } = require('../src/movement');
const { Task } = require('../src/skills');
const { runGoal, waitFor } = require('../src/work');
const { GoalStore, verifyHouse } = require('../src/objectives');
const { TypeSafe } = require('../src/typesafe');
require('../src/env').loadEnv();
const port = Number(process.env.MC_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535 || [25565, 25577].includes(port)) throw new Error('Choose an isolated MC_PORT');
const id = Date.now().toString(36), directory = path.join(__dirname, '..', 'artifacts', `build-shape-${id}`);
fs.mkdirSync(directory, { recursive: true });
const log = data => { const row = JSON.stringify({ at: new Date().toISOString(), ...data }); console.log(row); fs.appendFileSync(path.join(directory, 'events.jsonl'), row + '\n'); };
function connect(username) {
  const bot = mineflayer.createBot({ host: '127.0.0.1', port, username, version: '26.1', auth: 'offline' });
  bot.loadPlugin(compatibilityPlugin); bot.loadPlugin(pathfinder); return bot;
}
const bot = connect(`Build${id}`), witness = connect(`Watch${id}`), task = new Task('custom design');
const timer = setTimeout(() => task.cancel(), 8 * 60000);
for (const b of [bot, witness]) b.on('error', error => log({ error: error.message }));
async function ready(b) { await new Promise(resolve => b.once('spawn', resolve)); await b.waitForChunksToLoad(); configureMovements(b); }
(async () => {
  try {
    await Promise.all([ready(bot), ready(witness)]);
    const commands = ['forceload add 304 -32 367 32', 'fill 310 81 -25 365 89 25 air', 'fill 310 80 -25 365 80 25 stone',
      `tp ${bot.username} 330.5 81 .5`, `tp ${witness.username} 329.5 81 .5`, `gamemode creative ${bot.username}`];
    fs.writeFileSync(path.join(directory, 'setup.json'), JSON.stringify(commands, null, 2));
    log({ phase: 'setup', directory, commands: path.join(directory, 'setup.json'), ready: path.join(directory, 'ready') });
    await waitFor(task, () => fs.existsSync(path.join(directory, 'ready')), 180000);
    await waitFor(task, () => bot.game.gameMode === 'creative' && bot.entity.position.distanceTo(new Vec3(330.5, 81, .5)) < 1, 10000);
    await bot.waitForChunksToLoad(); await new Promise(resolve => setTimeout(resolve, 500));
    const goal = { kind: 'build', version: 1, request: process.env.SHAPE_REQUEST || 'Jev build a small solid stepped pyramid from cobblestone, exactly seven blocks wide and deep and four blocks high. This is a monument, with no rooms or entrance.' };
    const store = new GoalStore(path.join(directory, 'goal.json'));
    const result = await runGoal(bot, task, goal, store, { maxSteps: 400, decisionClient: new TypeSafe(), survival: { state: {}, step: async () => false },
      onStep: g => log({ step: g.step, error: g.lastError, design: g.design && { name: g.design.source.name, size: g.design.source.size, blocks: g.design.blocks.length, entrance: g.design.source.entrance } }) });
    assert(result.ok, result.reason);
    await new Promise(resolve => setTimeout(resolve, 1000));
    assert(verifyHouse(witness, goal.blueprint).ok, 'Independent player must see every actual planned block and empty cell');
    assert.equal(goal.design.source.entrance, null, 'Decorative geometry needs no invented doorway');
    log({ result: 'PASS', scenario: 'controlled Creative advisor-designed custom geometry', blocks: goal.blueprint.blocks.length, model: goal.design.model,
      source: goal.design.source, independentVerification: true, directory });
  } catch (error) { log({ result: 'FAIL', error: error.stack, directory }); process.exitCode = 1; }
  finally { clearTimeout(timer); bot.pathfinder.setGoal(null); bot.clearControlStates(); bot.quit(); witness.quit(); setTimeout(() => process.exit(process.exitCode || 0), 500); }
})();
