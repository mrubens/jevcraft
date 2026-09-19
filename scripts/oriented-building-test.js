'use strict';
// Controlled mechanics fixture: supplies and terrain are granted only on an
// explicitly selected isolated server. Construction itself uses Survival actions.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const mineflayer = require('mineflayer'), { pathfinder, goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { compatibilityPlugin } = require('../src/compatibility');
const { configureMovements } = require('../src/movement');
const { Task, navigate } = require('../src/skills');
const { runGoal, waitFor } = require('../src/work');
const { GoalStore, verifyHouse } = require('../src/objectives');
const { validateSchematic, selectSchematicSite } = require('../src/designer');
const port = Number(process.env.MC_PORT);
if (!Number.isInteger(port) || [25565, 25577].includes(port)) throw new Error('Explicit isolated MC_PORT required');
const resumedDirectory = process.env.RESUME_BUILD_DIR;
const id = resumedDirectory ? path.basename(resumedDirectory).replace('oriented-building-', '') : Date.now().toString(36);
const directory = resumedDirectory ? path.resolve(resumedDirectory) : path.resolve('artifacts', `oriented-building-${id}`);
fs.mkdirSync(directory, { recursive: true });
const log = value => { const row = JSON.stringify({ at: new Date().toISOString(), ...value }); console.log(row); fs.appendFileSync(path.join(directory, 'events.jsonl'), row + '\n'); };
const connect = prefix => { const b = mineflayer.createBot({ host: '127.0.0.1', port, username: prefix + id, version: '26.1', auth: 'offline' }); b.loadPlugin(compatibilityPlugin); b.loadPlugin(pathfinder); return b; };
const bot = connect('Shape'), witness = connect('See');
let activeTask = new Task('oriented building'), deaths = 0;
for (const b of [bot, witness]) { b.on('error', e => log({ error: e.message })); b.on('death', () => { deaths++; activeTask.cancel(); }); }
const timer = setTimeout(() => activeTask.cancel(), 15 * 60000);
const ready = async b => { await new Promise(r => b.once('spawn', r)); await b.waitForChunksToLoad(); configureMovements(b); };
const cellKey = p => `${p.x},${p.y},${p.z}`;
const regions = [{ from: [0, 0, 0], to: [10, 0, 6], block: 'oak_planks' },
  { from: [0, 1, 2], to: [8, 1, 2], block: 'oak_planks' }];
for (const [i, facing] of ['north', 'east', 'south', 'west'].entries()) for (const [z, half] of [[2, 'top'], [4, 'bottom']])
  regions.push({ from: [i * 2 + 1, 1, z], to: [i * 2 + 1, 1, z], block: 'oak_stairs', properties: { facing, half } });
regions.push({ from: [0, 1, 5], to: [0, 1, 5], block: 'oak_planks' },
  { from: [1, 1, 5], to: [1, 1, 5], block: 'oak_slab', properties: { half: 'top' } },
  { from: [3, 1, 5], to: [4, 1, 5], block: 'oak_slab', properties: { half: 'bottom' } },
  { from: [9, 1, 1], to: [9, 1, 1], block: 'oak_stairs', properties: { facing: 'south', half: 'bottom' } },
  { from: [9, 1, 2], to: [9, 1, 3], block: 'oak_planks' },
  { from: [9, 2, 2], to: [9, 2, 2], block: 'oak_stairs', properties: { facing: 'south', half: 'bottom' } },
  { from: [8, 2, 3], to: [8, 2, 3], block: 'oak_planks' },
  { from: [8, 1, 3], to: [8, 1, 3], block: 'oak_planks' },
  { from: [9, 2, 3], to: [9, 2, 3], block: 'oak_slab', properties: { half: 'top' } },
  { from: [0, 1, 6], to: [0, 3, 6], block: 'oak_planks' },
  { from: [0, 3, 6], to: [3, 3, 6], block: 'oak_planks' },
  { from: [3, 2, 6], to: [3, 2, 6], block: 'oak_slab', properties: { half: 'top' } });
let source = { name: 'Stair and slab gallery', description: 'All orientations and an ordinary usable staircase', size: [11, 5, 7],
  palette: ['oak_planks', 'oak_stairs', 'oak_slab'], entrance: null, regions };
