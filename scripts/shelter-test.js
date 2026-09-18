'use strict';
// Mechanics check in an existing world. No grants or commands are used. A
// prepared flat world is labelled controlled, never natural acceptance.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mineflayer = require('mineflayer');
const { pathfinder } = require('mineflayer-pathfinder');
const { configureMovements } = require('../src/movement');
const { compatibilityPlugin } = require('../src/compatibility');
const { createSurvival, inventory } = require('../src/work');
const { reservedForConstruction } = require('../src/build-sites');
const shelter = require('../src/shelter');
const { GoalStore } = require('../src/objectives');
const { Task } = require('../src/skills');
const id = Date.now().toString(36);
const directory = path.join(__dirname, '..', 'artifacts', `shelter-${id}`);
fs.mkdirSync(directory, { recursive: true });
const store = new GoalStore(path.join(directory, 'goal.json'));
const log = entry => { const line = JSON.stringify({ at: new Date().toISOString(), ...entry }); console.log(line); fs.appendFileSync(path.join(directory, 'events.jsonl'), line + '\n'); };
const bot = mineflayer.createBot({ host: process.env.MC_HOST || 'localhost', port: Number(process.env.MC_PORT || 25567),
  username: `Hut${id}`, version: process.env.MC_VERSION || '26.1', auth: 'offline' });
bot.loadPlugin(compatibilityPlugin); bot.loadPlugin(pathfinder);
const task = new Task('shelter-test', 'verify a reusable shelter');
const timeout = setTimeout(() => { task.cancel(); bot.pathfinder.setGoal(null); bot.clearControlStates(); }, 240000);
let minimumHealth = 20;
bot.on('health', () => { minimumHealth = Math.min(minimumHealth, bot.health); });
bot.on('death', () => { log({ death: true }); task.cancel(); });
bot.on('error', err => log({ error: err.message }));
bot.once('spawn', async () => {
  try {
    configureMovements(bot); await bot.waitForChunksToLoad();
    assert.equal(bot.game.gameMode, 'survival'); assert.equal(bot.inventory.items().length, 0);
    const goal = { version: 1, kind: 'house', request: 'Build a house', material: 'oak_planks', status: 'running', initialInventory: {} };
    let survival = createSurvival(bot);
    goal.survival = survival.state;
    bot.pathfinder.movements.exclusionAreasBreak.push(b => reservedForConstruction(goal, b.position) ? 100 : 0);
    const save = () => { store.save(goal); log({ action: goal.survivalAction, position: bot.entity.position, inventory: inventory(bot) }); };
    log({ initial: { position: bot.entity.position, difficulty: bot.game.difficulty, inventory: [], scenario: process.env.ACCEPT_SCENARIO || 'controlled' } });
    for (let i = 0; i < 60; i++) {
      await survival.refugeStep(task, goal, save);
      if (survival.currentShelter() && shelter.sealed(bot, survival.currentShelter())) break;
    }
    let refuge = survival.currentShelter();
    assert(refuge && shelter.inside(bot, refuge) && shelter.sealed(bot, refuge), 'Must verify the occupied shelter');
    log({ phase: 'sealed', origin: refuge.origin, health: bot.health });
    // Reload the persisted state before exercising the exit and reentry.
    survival = createSurvival(bot, { state: store.read().survival }); goal.survival = survival.state;
    refuge = survival.currentShelter();
    await survival.leave(task, goal, save, refuge);
    assert(!shelter.inside(bot, refuge), 'Must safely leave the saved shelter');
    for (let i = 0; i < 8 && !shelter.sealed(bot, refuge); i++) await survival.refugeStep(task, goal, save);
    assert(shelter.inside(bot, refuge) && shelter.sealed(bot, refuge), 'Must reenter and reseal');
    const cancel = setTimeout(() => task.cancel(), 100);
    await assert.rejects(survival.wait(task, goal, save), { name: 'Cancelled' }); clearTimeout(cancel);
    assert.equal(goal.request, 'Build a house'); assert.equal(goal.kind, 'house');
    assert.equal(minimumHealth, 20);
    log({ result: 'PASS', minimumHealth, origin: refuge.origin, retainedRequest: goal.request });
  } catch (err) { log({ result: 'FAIL', error: err.stack }); process.exitCode = 1; }
  finally { clearTimeout(timeout); bot.quit(); setTimeout(() => process.exit(process.exitCode || 0), 500); }
});
