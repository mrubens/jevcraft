'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('node:events'), { Vec3 } = require('vec3');
const { boatWater, surveyBoatTrip, boatTick, paddle, preferredBoat, leaveBoat } = require('../src/boats');
const { Task } = require('../src/skills');
function lake(width = 40) {
  return { game: { dimension: 'overworld', gameMode: 'survival' }, health: 20, food: 20, entities: {},
    entity: { position: new Vec3(0.5, 65, .5) },
    blockAt(p) { const water = p.y === 64 && p.x >= 3 && p.x < 3 + width && Math.abs(p.z) < 6;
      return { name: water ? 'water' : p.y < 65 ? 'stone' : 'air', boundingBox: water || p.y >= 65 ? 'empty' : 'block', getProperties: () => ({ level: 0 }) }; },
    pathfinder: { movements: {}, getPathTo: () => ({ status: 'success', path: [] }) },
  };
}
test('boats need wide source water, headroom, known chunks and no damaging floor', () => {
  for (const obstruction of ['stone', 'lava', 'bubble_column', 'ice', null]) {
    const bot = lake(), original = bot.blockAt;
    bot.blockAt = p => p.x === 5 && p.z === 1 && p.y === 64 ? obstruction && { name: obstruction } : original(p);
    assert.equal(boatWater(bot, new Vec3(4.5, 64, .5), 64), false, String(obstruction));
  }
  const bot = lake();
  assert(boatWater(bot, new Vec3(5.5, 64, .5), 64));
  const original = bot.blockAt; bot.blockAt = p => ({ ...original(p), getProperties: () => ({ level: 1 }) });
  assert.equal(boatWater(bot, new Vec3(5.5, 64, .5), 64), false);
});
test('survey finds a long crossing with safe shores but rejects a puddle and damaged swimmers', async () => {
  const task = new Task('survey'), bot = lake();
  const trip = await surveyBoatTrip(bot, task, new Vec3(48.5, 65, .5));
  assert(trip?.length >= 30); assert(trip.landing.x >= 43);
  assert.equal(await surveyBoatTrip(lake(5), task, new Vec3(48.5, 65, .5)), null);
  bot.health = 8; assert.equal(await surveyBoatTrip(bot, task, new Vec3(48.5, 65, .5)), null);
});

test('boats cross source water containing aquatic plants but never waterlogged solids', () => {
  for (const name of ['kelp', 'kelp_plant', 'seagrass', 'tall_seagrass', 'oak_slab']) {
    const bot = lake(), read = bot.blockAt;
    bot.blockAt = p => {
      const block = read(p);
      return block.name === 'water' ? { ...block, name, metadata: 7, getProperties: () => ({ age: 7, waterlogged: true }) } : block;
    };
    assert.equal(boatWater(bot, new Vec3(5.5, 64, .5), 64), name !== 'oak_slab', name);
  }
});
test('water physics accelerates and coasts within ordinary boat speed', () => {
  let s = { x: 0, y: 64.64, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, rotation: 0 };
  for (let i = 0; i < 200; i++) {
    s = boatTick(s, { forward: true, backward: false, left: false, right: false }, 65);
    assert(Math.hypot(s.vx, s.vz) < .401); assert(s.y > 64.5 && s.y < 65);
  }
  const speed = s.vz;
  for (let i = 0; i < 30; i++) s = boatTick(s, { forward: false, backward: false, left: false, right: false }, 65);
  assert(s.vz < speed / 10);
});
test('a stopped paddling task sends no movement and removes its correction listener', async () => {
  const bot = lake(); bot._client = new EventEmitter(); let writes = 0; bot._client.write = () => writes++;
  const boat = { position: new Vec3(5.5, 64.64, .5), yaw: 0 }; bot.vehicle = boat;
  const task = new Task('cancel'); task.cancel();
  await assert.rejects(paddle(bot, task, boat, { waterY: 64, path: [new Vec3(5.5, 64, .5), new Vec3(30.5, 64, .5)] }), { name: 'Cancelled' });
  assert.equal(writes, 0); assert.equal(bot._client.listenerCount('vehicle_move'), 0);
});

