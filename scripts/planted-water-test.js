'use strict';
// Controlled terrain and supplies; independent observation of ordinary swimming.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const mineflayer = require('mineflayer'), { pathfinder, goals } = require('mineflayer-pathfinder'), { Vec3 } = require('vec3');
const { compatibilityPlugin } = require('../src/compatibility'), { configureMovements } = require('../src/movement');
const { Task, navigate, countOf } = require('../src/skills');
const { surfaceMovement } = require('../src/surface'), { dryStanding } = require('../src/mining-access');
const { waitFor } = require('../src/work');
const port = Number(process.env.MC_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535 || [25565, 25577].includes(port)) throw new Error('Explicit isolated MC_PORT required');
const id = Date.now().toString(36), x = Number(process.env.SWIM_TEST_X || 1700);
const directory = path.resolve('artifacts', `planted-water-${id}`);
fs.mkdirSync(directory, { recursive: true });
const log = value => { const row = JSON.stringify({ at: new Date().toISOString(), ...value }); console.log(row); fs.appendFileSync(path.join(directory, 'events.jsonl'), row + '\n'); };
const connect = prefix => { const b = mineflayer.createBot({ host: '127.0.0.1', port, username: prefix + id, version: '26.1', auth: 'offline' }); b.loadPlugin(compatibilityPlugin); b.loadPlugin(pathfinder); return b; };
const bot = connect('Swim'), witness = connect('See'), task = new Task('swim through aquatic plants');
const timer = setTimeout(() => task.cancel(), 4 * 60000);
let phase, deaths = 0, placed = 0, dug = 0;
for (const b of [bot, witness]) b.on('error', e => log({ error: e.message }));
bot.on('death', () => { deaths++; task.cancel(); });
bot.on('blockPlaced', () => { placed++; }); bot.on('diggingCompleted', () => { dug++; });
bot.on('physicsTick', () => {
  if (!phase) return;
  phase.minimumHealth = Math.min(phase.minimumHealth, bot.health);
  phase.minimumOxygen = Math.min(phase.minimumOxygen, bot.oxygenLevel);
  if (bot.entity.isInWater) phase.waterTicks++;
  const e = witness.players[bot.username]?.entity;
  if (e && witness.blockAt(e.position)?.name === phase.plant) phase.observedPlantTicks++;
});
const ready = async b => { await new Promise(r => b.once('spawn', r)); await b.waitForChunksToLoad(); configureMovements(b); };
(async () => {
  try {
    await Promise.all([ready(bot), ready(witness)]);
    const commands = ['gamerule minecraft:spawn_mobs false', `forceload add ${x - 16} -16 ${x + 48} 16`,
      `fill ${x - 2} 77 -3 ${x + 42} 85 3 air`, `fill ${x - 2} 77 -2 ${x + 42} 80 2 stone`,
      `fill ${x - 2} 80 -3 ${x + 42} 85 -3 bedrock`, `fill ${x - 2} 80 3 ${x + 42} 85 3 bedrock`,
      `fill ${x + 3} 80 -2 ${x + 7} 80 2 water`, `fill ${x + 3} 80 -2 ${x + 7} 80 2 seagrass`,
      `fill ${x + 15} 79 -2 ${x + 20} 80 2 water`,
      `fill ${x + 15} 79 -2 ${x + 20} 79 2 tall_seagrass[half=lower]`, `fill ${x + 15} 80 -2 ${x + 20} 80 2 tall_seagrass[half=upper]`,
      `fill ${x + 28} 78 -2 ${x + 34} 80 2 water`, `fill ${x + 28} 78 -2 ${x + 34} 79 2 kelp_plant`, `fill ${x + 28} 80 -2 ${x + 34} 80 2 kelp[age=7]`,
      `gamemode survival ${bot.username}`, `gamemode spectator ${witness.username}`, `give ${bot.username} cobblestone 64`,
      `tp ${bot.username} ${x + .5} 81 .5`, `tp ${witness.username} ${x + 22.5} 85 .5`];
    fs.writeFileSync(path.join(directory, 'setup.json'), JSON.stringify(commands, null, 2)); log({ phase: 'setup', directory, username: bot.username });
    await waitFor(task, () => fs.existsSync(path.join(directory, 'ready')), 180000);
    await waitFor(task, () => countOf(bot, 'cobblestone') === 64 && bot.entity.position.distanceTo(new Vec3(x + .5, 81, .5)) < 1, 10000);
    const results = [];
    for (const [plant, end, middle, exploration] of [['seagrass', 11, 5, false], ['tall_seagrass', 24, 17, true], ['kelp', 38, 31, true]]) {
      assert.equal(witness.blockAt(new Vec3(x + middle, 80, 0)).name, plant, 'fixture plants survived setup');
      phase = { plant, waterTicks: 0, observedPlantTicks: 0, minimumHealth: bot.health, minimumOxygen: bot.oxygenLevel };
      const policy = exploration ? surfaceMovement(bot) : null;
      try { await navigate(bot, task, new goals.GoalBlock(x + end, 81, 0), { timeoutMs: 30000, stallMs: 6000 }); }
      finally { policy?.restore(); }
      assert(phase.waterTicks > 0); assert(phase.observedPlantTicks > 0, 'independent observer must see the swimmer inside plants');
      assert(dryStanding(bot, bot.entity.position)); assert.equal(phase.minimumHealth, 20); assert(phase.minimumOxygen >= 18);
      assert.equal(countOf(bot, 'cobblestone'), 64); assert.equal(placed, 0); assert.equal(dug, 0); assert.equal(deaths, 0);
      assert.equal(witness.blockAt(new Vec3(x + middle, 80, 0)).name, plant);
      results.push({ ...phase, position: { ...witness.players[bot.username].entity.position } }); log({ phaseResult: results.at(-1) });
    }
    log({ result: 'PASS', results, placed, dug, deaths, directory });
  } catch (e) { log({ result: 'FAIL', error: e.stack, position: bot.entity?.position, phase, directory }); process.exitCode = 1; }
  finally { clearTimeout(timer); bot.pathfinder.setGoal(null); bot.clearControlStates(); bot.quit(); witness.quit(); setTimeout(() => process.exit(process.exitCode || 0), 500); }
})();
