'use strict';
// Controlled grants, mobs, biome edits and platform. This verifies mechanics,
// not natural resource acquisition or the fresh winning-game acceptance.
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const mineflayer = require('mineflayer'), { pathfinder, goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { compatibilityPlugin } = require('../src/compatibility');
const { configureMovements } = require('../src/movement');
const { Task, navigate, countOf } = require('../src/skills');
const { interpret, GoalStore } = require('../src/objectives');
const { runGoal, waitFor, inventory, dig } = require('../src/work');
const { TypeSafe } = require('../src/typesafe');
const { opportunisticMining } = require('../src/opportunistic-mining');
const port = Number(process.env.MC_PORT);
if (!Number.isInteger(port) || [25565, 25577].includes(port)) throw new Error('Select an isolated MC_PORT');
require('../src/env').loadEnv();
const id = Date.now().toString(36), directory = path.join(__dirname, '..', 'artifacts', `companion-live-${id}`);
fs.mkdirSync(directory, { recursive: true });
const log = data => { const line = JSON.stringify({ at: new Date().toISOString(), ...data }); console.log(line); fs.appendFileSync(path.join(directory, 'events.jsonl'), line + '\n'); };
const client = new TypeSafe();
function connect(username) {
  const bot = mineflayer.createBot({ host: '127.0.0.1', port, username, version: '26.1', auth: 'offline' });
  bot.loadPlugin(compatibilityPlugin); bot.loadPlugin(pathfinder); return bot;
}
const bot = connect(`Work${id}`), receiver = connect(`Take${id}`);
let task = new Task('controlled companion'), deaths = 0;
const timer = setTimeout(() => task.cancel(), 12 * 60000);
for (const b of [bot, receiver]) { b.on('death', () => { deaths++; task.cancel(); }); b.on('error', e => log({ error: e.message })); }
bot.on('handover', handover => log({ handover }));
async function ready(b) { await new Promise(resolve => b.once('spawn', resolve)); await b.waitForChunksToLoad(); configureMovements(b); }
const survival = { state: {}, step: async () => false };
(async () => {
  try {
    await Promise.all([ready(bot), ready(receiver)]);
    const commands = ['gamerule minecraft:spawn_mobs false', 'forceload add 96 -32 175 32',
      'fill 100 81 -20 165 90 20 air', 'fill 100 80 -20 165 80 20 stone',
      'fillbiome 100 78 -20 127 90 20 plains', 'fillbiome 128 78 -20 165 90 20 cherry_grove',
      'setblock 120 81 0 cherry_log', 'setblock 110 81 3 diamond_ore', 'setblock 132 81 6 diamond_ore',
      'summon sheep 113.5 81 0.5 {NoAI:1b,PersistenceRequired:1b}',
      `give ${bot.username} diamond 24`, `give ${bot.username} oak_planks 8`, `give ${bot.username} white_wool 3`,
      `give ${bot.username} crafting_table 1`, `give ${bot.username} iron_pickaxe 1`,
      `tp ${bot.username} 105.5 81 0.5`, `tp ${receiver.username} 104.5 81 0.5`];
    fs.writeFileSync(path.join(directory, 'setup.json'), JSON.stringify(commands, null, 2));
    log({ phase: 'setup', commands: path.join(directory, 'setup.json'), ready: path.join(directory, 'ready'), directory });
    await waitFor(task, () => fs.existsSync(path.join(directory, 'ready')), 180000);
    await waitFor(task, () => countOf(bot, 'diamond') === 24 && bot.entity.position.distanceTo(new Vec3(105.5, 81, .5)) < 1, 10000);
    const spec = await interpret(client, 'Jev give me full diamond armor and a bed', receiver.username, 'Jev', { registry: bot.registry, players: [receiver.username] });
    assert.equal(spec.kind, 'bundle');
    let goal = { ...spec, version: 1, requesterPosition: { ...receiver.entity.position } };
    const store = new GoalStore(path.join(directory, 'bundle.json'));
    let interrupted = false;
    try {
      await runGoal(bot, task, goal, store, { decisionClient: client, survival, maxSteps: 80, onStep: g => {
        log({ step: g.step, progress: g.tasks.map(t => [t.item, t.status]), error: g.lastError });
        if (g.tasks.filter(t => t.status === 'complete').length >= 2) { interrupted = true; task.cancel(); }
      } });
    } catch (error) { if (error.name !== 'Cancelled') throw error; }
    assert(interrupted, 'Must exercise saving and resuming a partially delivered list');
    goal = store.read(); task = new Task('resume bundle');
    const result = await runGoal(bot, task, goal, store, { decisionClient: client, survival, maxSteps: 80, onStep: g => log({ step: g.step, error: g.lastError }) });
    assert(result.ok, result.reason);
    for (const name of ['diamond_helmet', 'diamond_chestplate', 'diamond_leggings', 'diamond_boots', 'white_bed']) assert.equal(countOf(receiver, name), 1, name);
    assert.equal(countOf(bot, 'diamond'), 0);
    log({ phase: 'bundle', result: 'PASS', receiverInventory: inventory(receiver), resumed: true });
    for (const request of ['Jev find a sheep', 'Jev find a cherry log', 'Jev find a cherry biome']) {
      const spec = await interpret(client, request, receiver.username, 'Jev', { registry: bot.registry });
      assert.equal(spec.kind, 'find');
      const goal = { ...spec, version: 1 }, store = new GoalStore(path.join(directory, `find-${spec.discoveryTarget.kind}.json`));
      task = new Task('find', request);
      const result = await runGoal(bot, task, goal, store, { decisionClient: client, survival, maxSteps: 16, onStep: g => log({ step: g.step, error: g.lastError }) });
      assert(result.ok, result.reason); log({ phase: 'discovery', request, result: 'PASS', found: goal.discovery.found });
    }
    task = new Task('opportunity');
    await navigate(bot, task, new goals.GoalBlock(108, 81, 0), { timeoutMs: 20000 });
    const start = bot.entity.position.clone(), goal2 = { kind: 'obtain', request: 'Jev get me coal', opportunistic: { primarySteps: 2, history: [], skipped: {} } };
    let farthest = 0;
    const track = () => { farthest = Math.max(farthest, bot.entity.position.distanceTo(start)); };
    bot.on('physicsTick', track);
    const did = await opportunisticMining(bot, task, goal2, () => fs.writeFileSync(path.join(directory, 'opportunity.json'), JSON.stringify(goal2, null, 2)), { action: 'mine', block: 'coal_ore', drops: 'coal' }, { navigate, dig }, client);
    bot.removeListener('physicsTick', track);
    assert(did, goal2.opportunistic.lastError || 'Jev declined the nearby diamond');
    await waitFor(task, () => countOf(bot, 'diamond') === 1, 3000);
    assert.equal(bot.blockAt(new Vec3(132, 81, 6)).name, 'diamond_ore');
    assert(farthest <= 6); assert.equal(goal2.request, 'Jev get me coal'); assert.equal(goal2.opportunistic.active, undefined);
    log({ phase: 'opportunity', result: 'PASS', inventory: inventory(bot), farthest, record: goal2.opportunistic });
    assert.equal(deaths, 0); assert.equal(bot.health, 20);
    log({ result: 'PASS', scenario: 'controlled compound crafting/delivery/resume, discovery and short optional mining', directory });
  } catch (error) { log({ result: 'FAIL', error: error.stack, position: bot.entity?.position, inventory: inventory(bot), directory }); process.exitCode = 1; }
  finally { clearTimeout(timer); bot.pathfinder.setGoal(null); bot.clearControlStates(); bot.quit(); receiver.quit(); setTimeout(() => process.exit(process.exitCode || 0), 500); }
})();
