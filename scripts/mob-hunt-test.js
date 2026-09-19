'use strict';
// Controlled arena/gear/spawns: never run against a natural acceptance world.
require('../src/env').loadEnv();
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const mineflayer = require('mineflayer'), { pathfinder } = require('mineflayer-pathfinder');
const { compatibilityPlugin } = require('../src/compatibility');
const { configureMovements } = require('../src/movement');
const { TypeSafe } = require('../src/typesafe');
const { Task, navigate, countOf } = require('../src/skills');
const { waitFor } = require('../src/work');
const { prepareCombatGear, huntObserved, canBegin, isolated } = require('../src/mob-hunt');
const { combatGear } = require('../src/mob-policy');
const { maintainVitals } = require('../src/vitals');
const id = `mob-hunt-${Date.now().toString(36)}`, username = `Hunt${id.slice(9)}`;
const directory = path.join(__dirname, '..', 'artifacts', id); fs.mkdirSync(directory, { recursive: true });
const log = data => { const line = JSON.stringify({ at: new Date().toISOString(), ...data }); console.log(line); fs.appendFileSync(path.join(directory, 'events.jsonl'), line + '\n'); };
const client = new TypeSafe(), task = new Task('controlled-mob-hunt');
const bot = mineflayer.createBot({ host: '127.0.0.1', port: Number(process.env.MOB_TEST_PORT || 25578), username, version: '26.1', auth: 'offline' });
bot.loadPlugin(compatibilityPlugin); bot.loadPlugin(pathfinder);
let deaths = 0, minimumHealth = 20, finishing = false;
const timer = setTimeout(() => task.cancel(), 600000);
bot.on('death', () => { deaths++; task.cancel(); });
bot.on('health', () => { minimumHealth = Math.min(minimumHealth, bot.health); log({ health: bot.health, food: bot.food }); });
bot.on('mob_hunt', result => log({ hunt: result }));
bot.on('error', err => log({ error: err.message }));
bot.on('end', reason => { if (!finishing) { log({ result: 'FAIL', reason }); process.exit(1); } });
bot.once('spawn', async () => {
  try {
    await bot.waitForChunksToLoad(); configureMovements(bot);
    assert.equal(bot.game.gameMode, 'survival'); assert.equal(bot.game.difficulty, 'normal');
    const commands = ['gamerule minecraft:spawn_mobs false', 'weather clear', 'time set 18000', 'forceload add 80 80 150 150',
      'kill @e[tag=jev_hunt_fixture]', 'kill @e[type=minecraft:item]',
      'fill 80 -61 80 150 -61 150 minecraft:stone', 'fill 80 -60 80 150 -56 150 minecraft:air',
      `tp ${username} 115.5 -60 115.5`, ...Object.values(combatGear).map(names => `give ${username} minecraft:${names[0]} 1`),
      `give ${username} minecraft:cooked_beef 16`];
    fs.writeFileSync(path.join(directory, 'setup.json'), JSON.stringify(commands, null, 2));
    const ready = path.join(directory, 'setup-ready');
    log({ phase: 'setup', scenario: 'controlled Normal mob loot acquisition with granted equipment and summoned mobs', directory, commands, ready });
    await waitFor(task, () => fs.existsSync(ready), 120000);
    await waitFor(task, () => Math.abs(bot.entity.position.y + 60) < .05 && countOf(bot, 'shield') > 0);
    assert.equal(countOf(bot, 'blaze_rod'), 0); assert.equal(countOf(bot, 'ender_pearl'), 0);
    const outcomes = [];
    for (const [entity, item] of [['blaze', 'blaze_rod'], ['enderman', 'ender_pearl']]) {
      const initial = countOf(bot, item), goal = { version: 1, kind: 'obtain', request: `Jev get me a ${item.replaceAll('_', ' ')}`,
        item, count: initial + 1, mobHunt: { entity, item, targetCount: initial + 1 } };
      const save = () => fs.writeFileSync(path.join(directory, `${entity}-goal.json`), JSON.stringify(goal, null, 2));
      assert(await prepareCombatGear(bot, task, goal, save, { acquireStep: async () => assert.fail('Fixture equipment missing') }));
      for (let attempt = 1; attempt <= 8 && countOf(bot, item) === initial; attempt++) {
        const healingDeadline = Date.now() + 60000;
        do {
          task.check(); await maintainVitals(bot, task);
          if (bot.health >= 18 && bot.food >= 16 && !(bot.entity.metadata?.[0] & 1)) break;
          assert(Date.now() < healingDeadline, 'Could not recover naturally between encounters');
          await new Promise(resolve => setTimeout(resolve, 500));
        } while (true);
        assert(await prepareCombatGear(bot, task, goal, save, { acquireStep: async () => assert.fail('Fixture equipment missing') }));
        const p = bot.entity.position;
        const oldIds = new Set(Object.values(bot.entities).map(e => e.id));
        const dx = 115.5 - p.x, dz = 115.5 - p.z, length = Math.hypot(dx, dz);
        const spawn = [`summon minecraft:${entity} ${p.x + (length > 3 ? dx / length : 1) * 2.2} ${p.y} ${p.z + (length > 3 ? dz / length : 0) * 2.2} {PersistenceRequired:1b,Tags:["jev_hunt_fixture"]}`];
        fs.writeFileSync(path.join(directory, `${entity}-spawn-${attempt}.json`), JSON.stringify(spawn, null, 2));
        log({ phase: 'spawn', entity, attempt, commands: spawn });
        await waitFor(task, () => Object.values(bot.entities).some(e => e.name === entity && e.isValid !== false && !oldIds.has(e.id)), 60000);
        const ran = await huntObserved(bot, task, goal, save, { navigate }, client);
        log({ decision: goal.decisions?.at(-1), inventory: bot.inventory.items().map(i => ({ name: i.name, count: i.count })), health: bot.health,
          position: bot.entity.position, ready: canBegin(bot), held: bot.heldItem?.name,
          entities: Object.values(bot.entities).filter(e => ['blaze', 'enderman'].includes(e.name)).map(e => ({ id: e.id, name: e.name, position: e.position, isolated: isolated(bot, e) })) });
        assert(ran, 'Jev did not select the controlled feasible encounter');
      }
      assert(countOf(bot, item) > initial, `${item} pickup was not confirmed within eight real encounters`);
      outcomes.push({ entity, item, initial, final: countOf(bot, item), encounters: goal.mobHunt.history });
    }
    assert.equal(deaths, 0);
    log({ result: 'PASS', controlled: true, outcomes, minimumHealth, finalHealth: bot.health, deaths, directory });
  } catch (err) { log({ result: 'FAIL', error: err.stack, minimumHealth, deaths, directory }); process.exitCode = 1; }
  finally { finishing = true; clearTimeout(timer); task.cancel(); bot.pathfinder.setGoal(null); bot.quit(); setTimeout(() => process.exit(process.exitCode || 0), 500); }
});
