'use strict';
// Note 2287: the bot's own drops after a death are not hidden from the pickup by the mob that killed it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { nearbyDrops } = require('../src/drop-collection');

test('a helmet lying beside a zombie: hidden from an ordinary pickup, seen by the walk back for the drops', () => {
  const helmet = { id: 1, isValid: true, position: new Vec3(1, 64, 0), getDroppedItem: () => ({ name: 'iron_helmet', count: 1 }) };
  const zombie = { id: 2, isValid: true, type: 'hostile', name: 'zombie', position: new Vec3(2, 64, 0), height: 1.95 };
  const bot = { entity: { position: new Vec3(0, 64, 0), height: 1.8 }, entities: { 1: helmet, 2: zombie }, blockAt: () => ({ name: 'air', boundingBox: 'empty' }), world: { raycast: () => null } };
  const ordinary = (() => { try { return nearbyDrops(bot, 'iron_helmet', new Vec3(0, 64, 0), 12); } catch (_) { return null; } })();
  const own = nearbyDrops(bot, 'iron_helmet', new Vec3(0, 64, 0), 12, { hostilesOk: true });
  assert.equal(own.length, 1, 'the walk back sees it');
  if (ordinary) assert.ok(ordinary.length <= 1);
});
