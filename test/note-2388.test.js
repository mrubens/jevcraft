'use strict';
// Note 2388. full-23 (25592, 2026-10-28 15:48:13 to 15:48:22Z): offered
// shield_the_blast at "about 0 damage" three times with a witch and
// skeletons in sight, took it each time, and went from 12.4 health to 1.4;
// "Jev was killed by Witch using magic". The others about are priced over
// the hold, the shield facing the creeper, a witch's potion not stopped.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('node:events');

const T0 = Date.parse('2026-10-28T15:48:13Z');
function bot(withWitch) {
  const creeper = { id: 90, name: 'creeper', type: 'hostile', position: new Vec3(5.1, 64, 0.5), height: 1.7, width: 0.6, isValid: true, metadata: [] };
  const witch = { id: 91, name: 'witch', type: 'hostile', position: new Vec3(0.5, 64, 7.5), height: 1.95, width: 0.6, isValid: true, metadata: [] };
  const entities = withWitch ? { 90: creeper, 91: witch } : { 90: creeper };
  const b = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, health: 12.4, food: 20, oxygenLevel: 20,
    entities, time: { timeOfDay: 6000 }, registry: require('minecraft-data')('26.1'),
    entity: { position: new Vec3(0.5, 64, 0.5), yaw: 0, eyeHeight: 1.62, onGround: true, width: 0.6, height: 1.8, velocity: new Vec3(0, 0, 0), metadata: [0] },
    inventory: { items: () => [{ name: 'iron_sword', count: 1 }, { name: 'shield', count: 1 }], slots: {}, emptySlotCount: () => 10 },
    blockAt: p => { const f = p.floored(); const s = f.y < 64; return { position: f, name: s ? 'stone' : 'air', boundingBox: s ? 'block' : 'empty', diggable: s, shapes: s ? [[0, 0, 0, 1, 1, 1]] : [] }; },
    world: { raycast: () => null }, findBlocks: () => [], lookAt: async () => {}, look: async () => {}, equip: async () => {}, attack() {} });
  const threats = Object.values(entities).map(e => ({ entity: e, distance: e.position.distanceTo(b.entity.position), visible: true }));
  return { b, threats };
}
const offer = withWitch => {
  const { Survival } = require('../src/survival');
  const { Task } = require('../src/skills');
  const { b, threats } = bot(withWitch);
  const survival = new Survival(b, { navigate: async () => {} }, { state: { shelters: [] } });
  return survival.stanceOptions(new Task('x'), {}, () => {}, threats, false).shield_the_blast;
};

test('with a witch in sight, the shield held to a creeper is priced with the witch\'s potions over the hold, not at 0 (full-23, note 2388)', t => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const alone = offer(false);
  assert(alone, 'offered for a creeper alone');
  assert.equal(alone.expects.damage, 0, 'the creeper alone, blocked, is 0');
  const both = offer(true);
  assert(both.expects.damage > 0, `priced ${both.expects.damage}`);
  assert.match(both.description, /from the others about while the shield is held/);
  assert.match(both.description, /a witch's potion is not stopped by a shield/);
});
