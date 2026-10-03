'use strict';
// Note 1045: before the Nether, a spare pickaxe and sword left in the chest
// at home is an answer, said with what a death costs with the chest empty.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const stash = require('../src/home-stash');
const registry = require('minecraft-data')('26.1');

function bot(carried) {
  const items = Object.entries(carried).map(([name, count]) => ({ name, count, type: registry.itemsByName[name]?.id, durabilityUsed: 0 }));
  return { registry, game: { gameMode: 'survival', dimension: 'overworld' }, health: 20, food: 20, entity: { position: new Vec3(40.5, 64, 0.5) }, inventory: { items: () => items, slots: [] } };
}
const goalWith = contents => ({ kind: 'win', survival: { home: { origin: { x: 0, y: 64, z: 0 }, bed: { x: 1, y: 64, z: 0 }, stash: { position: { x: 2, y: 64, z: 0 }, contents } } } });

test('an empty chest forty blocks off, iron and sticks carried: a spare pickaxe and sword made and left, said with the day\'s record', () => {
  const b = bot({ iron_pickaxe: 1, iron_sword: 1, iron_ingot: 9, stick: 6, cooked_beef: 8 });
  const o = stash.spareKitOffer(b, goalWith({}));
  // The deaths that followed a death are said with it (note 1115).
  assert.match(o.says, /of 110 deaths 20 were followed by another of the same trial within ten minutes and 30 within twenty, the bot back with empty hands among the mobs by its bed: a sword and a pickaxe in the chest are in hand the moment it is back\.$/);
  assert.ok(o, 'offered');
  assert.deepEqual(o.makes.map(m => m.item), ['iron_pickaxe', 'iron_sword']);
  assert.match(o.says, /^Leave a spare kit in the stash chest at home first, \d+ blocks off, about \d+ seconds each way: make a spare iron pickaxe \(3 of the 9 iron ingots carried\) and a spare iron sword \(2 of the 9 iron ingots carried\), a few seconds at a crafting table, and leave them there \(the chest holds nothing yet\)\. A death in the Nether comes back to life at the bed with empty hands, and what is in the chest is taken up from there: on 2026-10-03 the 4 deaths in the Nether with the chest empty were back in the Nether 22 to 52 minutes later, a median 37, the kit mined and smelted again\./);
});

test('stone where no iron is spare; nothing where the chest holds both, the pockets make neither, or the chest is out of reach', () => {
  assert.deepEqual(stash.spareKitOffer(bot({ iron_pickaxe: 1, cobblestone: 20, stick: 4 }), goalWith({})).makes.map(m => m.item), ['stone_pickaxe', 'stone_sword']);
  assert.equal(stash.spareKitOffer(bot({ iron_pickaxe: 1, iron_ingot: 9, stick: 6 }), goalWith({ iron_pickaxe: 1, stone_sword: 1 })), null, 'the chest holds both');
  assert.equal(stash.spareKitOffer(bot({ iron_pickaxe: 1, iron_sword: 1 }), goalWith({})), null, 'nothing to make them from');
  const far = bot({ iron_ingot: 9, stick: 6 }); far.entity.position = new Vec3(400.5, 64, 0.5);
  assert.equal(stash.spareKitOffer(far, goalWith({})), null);
  const twoPicks = stash.spareKitOffer(bot({ iron_pickaxe: 1, stone_pickaxe: 1, iron_sword: 1 }), goalWith({ stone_sword: 1 }));
  assert.ok(twoPicks && twoPicks.makes.length === 0, 'a spare carried is left as it is');
  assert.match(twoPicks.says, /leave the spare pickaxe carried there/);
});
