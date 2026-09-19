'use strict';
// Controlled mechanics: granted eyes, dry platforms, fixed time and teleports.
// A console /locate result is supplied ONLY to the independent verifier after
// the bot records its estimate; production search receives no such coordinate.
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const mineflayer = require('mineflayer'), { pathfinder } = require('mineflayer-pathfinder'), { Vec3 } = require('vec3');
const { compatibilityPlugin } = require('../src/compatibility');
const { configureMovements } = require('../src/movement');
const { Task, navigate } = require('../src/skills');
const { throwEye, triangulate, horizontal } = require('../src/ender-eye');
const { findStronghold } = require('../src/stronghold');
const { waitFor, inventory, explore, surfaceStep } = require('../src/work');
require('../src/env').loadEnv();
const { TypeSafe } = require('../src/typesafe');
const id = Date.now().toString(36), username = `Eye${id}`, directory = path.join(__dirname, '..', 'artifacts', `eye-search-${id}`);
fs.mkdirSync(directory, { recursive: true });
const log = data => { const line = JSON.stringify({ at: new Date().toISOString(), ...data }); console.log(line); fs.appendFileSync(path.join(directory, 'events.jsonl'), line + '\n'); };
const bot = mineflayer.createBot({ host: '127.0.0.1', port: Number(process.env.MC_PORT || 25578), username, version: '26.1', auth: 'offline' });
bot.loadPlugin(compatibilityPlugin); bot.loadPlugin(pathfinder);
const task = new Task('controlled Eye search'), timer = setTimeout(() => task.cancel(), 480000);
const client = new TypeSafe();
let deaths = 0, goal, finishing = false;
const save = () => fs.writeFileSync(path.join(directory, 'goal.json'), JSON.stringify(goal, null, 2));
bot.on('death', () => { deaths++; task.cancel(); });
bot.on('error', err => log({ error: err.message }));
bot.on('end', reason => { if (!finishing) { log({ result: 'FAIL', reason: `Disconnected: ${reason}` }); clearTimeout(timer); process.exitCode = 1; } });
bot.once('spawn', async () => {
  try {
    await bot.waitForChunksToLoad(); configureMovements(bot);
    const initial = bot.entity.position.floored(), y = initial.y + 24;
    const platform = p => [`forceload add ${p.x - 18} ${p.z - 18} ${p.x + 18} ${p.z + 18}`,
      `fill ${p.x - 18} ${y} ${p.z - 18} ${p.x + 18} ${y} ${p.z + 18} stone`, `tp ${username} ${p.x + .5} ${y + 1} ${p.z + .5}`];
    for (let index = 0; index < 2; index++) {
      const first = goal?.strongholdSearch.bearings[0];
      const p = first ? new Vec3(Math.floor(first.origin.x - first.direction.z * 64), y + 1, Math.floor(first.origin.z + first.direction.x * 64)) : initial;
      const commands = [...(index === 0 ? ['gamerule minecraft:spawn_mobs false', 'time set 1000', `give ${username} ender_eye 32`] : []), ...platform(p)];
      fs.writeFileSync(path.join(directory, `setup-${index}.json`), JSON.stringify(commands, null, 2));
      const ready = path.join(directory, `ready-${index}`);
      log({ phase: 'setup', index, username, commands, ready, directory, note: 'Wait for forceloaded chunks before the fill command' });
      await waitFor(task, () => fs.existsSync(ready), 180000);
      await waitFor(task, () => bot.entity.position.distanceTo(new Vec3(p.x + .5, y + 1, p.z + .5)) < .3 && inventory(bot).ender_eye >= 16);
      await bot.waitForChunksToLoad();
      assert.equal(bot.game.gameMode, 'survival'); assert.equal(bot.game.difficulty, 'normal');
      const bearing = await throwEye(bot, task);
      goal ||= { kind: 'win', request: 'Jev find the stronghold using Eyes of Ender', gameProgress: { milestones: {} },
        strongholdSearch: { bearings: [], visited: {}, throws: 0, moves: 0 } };
      goal.strongholdSearch.bearings.push(bearing); goal.strongholdSearch.throws++; save();
      log({ phase: 'bearing', index, bearing, inventory: inventory(bot) });
    }
    const estimate = triangulate(goal.strongholdSearch.bearings);
    assert(estimate, 'Two observed bearings must yield a consistent estimate');
    log({ phase: 'estimated', estimate, witnessCommand: `execute at ${username} run locate structure minecraft:stronghold`,
      witnessFile: path.join(directory, 'witness.json') });
    await waitFor(task, () => fs.existsSync(path.join(directory, 'witness.json')), 120000);
    const witness = JSON.parse(fs.readFileSync(path.join(directory, 'witness.json')));
    const error = horizontal(estimate, witness);
    assert(error < 16, `Estimated stronghold is ${error.toFixed(2)} blocks from independent console result`);
    const before = bot.entity.position.clone();
    await findStronghold(bot, task, goal, save, { navigate, explore, surfaceStep, tunnel: async () => assert.fail('This fixture should follow a surface bearing') }, client);
    assert(bot.entity.position.distanceTo(before) >= 4, 'Production controller must execute a surveyed waypoint');
    assert(goal.decisions.at(-1).judgments.length, 'Jev must select among the real waypoint choices');
    assert.equal(goal.gameProgress.milestones.stronghold_located, undefined, 'An estimate alone does not prove discovery');
    assert.equal(deaths, 0);
    log({ result: 'PASS', scenario: 'controlled real eye flights, independent bearing verification and one Jev-selected waypoint', estimate,
      error, position: bot.entity.position, health: bot.health, deaths, directory, limitations: 'No natural acquisition, long journey, portal room access, End entry or dragon combat verified' });
  } catch (err) { log({ result: 'FAIL', error: err.stack, position: bot.entity?.position, deaths, directory }); process.exitCode = 1; }
  finally { finishing = true; clearTimeout(timer); bot.pathfinder.setGoal(null); bot.clearControlStates(); bot.quit(); setTimeout(() => process.exit(process.exitCode || 0), 500); }
});
