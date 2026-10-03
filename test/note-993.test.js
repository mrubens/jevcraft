'use strict';
// Note 993: the hunt makes room for its own drop. 25593 killed blazes for ten
// minutes with its 36 slots full of other things and their rods lying beside it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { roomForDrop } = require('../src/mob-hunt');
const { Task } = require('../src/skills');

function fullBot() {
  const registry = require('minecraft-data')('26.1');
  const names = ['raw_copper', 'lapis_lazuli', 'egg', 'white_wool', 'gray_wool', 'light_gray_wool', 'bone', 'string', 'flint', 'leather', 'wooden_hoe', 'gold_nugget', 'shroomlight', 'oak_fence', 'nether_brick_fence', 'dirt', 'gravel', 'rotten_flesh'];
  const items = Array.from({ length: 36 }, (_, i) => { const name = names[i % names.length]; return { name, type: registry.itemsByName[name].id, count: 5, stackSize: registry.itemsByName[name].stackSize, slot: 9 + i }; });
  const tossed = [];
  const bot = { registry, game: { dimension: 'the_nether', gameMode: 'survival' }, health: 20, food: 20, entities: {}, entity: { position: new Vec3(0.5, 64, 0.5), yaw: 0, pitch: 0 },
    inventory: { items: () => items.filter(i => i.count > 0), emptySlotCount: () => 36 - items.filter(i => i.count > 0).length, slots: {} },
    tossStack: async stack => { tossed.push(stack.name); stack.count = 0; }, toss: async (type, meta, count) => { const st = items.find(i => i.type === type && i.count > 0); if (st) { tossed.push(st.name); st.count = 0; } },
    lookAt: async () => {}, look: async () => {}, blockAt: () => ({ name: 'air', boundingBox: 'empty' }) };
  return { bot, tossed };
}

test('with the pockets full and no rod among them, room is made for the rod hunted; with room, nothing is thrown', async () => {
  const { bot, tossed } = fullBot();
  const goal = { kind: 'win', mobHunt: { item: 'blaze_rod', entity: 'blaze' } };
  assert.equal(require('../src/inventory-tidy').roomFor(bot, 'blaze_rod'), false);
  await roomForDrop(bot, new Task('hunt'), goal, 'blaze_rod');
  assert.ok(tossed.length >= 1, `something thrown: ${tossed}`);
  assert.equal(require('../src/inventory-tidy').roomFor(bot, 'blaze_rod'), true);
  const n = tossed.length;
  await roomForDrop(bot, new Task('hunt'), goal, 'blaze_rod');
  assert.equal(tossed.length, n, 'room already: nothing more thrown');
});
