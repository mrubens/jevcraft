'use strict';
// Controlled Survival construction/traversal; console setup is isolated only.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const mineflayer = require('mineflayer'), { pathfinder, goals } = require('mineflayer-pathfinder'), { Vec3 } = require('vec3');
const { compatibilityPlugin } = require('../src/compatibility'), { configureMovements } = require('../src/movement');
const { Task, navigate, countOf } = require('../src/skills');
const { runGoal, waitFor } = require('../src/work'), { GoalStore, verifyHouse } = require('../src/objectives');
const { validateSchematic, selectSchematicSite } = require('../src/designer');
const port = Number(process.env.MC_PORT);
if (!Number.isInteger(port) || [25565, 25577].includes(port)) throw new Error('Explicit isolated MC_PORT required');
const resumed = process.env.RESUME_DOOR_DIR, id = resumed ? path.basename(resumed).replace('door-building-', '') : Date.now().toString(36);
const directory = resumed ? path.resolve(resumed) : path.resolve('artifacts', `door-building-${id}`);
fs.mkdirSync(directory, { recursive: true });
const log = value => { const row = JSON.stringify({ at: new Date().toISOString(), ...value }); console.log(row); fs.appendFileSync(path.join(directory, 'events.jsonl'), row + '\n'); };
const connect = prefix => { const b = mineflayer.createBot({ host: '127.0.0.1', port, username: prefix + id, version: '26.1', auth: 'offline' }); b.loadPlugin(compatibilityPlugin); b.loadPlugin(pathfinder); return b; };
const bot = connect('Door'), witness = connect('See');
let task = new Task('door building'), deaths = 0, placements = 0;
for (const b of [bot, witness]) { b.on('error', e => log({ error: e.message })); b.on('death', () => { deaths++; task.cancel(); }); }
const timeout = setTimeout(() => task.cancel(), 15 * 60000);
const ready = async b => { await new Promise(r => b.once('spawn', r)); await b.waitForChunksToLoad(); configureMovements(b); };
const doors = [{ p: [2, 1, 0], facing: 'south', inward: [0, 0, 1] }, { p: [2, 1, 4], facing: 'north', inward: [0, 0, -1] },
  { p: [0, 1, 2], facing: 'east', inward: [1, 0, 0] }, { p: [4, 1, 2], facing: 'west', inward: [-1, 0, 0] }];
const regions = [{ from: [0, 0, 0], to: [4, 3, 4], block: 'oak_planks' }, { from: [1, 1, 1], to: [3, 2, 3], block: 'air' }];
for (const d of doors) regions.push({ from: d.p, to: [d.p[0], 2, d.p[2]], block: 'air' },
  { from: d.p, to: d.p, block: 'oak_door', properties: { facing: d.facing, half: null } });
