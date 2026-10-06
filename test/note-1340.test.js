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
  assert.match(says, /the sword carried is stone sword\.$/);
  assert.match(endFightGearSays(bot(['iron_helmet']), []), /Worn now, iron helmet: 2 armour points[^;]*; in full iron/);
});