test('paddling follows a bend without getting stuck on skipped waypoints and reaches the landing', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const bot = lake();
  bot.blockAt = p => ({ name: p.y === 64 ? 'water' : p.y < 64 ? 'stone' : 'air',
    boundingBox: p.y < 64 ? 'block' : 'empty', getProperties: () => ({ level: 0 }) });
  const boat = { position: new Vec3(5.5, 64.64, 5.5), yaw: Math.PI * 1.5 };
  bot.vehicle = boat; bot._client = new EventEmitter(); bot._client.write = () => {};
  const path = [];
  for (let x = 5; x <= 65; x++) path.push(new Vec3(x + .5, 64, 5.5));
  for (let z = 4; z >= -25; z--) path.push(new Vec3(65.5, 64, z + .5));
  let done = false, failure;
  const samples = [];
  const result = paddle(bot, new Task('bent river'), boat, { waterY: 64, path }, row => samples.push(row)).then(() => { done = true; }, e => { failure = e; done = true; });
  for (let tick = 0; tick < 1805 && !done; tick++) { t.mock.timers.tick(50); await Promise.resolve(); }
  await result;
  assert.equal(failure, undefined, JSON.stringify({ error: failure?.message, position: boat.position, samples: samples.slice(-4) }));
  assert(Math.hypot(boat.position.x - 65.5, boat.position.z + 24.5) < 1.1);
  assert.equal(bot._client.listenerCount('vehicle_move'), 0);
});

test('paddling stops after a server correction, changed water or cancellation during travel', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  for (const kind of ['correction', 'obstacle', 'cancel']) {
    const bot = lake(), task = new Task(kind), read = bot.blockAt;
    let changed = false, moves = 0, done = false, failure;
    bot.blockAt = p => changed && p.y === 64 ? { name: 'stone', boundingBox: 'block' } : read(p);
    const boat = { position: new Vec3(5.5, 64.64, .5), yaw: Math.PI * 1.5 };
    bot.vehicle = boat; bot._client = new EventEmitter();
    bot._client.write = name => {
      if (name !== 'vehicle_move' || ++moves !== 20) return;
      if (kind === 'correction') bot._client.emit('vehicle_move', {});
      if (kind === 'obstacle') changed = true;
      if (kind === 'cancel') task.cancel();
    };
    const path = Array.from({ length: 30 }, (_, i) => new Vec3(5.5 + i, 64, .5));
    const result = paddle(bot, task, boat, { waterY: 64, path }).then(() => { done = true; }, e => { failure = e; done = true; });
    for (let tick = 0; tick < 1805 && !done; tick++) { t.mock.timers.tick(50); await Promise.resolve(); }
    await result;
    assert.match(failure?.message || '', kind === 'correction' ? /Server corrected/ : kind === 'obstacle' ? /blocked or unsafe/ : /cancelled/);
    assert.equal(moves, 20, kind); assert.equal(bot._client.listenerCount('vehicle_move'), 0);
  }
});
test('an interrupted crossing is not spent from the boat failure budget', async () => {
  const { boatTravelStep } = require('../src/boats');
  const registry = require('minecraft-data')('26.1');
  const states = [];
  const client = { systemOne: async ({ state }) => { states.push(state); return { answers: { travel: { choice: 'boat' } } }; } };
  const prepared = bot => { bot.registry = registry; bot.inventory = { items: () => [] }; return bot; };
  const destination = new Vec3(48.5, 65, .5);

  // A stop or an air emergency during the supply trip must leave the route's
  // reputation intact: neither says the crossing itself is unusable.
  for (const kind of ['Cancelled', 'NeedsAir']) {
    const goal = {}, task = new Task('cross');
    const acquireStep = async () => {
      if (kind === 'Cancelled') { task.cancel(); task.check(); }
      throw Object.assign(new Error('drowning'), { name: kind });
    };
    await assert.rejects(boatTravelStep(prepared(lake(200)), task, goal, () => {}, destination, { acquireStep }, client), { name: kind });
    assert.equal(goal.boatTravel.failures, undefined, kind);
    assert.equal(require('../src/progress').isSetAside(goal, 'boat', 'crossing'), false, kind);
    assert.match(goal.boatTravel.preparing || '', /_boat$/, kind);
  }

  // A real preparation failure still spends the budget and retires boats.
  const goal = {}, task = new Task('cross');
  const acquireStep = async () => { throw new Error('no wood anywhere'); };
  for (let attempt = 0; attempt < 2; attempt++) {
    const bot = prepared(lake(200));
    assert.equal(await boatTravelStep(bot, task, goal, () => {}, destination, { acquireStep }, client), false);
    if (attempt === 0) require('../src/progress').attemptsFor(goal).clear('boat', 'crossing'); // Skip the ordinary cooldown for this check.
  }
  assert.equal(goal.boatTravel.failures, 2);
  assert(require('../src/progress').attemptsFor(goal).entries['boat:crossing'].until > Date.now() + 20 * 60000, 'two failures rest boats for half an hour');
  assert.equal(await boatTravelStep(prepared(lake(200)), task, goal, () => {}, destination, { acquireStep }, client), false);
  // The decision audit: the swim a boat would save, as time.
  assert(states.length && states.every(s => s.swimSecondsWithoutBoat === Math.round(s.waterBlocks / 2)), JSON.stringify(states[0]));
});

