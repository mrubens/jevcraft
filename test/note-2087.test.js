'use strict';
// Note 2087: the diamond pickaxe offered as a choice (the user, 2026-10-25).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { diamondPickaxeOption } = require('../src/strategy');

const bot = (items, y = 64, dimension = 'overworld') => ({ game: { gameMode: 'survival', dimension }, entity: { position: new Vec3(0.5, y, 0.5) },
  inventory: { items: () => items.map(([name, count]) => ({ name, count })), slots: [] }, _survivalState: { deaths: [] } });

test('with an iron pickaxe and none of diamond, the diamond pickaxe is offered with the depth to the diamonds and what it does', () => {
  const o = diamondPickaxeOption(bot([['iron_pickaxe', 1], ['diamond', 1]]), {});
  assert.deepEqual(o.rung, { phase: 'diamond_pickaxe', action: 'acquire', item: 'diamond_pickaxe', count: 1 });
  assert.match(o.description, /^(?:This way: .*? health(?: \(more than the bot has\))?\. )?Make a diamond pickaxe \(1 of the three diamonds carried; the rest mined from here, 122 blocks down to about y -58\): three diamonds and two sticks/);
  assert.match(o.description, /lasts 1,561 uses against the iron pickaxe's 250 and digs faster, and it alone mines obsidian/);
  assert.match(diamondPickaxeOption(bot([['iron_pickaxe', 1], ['diamond', 3]]), {}).description, /3 diamonds carried: it is made now, at a crafting table/);
});

test('not offered with a diamond pickaxe, without an iron one, or off the Overworld', () => {
  assert.equal(diamondPickaxeOption(bot([['iron_pickaxe', 1], ['diamond_pickaxe', 1]]), {}), null);
  assert.equal(diamondPickaxeOption(bot([['stone_pickaxe', 1]]), {}), null);
  assert.equal(diamondPickaxeOption(bot([['iron_pickaxe', 1]], 64, 'the_nether'), {}), null);
});

test('the run\'s own iron pickaxes are said beside the diamond one (note 2089)', () => {
  const o = diamondPickaxeOption(bot([['iron_pickaxe', 1]]), { toolsMade: { iron_pickaxe: 11 } });
  assert.match(o.description, /This run has made 11 iron pickaxes so far, 33 iron, about 23 to 43 minutes of mining and smelting at the fresh runs' pace; one diamond pickaxe outlasts six\./);
  assert.doesNotMatch(diamondPickaxeOption(bot([['iron_pickaxe', 1]]), {}).description, /This run has made/);
});
