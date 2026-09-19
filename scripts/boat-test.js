'use strict';
// Controlled platform/water/grants, ordinary survival actions thereafter.
// A second client observes the server's boat and rider, independently of the
// driver's client prediction. This is mechanics evidence, not game acceptance.
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const mineflayer = require('mineflayer'), { pathfinder } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { compatibilityPlugin } = require('../src/compatibility');
const { configureMovements } = require('../src/movement');
const { Task, countOf, navigate } = require('../src/skills');
const { acquireStep, waitFor, inventory } = require('../src/work');
const { surveyBoatTrip, boatTravelStep, chooseBoat } = require('../src/boats');
const { TypeSafe } = require('../src/typesafe');
require('../src/env').loadEnv();
const port = Number(process.env.MC_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535 || [25565, 25577].includes(port)) throw new Error('Choose an explicit isolated test MC_PORT');
const id = Date.now().toString(36), directory = path.join(__dirname, '..', 'artifacts', `boat-${id}`);
fs.mkdirSync(directory, { recursive: true });
const log = data => { const row = JSON.stringify({ at: new Date().toISOString(), ...data }); console.log(row); fs.appendFileSync(path.join(directory, 'events.jsonl'), row + '\n'); };
function connect(username) {
  const bot = mineflayer.createBot({ host: '127.0.0.1', port, username, version: '26.1', auth: 'offline' });
  bot.loadPlugin(compatibilityPlugin); bot.loadPlugin(pathfinder); return bot;
}
const bot = connect(`Boat${id}`), witness = connect(`See${id}`), client = new TypeSafe();
const task = new Task('controlled boat crossing');
const timer = setTimeout(() => task.cancel(), 7 * 60000);
let deaths = 0, corrections = 0, mountedSamples = 0, maxWitnessX = 0, minimumHealth = 20;
const observed = [];
for (const b of [bot, witness]) { b.on('death', () => { deaths++; task.cancel(); }); b.on('error', error => log({ error: error.message })); }
bot.on('mount', () => log({ mounted: bot.vehicle?.id, position: bot.vehicle?.position }));
bot.on('dismount', () => log({ dismounted: true, position: bot.entity.position }));
bot._client.on('vehicle_move', packet => { corrections++; log({ vehicleCorrection: packet }); });
const observation = setInterval(() => {
  minimumHealth = Math.min(minimumHealth, bot.health || 20);
  const rider = witness.players[bot.username]?.entity;
  if (rider?.vehicle) {
    mountedSamples++; maxWitnessX = Math.max(maxWitnessX, rider.vehicle.position.x);
    const sample = { at: new Date().toISOString(), boat: { ...rider.vehicle.position }, rider: { ...rider.position }, passengers: rider.vehicle.passengers.map(e => e.id) };
    observed.push(sample);
    if (mountedSamples % 20 === 0) log({ witness: sample });
  }
}, 100);
async function ready(b) { await new Promise(resolve => b.once('spawn', resolve)); await b.waitForChunksToLoad(); configureMovements(b); }
(async () => {
  try {
    await Promise.all([ready(bot), ready(witness)]);
    const commands = ['gamerule minecraft:spawn_mobs false', 'forceload add 192 -16 287 16',
      'fill 200 77 -8 280 85 8 air', 'fill 200 77 -8 280 80 8 stone',
      'fill 206 78 -6 270 80 6 water', `give ${bot.username} oak_planks 8`, `give ${bot.username} crafting_table 1`,
      'kill @e[type=minecraft:oak_boat,x=200,y=78,z=-8,dx=80,dy=8,dz=16]',
      `tp ${bot.username} 203.5 81 .5`, `tp ${witness.username} 236.5 81 -7.5`];
    if (process.env.BOAT_PLANTS === '1') commands.push('fill 206 78 -6 270 79 6 kelp_plant', 'fill 206 80 -6 270 80 6 kelp[age=7]');
    fs.writeFileSync(path.join(directory, 'setup.json'), JSON.stringify(commands, null, 2));
    log({ phase: 'setup', directory, username: bot.username, uuid: bot.player?.uuid, commands: path.join(directory, 'setup.json'), ready: path.join(directory, 'ready') });
    await waitFor(task, () => fs.existsSync(path.join(directory, 'ready')), 180000);
    await waitFor(task, () => countOf(bot, 'oak_planks') === 8 && bot.entity.position.distanceTo(new Vec3(203.5, 81, .5)) < 1, 10000);
    await bot.waitForChunksToLoad(); await new Promise(resolve => setTimeout(resolve, 500));
    const destination = new Vec3(276.5, 81, .5), trip = await surveyBoatTrip(bot, task, destination);
    assert(trip); log({ phase: 'survey', entry: trip.entry, landing: trip.landing, length: trip.length });
    for (const [request, expected] of [['Jev come to me across this lake', 'boat'], ['Jev swim to me, do not make or use a boat', 'walk_or_swim']]) {
      const decision = await chooseBoat(client, { request, waterBlocks: trip.length, progressBlocks: trip.progress, carriedBoat: null, inventory: inventory(bot), safeShoreAtBothEnds: true });
      log({ phase: 'decision', request, decision }); assert.equal(decision.answers.travel.choice, expected);
    }
    const goal = { kind: 'come', request: 'Jev come to me across this lake' };
    const save = () => fs.writeFileSync(path.join(directory, 'goal.json'), JSON.stringify(goal, null, 2));
    for (let i = 0; i < 16 && !goal.boatTravel?.completed; i++) {
      const worked = await boatTravelStep(bot, task, goal, save, destination, { acquireStep }, client);
      log({ step: goal.step, boat: goal.boatTravel, inventory: inventory(bot), worked });
      assert(worked, goal.boatTravel?.lastError || 'No boat action');
    }
    assert(goal.boatTravel?.completed, 'Must finish crossing and land');
    assert(bot.entity.position.x >= 271, 'Driver must reach far shore');
    assert(maxWitnessX >= 267, 'Independent observer must see server boat on far side');
    assert(mountedSamples > 20, 'Observer must see sustained actual riding');
    assert.equal(corrections, 0); assert.equal(deaths, 0); assert.equal(minimumHealth, 20);
    assert.equal(bot.vehicle, null); assert.equal(countOf(bot, 'oak_boat'), 1, 'Recover boat for reuse');
    if (process.env.BOAT_CANCEL_TRIAL === '1') {
      const { goals } = require('mineflayer-pathfinder');
      let moves = 0;
      const original = bot._client.write;
      bot._client.write = function (name, packet, ...args) {
        const result = original.call(this, name, packet, ...args);
        if (name === 'vehicle_move' && ++moves === 20) task.cancel();
        return result;
      };
      const cancelledGoal = { request: 'Jev come back across the lake', kind: 'come' };
      try {
        await assert.rejects(boatTravelStep(bot, task, cancelledGoal, () => {}, new Vec3(203.5, 81, .5), { acquireStep }, client), { name: 'Cancelled' });
        const stoppedMoves = moves;
        await new Promise(resolve => setTimeout(resolve, 350));
        assert.equal(moves, stoppedMoves); assert.equal(bot.vehicle, null);
        const continuation = new Task('walk after cancellation');
        await navigate(bot, continuation, new goals.GoalBlock(271, 81, 0), { timeoutMs: 15000, stallMs: 5000 });
        assert.equal(bot.vehicle, null); assert.equal(deaths, 0); assert.equal(bot.health, 20);
        log({ phase: 'stop and continue', result: 'PASS', movementPacketsBeforeStop: moves, position: bot.entity.position });
      } finally { bot._client.write = original; }
    }
    log({ result: 'PASS', scenario: 'craft, board, paddle, dismount and recover a boat', position: bot.entity.position,
      maxWitnessX, mountedSamples, corrections, deaths, minimumHealth, uuid: bot.player.uuid, directory });
  } catch (error) { log({ result: 'FAIL', error: error.stack, position: bot.entity?.position, maxWitnessX, mountedSamples, corrections, directory }); process.exitCode = 1; }
  finally {
    clearTimeout(timer); clearInterval(observation); fs.writeFileSync(path.join(directory, 'witness.json'), JSON.stringify(observed, null, 2));
    bot.pathfinder.setGoal(null); bot.clearControlStates(); bot.quit(); witness.quit(); setTimeout(() => process.exit(process.exitCode || 0), 500);
  }
})();
