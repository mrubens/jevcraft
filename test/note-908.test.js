'use strict';
// Note 908: in the Nether with no gold worn and the makings in the pack,
// golden boots are made and worn before the stage in hand.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { goldForPiglins } = require('../src/mob-hunt');

function bot(items, { dimension = 'the_nether', feet = 'iron_boots' } = {}) {
  const list = Object.entries(items).map(([name, count]) => ({ name, count, type: registry.itemsByName[name]?.id }));
  const slots = []; slots[8] = feet ? { name: feet } : null; slots[5] = { name: 'iron_helmet' };
  const worn = [];
  return { registry, game: { dimension, gameMode: 'survival' }, health: 20, food: 20, entity: { position: new Vec3(0.5, 64, 0.5) }, chat() {},
    inventory: { items: () => list, slots }, equip: async (item, where) => { worn.push([item.name, where]); slots[8] = { name: item.name }; }, _list: list, _worn: worn };
}
const task = { check() {} };

test('38 gold nuggets and a crafting table carried, iron boots worn: the boots are made (the acquire step asked for them) and a step is taken', async () => {
  const b = bot({ gold_nugget: 38, crafting_table: 1, iron_sword: 1 });
  const goal = {}, asked = [];
  const acquireStep = async (bt, t, item, count) => { asked.push([item, count]); b._list.push({ name: 'golden_boots', count: 1, type: registry.itemsByName.golden_boots.id }); };
  assert.equal(await goldForPiglins(b, task, goal, () => {}, { acquireStep }), true);
  assert.deepEqual(asked, [['golden_boots', 1]]);
  assert.equal(goal.step.action, 'gold_for_piglins');
  assert.deepEqual(b._worn.at(-1), ['golden_boots', 'feet'], 'worn on the feet in the Nether');
});

test('gold worn already, the Overworld, too little gold, or a making that needs more than crafts: nothing', async () => {
  const none = async () => assert.fail('nothing is made');
  assert.equal(await goldForPiglins(bot({ gold_nugget: 38, crafting_table: 1 }, { feet: 'golden_boots' }), task, {}, () => {}, { acquireStep: none }), false);
  assert.equal(await goldForPiglins(bot({ gold_nugget: 38, crafting_table: 1 }, { dimension: 'overworld' }), task, {}, () => {}, { acquireStep: none }), false);
  assert.equal(await goldForPiglins(bot({ gold_nugget: 20, crafting_table: 1 }), task, {}, () => {}, { acquireStep: none }), false);
  assert.equal(await goldForPiglins(bot({ gold_nugget: 38 }), task, {}, () => {}, { acquireStep: none }), false, 'no table and no planks: a gathering, not this rule');
});

test('a making that fails rests ten minutes and is not tried at every stage', async () => {
  const b = bot({ gold_ingot: 4, crafting_table: 1 });
  const goal = {};
  let calls = 0;
  const acquireStep = async () => { calls++; throw new Error('No free slot for the 1 golden boots; the inventory is full'); };
  assert.equal(await goldForPiglins(b, task, goal, () => {}, { acquireStep }), false);
  assert.equal(await goldForPiglins(b, task, goal, () => {}, { acquireStep }), false);
  assert.equal(calls, 1);
});

test('raw gold with a furnace and fuel carried: the ingots are smelted and the boots made without asking (note 1247)', async () => {
  const b = bot({ raw_gold: 5, furnace: 1, coal: 6, crafting_table: 1 });
  const goal = {}, asked = [];
  const give = (name, n) => { const it = b._list.find(i => i.name === name); if (it) it.count += n; else b._list.push({ name, count: n, type: registry.itemsByName[name].id }); };
  const acquireStep = async (bt, t, item, count) => { asked.push([item, count]); if (item === 'gold_ingot') give('gold_ingot', 2); else give('golden_boots', 1); };
  assert.equal(await goldForPiglins(b, task, goal, () => {}, { acquireStep }), true);
  assert.deepEqual(asked, [['gold_ingot', 4], ['gold_ingot', 4], ['golden_boots', 1]]);
  assert.deepEqual(goal.step, { action: 'gold_for_piglins', item: 'golden_boots', smelts: true });
  assert.deepEqual(b._worn.at(-1), ['golden_boots', 'feet']);
});