if (process.env.BUILD_SOURCE) source = JSON.parse(fs.readFileSync(process.env.BUILD_SOURCE));
(async () => {
  try {
    await Promise.all([ready(bot), ready(witness)]);
    const x = Number(process.env.BUILD_TEST_X || 1200);
    const setup = [`gamemode ${process.env.BUILD_MODE || 'survival'} ${bot.username}`, `gamemode survival ${witness.username}`, `time set day`,
      `forceload add ${x - 32} -32 ${x + 48} 48`, ...[64, 74].map(y => `fill ${x - 20} ${y} -20 ${x + 36} ${y + 9} 36 air`),
      `fill ${x - 20} 61 -20 ${x + 36} 63 36 stone`, `tp ${bot.username} ${x + .5} 64 .5`, `tp ${witness.username} ${x + 2.5} 64 .5`,
      `give ${bot.username} minecraft:oak_planks 100`, `give ${bot.username} minecraft:oak_stairs 16`, `give ${bot.username} minecraft:oak_slab 8`,
      `give ${bot.username} minecraft:iron_pickaxe`, `give ${bot.username} minecraft:iron_axe`, `give ${bot.username} minecraft:dirt 64`];
    if (!resumedDirectory) {
      fs.writeFileSync(path.join(directory, 'setup.json'), JSON.stringify(setup, null, 2));
      log({ phase: 'setup', directory, bot: bot.username, witness: witness.username });
      await waitFor(activeTask, () => fs.existsSync(path.join(directory, 'ready')), 180000);
    }
    await bot.waitForChunksToLoad();
    const savedGoal = resumedDirectory && JSON.parse(fs.readFileSync(path.join(directory, 'goal.json')));
    const design = savedGoal?.design || validateSchematic(source, bot.registry), blueprint = savedGoal?.blueprint || selectSchematicSite(bot, design);
    assert(blueprint);
    let goal = savedGoal || { version: 1, kind: 'build', request: 'Build the test gallery', design, blueprint };
    const store = new GoalStore(path.join(directory, 'goal.json'));
    let placements = 0, oriented = 0;
    const placed = (_old, block) => { placements++; if (block.name.endsWith('_stairs') && ++oriented === 2) activeTask.cancel(); };
    const options = { survival: { state: {}, step: async () => false }, recoveryAdviser: { recordFailure: () => {}, suggest: async () => false },
      onStep: g => { if (g.lastError || placements % 20 === 0) log({ phase: 'build', step: g.step, error: g.lastError, position: bot.entity.position }); } };
    if (!resumedDirectory) {
      bot.on('blockPlaced', placed);
      await assert.rejects(runGoal(bot, activeTask, goal, store, options), { name: 'Cancelled' });
      assert(activeTask.cancelled); bot.removeListener('blockPlaced', placed);
      goal = JSON.parse(fs.readFileSync(path.join(directory, 'goal.json')));
    }
    assert(goal.blueprint.blocks.some(p => p.properties));
    log({ phase: 'resume', placements, oriented });
    activeTask = new Task('resume oriented building');
    if (process.env.TEST_REPAIR === '1') {
      const p = blueprint.blocks.find(p => p.material.endsWith('_stairs') && bot.blockAt(new Vec3(p.x, p.y, p.z))?.name === p.material);
      const wrongFacing = { north: 'south', south: 'north', east: 'west', west: 'east' }[p.properties.facing];
      fs.writeFileSync(path.join(directory, 'repair-setup.json'), JSON.stringify([`setblock ${p.x} ${p.y} ${p.z} ${p.material}[facing=${wrongFacing},half=${p.properties.half}]`], null, 2));
      log({ phase: 'repairSetup', directory, position: p });
      await waitFor(activeTask, () => fs.existsSync(path.join(directory, 'repair-ready')) && bot.blockAt(new Vec3(p.x, p.y, p.z))?.getProperties().facing === wrongFacing, 180000);
      // Deliberately mark this fixture's wrong placement as bot-owned. Player
      // edits remain protected; this tests repair of a saved bot misplacement.
      goal.buildOwned[cellKey(p)] = bot.blockAt(new Vec3(p.x, p.y, p.z)).stateId;
      store.save(goal);
    }
    const result = await runGoal(bot, activeTask, goal, store, options);
    assert(result.ok, result.reason); await new Promise(r => setTimeout(r, 500));
    const states = blueprint.blocks.filter(p => p.properties).map(p => ({ position: { x: p.x, y: p.y, z: p.z }, material: p.material,
      expected: p.properties, observed: witness.blockAt(new Vec3(p.x, p.y, p.z))?.getProperties() }));
    assert(verifyHouse(witness, blueprint).ok, 'independent client verifies all block states and empty cells');
    assert.equal(deaths, 0);
    fs.writeFileSync(path.join(directory, 'states.json'), JSON.stringify(states, null, 2));
    // Walk straight up the stairs without jumping. This checks usable geometry,
    // independently of the blueprint's approximate accessibility diagnostics.
    let observed;
    if (!process.env.BUILD_SOURCE) {
      const o = blueprint.origin;
      await navigate(bot, activeTask, new goals.GoalBlock(o.x + 9, o.y + 1, o.z));
      await bot.lookAt(new Vec3(o.x + 9.5, bot.entity.position.y + 1.62, o.z + 8), true);
      try {
        bot.setControlState('forward', true);
        await waitFor(activeTask, () => bot.entity.position.z >= o.z + 3.3, 5000);
      } finally { bot.clearControlStates(); }
      await waitFor(activeTask, () => Math.abs(bot.entity.position.y - (o.y + 3)) < .1, 3000);
      observed = witness.players[bot.username]?.entity?.position;
      assert(observed && Math.abs(observed.y - (o.y + 3)) < .2);
    }
    log({ result: 'PASS', blocks: blueprint.blocks.length, orientedBlocks: states.length, resumed: true, staircaseWalkWithoutJump: !process.env.BUILD_SOURCE,
      repairedWrongOrientation: process.env.TEST_REPAIR === '1',
      independentPosition: observed, health: bot.health, directory });
  } catch (e) { log({ result: 'FAIL', error: e.stack, position: bot.entity?.position, directory }); process.exitCode = 1; }
  finally { clearTimeout(timer); bot.pathfinder.setGoal(null); bot.clearControlStates(); bot.quit(); witness.quit(); setTimeout(() => process.exit(process.exitCode || 0), 500); }
})();
