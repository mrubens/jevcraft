'use strict';
// Note 1114: back with empty hands, the night's record is another.
const test = require('node:test');
const assert = require('node:assert');
const { bareSays, bareOf, BARE } = require('../src/night-record');

test('a bot with no sword and nothing worn is told the deaths that followed a death; one armed or in armour is not (note 1114)', () => {
  const bare = { inventory: { items: () => [{ name: 'dirt', count: 3 }], slots: [] } };
  assert.equal(bareOf(bare), true);
  assert.match(bareSays(bare), /With empty hands and nothing worn the record is another: on 2026-10-03 \(08:00 to 21:00Z\), of 110 deaths 20 were followed by another of the same trial within ten minutes and 30 within twenty, the bot back bare, about 1 in 6 and 1 in 4\./);
  const armed = { inventory: { items: () => [{ name: 'stone_sword', count: 1 }], slots: [] } };
  assert.equal(bareSays(armed), '');
  const slots = []; slots[6] = { name: 'iron_chestplate' };
  assert.equal(bareSays({ inventory: { items: () => [], slots } }), '');
  assert(BARE.again20 > BARE.again10);
});
