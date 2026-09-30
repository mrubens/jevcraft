'use strict';
// Note 741b (newest artifacts/critic/*.md item 1; 25588 at -70,63,443, from
// about 09:48Z): health 1, hunger 16, no food carried, a box shut all round
// it built against a blaze. turn_priority asked twenty-one times, survival
// winning each at 0.83-0.98 for that same blaze, 1.9 blocks off, out of
// sight through the box's own wall; the resulting stance (take_cover,
// box_here) does nothing against a wall already shut. At 09:59:04 it
// picked restock_food ("Getting food here first") and never moved: survival
// preempted it fifteen seconds later, still claiming the same
// unreachable blaze. At 10:07:44, 1.4 health, it chose stay_and_fight.
//
// Root cause: src/danger.js's stanceMobs keeps a mob "held" against the
// bot by distance and an active stance alone, seen or not, on purpose
// (note 535: a mob stepping behind a rock mid-fight is not gone, or
// turn_priority would thrash every time a mob ducked out of sight for a
// tick) — but it never asked whether the bot is now walled in on every
// side, where an out-of-sight mob (walker or shooter) has no line through
// the rock at all, and so cannot be a reason to keep pressing the stance
// or preempting a chosen errand.
//
// Fix (src/danger.js, stanceMobs): a mob out of sight is dropped from the
// held set only once the bot is walled in on every side (unstuck.js's
// walledOf: every side closed at the feet or the head), not merely for
// stepping out of sight in the open, so note 535's own case (a distant
// mob behind cover, the bot not sealed) is unchanged.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');

// A box shut all round: air only at the bot's own feet and head cell, rock
// on every side and above and below.
function sealedBoxBot({ health = 1, food = 16, at = new Vec3(0.5, 63, 0.5) } = {}) {
  const feet = at.floored(), head = feet.offset(0, 1, 0);
  const open = new Set([`${feet}`, `${head}`]);
  const bot = { registry, game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health, food, time: { timeOfDay: 6000 },
    entity: { position: at.clone() }, entities: {}, inventory: { items: () => [], slots: [] },
    world: { raycast: from => ({ position: from.floored(), intersect: from }) },
    blockAt: p => { const k = `${p.floored()}`; return { position: p, name: open.has(k) ? 'air' : 'netherrack', boundingBox: open.has(k) ? 'empty' : 'block' }; } };
  return { bot, feet };
}

test('stanceMobs drops a mob out of sight once the bot is walled in on every side, not merely for stepping out of sight in the open (25588, note 741b)', () => {
  const { stanceMobs, immediateThreat } = require('../src/danger');
  const { bot, feet } = sealedBoxBot();
  const blaze = { id: 9, name: 'blaze', type: 'hostile', position: feet.offset(1.9, 0, 0), height: 1.8, width: 0.6, isValid: true };
  bot.entities = { 9: blaze };
  bot._stance = { choice: 'take_cover', ids: [9], at: Date.now() - 1000, ranAt: Date.now() - 500, health: bot.health, expects: { damage: 0, seconds: 15, oneHit: 2.5 } };
  assert.deepEqual(stanceMobs(bot), [], 'walled in on every side: the blaze through the wall is not kept');
  assert.equal(immediateThreat(bot), undefined, 'so survival does not keep pressing the same stance for it');
});

test('stanceMobs still keeps a mob out of sight while the bot is not walled in (note 535, unchanged)', () => {
  const { stanceMobs } = require('../src/danger');
  const { bot, feet } = sealedBoxBot();
  // One side open: not a box shut all round.
  bot.blockAt = p => { const k = `${p.floored()}`; const openHere = k === `${feet}` || k === `${feet.offset(0, 1, 0)}` || k === `${feet.offset(1, 0, 0)}` || k === `${feet.offset(1, 1, 0)}`;
    return { position: p, name: openHere ? 'air' : 'netherrack', boundingBox: openHere ? 'empty' : 'block' }; };
  const blaze = { id: 9, name: 'blaze', type: 'hostile', position: feet.offset(1.9, 0, 0), height: 1.8, width: 0.6, isValid: true };
  bot.entities = { 9: blaze };
  bot._stance = { choice: 'take_cover', ids: [9], at: Date.now() - 1000, ranAt: Date.now() - 500, health: bot.health, expects: { damage: 0, seconds: 15, oneHit: 2.5 } };
  assert.deepEqual(stanceMobs(bot).map(t => t.entity.id), [9], 'one side open: still held, as note 535 established');
});
