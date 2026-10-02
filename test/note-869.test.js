'use strict';
// Note 869: a blaze within two blocks is priced by its blows, one a second,
// not as a shooter. 25590 chose a meal priced 4.2 among four blazes at arm's
// length and lost 6.7 in it, then the rest.
const test = require('node:test');
const assert = require('node:assert/strict');
const ce = require('../src/combat-estimate');

const blazes = ds => ce.fightEstimate({ threats: ds.map(d => ({ name: 'blaze', distance: d, shoots: true, visible: true })), armour: ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'], weapon: 'iron_sword', health: 14.9 }).mobs;

test('four blazes at arm\'s length: 1.6 seconds standing costs about two blows a second, not a shooter\'s share (note 869)', () => {
  const near = ce.stanceCost({ mobs: blazes([1.2, 1.6, 1.7, 1.8]), seconds: 1.6, reaches: () => true });
  const far = ce.stanceCost({ mobs: blazes([8, 9, 10, 11]), seconds: 1.6, reaches: () => true });
  assert(near.damage >= 8, `${near.damage} at arm's length`);
  assert(near.damage >= far.damage * 3, `${near.damage} near, ${far.damage} far`);
  // The blow through the armour is on the mob's figures.
  assert(blazes([1.5])[0].meleeHit > 2 && blazes([1.5])[0].meleeHit < 6);
});
