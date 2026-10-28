'use strict';
// Note 2404. full-21 (25589, 2026-10-28 17:12 to 17:3xZ) sat at 6.6 health, hunger 13, nothing to eat, beside a blaze
// spawner: by the Nether's lightest blow no hit was its last, so 'go on without food' held and no food was asked.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { lastHit } = require('../src/last-hit');

const bot = (mobs) => ({ health: 6.6, food: 13, game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' },
  entity: { position: new Vec3(0, 64, 0) }, inventory: { items: () => [], slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 7: { name: 'iron_leggings' }, 8: { name: 'golden_boots' } } },
  entities: Object.fromEntries(mobs.map((name, i) => [i, { name, position: new Vec3(3 + i, 64, 0), isValid: true }])) });

test('a blaze about whose fireball and its fire would end the bot makes it the last hit (note 2404)', () => {
  const h = lastHit(bot(['blaze']));
  assert(h, 'a last hit');
  assert.equal(h.kind, 'blaze');
  assert.match(h.says, /a hit from the blaze 3 blocks off ends the bot/);
});

test('with nothing about, the lightest blow of the dimension stands as before (note 2404)', () => {
  const h = lastHit(bot([]));
  assert(!h || h.kind !== 'blaze');
});
