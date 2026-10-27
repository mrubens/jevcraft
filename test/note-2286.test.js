'use strict';
// Note 2286: a death that would lose no item is said plainly, with what it does cost; the drop clock is the game's.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { deathCost } = require('../src/risk');

const botWith = (items = [], slots = {}) => ({ game: { dimension: 'overworld' }, entity: { position: new Vec3(100, 64, 0) }, spawnPoint: new Vec3(0, 64, 0), experience: { level: 0 }, inventory: { items: () => items, slots } });

test('bare, carrying dirt: nothing to lose, the walk back said', () => {
  const c = deathCost(botWith([{ name: 'dirt', count: 12 }]), {});
  assert.match(c.nothingToLose, /^Nothing of worth is carried or worn now: a death here drops no items\. It costs only the walk back from the world spawn, about 23 seconds at a walk, and the levels\.$/);
  assert.match(c.note, /ticks it only while a player is within about 176 blocks/);
});

test('in iron: no such line', () => {
  assert.equal(deathCost(botWith([], { 6: { name: 'iron_chestplate' } }), {}).nothingToLose, undefined);
});

test('on a walk back to drops being ticked: their clock runs on whatever happens', () => {
  const c = deathCost(botWith(), { corpseRun: { status: 'open', loadedAt: new Date().toISOString() } });
  assert.match(c.nothingToLose, /the game is ticking them now: what is left of their five minutes runs on whether or not the bot dies again/);
});
