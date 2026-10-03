'use strict';
// Note 1111: the wait for one blaze ends when a mob that bites comes within reach.
// 25584 (2026-10-03 20:46:07 to 20:46:15Z): awaiting a blaze six blocks off while a wither skeleton struck four times, 20 health to 3, no question asked.
const test = require('node:test');
const assert = require('node:assert');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('events');
const { riseOrAwait, biterInReach } = require('../src/blaze-stand');

function world(mobs) {
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival' }, health: 20, food: 20,
    entity: { position: new Vec3(0.5, 64, 0.5), height: 1.8, onGround: true, velocity: new Vec3(0, 0, 0) }, entities: Object.fromEntries(mobs.map(m => [m.id, m])),
    inventory: { items: () => [{ name: 'iron_sword', count: 1 }], slots: [] }, world: { raycast: () => null },
    blockAt: p => ({ name: p.y < 64 ? 'nether_bricks' : 'air', position: p, boundingBox: p.y < 64 ? 'block' : 'empty' }),
    lookAt: async () => {}, setControlState() {}, clearControlStates() {}, activateItem() {}, deactivateItem() {}, attack() {}, equip: async () => {} });
  return bot;
}
const blaze = { id: 7, name: 'blaze', type: 'hostile', position: new Vec3(6.5, 65, 0.5), height: 1.8, width: 0.6, isValid: true };
const task = { check() {} };

test('a wither skeleton at arm\'s length ends the wait for the blaze, said as that; with none about the wait runs (note 1111)', async () => {
  const skeleton = { id: 9, name: 'wither_skeleton', type: 'hostile', position: new Vec3(2.5, 64, 0.5), height: 2.4, width: 0.7, isValid: true };
  const beset = world([blaze, skeleton]);
  assert.equal(biterInReach(beset, blaze)?.entity.name, 'wither_skeleton');
  await assert.rejects(riseOrAwait(beset, task, {}, () => {}, { kind: 'await', site: { target: 7 } }, { seconds: 1 }),
    err => err.name === 'StanceFailed' && /a wither skeleton came within [\d.]+ blocks while the blaze was awaited/.test(err.message));
  const alone = world([blaze]);
  assert.equal(biterInReach(alone, blaze), null);
  assert.equal(await riseOrAwait(alone, task, {}, () => {}, { kind: 'await', site: { target: 7 } }, { seconds: 0.4 }), true);
});
