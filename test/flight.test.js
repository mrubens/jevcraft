'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3'), { goals } = require('mineflayer-pathfinder');
const { Task, navigate } = require('../src/skills');
const { installFlight, canFly, startFlight, clearFlightSegment, surveyFlight } = require('../src/flight');
const { chooseConstructionWork, approachConstruction } = require('../src/construction-access');
const registry = require('minecraft-data')('26.1');
function fixture() {
  const Chunk = require('prismarine-chunk')(registry), World = require('prismarine-world')(registry);
  const world = new World(() => new Chunk()).sync;
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) world.setColumn(x, z, new Chunk());
  const bot = new EventEmitter(), packets = [];
  Object.assign(bot, { registry, world, blockAt: p => world.getBlock(p),
    entity: { position: new Vec3(.5, 64.05, .5), velocity: new Vec3(0, 0, 0) },
    game: { gameMode: 'creative' }, oxygenLevel: 20, physics: { gravity: .08 },
    pathfinder: { setGoal: () => {}, movements: { canDig: true, exclusionAreasPlace: [] } },
    clearControlStates: () => {}, lookAt: async () => {}, inventory: { items: () => [] },
    _client: Object.assign(new EventEmitter(), { state: 'play', write: (name, data) => packets.push({ name, ...data }) }),
  });
  installFlight(bot); bot._client.emit('abilities', { flags: 13 });
  const set = (x, y, z, name = 'stone') => world.setBlockStateId(new Vec3(x, y, z), registry.blocksByName[name].defaultState);
  return { bot, set, packets };
}

test('flight requires Creative mode and server permission, restores gravity on revocation', () => {
  const { bot, packets } = fixture();
  assert(canFly(bot)); startFlight(bot); assert.equal(bot.physics.gravity, 0);
  bot._client.emit('abilities', { flags: 1 });
  assert(!canFly(bot)); assert.equal(bot.physics.gravity, .08);
  assert.deepEqual(packets, [{ name: 'abilities', flags: 2 }, { name: 'abilities', flags: 0 }]);
  bot.game.gameMode = 'survival'; bot._client.emit('abilities', { flags: 4 });
  assert(!canFly(bot)); assert.throws(() => startFlight(bot), /not available/);
});

test('flight checks full player body, ceiling, narrow gap and unloaded chunks', () => {
  const { bot, set } = fixture();
  set(1, 65, 0);
  assert(!clearFlightSegment(bot, bot.entity.position, new Vec3(2.5, 64.05, .5)));
  assert(!clearFlightSegment(bot, new Vec3(.8, 64.05, .5)), 'body edge clips wall');
  set(0, 66, 0);
  assert(!clearFlightSegment(bot, bot.entity.position, new Vec3(.5, 65.05, .5)), 'head hits ceiling');
  assert(!clearFlightSegment(bot, new Vec3(1000, 64, 1000)), 'unknown chunks are blocked');
});

test('3D route goes over a wall without breaking it or scaffolding', async () => {
  const { bot, set } = fixture();
  for (let y = 50; y <= 70; y++) for (let z = -16; z <= 16; z++) set(2, y, z);
  const result = await surveyFlight(bot, new Task('wall'), new goals.GoalBlock(5, 64, 0), { timeoutMs: 3000 });
  assert.equal(result.status, 'success'); assert(result.path.some(p => p.y >= 71));
  let previous = bot.entity.position;
  for (const point of result.path) { assert(clearFlightSegment(bot, previous, point)); previous = point; }
});

test('Creative construction can fly to a high visible face with no inventory or walking route', async () => {
  const { bot, set } = fixture(); set(2, 74, 0);
  const point = new Vec3(2, 75, 0), task = new Task('high construction');
  const result = await chooseConstructionWork(bot, task, { buildPhase: 'build' }, [{ position: point, operation: 'place' }]);
  assert(result); assert.equal(bot.pathfinder.movements.canDig, true);
  const face = await approachConstruction(bot, task, {}, point, 'place');
  assert(face); assert(bot.entity.position.y > 68); assert.equal(bot.physics.gravity, 0);
});

