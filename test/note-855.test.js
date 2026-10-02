'use strict';
// Note 855: a column whose rock opens into water with open air over it is a
// rise and then a swim, said with the swim's seconds against a full breath.
// first-days-236: the bot starts on its own cobblestone at (210, 33, 423) in
// a cave, air at 34 to 36, stone at 37, water 38 to 62, air from 63.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { risePlan } = require('../src/unstuck');

const FEET = new Vec3(210, 34, 423);
const lake = (top = 62) => p => {
  if (p.y <= 33) return p.x === 210 && p.z === 423 && p.y === 33 ? 'cobblestone' : 'air';
  if (p.y <= 36) return 'air';
  if (p.y === 37) return 'stone';
  if (p.y <= top) return 'water';
  return 'air';
};
const view = name => ({ name, carried: { cobblestone: 64 }, pickaxe: 'iron_pickaxe', pickaxeUses: 200, health: 20 });

test('rock under a lake with air over it: rise_and_swim, its swim against a full breath (note 855)', () => {
  const r = risePlan(view(lake()), FEET);
  assert(r?.move, JSON.stringify(r));
  assert.equal(r.move.key, 'rise_and_swim');
  assert.equal(r.move.top, 36);
  assert.equal(r.move.swim.cells, 25);
  assert.match(r.move.does, /swim straight up 25 blocks of water to open air at y 63: about \d+ seconds of rising, then about 10 seconds of swimming against 15 seconds of a full breath\./);
});

test('too deep a lake is said past the breath; lava over the rock is still refused (note 855)', () => {
  assert.match(risePlan(view(lake(80)), FEET).move.does, /past the breath, into the drowning/);
  const lava = p => (p.y === 38 ? 'lava' : lake()(p));
  assert.match(risePlan(view(lava), FEET).blocked, /lava in the column at y 38/);
});
