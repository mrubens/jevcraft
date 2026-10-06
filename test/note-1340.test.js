'use strict';
// Note 1340: the combat kit question before the End says the dragon's hits
// through what is worn, with the pieces offered, and in full iron.
const test = require('node:test');
const assert = require('node:assert/strict');
const { endFightGearSays } = require('../src/mob-hunt');

const bot = (worn, items = []) => ({ inventory: { slots: Object.assign([], Object.fromEntries(worn.map((n, i) => [5 + i, { name: n, count: 1 }]))), items: () => items.map(name => ({ name, count: 1 })) } });

test('nothing worn, a stone sword: the hits bare, with the pieces offered, and in full iron', () => {
  const says = endFightGearSays(bot([], ['stone_sword']), ['iron_chestplate']);
  assert.match(says, /Worn now, nothing: 0 armour points: the head 10, the wing 5, an enderman 7; with iron chestplate too, 6 armour points: the head 9\.5, the wing 4\.3, an enderman 6\.3; in full iron, 15 armour points: the head 6, the wing 2\.5, an enderman 3\.8\./);
  assert.match(says, /the sword carried is stone sword\. The arena.s drills of 2026-10-06 on a fresh End with nothing worn/);
  assert.match(endFightGearSays(bot(['iron_helmet']), []), /Worn now, iron helmet: 2 armour points[^;]*; in full iron/);
});

test('note 1341: leather pieces for the empty slots, by crafts alone, while the leather lasts', () => {
  const { leatherPieces } = require('../src/mob-hunt');
  const registry = require('minecraft-data')('26.1');
  const items = [{ name: 'leather', count: 16 }, { name: 'crafting_table', count: 1 }].map(i => ({ ...i, type: registry.itemsByName[i.name].id, durabilityUsed: 0 }));
  const b = { registry, game: { dimension: 'overworld' }, inventory: { slots: [], items: () => items } };
  assert.deepEqual(leatherPieces(b, ['hand', 'head', 'torso', 'legs', 'feet']).map(p => p.item), ['leather_chestplate', 'leather_leggings']);
  b.inventory.slots[6] = { name: 'iron_chestplate', count: 1 };
  assert.deepEqual(leatherPieces(b, ['head', 'legs', 'feet']).map(p => p.item), ['leather_leggings', 'leather_helmet', 'leather_boots']);
});
