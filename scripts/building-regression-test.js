'use strict';
// Controlled Survival construction of the player's recorded arbitrary design.
// Setup is privileged; execution uses ordinary inventory, digging and placement.
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const mineflayer = require('mineflayer'), { pathfinder } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { compatibilityPlugin } = require('../src/compatibility');
const { configureMovements } = require('../src/movement');
const { Task } = require('../src/skills');
const { runGoal, waitFor } = require('../src/work');
const { GoalStore, verifyHouse } = require('../src/objectives');
const { validateSchematic, selectSchematicSite, schematicScaffolding } = require('../src/designer');
const port = Number(process.env.MC_PORT);
if (!Number.isInteger(port) || [25565, 25577].includes(port)) throw new Error('Explicit isolated MC_PORT required');
const id = Date.now().toString(36), directory = path.resolve('artifacts', `building-regression-${id}`);
fs.mkdirSync(directory, { recursive: true });
const crypto = require('crypto');
fs.writeFileSync(path.join(directory, 'source.json'), JSON.stringify(Object.fromEntries(['work', 'construction-access', 'build-batch', 'designer', 'build-terrain', 'pillar-recovery'].map(name => [name, crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', 'src', name + '.js'))).digest('hex')])), null, 2));
const log = value => { const row = JSON.stringify({ at: new Date().toISOString(), ...value }); console.log(row); fs.appendFileSync(path.join(directory, 'events.jsonl'), row + '\n'); };
const resumed = process.env.BUILD_RESUME && JSON.parse(fs.readFileSync(path.join(process.env.BUILD_RESUME, 'events.jsonl'), 'utf8').split('\n').find(l => l.includes('"phase":"setup"') || l.includes('"phase":"resume"')));
const connect = prefix => { const b = mineflayer.createBot({ host: '127.0.0.1', port, username: resumed ? (prefix === 'Build' ? resumed.bot : resumed.witness) : prefix + id, version: '26.1', auth: 'offline' }); b.loadPlugin(compatibilityPlugin); b.loadPlugin(pathfinder); return b; };
const bot = connect('Build'), witness = connect('See'), task = new Task('construction regression');
let deaths = 0;
for (const b of [bot, witness]) { b.on('error', e => log({ error: e.message })); b.on('death', () => { deaths++; task.cancel(); }); }
const timer = setTimeout(() => task.cancel(), 25 * 60000);
const ready = async b => { await new Promise(r => b.once('spawn', r)); await b.waitForChunksToLoad(); configureMovements(b); };
(async () => {
  try {
    await Promise.all([ready(bot), ready(witness)]);
    const saved = JSON.parse(fs.readFileSync(process.env.BUILD_RESUME ? path.join(process.env.BUILD_RESUME, 'goal.json') : process.env.BUILD_FIXTURE || 'test/fixtures/desert-watchtower.json'));
    const design = validateSchematic(saved.design.source, bot.registry);
    const x = Number(process.env.BUILD_TEST_X || 100);
    const commands = [`forceload add ${x - 32} -32 ${x + 48} 48`, ...[64, 74, 84].map(y => `fill ${x - 24} ${y} -24 ${x + 32} ${y + 9} 32 air`), `fill ${x - 24} 61 -24 ${x + 32} 63 32 stone`,
      `tp ${bot.username} ${x + .5} 64 .5`, `tp ${witness.username} ${x + 2.5} 64 .5`,
      ...(process.env.BUILD_RAW ? [`fill ${x - 12} 64 -8 ${x - 1} 64 -5 sand`, `give ${bot.username} furnace 1`, `give ${bot.username} oak_planks 16`] : Object.entries(design.materials).map(([name, count]) => `give ${bot.username} ${name} ${count}`)),
      `give ${bot.username} dirt 192`, `give ${bot.username} iron_pickaxe 2`, `give ${bot.username} iron_shovel 2`];
    if (!resumed) {
    fs.writeFileSync(path.join(directory, 'setup.json'), JSON.stringify(commands, null, 2));
    log({ phase: 'setup', directory, bot: bot.username, witness: witness.username });
    await waitFor(task, () => fs.existsSync(path.join(directory, 'ready')), 180000);
    await bot.waitForChunksToLoad();
    } else log({ phase: 'resume', from: process.env.BUILD_RESUME, directory, bot: bot.username, witness: witness.username });
    const blueprint = resumed ? saved.blueprint : selectSchematicSite(bot, design);
    assert(blueprint);
    const goal = resumed ? saved : { version: 1, kind: 'build', request: saved.request, design, blueprint };
    const store = new GoalStore(path.join(directory, 'goal.json'));
    let firstManufacture;
    const save = store.save.bind(store);
    store.save = g => {
      if (process.env.BUILD_RAW && !firstManufacture && ['craft', 'smelt'].includes(g.step?.action)) {
        firstManufacture = { step: structuredClone(g.step), inventory: require('../src/work').inventory(bot) };
        log({ firstManufacture });
      }
      return save(g);
    };
    let steps = 0;
    const result = await runGoal(bot, task, goal, store, { survival: { state: {}, step: async () => false },
      recoveryAdviser: { recordFailure: () => {}, suggest: async () => false },
      onStep: g => { steps++; if (steps % 10 === 0 || g.lastError) log({ steps, step: g.step, error: g.lastError, position: bot.entity.position, remaining: verifyHouse(bot, blueprint).missing?.length, health: bot.health }); } });
    assert(result.ok, result.reason);
    await new Promise(r => setTimeout(r, 500));
    assert(verifyHouse(witness, blueprint).ok, 'independent final blocks and empty-space verification');
    assert.equal(schematicScaffolding(bot, goal).length, 0, 'temporary access removed');
    assert.equal(deaths, 0);
    if (process.env.BUILD_RAW) assert(firstManufacture?.inventory.sand >= 44, 'all 44 shared sand gathered before first craft or smelt');
    log({ result: 'PASS', blocks: blueprint.blocks.length, independentVerification: true, health: bot.health, directory });
  } catch (e) { log({ result: 'FAIL', error: e.stack, position: bot.entity?.position, directory }); process.exitCode = 1; }
  finally { clearTimeout(timer); bot.pathfinder.setGoal(null); bot.clearControlStates(); bot.quit(); witness.quit(); setTimeout(() => process.exit(process.exitCode || 0), 500); }
})();
