'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fightEstimate, afterArmour, armourOf } = require('../src/combat-estimate');

test('armour takes what the game takes: full iron cuts a zombie\'s hit from 3 to 1.4', () => {
  const iron = armourOf(['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots']);
  assert.deepEqual(iron, { points: 15, toughness: 0 });
  assert.equal(Math.round(afterArmour(3, iron) * 10) / 10, 1.4);
  assert.equal(afterArmour(3, { points: 0, toughness: 0 }), 3);
});

test('three zombies against a stone sword and no armour cost more than eight health', () => {
  const zombie = d => ({ name: 'zombie', distance: d, shoots: false, visible: true });
  const e = fightEstimate({ threats: [zombie(6), zombie(7), zombie(8)], armour: [], weapon: 'stone_sword', health: 8 });
  assert.equal(e.mobs[0].swingsToKill, 4); assert.equal(e.mobs[0].secondsToKill, 2.5); assert.equal(e.mobs[0].hitsBot, 3);
  // 2.5 s under three, then two, then one, the one being struck landing a
  // third of its hits: (7 + 4 + 1) * 2.5 = 30.
  assert.equal(e.fightHere.damageTaken, 30);
  assert(e.fightHere.healthAfter < 0);
  const armed = fightEstimate({ threats: [zombie(6)], armour: ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'], weapon: 'iron_sword', health: 20 });
  assert(armed.fightHere.damageTaken < 5, JSON.stringify(armed.fightHere));
});

test('the arena cave trio comes out near what it measured (about five, with a shield)', () => {
  const e = fightEstimate({ threats: [{ name: 'zombie', distance: 3, visible: true }, { name: 'zombie', distance: 4, visible: true }, { name: 'skeleton', distance: 5, shoots: true, visible: true }],
    armour: ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'golden_boots'], weapon: 'diamond_sword', health: 20, shield: true });
  assert(e.fightHere.damageTaken > 4 && e.fightHere.damageTaken < 10, JSON.stringify(e.fightHere));
});

test('a shooter out of sight costs nothing while it is fought for; a creeper\'s blast is said, not summed', () => {
  const e = fightEstimate({ threats: [{ name: 'skeleton', distance: 10, shoots: true, visible: false }, { name: 'creeper', distance: 5, visible: true }], weapon: 'iron_sword' });
  assert.equal(e.fightHere.damageTaken, 0);
  assert.match(e.fightHere.creeper, /goes off for about 22/);
});

test('a skeleton is not a quick kill: it backs off after each hit and shoots while it is closed on', () => {
  // Trial 44 was told 2.5 seconds and 1.3 damage; it lost fourteen health in six seconds.
  const e = fightEstimate({ threats: [{ name: 'skeleton', distance: 4.3, shoots: true, visible: true }], weapon: 'stone_sword', health: 9.2 });
  assert(e.fightHere.damageTaken >= 6, JSON.stringify(e.fightHere));
  assert(e.fightHere.healthAfter < 4, 'at nine health it is close to fatal');
});
