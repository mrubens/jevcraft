'use strict';
// Note 1008: the way back along the way in is not begun unasked where it
// first leads away from the portal (the bot's own tunnel toward it).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const walkOut = require('../src/walk-out');

test('a way in whose newest cells are a tunnel toward the portal leads away at first; one that goes straight back does not', async () => {
  const portal = { x: 0, y: 77, z: 0 };
  // In from the portal 120 blocks east to a fortress, then a tunnel 40 blocks back toward the portal on another line.
  const cells = [];
  for (let x = 0; x <= 120; x++) cells.push([x, 77, 40]);
  for (let x = 119; x >= 80; x--) cells.push([x, 77, 0]);
  const trail = { cells };
  const here = new Vec3(80.5, 77, 0.5);
  const way = walkOut.backTrail(trail, here, portal);
  assert.equal(walkOut.leadsAway(way, here, portal), true, 'two legs back along it is the tunnel, farther from the portal');
  const bot = { entity: { position: here }, _stalls: { goalOf: () => ({}) }, game: { dimension: 'the_nether' } };
  const goal = { wayIn: trail };
  let walked = 0;
  const navigate = async () => { walked++; };
  const went = await walkOut.walkBack(bot, { check() {} }, goal, portal, navigate);
  if (walkOut.wayInOf(bot, goal)) { assert.equal(went.tried, false); assert.equal(went.away, true); assert.equal(walked, 0); }
  // Straight back along the way in: not away.
  const straight = { cells: Array.from({ length: 81 }, (_, x) => [x, 77, 0]) };
  assert.equal(walkOut.leadsAway(walkOut.backTrail(straight, here, portal), here, portal), false);
});
