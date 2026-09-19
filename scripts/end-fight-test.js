'use strict';
// Controlled End encounter from granted equipment and a teleport to the island.
// The dragon/crystals keep ordinary AI. This is not fresh-start acceptance.
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const mineflayer = require('mineflayer'), { pathfinder } = require('mineflayer-pathfinder');
const { compatibilityPlugin } = require('../src/compatibility');
const { configureMovements } = require('../src/movement');
const { Task, navigate, countOf } = require('../src/skills');
const { prepareCombatGear } = require('../src/mob-hunt');
const { fightEndStep } = require('../src/end-combat');
const { exitEnd } = require('../src/end-exit');
const { watchGameProgress, gameStep, dimension } = require('../src/game-progress');
const { waitFor, inventory } = require('../src/work');
const fixturePort = Number(process.env.MC_PORT || 25579);
if ([25565, 25577].includes(fixturePort)) throw new Error('End fixtures cannot use an interactive server port');
require('../src/env').loadEnv(); const { TypeSafe } = require('../src/typesafe');
const resumeId = process.env.END_RESUME;
if (resumeId && !/^end-fight-[a-z0-9]+$/.test(resumeId)) throw new Error('Invalid controlled End resume id');
const resumeDirectory = resumeId && path.join(__dirname, '..', 'artifacts', resumeId);
const prior = resumeDirectory && fs.readFileSync(path.join(resumeDirectory, 'events.jsonl'), 'utf8').trim().split('\n')
  .map(line => JSON.parse(line)).find(event => event.username);