const source = { name: 'Four-door room', description: 'A small room with doors in all four directions', size: [5, 4, 5], palette: ['oak_planks', 'oak_door'], entrance: [2, 1, 0], regions };
(async () => {
  try {
    await Promise.all([ready(bot), ready(witness)]);
    if (!resumed) {
      const x = Number(process.env.BUILD_TEST_X || 1520);
      const setup = [`gamemode survival ${bot.username}`, `gamemode survival ${witness.username}`, 'time set day',
        `forceload add ${x - 16} -16 ${x + 32} 32`, `fill ${x - 12} 64 -12 ${x + 24} 78 24 air`, `fill ${x - 12} 61 -12 ${x + 24} 63 24 stone`,
        `tp ${bot.username} ${x + .5} 64 .5`, `tp ${witness.username} ${x + 2.5} 64 .5`,
        `give ${bot.username} minecraft:oak_planks 80`, `give ${bot.username} minecraft:oak_door 4`,
        `give ${bot.username} minecraft:iron_pickaxe`, `give ${bot.username} minecraft:iron_axe`, `give ${bot.username} minecraft:dirt 64`];
      fs.writeFileSync(path.join(directory, 'setup.json'), JSON.stringify(setup, null, 2));
      log({ phase: 'setup', directory, bot: bot.username, witness: witness.username });
      await waitFor(task, () => fs.existsSync(path.join(directory, 'ready')), 180000); await bot.waitForChunksToLoad();
    }
    const store = new GoalStore(path.join(directory, 'goal.json'));
    const design = validateSchematic(source, bot.registry);
    let goal = resumed ? JSON.parse(fs.readFileSync(path.join(directory, 'goal.json'))) :
      { version: 1, kind: 'build', request: 'Build the four-door room', design, blueprint: selectSchematicSite(bot, design) };
    assert(goal.blueprint); assert.equal(design.materials.oak_door, 4);
    const options = { survival: { state: {}, step: async () => false }, recoveryAdviser: { recordFailure: () => {}, suggest: async () => false },
      onStep: g => { if (g.lastError || placements % 20 === 0) log({ phase: 'build', step: g.step, error: g.lastError, position: bot.entity.position }); } };
    const onPlace = (_old, block) => { placements++; if (block.name === 'oak_door') task.cancel(); };
    if (!resumed) {
      bot.on('blockPlaced', onPlace);
      await assert.rejects(runGoal(bot, task, goal, store, options), { name: 'Cancelled' });
      bot.removeListener('blockPlaced', onPlace);
      goal = JSON.parse(fs.readFileSync(path.join(directory, 'goal.json')));
      assert.equal(Object.values(goal.buildOwned).filter(value => value?.name === 'oak_door').length, 2, 'both halves are checkpointed when stop lands on placement');
      log({ phase: 'resume', ownedDoorHalves: 2, carriedDoors: countOf(bot, 'oak_door') });
    }
    task = new Task('resume door building');
    const result = await runGoal(bot, task, goal, store, options);
    assert(result.ok, result.reason);
    await new Promise(r => setTimeout(r, 500));
    assert(verifyHouse(witness, goal.blueprint).ok); assert.equal(countOf(bot, 'oak_door'), 0, 'exactly four doors placed, never eight halves');
    const o = new Vec3(goal.blueprint.origin.x, goal.blueprint.origin.y, goal.blueprint.origin.z);
    const observations = [];
    bot.pathfinder.movements.canDig = false;
    bot.pathfinder.movements.scafoldingBlocks = []; // Door use must work without scaffolding available.
    for (const d of doors) {
      const p = o.plus(new Vec3(...d.p)), inward = new Vec3(...d.inward), outside = p.minus(inward.scaled(2)), inside = o.offset(2, 1, 2);
      await navigate(bot, task, new goals.GoalBlock(outside.x, outside.y, outside.z), { timeoutMs: 15000, stallMs: 5000 });
      if (bot.blockAt(p).getProperties().open) { await bot.activateBlock(bot.blockAt(p)); await waitFor(task, () => !bot.blockAt(p).getProperties().open); }
      const before = countOf(bot, 'oak_planks');
      await navigate(bot, task, new goals.GoalBlock(inside.x, inside.y, inside.z), { timeoutMs: 15000, stallMs: 5000 });
      await waitFor(task, () => witness.blockAt(p)?.getProperties().open && witness.players[bot.username]?.entity?.position.distanceTo(inside.offset(.5, 0, .5)) < .6);
      assert.equal(countOf(bot, 'oak_planks'), before);
      assert(verifyHouse(witness, goal.blueprint).ok);
      observations.push({ facing: d.facing, door: { ...p }, independentPosition: witness.players[bot.username].entity.position.clone() });
      log({ phase: 'traversed', ...observations.at(-1) });
    }
    fs.writeFileSync(path.join(directory, 'traversal.json'), JSON.stringify(observations, null, 2));
    assert.equal(deaths, 0);
    log({ result: 'PASS', blocks: goal.blueprint.blocks.length, doors: 4, resumed: true, traversedDirections: observations.map(o => o.facing), health: bot.health, directory });
  } catch (e) { log({ result: 'FAIL', error: e.stack, position: bot.entity?.position, directory }); process.exitCode = 1; }
  finally { clearTimeout(timeout); bot.pathfinder.setGoal(null); bot.clearControlStates(); bot.quit(); witness.quit(); setTimeout(() => process.exit(process.exitCode || 0), 500); }
})();
