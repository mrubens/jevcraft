'use strict';
// Note 1029: with nothing to lay, the pack's coal, glowstone dust, raw
// copper and quartz make blocks, and those are laid as any block.
const test = require('node:test');
const assert = require('node:assert/strict');
const pb = require('../src/pocket-blocks');

const bot = carried => ({ inventory: { items: () => Object.entries(carried).map(([name, count]) => ({ name, count })) } });

test('25594\'s pack: 132 coal, 19 glowstone dust, 19 raw copper and a table make 19 blocks; said with each', () => {
  const b = bot({ coal: 132, glowstone_dust: 19, raw_copper: 19, crafting_table: 1, gravel: 19, blaze_rod: 2 });
  const o = pb.offer(b);
  assert.deepEqual(o.makes.map(m => [m.block, m.count]), [['coal_block', 13], ['glowstone', 4], ['raw_copper_block', 2]]);
  assert.equal(o.total, 19);
  assert.equal(pb.says(b, o, { carried: 0, short: 20 }), 'Make blocks to lay from what is carried: 13 coal blocks from 117 of the 132 coal (9 each, 8 kept for fuel), 4 glowstones from 16 of the 19 glowstone dust (4 each), 2 raw copper blocks from 18 of the 19 raw copper (9 each): 19 blocks in about 9 seconds at a crafting table set down here, with no walk and nothing dug. They are laid as any block is (a coal block burns where fire reaches it; glowstone and the others do not). None is carried now. The way ahead is short of 20 blocks: these leave it 1 short.');
});

test('no table: the two-by-two ones alone; nothing to make: no offer; the blocks made are laid by the span', () => {
  assert.deepEqual(pb.offer(bot({ coal: 132, glowstone_dust: 8 })).makes.map(m => m.block), ['glowstone']);
  assert.equal(pb.offer(bot({ coal: 16, crafting_table: 1 })), null, 'eight kept for fuel leaves under nine');
  assert.equal(pb.offer(bot({ gravel: 19 })), null);
  const bridging = require('../src/bridging');
  assert.equal(bridging.blocksCarried(bot({ coal_block: 13, glowstone: 4, raw_copper_block: 2, quartz_block: 1, gravel: 19 })), 20);
});
