'use strict';
// Controlled natural-looking terrain and granted supplies, then ordinary
// Survival earthworks/construction. Separate client verifies the final world.
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const mineflayer = require('mineflayer'), { pathfinder } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { compatibilityPlugin } = require('../src/compatibility');
const { configureMovements } = require('../src/movement');
const { Task, countOf } = require('../src/skills');
const { runGoal, waitFor } = require('../src/work');
const { GoalStore, verifyHouse } = require('../src/objectives');
const { validateSchematic, selectSchematicSite } = require('../src/designer');
const port = Number(process.env.MC_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535 || [25565, 25577].includes(port)) throw new Error('Choose an explicit isolated MC_PORT');
require('../src/env').loadEnv();
const id = Date.now().toString(36), directory = path.join(__dirname, '..', 'artifacts', `terrain-build-${id}`);
fs.mkdirSync(directory, { recursive: true });
const log = data => { const row = JSON.stringify({ at: new Date().toISOString(), ...data }); console.log(row); fs.appendFileSync(path.join(directory, 'events.jsonl'), row + '\n'); };
function connect(prefix) {
  const bot = mineflayer.createBot({ host: '127.0.0.1', port, username: `${prefix}${id}`, version: '26.1', auth: 'offline' });
  bot.loadPlugin(compatibilityPlugin); bot.loadPlugin(pathfinder); return bot;
}
const bot = connect('Earth'), witness = connect('See');
let task = new Task('earthworks'), deaths = 0;
const timer = setTimeout(() => task.cancel(), 12 * 60000);
for (const b of [bot, witness]) { b.on('error', error => log({ error: error.message })); b.on('death', () => { deaths++; task.cancel(); }); }
async function ready(b) { await new Promise(resolve => b.once('spawn', resolve)); await b.waitForChunksToLoad(); configureMovements(b); }
(async () => {
  try {
    await Promise.all([ready(bot), ready(witness)]);
    for (const [i, kind] of ['hills', 'water'].entries()) {
      if (process.env.TERRAIN_ONLY && process.env.TERRAIN_ONLY !== kind) continue;
      const x = 500 + i * 64;
      const commands = [`forceload add ${x} 0 ${x + 31} 31`, `fill ${x} 77 0 ${x + 25} 89 25 air`, `fill ${x} 77 0 ${x + 25} 80 25 stone`,
        ...(kind === 'hills' ? [0, 3, 6, 9, 12, 15, 18, 21, 24].map(dx => `fill ${x + dx} 81 0 ${x + dx} 84 25 dirt`) : [`fill ${x + 4} 79 4 ${x + 25} 80 25 water`]),
        `give ${bot.username} cobblestone 256`, `give ${bot.username} iron_pickaxe 1`, `give ${bot.username} bread 16`,
        `tp ${bot.username} ${x + 2.5} 81 2.5`, `tp ${witness.username} ${x + 1.5} 81 2.5`];
      const setupFile = path.join(directory, `setup-${kind}.json`), readyFile = path.join(directory, `ready-${kind}`);
      fs.writeFileSync(setupFile, JSON.stringify(commands, null, 2)); log({ phase: 'setup', kind, commands: setupFile, ready: readyFile, directory });
      await waitFor(task, () => fs.existsSync(readyFile), 180000);
      await waitFor(task, () => countOf(bot, 'cobblestone') >= 128 && Math.abs(bot.entity.position.x - x - 2.5) < 1, 10000);
      await bot.waitForChunksToLoad();
      const source = { name: 'Stone monument', description: 'Solid sculpture', size: [3, 3, 3], palette: ['cobblestone'], entrance: null,
        regions: [{ from: [0, 0, 0], to: [2, 2, 2], block: 'cobblestone' }] };
      const design = validateSchematic(source, bot.registry), actualBlockAt = bot.blockAt.bind(bot);
      // Limit only this survey to the controlled patch, so an easier natural
      // site outside it cannot silently bypass the terrain behavior under test.
      bot.blockAt = (p, ...args) => p.x >= x + 4 && p.x <= x + 25 && p.z >= 4 && p.z <= 25 ? actualBlockAt(p, ...args) : null;
      let blueprint;
      try { blueprint = selectSchematicSite(bot, design); } finally { bot.blockAt = actualBlockAt; }
      assert(blueprint?.terrain, 'must select a prepared site, not the flat-site shortcut');
      log({ kind, terrain: blueprint.terrain, origin: blueprint.origin });
      const goal = { version: 1, kind: 'build', request: `build a stone monument on ${kind}`, design, blueprint };
      const store = new GoalStore(path.join(directory, `${kind}.json`));
      task = new Task(`build on ${kind}`);
      const result = await runGoal(bot, task, goal, store, { maxSteps: 400, survival: { state: {}, step: async () => false },
        onStep: g => log({ kind, step: g.step, prepared: g.blueprint.terrain.prepared, error: g.lastError }) });
      assert(result.ok, result.reason);
      await new Promise(resolve => setTimeout(resolve, 500));
      assert(verifyHouse(witness, goal.blueprint).ok, 'independent actual block and empty-space verification');
      assert(goal.blueprint.terrain.prepared); assert.equal(deaths, 0);
      log({ phase: kind, result: 'PASS', independentVerification: true, health: bot.health, blocks: goal.blueprint.blocks.length });
    }
    log({ result: 'PASS', scenario: 'controlled Survival leveling and shallow island foundation', deaths, directory });
  } catch (error) { log({ result: 'FAIL', error: error.stack, position: bot.entity?.position, directory }); process.exitCode = 1; }
  finally { clearTimeout(timer); bot.pathfinder.setGoal(null); bot.clearControlStates(); bot.quit(); witness.quit(); setTimeout(() => process.exit(process.exitCode || 0), 500); }
})();
