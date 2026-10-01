'use strict';
// Note 774c. 25584 (mid-229-ac, 2026-10-01 03:51-03:59Z, 1 rod carried) was
// offered close_in at "the nearest blaze ground reaches (10.1 blocks ...)"
// and hunt_13686 "in the open", and the walk refused both: "with 1 blaze rod
// carried the walk takes no drop of more than two". note 774's one
// reachability walked its own cells, not the walk's. 25592 (mid-220-ad) chose
// charge_nearest at a blaze 1.9 off and its walk said "no route" at once.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { groundBot } = require('./fixtures/saved-ground');
const stand = require('../src/blaze-stand');

function scene(box, fn) {
  const palette = [], rows = [];
  const letter = n => { let i = palette.indexOf(n); if (i < 0) { palette.push(n); i = palette.length - 1; } return String.fromCharCode(97 + i); };
  for (let y = box.y[0]; y <= box.y[1]; y++) for (let z = box.z[0]; z <= box.z[1]; z++) {
    let r = ''; for (let x = box.x[0]; x <= box.x[1]; x++) r += letter(fn(x, y, z)); rows.push(r);
  }
  return { box, palette, rows };
}
// A ledge at y 30 (x 0 to 6) above a floor at y 27 (x 7 to 16): the one way
// down is a drop of three; walls at z 0 and z 6.
const LEDGE = scene({ x: [0, 16], y: [25, 36], z: [0, 6] }, (x, y, z) => {
  if (y === 25 || z === 0 || z === 6) return y <= 33 ? 'netherrack' : 'air';
  if (x <= 6) return y <= 29 ? 'netherrack' : 'air';
  return y <= 26 ? 'netherrack' : 'air';
});
function ledgeBot(items = []) {
  const bot = groundBot(LEDGE, { dimension: 'the_nether', at: new Vec3(2.5, 30, 3.5), items: [['iron_sword', 1], ...items] });
  bot.game.minY = 0;
  Object.assign(bot.pathfinder.movements, { canDig: false, allow1by1towers: false, scafoldingBlocks: [] });
  const blaze = { id: 5, name: 'blaze', type: 'hostile', position: new Vec3(12.5, 27.5, 3.5), height: 1.8, width: 0.6, isValid: true, metadata: {} };
  bot.entities = { ...(bot.entities || {}), 5: blaze };
  return { bot, blaze };
}

test('the reach reads the walk the bot takes: down the drop of three without rods, and no reach with a rod carried, the drop refused (25584, 03:51-03:59Z)', () => {
  const plain = ledgeBot();
  const reach = stand.blazeReach(plain.bot, plain.blaze);
  assert(reach && reach.cell.y === 27, `reached on the floor below: ${JSON.stringify(reach)}`);
  const rods = ledgeBot([['blaze_rod', 1]]);
  assert.equal(stand.blazeReach(rods.bot, rods.blaze), null, 'with a rod carried the walk takes no drop of more than two');
  assert.deepEqual(require('../src/survival').chargeStopsAt(rods.bot, rods.blaze)?.blocks, 0, 'fight reads the same');
});

test('a blaze within the sword\'s reach of where the bot stands needs no walk: the reach is the bot\'s own cell, and the hunt\'s fight swings from there (25592, mid-220-ad)', async () => {
  const { bot, blaze } = ledgeBot([['blaze_rod', 1]]);
  blaze.position = new Vec3(4.2, 31, 3.5);
  const reach = stand.blazeReach(bot, blaze);
  assert.equal(reach?.steps, 0, JSON.stringify(reach));
  const { combatRoute } = require('../src/mob-hunt');
  const route = await combatRoute(bot, { check() {} }, blaze, { allowed: () => true });
  assert.equal(route.reach.steps, 0, 'no walk asked of the fight');
});
