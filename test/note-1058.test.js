'use strict';
// Note 1058: in water the shield is turned to a shot as on land, the body
// kept up by the swim's own key, while there is breath for it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { Vec3 } = require('vec3');
const reflex = require('../src/shot-reflex');

const registry = require('minecraft-data')('26.1');
const TRIDENT = registry.entitiesByName.trident.id;

// 25592's swim: the bot in a pond facing north, a drowned 20 blocks south of
// it, its trident in the air ten blocks off on a line to the body.
function swimmer({ air = 20, lava = false } = {}) {
  const calls = { raised: 0, keys: [] };
  const client = new EventEmitter();
  const bot = Object.assign(new EventEmitter(), {
    registry, _client: client, game: { dimension: 'overworld' }, health: 20, oxygenLevel: air, time: { timeOfDay: 6000 },
    entity: { id: 1, position: new Vec3(0.5, 62, 0.5), yaw: 0, pitch: 0, onGround: false, isInWater: !lava, isInLava: lava, height: 1.8, velocity: new Vec3(0, 0, 0), metadata: {} },
    entities: {}, inventory: { slots: { 45: { name: 'shield' } }, items: () => [] },
    world: { raycast: () => null },
    blockAt: p => ({ position: p, name: p.y <= 62 ? 'water' : 'air', boundingBox: 'empty' }),
    controlState: {}, pathfinder: { isBuilding: () => false, setGoal() {} },
    activateItem() { calls.raised++; }, deactivateItem() {},
    setControlState(k, on) { calls.keys.push([k, on]); this.controlState[k] = on; },
    clearControlStates() { this.controlState = {}; },
    look(yaw) { this.entity.yaw = yaw; return Promise.resolve(); }, lookAt() { return Promise.resolve(); }, attack() {},
  });
  bot.entities[9] = { id: 9, name: 'drowned', type: 'hostile', position: new Vec3(0.5, 62, 20.5), height: 1.95, width: 0.6, isValid: true, metadata: {} };
  bot.entities[10] = { id: 10, name: 'trident', type: 'projectile', position: new Vec3(0.5, 63.4, 10.5), height: 0.5, width: 0.5, isValid: true, metadata: {} };
  reflex.watchShots(bot);
  client.emit('spawn_entity', { entityId: 10, type: TRIDENT, x: 0.5, y: 63.4, z: 10.5, velocity: { x: 0, y: -0.05, z: -1.6 }, objectData: 9 });
  return { bot, calls };
}
const faces = (bot, point) => { const p = bot.entity.position, yaw = bot.entity.yaw; return (-Math.sin(yaw) * (point.x - p.x) - Math.cos(yaw) * (point.z - p.z)) / Math.hypot(point.x - p.x, point.z - p.z); };

test('swimming with its back to a drowned\'s trident in the air: the shield comes up, the face turns to it, and the swim-up key is held while the others wait', () => {
  const { bot, calls } = swimmer();
  assert.ok(faces(bot, bot.entities[9].position) < 0, 'its back to the drowned');
  bot.controlState.forward = true;
  reflex.tick(bot, null);
  assert.equal(calls.raised, 1);
  assert.ok(faces(bot, bot.entities[9].position) > 0.5, 'turned to it');
  assert.equal(bot.controlState.jump, true, 'kept afloat');
  assert.equal(bot.controlState.forward, false, 'the swim waits the flight');
});

test('a walking stance in water does not leave the shield up behind the swim: the hold faces the shot', () => {
  const { bot } = swimmer();
  bot._stance = { choice: 'retreat', at: Date.now(), until: Date.now() + 15000 };
  reflex.tick(bot, null);
  assert.ok(faces(bot, bot.entities[9].position) > 0.5);
  assert.equal(bot._shotHold.free, false);
});

test('short of breath under water, or in lava, the shot is not held for, and why is kept', () => {
  for (const [why, opts] of [[/short of breath/, { air: 5 }], [/in lava/, { lava: true }]]) {
    const { bot, calls } = swimmer(opts);
    reflex.tick(bot, null);
    assert.equal(calls.raised, 0, String(why));
    assert.match(bot._shotRefused?.why || '', why);
  }
});
