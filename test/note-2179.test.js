'use strict';
// Note 2179: the record of pickaxe-less, block-less Nether spells is said on the death chosen to start over and on the fact beside its siblings.
const test = require('node:test');
const assert = require('node:assert/strict');
const RF = require('../src/respawn-fresh');
test('the spells record is one sentence with both ends of the trade', () => {
  const s = RF.spellsSays();
  assert.match(s, /^On the full runs \(2026-10-25 06:00Z to 10-26 09:00Z\) a bot stood in the Nether with no pickaxe and no block 19 times, 239 minutes in all \(the median spell about 9 minutes, the longest 115, with 60 'none good' answers in it\): 1 of the 19 ended in a death, 18 in a pickaxe or blocks got, or the portal reached, on the ground the bot could walk\.$/);
  const bot = { game: { dimension: 'the_nether' }, entity: { position: { x: 0, y: 64, z: 0 } }, spawnPoint: null, inventory: { items: () => [] } };
  assert.ok(RF.says(bot, {}, { lava: { distance: 5, at: { x: 1, y: 63, z: 1 } } }).includes(s.charAt(0).toLowerCase() + s.slice(1)));
});
