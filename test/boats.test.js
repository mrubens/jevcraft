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
  const client = { systemOne: async () => ({ answers: { travel: { choice: 'boat' } } }) };
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
    assert.equal(goal.boatTravel.retryAfter, undefined, kind);
    assert.match(goal.boatTravel.preparing || '', /_boat$/, kind);
  }

  // A real preparation failure still spends the budget and retires boats.
  const goal = {}, task = new Task('cross');
  const acquireStep = async () => { throw new Error('no wood anywhere'); };
  for (let attempt = 0; attempt < 2; attempt++) {
    const bot = prepared(lake(200));
    assert.equal(await boatTravelStep(bot, task, goal, () => {}, destination, { acquireStep }, client), false);
    delete goal.boatTravel.retryAfter; // Skip the ordinary cooldown for this check.
  }
  assert.equal(goal.boatTravel.failures, 2);
  assert.equal(await boatTravelStep(prepared(lake(200)), task, goal, () => {}, destination, { acquireStep }, client), false);
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
