'use strict';
// Note 1295: one of the twelve chosen for the second bearing, none carried:
// it is taken out of the chest the twelve are kept in. 25592 (2026-10-05
// 01:30 to 14:30Z) was told 'needs another spare Eye of Ender' for thirteen hours.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const reg = require('minecraft-data')('26.1');

test('throw_one chosen and the twelve in the chest: the step is one eye out of it, not blocked', async () => {
  const items = [{ name: 'cobblestone', count: 64, type: reg.itemsByName.cobblestone.id, slot: 9 }];
  const chestItems = [{ name: 'ender_eye', count: 12, type: reg.itemsByName.ender_eye.id }];
  const bot = { registry: reg, version: '26.1', game: { gameMode: 'survival', dimension: 'overworld' }, time: { timeOfDay: 6000 }, entity: { position: new Vec3(19.5, 72, 122.5), onGround: true }, entities: {},
    findBlocks: () => [], inventory: { items: () => items.filter(i => i.count > 0), slots: [] }, health: 20, food: 20, oxygenLevel: 20,
    blockAt: p => ({ name: Math.floor(p.x) === 18 && Math.floor(p.y) === 71 && Math.floor(p.z) === 123 ? 'chest' : p.y >= 72 ? 'air' : 'stone', position: p, boundingBox: p.y >= 72 ? 'empty' : 'block' }) };
  const window = { containerItems: () => chestItems.filter(i => i.count > 0), withdraw: async (type, meta, n) => { chestItems[0].count -= n; items.push({ name: 'ender_eye', count: n, type, slot: 10 }); }, close() {} };
  require('../src/chest-delivery').openChest = async () => window;
  const surface = require('../src/surface'); const was = surface.surfaceReturnComplete;
  const goal = { kind: 'win', eyeBank: { at: 1, chestAt: { x: 18, y: 71, z: 123 }, forSearch: true },
    rodStashes: [{ position: { x: 18, y: 71, z: 123 }, dimension: 'overworld', contents: { ender_eye: 12 } }],
    strongholdSearch: { bearings: [{ origin: { x: -200, y: 72, z: 122 }, end: { x: -196, y: 80, z: 133 }, direction: { x: 0.36, y: 0, z: 0.93 } }], throws: 1, moves: 28, visited: {}, estimate: null, spare: { pick: 'throw_one', at: 1, target: 11 } } };
  const { findStronghold } = require('../src/stronghold');
  const task = { check() {} };
  let navigated = 0;
  await findStronghold(bot, task, goal, () => {}, { navigate: async () => { navigated++; }, explore: async () => {}, tunnel: async () => {}, surfaceStep: async () => {} }, null).catch(err => { throw err; });
  assert.equal(goal.step?.action, 'eye_from_chest', JSON.stringify(goal.step));
  assert.equal(items.find(i => i.name === 'ender_eye')?.count, 1, 'one eye taken out');
  assert.equal(chestItems[0].count, 11, 'eleven left for the portal');
  surface.surfaceReturnComplete = was;
});

test('a withdraw that failed with the stack on the cursor: it goes back into the chest before the window closes (note 1322)', async () => {
  const { putBackHeld } = require('../src/rod-stash');
  const clicks = [];
  const window = { inventoryStart: 27, slots: Array(63).fill(null), selectedItem: { type: 9, count: 11, name: 'ender_eye', stackSize: 16 } };
  window.slots[0] = { type: 9, count: 16, stackSize: 16 }; // full stack of the same: not that slot
  const bot = { clickWindow: async (slot) => { clicks.push(slot); window.selectedItem = null; } };
  assert.equal(await putBackHeld(bot, window), true);
  assert.deepEqual(clicks, [1], 'the first empty chest slot');
  assert.equal(await putBackHeld(bot, window), false, 'nothing held, nothing done');
});
