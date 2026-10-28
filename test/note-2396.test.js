'use strict';
// Note 2396. full-23 (25592, 2026-10-28 15:48:25Z) came back to life 55 blocks from its kit, the drops' five minutes
// running from the death, and took wood and food first: the walk back began 85 seconds in.
const test = require('node:test');
const assert = require('node:assert/strict');
const { ageingHere } = require('../src/corpse-run');

const T0 = Date.parse('2026-10-28T15:48:25Z');
const bot = { game: { dimension: 'overworld' }, entity: { position: { x: -384, y: 64, z: 290 } } };
const run = extra => ({ survival: { deaths: [{ at: '2026-10-28T15:48:25.000Z', dimension: 'overworld', position: { x: -333, y: 61, z: 269 } }] }, corpseRunFor: '2026-10-28T15:48:25.000Z', corpseRunsEarlier: [], corpseRun: { deathAt: '2026-10-28T15:48:25.000Z', position: { x: -333, y: 61, z: 269 }, dimension: 'overworld', items: { diamond: 8 }, passes: 0, stuck: 0, status: 'open', loadedAt: '2026-10-28T15:48:25.000Z', ...extra } });

test('the drops ageing here put the walk back first; once Jev left them, or their time is up, they do not (note 2396)', () => {
  assert(ageingHere(bot, run(), T0 + 30000));
  assert.equal(ageingHere(bot, run({ choice: 'leave_them' }), T0 + 30000), null);
  assert.equal(ageingHere(bot, run(), T0 + 6 * 60000), null);
});
