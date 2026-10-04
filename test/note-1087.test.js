'use strict';
// Note 1087: in the Nether with no gold worn, golden boots are offered from
// the gold the pockets carry.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const kit = require('../src/entry-kit');

function bot(carried, worn = {}, { dimension = 'the_nether', entities = {} } = {}) {
  const registry = require('minecraft-data')('26.1');
  const items = Object.entries(carried).map(([name, count]) => ({ name, count, type: registry.itemsByName[name]?.id }));
  return { registry, game: { dimension, gameMode: 'survival' }, health: 20, food: 20, entity: { position: new Vec3(0, 64, 0) }, entities,
    inventory: { items: () => items, slots: Object.fromEntries(Object.entries(worn).map(([slot, name]) => [slot, { name }])) } };
}
const IRON = { 5: 'iron_helmet', 6: 'iron_chestplate', 7: 'iron_leggings', 8: 'iron_boots' };

test('25588 in the Nether: full iron, 5 raw gold, a furnace, coal and a table: the boots are offered, with the piglins\' rule and those about', () => {
  const piglin = { name: 'piglin', type: 'mob', position: new Vec3(40, 64, 0) };
  const b = kit.goldBoots(bot({ raw_gold: 5, furnace: 1, coal: 6, crafting_table: 1 }, IRON, { entities: { 1: piglin } }));
  assert.ok(b);
  assert.match(b.says, /^Make golden boots now and put them on, from what is carried \(4 smelted from the 5 raw gold carried .*\), .* standing here; they take the place of the iron boots worn, a point of armour less\. No gold is worn: a piglin attacks a player wearing none on sight.*; 1 within 64 blocks now, none within 24\./);
});

test('not with gold worn or carried, short of gold, with no way to smelt it, with a mob within 24 blocks, or in the Overworld', () => {
  assert.equal(kit.goldBoots(bot({ gold_ingot: 4, crafting_table: 1 }, { ...IRON, 8: 'golden_boots' })), null);
  assert.equal(kit.goldBoots(bot({ gold_ingot: 4, crafting_table: 1, golden_helmet: 1 }, IRON)), null);
  assert.equal(kit.goldBoots(bot({ gold_ingot: 3, crafting_table: 1 }, IRON)), null);
  assert.equal(kit.goldBoots(bot({ raw_gold: 5, crafting_table: 1 }, IRON)), null, 'raw gold with no furnace or fuel');
  assert.equal(kit.goldBoots(bot({ gold_ingot: 4, crafting_table: 1 }, IRON, { entities: { 1: { type: 'hostile', name: 'piglin', position: new Vec3(8, 64, 0) } } })), null);
  assert.equal(kit.goldBoots(bot({ gold_ingot: 4, crafting_table: 1 }, IRON, { dimension: 'overworld' })), null);
  assert.ok(kit.goldBoots(bot({ gold_ingot: 4, crafting_table: 1 }, IRON)));
});

test('gold nuggets count toward the boots, nine to an ingot at the table (note 1246)', () => {
  const b = kit.goldBoots(bot({ gold_nugget: 36, crafting_table: 1 }, IRON));
  assert.ok(b, 'offered from 36 nuggets');
  assert.equal(b.fromNuggets, 4);
  assert.match(b.says, /4 of the ingots are made of 36 of the 36 gold nuggets carried, at the table\./);
  assert.match(b.says, /on 2026-10-04 \(16:00 to 17:25Z\) six deaths in the Nether were to piglins or in flight from them, every one with no gold on/);
  assert.equal(kit.goldBoots(bot({ gold_nugget: 35, crafting_table: 1 }, IRON)), null, 'a nugget short');
  const mixed = kit.goldBoots(bot({ gold_nugget: 20, gold_ingot: 2, crafting_table: 1 }, IRON));
  assert.equal(mixed.fromNuggets, 2);
});
