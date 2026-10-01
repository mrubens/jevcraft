'use strict';
// Trial note 809: the stalk's dig toward the blazes keeps the hunt's claim
// and its own closing-on for as long as it runs, so the route search lets
// the walk toward a blaze behind the wall.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { keepClaim } = require('../src/mob-hunt');
const { safeFromHostiles } = require('../src/danger');

test('the cell toward a blaze 3.3 blocks off behind the wall: refused unclaimed, walked while the dig keeps its claim (note 809)', () => {
  const bot = { game: { gameMode: 'survival', difficulty: 'normal' }, entity: { position: new Vec3(225.5, 64, 68.5) }, health: 20, food: 20,
    inventory: { items: () => [{ name: 'iron_sword', count: 1 }], slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 7: { name: 'iron_leggings' }, 8: { name: 'iron_boots' } } },
    world: { raycast: () => ({ position: new Vec3(226, 64, 68), intersect: new Vec3(226, 65, 68.5) }) } };
  const blaze = { id: 9, name: 'blaze', position: new Vec3(227.8, 64, 70.8), height: 1.8 };
  const cell = new Vec3(226.5, 64, 68.5);
  assert.equal(safeFromHostiles(bot, cell, [blaze]), false, 'out of sight within six: refused');
  const task = { interruptCheck: null };
  const restore = keepClaim(bot, task, 'blaze');
  assert.equal(safeFromHostiles(bot, cell, [blaze]), true, 'the dig closing on the blaze walks there');
  // Renewed at each check, however long the dig runs.
  bot._closingOn.until = Date.now() - 1; bot._huntingEntity.until = Date.now() - 1;
  task.interruptCheck();
  assert.ok(bot._closingOn.until > Date.now());
  restore();
  assert.equal(bot._closingOn, undefined);
  assert.equal(task.interruptCheck, null);
});
