'use strict';
// Note 1066: in the Overworld too, a piece of iron armour gone without is
// offered from the iron carried, before the armour's rung has gathered the
// iron for every piece.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const kit = require('../src/entry-kit');

function bot(carried, worn = {}, { dimension = 'overworld', entities = {} } = {}) {
  const registry = require('minecraft-data')('26.1');
  const items = Object.entries(carried).map(([name, count]) => ({ name, count, type: registry.itemsByName[name]?.id }));
  return { registry, game: { dimension, gameMode: 'survival' }, health: 20, food: 20, entity: { position: new Vec3(130, -34, 160) }, entities,
    inventory: { items: () => items, slots: Object.fromEntries(Object.entries(worn).map(([slot, name]) => [slot, { name }])) } };
}

test('25593 in its mine: 13 raw iron, a furnace, coal and a table carried, nothing worn: the chestplate is offered, said by a zombie\'s blow and a creeper\'s blast', () => {
  const p = kit.ironPiece(bot({ raw_iron: 13, furnace: 1, coal: 9, crafting_table: 1, stone_sword: 1, iron_pickaxe: 1 }));
  assert.equal(p.item, 'iron_chestplate');
  assert.match(p.says, /^Make an iron chestplate now and put it on, from what is carried \(8 iron ingots: 8 smelted from the 13 raw iron carried/);
  assert.match(p.says, /Worn now: nothing; a zombie's blow or a skeleton's arrow lands about 3 and a creeper's blast two blocks off about 24, with the chestplate about [\d.]+ and [\d.]+\./);
  assert.match(p.says, /The armour's own step gathers the iron for every piece before it smelts any; this one is worn from now/);
  assert.doesNotMatch(p.says, /blaze|wither/);
});

test('in the Overworld: no iron boots (the feet are the golden boots\'), nothing with a mob within 24 blocks, and the Nether\'s offer is as it was', () => {
  const TOP = { 5: 'iron_helmet', 6: 'iron_chestplate', 7: 'iron_leggings' };
  assert.equal(kit.ironPiece(bot({ iron_ingot: 9, crafting_table: 1 }, TOP)), null);
  assert.equal(kit.ironPiece(bot({ iron_ingot: 9, crafting_table: 1 }, TOP, { dimension: 'the_nether' })).item, 'iron_boots');
  assert.equal(kit.ironPiece(bot({ iron_ingot: 9, crafting_table: 1 }, {}, { entities: { 1: { type: 'hostile', name: 'zombie', position: new Vec3(138, -34, 160) } } })), null);
  assert.equal(kit.netherPiece(bot({ iron_ingot: 9, crafting_table: 1 })), null, 'netherPiece stays the Nether\'s');
  assert.equal(kit.ironPiece(bot({ iron_ingot: 5, crafting_table: 1 })).item, 'iron_helmet', 'five ingots: the helmet');
});