test('carried boats are reused and crafting chooses wood already in inventory', () => {
  const bot = { registry: require('minecraft-data')('26.1'), inventory: { items: () => [{ name: 'birch_planks', count: 8 }] } };
  assert.equal(preferredBoat(bot), 'birch_boat');
  bot.inventory.items = () => [{ name: 'cherry_boat', count: 1 }, { name: 'birch_planks', count: 8 }];
  assert.equal(preferredBoat(bot), 'cherry_boat');
});
test('modern dismount sends sneak and waits for the observed detach', async () => {
  const writes = [], bot = { vehicle: {}, supportFeature: () => true, _client: { write: (name, packet) => {
    writes.push([name, packet]); if (packet.inputs?.shift) bot.vehicle = null;
  } } };
  await leaveBoat(bot);
  assert(writes.some(([name, p]) => name === 'player_input' && p.inputs.shift));
  assert(!writes.some(([, p]) => p.inputs?.jump));
});

test('resuming navigation clears an owned empty boat but leaves occupied and other players boats alone', async () => {
  const { clearOwnedBoatAtFeet } = require('../src/boats'), origin = new Vec3(5.5, 64.6, .5);
  const own = { id: 1, uuid: 'owned', position: origin, passengers: [] };
  const occupied = { id: 2, uuid: 'occupied', position: origin, passengers: [{ id: 10 }] };
  const stranger = { id: 3, uuid: 'someone-elses', position: origin, passengers: [] };
  const bot = { entity: { position: origin }, _ownedBoats: new Set(['owned', 'occupied']), entities: { 1: own, 2: occupied, 3: stranger },
    attack(e) { assert.equal(e, own); delete this.entities[e.id]; } };
  await clearOwnedBoatAtFeet(bot, new Task('continue'));
  assert.equal(bot.entities[1], undefined); assert.equal(bot.entities[2], occupied); assert.equal(bot.entities[3], stranger);
});

test('sitting in a boat between work passes, the bot gets out', async () => {
  // mid-218-e: restarted in its boat, no physics for a rider, and a spider killed it where it sat.
  const { leaveStrandedVehicle } = require('../src/boats');
  const written = [];
  const bot = { vehicle: { id: 7 }, supportFeature: () => true, _client: { write: (name, data) => { written.push(name); if (name === 'player_input' && data.inputs.shift) setTimeout(() => { bot.vehicle = null; }, 20); } } };
  assert.equal(await leaveStrandedVehicle(bot), true);
  assert.equal(bot.vehicle, null);
  assert(written.includes('player_input'));
  assert.equal(await leaveStrandedVehicle({ vehicle: null }), false);
});

test('seated by the server before the boat is known, the bot still gets out', async () => {
  // mid-218-h: the seat came before the boat on joining; bot.vehicle was nothing, and it sat thirteen minutes until a zombie killed it.
  const { leaveStrandedVehicle } = require('../src/boats');
  const written = [];
  const bot = { vehicle: null, _seatedIn: 42, supportFeature: () => true, _client: { write: (name, data) => { written.push([name, data.inputs]); if (name === 'player_input' && data.inputs.shift) setTimeout(() => { bot._seatedIn = null; }, 20); } } };
  assert.equal(await leaveStrandedVehicle(bot), true);
  assert.equal(bot._seatedIn, null);
  assert.deepEqual(written.map(w => w[0]), ['player_input', 'player_input'], 'shift down, then let go');
});

test('on the way back to a portal across water, the boat is offered, and a way refused says why', async () => {
  // mid-229-k walked the shore of a lake eighty blocks across for twenty minutes with an oak boat in its pack; its error said "undefined" (2026-09-27).
  const { walkToKnownPortal } = require('../src/work');
  const { setAside } = require('../src/progress');
  const bot = Object.assign(new EventEmitter(), lake(200), { registry: require('minecraft-data')('26.1'), oxygenLevel: 20,
    inventory: { items: () => [{ name: 'oak_boat', count: 1 }] }, world: { raycast: () => null },
    clearControlStates() {}, setControlState() {}, stopDigging() {} });
  bot.pathfinder = { ...bot.pathfinder, setGoal() {}, isMoving: () => false, goto: async () => { throw Object.assign(new Error('No path'), { name: 'NoPath' }); } };
  const asked = [];
  const task = new Task('back');
  // The boat's question, then the way's (portal_way, note 495): other work till the staircase's rest ends.
  task.opportunityClient = { systemOne: async ({ state, questions }) => {
    if (questions?.branch_0) return { answers: { branch_0: { choice: 'wait_rest', confidence: 0.9 } } };
    asked.push(state); return { answers: { travel: { choice: 'swim' } } };
  } };
  const goal = { portals: [{ x: 120, y: 65, z: 0, dimension: 'overworld' }] };
  setAside(goal, 'staircase', { x: 120, y: 64, z: 0 }, 'lava or water underfoot', 600000);
  await assert.rejects(walkToKnownPortal(bot, task, goal, () => {}, 'overworld'), err => !/undefined/.test(err.message) && /lava or water underfoot/.test(err.message));
  assert.equal(asked.length, 1, 'the boat was Jev\'s to choose');
  assert(asked[0].waterBlocks >= 30);
  assert.equal(asked[0].carriedBoat, 'oak_boat');
});