test('cancellation stops motion within one tick and keeps a Creative hover', async () => {
  const { bot } = fixture(), task = new Task('cancel flight');
  const timer = setTimeout(() => task.cancel(), 100);
  await assert.rejects(navigate(bot, task, new goals.GoalBlock(0, 80, 0)), { name: 'Cancelled' });
  clearTimeout(timer);
  const stopped = bot.entity.position.clone();
  await new Promise(r => setTimeout(r, 100));
  assert(bot.entity.position.equals(stopped)); assert.equal(bot.physics.gravity, 0);
  bot.game.gameMode = 'survival'; bot.emit('game'); assert.equal(bot.physics.gravity, .08);
});

test('following replans when an airborne player moves', async () => {
  const { bot } = fixture(), task = new Task('follow flight');
  const entity = { position: new Vec3(3.5, 66.05, .5) };
  const timer = setTimeout(() => { entity.position = new Vec3(-3.5, 67.05, .5); }, 150);
  try { await navigate(bot, task, new goals.GoalFollow(entity, 1), { timeoutMs: 6000 }); }
  finally { clearTimeout(timer); }
  assert(bot.entity.position.distanceTo(entity.position) <= 1.1);
});

test('flight stops after repeated server corrections', async () => {
  const { bot } = fixture(), task = new Task('corrections');
  const timer = setInterval(() => bot.emit('forcedMove'), 80);
  try { await assert.rejects(navigate(bot, task, new goals.GoalBlock(0, 90, 0)), /server could not confirm/); }
  finally { clearInterval(timer); }
  assert.equal(bot.listenerCount('forcedMove'), 0);
});

test('flight reroutes around a block placed in its path', async () => {
  const { bot, set } = fixture(), task = new Task('changed terrain');
  let routes = 0;
  bot.on('flight_route', route => { if (route.path.length && ++routes === 1) set(2, 65, 0); });
  await navigate(bot, task, new goals.GoalBlock(4, 64, 0), { timeoutMs: 6000 });
  assert(routes >= 2); assert.equal(bot.entity.position.floored().x, 4);
  assert(clearFlightSegment(bot, bot.entity.position));
});

test('revoking permission in midair aborts flight and restores gravity', async () => {
  const { bot } = fixture(), task = new Task('permission change');
  const timer = setTimeout(() => bot._client.emit('abilities', { flags: 1 }), 100);
  try { await assert.rejects(navigate(bot, task, new goals.GoalBlock(0, 90, 0)), /permission changed/); }
  finally { clearTimeout(timer); }
  assert.equal(bot.physics.gravity, .08); assert(!bot._creativeFlight.active);
});

test('a hovering worker verifies its position without a floor beneath it', () => {
  const { supportCell } = require('../src/terrain');
  const { dryStanding } = require('../src/mining-access');
  const { bot, set } = fixture();
  const hovering = new Vec3(.5, 64.05, .5), standing = new Vec3(.5, 64, .5);
  // Flight parks the body a fraction above the block it arrived at, which rounds
  // supportCell up into the air the feet occupy instead of the block below.
  assert.equal(supportCell(hovering).y, 64, 'hover offset names the feet cell');
  assert.equal(supportCell(standing).y, 63, 'a standing body names the block below');
  assert(canFly(bot));
  assert(dryStanding(bot, hovering), 'flight needs no footing to hold a work position');
  bot._client.emit('abilities', { flags: 1 });
  assert(!canFly(bot));
  assert(!dryStanding(bot, hovering), 'without flight the missing floor still rejects');
  set(0, 63, 0);
  assert(dryStanding(bot, standing), 'ordinary walking footing is unchanged');
  bot._client.emit('abilities', { flags: 13 });
  set(0, 64, 0);
  assert(canFly(bot));
  assert(!dryStanding(bot, hovering), 'a blocked body is refused even while flying');
});
