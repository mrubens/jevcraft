'use strict';
// Note 1098: the climb for food into the night says the blows that end the
// bot at the health it has. 25589 (2026-10-03 19:37Z), bare at 6 health under
// the rock a minute before dawn, took the climb and two arrows ended it.
const test = require('node:test');
const assert = require('node:assert');
const { nightEnds } = require('../src/survival');

test('at 6 health with nothing worn the night walk says two arrows or two zombie hits end it; at full health nothing is added (note 1098)', () => {
  const bare = { health: 6, inventory: { slots: [] } };
  assert.match(nightEnds(bare), /^: 2 skeleton arrows \(about [\d.]+ each\) or 2 zombie hits \(about [\d.]+ each\) end it through what is worn; zombies and skeletons under open sky burn from dawn/);
  assert.equal(nightEnds({ health: 20, inventory: { slots: [] } }), '');
  const slots = []; slots[5] = { name: 'iron_helmet' }; slots[6] = { name: 'iron_chestplate' }; slots[7] = { name: 'iron_leggings' }; slots[8] = { name: 'iron_boots' };
  const hits = +/^: (\d+) skeleton/.exec(nightEnds({ health: 6, inventory: { slots } }))[1];
  assert(hits > 2, `iron worn takes more arrows: ${hits}`);
});