test('the walk, the boat and the staircase to the portal all failed: the way is Jev\'s, a portal here, round, the boat again or other work, asked once from each place', async () => {
  // mid-202-o-nether-3 (note 495): 374 blocks from its Overworld portal at (268, 103, 134) across water, the boat's route
  // "blocked or unsafe", the staircase "no floor 2, lava or water underfoot 2": "No way back" thrown at every pass till the
  // run ended, a lava pool known and a bucket carried.
  const { walkToKnownPortal } = require('../src/work');
  const { setAside, isSetAside } = require('../src/progress');
  const bot = Object.assign(new EventEmitter(), lake(200), { registry: require('minecraft-data')('26.1'), oxygenLevel: 20, time: { timeOfDay: 6000 },
    inventory: { items: () => [{ name: 'bucket', count: 1 }, { name: 'water_bucket', count: 1 }, { name: 'flint_and_steel', count: 1 }, { name: 'cobblestone', count: 64 }] },
    world: { raycast: () => null }, findBlocks: () => [], clearControlStates() {}, setControlState() {}, stopDigging() {} });
  bot.pathfinder = { ...bot.pathfinder, setGoal() {}, isMoving: () => false, goto: async () => { throw Object.assign(new Error('No path'), { name: 'NoPath' }); } };
  const asked = [], picks = ['wait_rest', 'portal_here'];
  const task = new Task('back');
  task.opportunityClient = { systemOne: async ({ state, questions }) => { asked.push({ state, options: questions.branch_0.criteria }); return { answers: { branch_0: { choice: picks.shift(), confidence: 0.9 } } }; } };
  const goal = { portals: [{ x: 120, y: 65, z: 0, dimension: 'overworld' }], boatTravel: { attempts: 0, failures: 1, lastError: 'Boat route is blocked or unsafe' } };
  setAside(goal, 'boat', 'crossing', 'Boat route is blocked or unsafe', 60000);
  setAside(goal, 'staircase', { x: 120, y: 64, z: 0 }, 'no safe step toward it from (0, 65, 0) (no floor 2, lava or water underfoot 2)', 600000);
  const pass = () => walkToKnownPortal(bot, task, goal, () => {}, 'overworld');
  await assert.rejects(pass(), err => err.name === 'WaysResting' && /Jev chose other work until then/.test(err.message));
  assert.equal(asked.length, 1, 'the way is Jev\'s, not "No way back" thrown');
  const { options, state } = asked[0];
  assert.deepEqual(Object.keys(options).sort(), ['around_left', 'around_right', 'boat_again', 'portal_here', 'wait_rest']);
  const said = /The overworld portal at \(120, 65, 0\) is 120 blocks off and cannot be reached from here: legs of thirty-two blocks on foot toward it made no ground(, and rest two minutes)?; the boat was tried and failed \(Boat route is blocked or unsafe\), and rests; and the staircase toward it is set aside \(no safe step toward it from \(0, 65, 0\) \(no floor 2, lava or water underfoot 2\)\), taken up again in 10 minutes\./;
  await assert.rejects(pass(), err => err.name === 'WaysResting' && said.test(err.message));
  assert.equal(asked.length, 1, 'met again from the same place in the same rest: every way resting, said, not asked again');
  assert.match(options.portal_here, /Make a portal here instead and pass this one over for half an hour/);
  assert.match(options.portal_here, /1 bucket and a water bucket carried; no lava known\)\. A lighter is carried\./);
  assert.match(options.boat_again, /the boat was tried and failed \(Boat route is blocked or unsafe\)/);
  assert.match(options.wait_rest, /in 10 minutes/);
  assert.match(state.between, /On the straight line toward it, of the 96 blocks loaded: 94 over water, 2 on ground\./);
  // From another place: asked again, and a portal made here passes the one out of reach over.
  bot.entity.position = new Vec3(0.5, 65, 20.5);
  assert.equal(await pass(), false, 'on to making a portal (portalStep)');
  assert.equal(asked.length, 2);
  assert(isSetAside(goal, 'portal_passed', { x: 120, y: 65, z: 0 }));
  assert.equal(await pass(), false, 'the one passed over is not made for again');
  assert.equal(asked.length, 2);
});