if (resumeId && !/^Fight[a-z0-9]+$/.test(prior?.username || '')) throw new Error('Resume requires a recorded controlled player identity');
const id = Date.now().toString(36), username = prior?.username || `Fight${id}`, directory = path.join(__dirname, '..', 'artifacts', `end-fight-${id}`);
fs.mkdirSync(directory, { recursive: true });
const log = data => { const line = JSON.stringify({ at: new Date().toISOString(), ...data }); console.log(line); fs.appendFileSync(path.join(directory, 'events.jsonl'), line + '\n'); };
async function main() {
const harness = process.env.END_DASHBOARD_PORT ? await require('../src/harness/server').startHarness({
  port: Number(process.env.END_DASHBOARD_PORT), artifacts: path.join(__dirname, '..', 'artifacts'),
}) : null;
const bot = mineflayer.createBot({ host: '127.0.0.1', port: fixturePort, username, version: '26.1', auth: 'offline' });
bot.loadPlugin(compatibilityPlugin); bot.loadPlugin(pathfinder);
const task = new Task('controlled End fight'), timer = setTimeout(() => task.cancel(), 30 * 60000), client = new TypeSafe();
let goal, detach, observation, deaths = 0, minimumHealth = 20, finishing = false;
const save = () => { fs.writeFileSync(path.join(directory, 'goal.json'), JSON.stringify(goal, null, 2)); observation?.sample('step', undefined, goal); };
observation = harness?.attach(bot, { getGoal: () => goal, server: `127.0.0.1:${fixturePort} · controlled End trial` });
if (harness) log({ observatory: harness.url, directory });
bot.on('death', () => { deaths++; log({ death: true, position: bot.entity.position, dimension: dimension(bot) }); task.cancel(); });
bot.on('health', () => { minimumHealth = Math.min(minimumHealth, bot.health); log({ health: bot.health, food: bot.food, position: bot.entity.position }); });
bot._client.on('entity_velocity', packet => { if (packet.entityId === bot.entity?.id) log({ playerVelocity: packet.velocity, position: bot.entity.position }); });
bot.on('forcedMove', () => log({ forcedMove: true, position: bot.entity.position, velocity: bot.entity.velocity }));
bot.on('end_combat', evidence => log({ evidence }));
bot.on('fall_recovery', evidence => log({ fallRecovery: evidence }));
bot.on('error', err => log({ error: err.message }));
bot.on('end', reason => { if (!finishing) { log({ result: 'FAIL', reason: `Disconnected: ${reason}`, directory }); clearTimeout(timer); process.exitCode = 1; } });
bot.once('spawn', async () => {
  try {
    await bot.waitForChunksToLoad(); configureMovements(bot);
    if (resumeId) {
      goal = JSON.parse(fs.readFileSync(path.join(resumeDirectory, 'goal.json'), 'utf8'));
      assert.equal(goal.controlled, true); assert.equal(goal.kind, 'win');
      assert.equal(dimension(bot), 'end'); assert(countOf(bot, 'arrow') > 0);
      log({ phase: 'resumed_controlled_trial', username, resumedFrom: resumeId, directory,
        initialInventory: inventory(bot), position: bot.entity.position,
        priorDragon: goal.endCombat?.dragon, limitations: 'Copied failed controlled world/player state; not a fresh fight or acceptance' });
    } else {
    const commands = ['gamerule minecraft:spawn_mobs false',
      ...['diamond_sword', 'diamond_pickaxe', 'diamond_helmet', 'diamond_chestplate', 'diamond_leggings', 'diamond_boots', 'shield', 'bow', 'water_bucket'].map(item => `give ${username} ${item}`),
      `give ${username} arrow 256`, `give ${username} cooked_beef 64`, `give ${username} cobblestone 64`,
      `execute in minecraft:the_end run tp ${username} 0.5 63 45.5`];
    fs.writeFileSync(path.join(directory, 'setup.json'), JSON.stringify(commands, null, 2));
    log({ phase: 'setup', username, port: fixturePort, commands: path.join(directory, 'setup.json'), ready: path.join(directory, 'ready'), directory });
    await waitFor(task, () => fs.existsSync(path.join(directory, 'ready')), 180000);
    await waitFor(task, () => dimension(bot) === 'end' && bot.isAlive !== false && countOf(bot, 'arrow') === 256, 30000);
    await bot.waitForChunksToLoad();
    goal = { kind: 'win', request: 'Jev defeat the dragon and return alive', controlled: true };
    }
    assert.equal(bot.game.gameMode, 'survival'); assert.equal(bot.game.difficulty, 'normal');
    detach = watchGameProgress(bot, goal, save); save();
    assert(await prepareCombatGear(bot, task, goal, save, { acquireStep: async () => { throw new Error('Fixture equipment was not supplied'); } }));
    await waitFor(task, () => Object.values(bot.entities).some(e => e.name === 'ender_dragon'), 30000);
    for (let step = 0; step < 1200 && !goal.endReturn; step++) {
      await gameStep(bot, task, goal, save, {
        fight_dragon: (b, t, g, s) => fightEndStep(b, t, g, s, { navigate }, client),
        exit_end: (b, t, g, s) => exitEnd(b, t, g, s, { navigate }),
      });
      log({ step: goal.step, health: bot.health, food: bot.food, position: bot.entity.position, dimension: dimension(bot),
        dragon: goal.endCombat?.dragon, noProgress: goal.endCombat?.noProgress, shots: goal.endCombat?.shots.length,
        crystalsDestroyed: goal.endCombat?.destroyedCrystals.length, milestones: goal.gameProgress.milestones });
    }
    assert(goal.gameProgress.milestones.dragon_defeated); assert(goal.gameProgress.milestones.exit_portal_used);
    assert(goal.endReturn); assert.equal(dimension(bot), 'overworld'); assert(bot.health > 0); assert.equal(deaths, 0);
    log({ result: 'PASS', scenario: resumeId ? 'resumed controlled End combat and living portal return' : 'controlled End combat and living portal return',
      resumedFrom: resumeId, username, minimumHealth, deaths, directory,
      inventory: inventory(bot), milestones: goal.gameProgress.milestones,
      limitations: 'Granted equipment, teleported to End and disabled natural mob spawning; not natural progression or winning acceptance' });
  } catch (err) { log({ result: 'FAIL', error: err.stack, position: bot.entity?.position, health: bot.health, deaths, directory }); process.exitCode = 1; }
  finally {
    finishing = true; detach?.(); clearTimeout(timer); bot.pathfinder.setGoal(null); bot.clearControlStates();
    if (harness) { fs.writeFileSync(path.join(directory, 'trace.json'), JSON.stringify(harness.trace.view())); await harness.close(); }
    bot.quit(); setTimeout(() => process.exit(process.exitCode || 0), 500);
  }
});
}
main().catch(err => { log({ result: 'FAIL', error: err.stack, directory }); process.exitCode = 1; });
