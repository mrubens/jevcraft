'use strict';
// Note 1024: in the Nether a piece of iron armour gone without is offered
// from the pockets, the piece that takes the most off a hit first.
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
const TOP = { 5: 'iron_helmet', 6: 'iron_chestplate' };

test('a helmet and chestplate worn, raw iron, a furnace and coal carried: the leggings are offered, said with what they take off a hit', () => {
  const p = kit.netherPiece(bot({ raw_iron: 61, furnace: 1, coal: 117, crafting_table: 1, iron_sword: 1 }, TOP));
  assert.equal(p.item, 'iron_leggings');
  assert.match(p.says, /^Make iron leggings now and put them on, from what is carried \(7 iron ingots: 7 smelted from the 61 raw iron carried \(.*in the furnace carried, the coal carried for fuel\).*standing here\. Worn now: iron helmet, iron chestplate; a blaze's fireball lands about [\d.]+ and a wither skeleton's blade about [\d.]+, with the leggings about [\d.]+ and [\d.]+/);
  assert.match(p.says, /in a helmet and chestplate 130 fights took 12\.9 health each, in three or four iron pieces 54 took 4\.4/);
});

test('the chestplate first where none is worn; the boots not with golden boots carried; nothing short of iron, a table, or with a mob about, or outside the Nether', () => {
  assert.equal(kit.netherPiece(bot({ iron_ingot: 9, crafting_table: 1 })).item, 'iron_chestplate');
  assert.equal(kit.netherPiece(bot({ iron_ingot: 9, crafting_table: 1 }, { ...TOP, 7: 'iron_leggings', 8: 'golden_boots' })), null);
  assert.equal(kit.netherPiece(bot({ iron_ingot: 9, crafting_table: 1, golden_boots: 1 }, { ...TOP, 7: 'iron_leggings' })), null);
  assert.equal(kit.netherPiece(bot({ iron_ingot: 4, crafting_table: 1 }, { ...TOP, 7: 'iron_leggings' })).item, 'iron_boots');
  assert.equal(kit.netherPiece(bot({ iron_ingot: 6, crafting_table: 1 }, TOP)).item, 'iron_boots', 'six ingots: the leggings want seven, the boots four');
  assert.equal(kit.netherPiece(bot({ iron_ingot: 3, crafting_table: 1 }, TOP)), null, 'three ingots make no piece');
  assert.equal(kit.netherPiece(bot({ raw_iron: 20, crafting_table: 1 }, TOP)), null, 'raw iron with no furnace or fuel');
  assert.equal(kit.netherPiece(bot({ iron_ingot: 9 }, TOP)), null, 'no table and no planks');
  assert.equal(kit.netherPiece(bot({ iron_ingot: 9, crafting_table: 1 }, TOP, { entities: { 1: { type: 'hostile', name: 'blaze', position: new Vec3(8, 64, 0) } } })), null);
  assert.equal(kit.netherPiece(bot({ iron_ingot: 9, crafting_table: 1 }, TOP, { dimension: 'overworld' })), null);
});
