'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { enchantable, enchantReady, bestOffer } = require('../src/enchanting');

const item = (name, enchants = []) => ({ name, count: 1, enchants });
const bot = ({ items = [], worn = {}, level = 10, table = true } = {}) => ({
  registry: require('minecraft-data')('26.1'), experience: { level },
  inventory: { items: () => items, slots: Object.assign([], worn) },
  findBlocks: () => table ? [{ x: 1, y: 64, z: 1 }] : [],
});

test('the sword first, then the bow, then the armour from the chest down; stone and enchanted gear left alone', () => {
  const b = bot({ items: [item('diamond_pickaxe'), item('stone_sword'), item('bow'), item('diamond_sword')], worn: { 6: item('iron_chestplate'), 8: item('iron_boots', [{ name: 'protection', lvl: 1 }]) } });
  assert.deepEqual(enchantable(b).map(e => e.item.name), ['diamond_sword', 'bow', 'iron_chestplate', 'diamond_pickaxe']);
  assert.equal(enchantable(b)[2].worn, 'torso', 'worn armour comes off for the table');
});

test('an enchant needs a table, lapis, five levels and plain gear', () => {
  const kit = [item('diamond_sword'), { name: 'lapis_lazuli', count: 12 }];
  assert.equal(enchantReady(bot({ items: kit }), {}), true);
  assert.equal(enchantReady(bot({ items: kit, level: 4 }), {}), false, 'four levels');
  assert.equal(enchantReady(bot({ items: [item('diamond_sword')] }), {}), false, 'no lapis');
  assert.equal(enchantReady(bot({ items: kit, table: false }), {}), false, 'no table anywhere');
  assert.equal(enchantReady(bot({ items: kit, table: false }), { enchanting: { table: { x: 0, y: 64, z: 0 } } }), true, 'a remembered one');
});

test('of the three offers, the dearest the levels and the lapis pay for', () => {
  const offers = [{ level: 2 }, { level: 5 }, { level: 8 }];
  assert.equal(bestOffer(offers, { level: 10, lapis: 3 }), 2);
  assert.equal(bestOffer(offers, { level: 6, lapis: 3 }), 1);
  assert.equal(bestOffer(offers, { level: 10, lapis: 1 }), 0, 'one lapis buys the first only');
  assert.equal(bestOffer(offers, { level: 1, lapis: 3 }), -1);
});

test('26.1 item enchantments ({ enchantments: [{ id, level }] }) read as names and levels', () => {
  const { enchantsOf } = require('../src/enchanting');
  assert.deepEqual(enchantsOf({ enchants: { enchantments: [{ id: 33, level: 1 }] } }), [{ name: 'sharpness', lvl: 1 }]);
  assert.deepEqual(enchantsOf({ enchants: [{ name: 'minecraft:protection', lvl: 2 }] }), [{ name: 'protection', lvl: 2 }]);
  assert.deepEqual(enchantsOf({ enchants: [] }), []);
});
