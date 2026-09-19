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
