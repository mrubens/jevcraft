'use strict';
// Trial note 810: the cage's plan ends when a hit lands through it, as its
// commitment says (25583 mid-230-ba, 2026-10-01 13:11:49-13:12:30Z).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { holding } = require('../src/cage-hold');

test('a box held as the cage plan: a blaze fireball landing after it began ends it (note 810)', () => {
  const now = Date.now();
  const bot = { entity: { position: new Vec3(225.5, 64, 68.5) }, health: 18, entities: {}, inventory: { items: () => [] }, _kills: { blaze: 0 }, _hurtBy: {} };
  const goal = { cageHold: { choice: 'box_here', at: now - 20000, until: now + 120000, from: { x: 225.5, y: 64, z: 68.5 }, box: { cell: { x: 225, y: 64, z: 68 } }, kills: 0, rods: 0, health: 20 } };
  assert.ok(holding(bot, goal, now), 'held with no hit');
  bot._hurtBy.blaze = now - 30000;
  assert.ok(holding(bot, goal, now), 'a hit from before it began does not end it');
  bot._hurtBy.blaze = now - 1000;
  assert.equal(holding(bot, goal, now), null);
  assert.match(goal.cageHold.endedBy, /^a hit landed through it \(a blaze's fireball, 1 seconds ago\)$/);
});
