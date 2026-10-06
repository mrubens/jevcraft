'use strict';
// Note 1356: a full pack with a chest carried is offered the chest put down
// and the stacks needed least left in it, nothing dropped, the chest
// remembered as a cache.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');

function pockets(list) {
  const items = [];
  for (const [name, count] of list) { const it = registry.itemsByName[name]; items.push({ name, count, type: it.id, stackSize: it.stackSize }); }
  while (items.length < 36) { const it = registry.itemsByName.diorite; items.push({ name: 'diorite', count: 1, type: it.id, stackSize: it.stackSize }); }
  return items;
}

test('a chest carried: chest_here offered and done, the stacks deposited and the cache remembered', async () => {
  const { makeRoom } = require('../src/inventory-tidy');
  const items = pockets([['chest', 1], ['stone_pickaxe', 1], ['cooked_beef', 8], ['rotten_flesh', 12], ['dripstone_block', 20]]);
  const placed = new Map(), deposited = [];
  const blockAt = p => { const q = p.floored ? p.floored() : p; const k = `${q.x},${q.y},${q.z}`; if (placed.has(k)) return { name: placed.get(k), position: q, boundingBox: 'block' }; return { name: q.y < 64 ? 'stone' : 'air', position: q, boundingBox: q.y < 64 ? 'block' : 'empty' }; };
  const bot = { registry, chat: () => {}, inventory: { items: () => items, emptySlotCount: () => 36 - items.length, slots: [] },
    entity: { position: new Vec3(0.5, 64, 0.5) }, game: { dimension: 'overworld' }, lookAt: async () => {}, blockAt,
    equip: async () => {}, placeBlock: async (ref, face) => { const c = ref.position.plus(face); placed.set(`${c.x},${c.y},${c.z}`, 'chest'); },
    openContainer: async () => ({ deposit: async (type, meta, count) => { const i = items.findIndex(x => x.type === type); deposited.push(items[i].name); items.splice(i, 1); }, close() {} }),
    tossStack: async () => assert.fail('nothing dropped') };
  let offered = null;
  const client = { systemOne: async ({ questions }) => { offered = questions.branch_0.criteria; return { answers: { branch_0: { choice: 'chest_here', confidence: 0.9 } } }; } };
  const goal = { kind: 'win' };
  await makeRoom(bot, { check() {}, opportunityClient: client }, 'raw_iron', { goal });
  assert.match(offered.chest_here, /^Put the chest carried down here and leave .*in it, making room for the raw iron with nothing dropped/);
  assert.ok(deposited.length >= 1 && !deposited.includes('cooked_beef') && !deposited.includes('stone_pickaxe'), `deposited ${deposited}`);
  assert.equal(goal.caches.length, 1);
});
