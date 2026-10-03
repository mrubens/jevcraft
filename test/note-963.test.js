'use strict';
// Note 963: 25584 (mid-241-dx, 2026-10-03 02:12:10 to 02:13:23Z) was asked its
// stance against one pillager at each bolt, every 4 to 6 seconds.
const test = require('node:test');
const assert = require('node:assert/strict');
const holds = require('../src/holds');

const pillager = { entity: { id: 3, name: 'pillager', position: { x: 8, y: 64, z: 0 } }, distance: 8, visible: true, shoots: true };
const skeleton = { entity: { id: 4, name: 'skeleton', position: { x: -9, y: 64, z: 0 } }, distance: 9, visible: true, shoots: true };
const bolt = { name: 'arrow' };

test('a bolt from the shooter a fight faces does not end the hold; one under cover does, and so does a shooter it was not chosen against', () => {
  const fight = holds.begin({ choice: 'fight', at: 0, health: 20, mobs: [pillager], offered: ['fight', 'take_cover'] });
  assert.equal(holds.diverged(fight, { now: 3000, health: 20, mobs: [pillager], offered: ['fight', 'take_cover'], shot: bolt }), null);
  const cover = holds.begin({ choice: 'take_cover', at: 0, health: 20, mobs: [pillager], offered: ['fight', 'take_cover'] });
  assert.match(holds.diverged(cover, { now: 3000, health: 20, mobs: [pillager], offered: ['fight', 'take_cover'], shot: bolt }) || '', /a shot came at the bot/);
  assert.ok(holds.diverged(fight, { now: 3000, health: 20, mobs: [pillager, skeleton], offered: ['fight', 'take_cover'], shot: bolt }), 'a new shooter about');
});

test('with a hoglin about over a drop into lava, shield guard and the pillar say what followed them (note 966)', () => {
  const { optionSays } = require('../src/knock-record');
  assert.match(optionSays('shield_guard', ['hoglin']), /shield guard chosen with a drop that kills within three blocks and a hoglin about, 15 times .*: 4 of them had the bot in lava within 30 seconds\./);
  assert.match(optionSays('pillar', ['hoglin']), /14 times .*: 0 of them/);
  assert.match(optionSays('take_cover', ['ghast', 'hoglin']), /a ghast about/, 'the ghast table first');
});
