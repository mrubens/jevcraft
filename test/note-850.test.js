'use strict';
// Note 850: a shield guard's sword is on the one it faces until that one is
// dead; the other biters strike at their own pace meanwhile and are fought
// only after. 25591 (mid-239-ck, 2026-10-02 00:31:59Z) was priced "about
// 14.4 damage" with four zombies and no armour, two outside the shield's
// cover, and was dead in under four seconds of blows.
const test = require('node:test');
const assert = require('node:assert/strict');
const ce = require('../src/combat-estimate');

test('stanceCost with fight.after: those fought strike at their pace until the sword is free, then are fought (note 850)', () => {
  const mobs = ce.fightEstimate({ threats: [{ name: 'zombie', distance: 2.1, shoots: false, visible: true }, { name: 'zombie', distance: 3.9, shoots: false, visible: true }],
    armour: [], weapon: 'iron_sword', health: 20 }).mobs;
  const now = ce.stanceCost({ mobs, fight: { lead: true }, shield: true, health: 20 });
  const after = ce.stanceCost({ mobs, fight: { lead: true, after: 4 }, shield: true, health: 20 });
  assert(after.damage >= now.damage + 8, `${after.damage} with the sword on another four seconds, ${now.damage} fought at once`);
  // No delay, the same as before.
  assert.equal(ce.stanceCost({ mobs, fight: { lead: true, after: 0 }, shield: true, health: 20 }).damage, now.damage);
});
