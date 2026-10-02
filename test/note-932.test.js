'use strict';
// Note 932: the blazes by a dropped rod, said on fetching it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { rodBlazesSays } = require('../src/mob-hunt');

const bot = (blazes, worn = ['iron_helmet', 'iron_chestplate']) => ({
  entities: Object.fromEntries(blazes.map((p, i) => [i + 1, { id: i + 1, name: 'blaze', isValid: true, position: new Vec3(...p) }])),
  inventory: { slots: { 5: worn[0] ? { name: worn[0] } : null, 6: worn[1] ? { name: worn[1] } : null } },
});

test('two blazes over the rod: said, with the blow through the armour worn (25595, 20 to 15.2 to 10.4)', () => {
  const says = rodBlazesSays(bot([[1.2, 64, 0], [0, 64, 1.9], [6, 64, 0]]), new Vec3(0, 64, 0));
  assert.match(says, /^ Blazes by it now: one 1\.2 blocks from it, one 1\.9 blocks from it, one 6 blocks from it\./);
  assert.match(says, /2 of them are within a blaze's arm's length of where the rod lies: a blaze strikes there for about 4\.8 a blow through the armour worn, a blow a second/);
});

test('none near the rod: nothing said; one only within eight: said without the blow', () => {
  assert.equal(rodBlazesSays(bot([[20, 64, 0]]), new Vec3(0, 64, 0)), '');
  const one = rodBlazesSays(bot([[5, 64, 0]]), new Vec3(0, 64, 0));
  assert.equal(one, ' Blazes by it now: one 5 blocks from it.');
});
