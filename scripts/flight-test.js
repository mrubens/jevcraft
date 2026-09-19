'use strict';
// Controlled Creative mechanics only. The witness gets operator permission for
// fixture setup and mode changes; the flying builder does not get commands.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const mineflayer = require('mineflayer'), { pathfinder, goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { compatibilityPlugin } = require('../src/compatibility');
const { configureMovements } = require('../src/movement');
const { Task, navigate } = require('../src/skills');
const { canFly, startFlight } = require('../src/flight');
const { runGoal, waitFor } = require('../src/work');
const { GoalStore, verifyHouse } = require('../src/objectives');
const { validateSchematic, selectSchematicSite, schematicScaffolding } = require('../src/designer');
const port = Number(process.env.MC_PORT);
if (!Number.isInteger(port) || [25565, 25577].includes(port)) throw new Error('Explicit isolated MC_PORT required');
const id = Date.now().toString(36), directory = path.resolve('artifacts', `flight-${id}`);
fs.mkdirSync(directory, { recursive: true });
const log = value => { const row = JSON.stringify({ at: new Date().toISOString(), ...value }); console.log(row); fs.appendFileSync(path.join(directory, 'events.jsonl'), row + '\n'); };
const connect = prefix => { const b = mineflayer.createBot({ host: '127.0.0.1', port, username: prefix + id, version: '26.1', auth: 'offline' }); b.loadPlugin(compatibilityPlugin); b.loadPlugin(pathfinder); return b; };
const bot = connect('Fly'), witness = connect('See'), task = new Task('Creative flight');
let corrections = 0, deaths = 0;
bot.on('forcedMove', () => { corrections++; });
for (const b of [bot, witness]) { b.on('error', e => log({ error: e.message })); b.on('death', () => { deaths++; task.cancel(); }); }
const timer = setTimeout(() => task.cancel(), 15 * 60000);
const ready = async b => { await new Promise(r => b.once('spawn', r)); await b.waitForChunksToLoad(); configureMovements(b); };
const command = async text => { witness.chat('/' + text); await new Promise(r => setTimeout(r, 250)); };
const observed = () => witness.players[bot.username]?.entity?.position;
(async () => {
  try {
    await Promise.all([ready(bot), ready(witness)]);
    const x = Number(process.env.FLIGHT_TEST_X || 700);
    const setup = [`op ${witness.username}`, `gamemode creative ${witness.username}`, `gamemode creative ${bot.username}`,
      `forceload add ${x - 32} -32 ${x + 48} 48`, ...[64, 74, 84, 94].map(y => `fill ${x - 24} ${y} -24 ${x + 32} ${y + 9} 32 air`),
      `fill ${x - 24} 61 -24 ${x + 32} 63 32 stone`, `fill ${x + 6} 64 -12 ${x + 6} 76 12 stone`,
      `tp ${bot.username} ${x + .5} 64 .5`, `tp ${witness.username} ${x + 2.5} 64 .5`];
    fs.writeFileSync(path.join(directory, 'setup.json'), JSON.stringify(setup, null, 2));
    log({ phase: 'setup', directory, bot: bot.username, witness: witness.username });
    await waitFor(task, () => fs.existsSync(path.join(directory, 'ready')), 180000);
    await bot.waitForChunksToLoad(); await waitFor(task, () => canFly(bot), 5000);
    await waitFor(task, () => canFly(witness), 5000); startFlight(witness);
    const before = corrections;
    await navigate(bot, task, new goals.GoalBlock(x + 10, 70, 0));
    await waitFor(task, () => observed()?.distanceTo(bot.entity.position) < .2, 5000);
    assert.equal(corrections, before, 'no server corrections crossing wall');
    log({ phase: 'wall', independentPosition: observed(), corrections: corrections - before });

    await command(`tp ${witness.username} ${x + 15.5} 82 .5`);
    await waitFor(task, () => bot.players[witness.username]?.entity?.position.y > 81, 5000);
    const target = bot.players[witness.username].entity;
    const moved = new Promise(resolve => setTimeout(async () => { await command(`tp ${witness.username} ${x + 21.5} 85 .5`); resolve(); }, 800));
    await navigate(bot, task, new goals.GoalFollow(target, 2)); await moved;
    await waitFor(task, () => observed()?.distanceTo(bot.entity.position) < .2, 5000);
    assert(bot.entity.position.distanceTo(target.position) <= 3);
    log({ phase: 'airborneFollow', independentPosition: observed(), target: target.position });

    const cancelled = new Task('stop in flight');
    const cancelTimer = setTimeout(() => cancelled.cancel(), 150);
    try { await assert.rejects(navigate(bot, cancelled, new goals.GoalBlock(x + 21, 99, 0)), { name: 'Cancelled' }); }
    finally { clearTimeout(cancelTimer); }
    const stopped = bot.entity.position.clone();
    await new Promise(r => setTimeout(r, 600));
    assert(stopped.distanceTo(bot.entity.position) < .05); assert(observed().distanceTo(stopped) < .2);
    log({ phase: 'cancelHover', position: stopped, independentPosition: observed() });

    await navigate(bot, task, new goals.GoalBlock(x + 12, 64, 0));
    await command(`gamemode survival ${bot.username}`);
    await waitFor(task, () => bot.game.gameMode === 'survival' && !bot._creativeFlight.active, 5000);
    assert(bot.physics.gravity > 0);
    await navigate(bot, task, new goals.GoalBlock(x + 15, 64, 0));
    assert(bot.entity.onGround);
    log({ phase: 'survivalWalking', position: observed(), gravity: bot.physics.gravity });

    await command(`gamemode creative ${bot.username}`);
    await waitFor(task, () => canFly(bot), 5000);
    await command(`fill ${x + 6} 64 -12 ${x + 6} 76 12 air`);
    await navigate(bot, task, new goals.GoalBlock(x, 64, 0));
    const saved = JSON.parse(fs.readFileSync('test/fixtures/desert-watchtower.json'));
    const design = validateSchematic(saved.design.source, bot.registry), blueprint = selectSchematicSite(bot, design);
    assert(blueprint);
    const goal = { version: 1, kind: 'build', request: saved.request, design, blueprint };
    let scaffoldPlacements = 0;
    const planned = new Set(blueprint.blocks.map(p => `${p.x},${p.y},${p.z}`));
    bot.on('blockPlaced', (_old, block) => { if (!planned.has(`${block.position.x},${block.position.y},${block.position.z}`)) scaffoldPlacements++; });
    const store = new GoalStore(path.join(directory, 'goal.json'));
    let steps = 0;
    const result = await runGoal(bot, task, goal, store, { survival: { state: {}, step: async () => false },
      recoveryAdviser: { recordFailure: () => {}, suggest: async () => false },
      onStep: g => { if (++steps % 50 === 0 || g.lastError) log({ phase: 'build', step: g.step, position: bot.entity.position, error: g.lastError }); } });
    assert(result.ok, result.reason); await new Promise(r => setTimeout(r, 500));
    assert(verifyHouse(witness, blueprint).ok); assert.equal(schematicScaffolding(bot, goal).length, 0);
    assert.equal(scaffoldPlacements, 0); assert.equal(deaths, 0);
    log({ result: 'PASS', blocks: blueprint.blocks.length, scaffoldPlacements, independentVerification: true, health: bot.health, directory });
  } catch (e) { log({ result: 'FAIL', error: e.stack, position: bot.entity?.position, directory }); process.exitCode = 1; }
  finally { clearTimeout(timer); bot.pathfinder.setGoal(null); bot.clearControlStates(); bot.quit(); witness.quit(); setTimeout(() => process.exit(process.exitCode || 0), 500); }
})();
