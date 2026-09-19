'use strict';
// Controlled Normal arena, separate from every natural acceptance world.
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const mineflayer = require('mineflayer');
const { pathfinder } = require('mineflayer-pathfinder');
const { compatibilityPlugin } = require('../src/compatibility');
const { configureMovements } = require('../src/movement');
const { Task } = require('../src/skills');
const { createSurvival, waitFor } = require('../src/work');
const id = Date.now().toString(36), username = `Defend${id}`;
const directory = path.join(__dirname, '..', 'artifacts', `combat-${id}`);
fs.mkdirSync(directory, { recursive: true });
const log = data => { const line = JSON.stringify({ at: new Date().toISOString(), ...data }); console.log(line); fs.appendFileSync(path.join(directory, 'events.jsonl'), line + '\n'); };
const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25574, username, version: '26.1', auth: 'offline' });
bot.loadPlugin(compatibilityPlugin); bot.loadPlugin(pathfinder);
const task = new Task('defense', 'survive cave spiders in a constrained arena');
const timer = setTimeout(() => task.cancel(), 240000);
const dead = new Set(), seen = new Set(); let deaths = 0, minimumHealth = 20, strikes = 0;
bot.on('death', () => { deaths++; task.cancel(); });
bot.on('health', () => { minimumHealth = Math.min(minimumHealth, bot.health); log({ health: bot.health, food: bot.food }); });
bot.on('entityDead', entity => { if (entity?.name === 'cave_spider') { dead.add(entity.id); log({ defeated: entity.id }); } });
bot.on('entityHurt', (entity, source) => { if (entity?.name === 'cave_spider') log({ hurtTarget: entity.id, source: source?.name }); });
bot.on('error', err => log({ error: err.message }));
bot.once('spawn', async () => {
  try {
    await bot.waitForChunksToLoad(); configureMovements(bot);
    const commands = ['fill 0 70 0 6 74 6 minecraft:glass', 'fill 1 71 1 5 73 5 minecraft:air',
      `tp ${username} 3.5 71 3.5`, `give ${username} minecraft:diamond_pickaxe 1`];
    const ready = path.join(directory, 'setup-ready');
    fs.writeFileSync(path.join(directory, 'setup.json'), JSON.stringify(commands, null, 2));
    log({ phase: 'setup', scenario: 'controlled Normal cave-spider defense', commands, ready, directory });
    await waitFor(task, () => fs.existsSync(ready), 180000);
    await waitFor(task, () => bot.entity.position.y === 71 && bot.inventory.items().some(i => i.name === 'diamond_pickaxe'));
    assert.equal(bot.game.difficulty, 'normal'); assert.equal(bot.game.gameMode, 'survival');
    const spawn = ['summon minecraft:cave_spider 5.2 71 3.5 {PersistenceRequired:1b,Tags:["jev_combat_fixture"]}',
      'summon minecraft:cave_spider 3.5 71 5.2 {PersistenceRequired:1b,Tags:["jev_combat_fixture"]}'];
    fs.writeFileSync(path.join(directory, 'mobs.json'), JSON.stringify(spawn, null, 2));
    log({ phase: 'spawn-hostiles', commands: spawn });
    await waitFor(task, () => Object.values(bot.entities).filter(e => e.name === 'cave_spider').length >= 2, 60000);
    const survival = createSurvival(bot), goal = { request: 'Stay alive', kind: 'survive' };
    const save = () => fs.writeFileSync(path.join(directory, 'goal.json'), JSON.stringify(goal, null, 2));
    const deadline = Date.now() + 45000; let lastAction;
    while (Date.now() < deadline && dead.size < 2) {
      task.check();
      for (const entity of Object.values(bot.entities)) if (entity.name === 'cave_spider') seen.add(entity.id);
      await survival.step(task, goal, save);
      if (goal.survivalAction !== lastAction) {
        lastAction = goal.survivalAction;
        if (lastAction?.action === 'defend') strikes++;
        log({ action: lastAction, position: bot.entity.position, health: bot.health });
      }
    }
    assert.equal(seen.size, 2); assert.equal(dead.size, 2, 'Both live hostiles must be confirmed defeated by entity-death packets');
    assert.equal(deaths, 0); assert(bot.health > 0); assert(strikes >= 2);
    log({ result: 'PASS', defeated: [...dead], strikes, deaths, minimumHealth, finalHealth: bot.health, directory });
  } catch (err) { log({ result: 'FAIL', error: err.stack, seen: [...seen], defeated: [...dead], deaths, minimumHealth, strikes, directory }); process.exitCode = 1; }
  finally { clearTimeout(timer); bot.pathfinder.setGoal(null); bot.quit(); setTimeout(() => process.exit(process.exitCode || 0), 500); }
});
