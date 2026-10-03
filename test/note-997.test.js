'use strict';
// Note 997: wood wanted for a chest to keep the rods in is counted with the
// pickaxe's while rods_now asks for it.
const test = require('node:test');
const assert = require('node:assert/strict');
const nw = require('../src/nether-wood');

test('the chest\'s eight planks are wanted beside the pickaxe\'s wood while the asking stands, and not after', () => {
  const registry = require('minecraft-data')('26.1');
  const stock = [['iron_pickaxe', 1], ['stick', 4], ['crafting_table', 1], ['cobblestone', 3]];
  const bot = { registry, game: { dimension: 'the_nether' }, inventory: { items: () => stock.map(([name, count]) => ({ name, count, type: registry.itemsByName[name].id })) } };
  const plain = nw.woodWanted(bot);
  bot._woodAlso = { planks: 8, for: 'a chest to keep the rods in', until: Date.now() + 60000 };
  const withChest = nw.woodWanted(bot);
  assert.equal(withChest.want, plain.want + 8);
  assert.equal(withChest.stems, Math.ceil(withChest.short / 4));
  assert.match(withChest.says, /a chest to keep the rods in \(8 planks\)/);
  bot._woodAlso.until = Date.now() - 1;
  assert.equal(nw.woodWanted(bot).want, plain.want);
});
