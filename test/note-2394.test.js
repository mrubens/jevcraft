'use strict';
// Note 2394. full-23 (25592, 2026-10-28 15:50 to 15:53Z) came back to 39 of its drops floating on a pool and took
// none: the pickup walked the pool's floor until 'Low air', and the work loop swam it to the shore before each pass.
// The arena's drill (scripts/walkback-drill.js DRILL_WATER=1): 4 of 19 before, 75 of 76 over four runs after.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { atOwnDropsInWater } = require('../src/work');
const { collectNearbyDrops } = require('../src/drop-collection');

test('at its own drops in this dimension the walk back is not sent to the shore; elsewhere it is (note 2394)', () => {
  const bot = { game: { dimension: 'overworld' }, entity: { position: new Vec3(-336, 61, 268) } };
  const goal = { corpseRun: { status: 'open', dimension: 'overworld', position: { x: -333, y: 61, z: 269 } } };
  assert.equal(atOwnDropsInWater(bot, goal), true);
  assert.equal(atOwnDropsInWater({ ...bot, entity: { position: new Vec3(-300, 61, 268) } }, goal), false, '33 off');
  assert.equal(atOwnDropsInWater({ ...bot, game: { dimension: 'the_nether' } }, goal), false);
  assert.equal(atOwnDropsInWater(bot, { corpseRun: { ...goal.corpseRun, status: 'despawned' } }), false);
});

test('a drop floating in water is swum to, not walked to along the floor (note 2394)', async () => {
  const controls = [];
  let held = 0;
  const drop = { id: 7, name: 'item', isValid: true, position: new Vec3(5.5, 62.5, 0.5), getDroppedItem: () => ({ name: 'iron_sword', count: 1 }) };
  const bot = { entity: { position: new Vec3(0.5, 62, 0.5) }, entities: { 7: drop }, oxygenLevel: 20, game: { dimension: 'overworld' },
    blockAt: p => ({ name: p.y <= 62 && p.y >= 59 ? 'water' : p.y < 59 ? 'stone' : 'air', position: p, boundingBox: p.y < 59 ? 'block' : 'empty' }),
    inventory: { items: () => (held ? [{ name: 'iron_sword', count: 1 }] : []), slots: [] },
    pathfinder: { movements: { scafoldingBlocks: [] } },
    lookAt: async () => {}, setControlState: (k, v) => { controls.push([k, v]); if (k === 'forward' && v) { bot.entity.position.x += 1; if (bot.entity.position.x >= 5) { held = 1; delete bot.entities[7]; } } },
    clearControlStates() {} };
  const got = await collectNearbyDrops(bot, { check() {} }, 'iron_sword', { origin: new Vec3(0.5, 62, 0.5), radius: 12, timeoutMs: 5000, hostilesOk: true,
    move: async () => assert.fail('walked') });
  assert.equal(got, true);
  assert(controls.some(([k, v]) => k === 'jump' && v), 'jump held to stay at the surface');
});

test('with no room in the pockets for a drop worth carrying, room is made before it is walked to (note 2403)', async () => {
  const tidy = require('../src/inventory-tidy');
  const calls = [];
  const was = { roomFor: tidy.roomFor, makeRoom: tidy.makeRoom };
  tidy.roomFor = () => false; tidy.makeRoom = async (b, t, name) => { calls.push(name); return true; };
  try {
    const drop = { id: 9, name: 'item', isValid: true, position: new Vec3(3.5, 64, 0.5), getDroppedItem: () => ({ name: 'raw_iron', count: 1 }) };
    const bot = { entity: { position: new Vec3(0.5, 64, 0.5) }, entities: { 9: drop }, oxygenLevel: 20, game: { dimension: 'overworld' },
      blockAt: p => ({ name: p.y < 64 ? 'stone' : 'air', position: p, boundingBox: p.y < 64 ? 'block' : 'empty' }),
      inventory: { items: () => [], slots: [] }, pathfinder: { movements: { scafoldingBlocks: [] }, getPathTo: () => ({ status: 'noPath', path: [] }), setGoal() {} } };
    await collectNearbyDrops(bot, { check() {} }, 'raw_iron', { origin: bot.entity.position.clone(), radius: 8, timeoutMs: 300, hostilesOk: true, move: async () => {} });
    assert.deepEqual(calls, ['raw_iron']);
    calls.length = 0;
    drop.getDroppedItem = () => ({ name: 'dirt', count: 1 });
    await collectNearbyDrops(bot, { check() {} }, 'dirt', { origin: bot.entity.position.clone(), radius: 8, timeoutMs: 300, hostilesOk: true, move: async () => {} });
    assert.deepEqual(calls, [], 'not for dirt');
  } finally { Object.assign(tidy, was); }
});
