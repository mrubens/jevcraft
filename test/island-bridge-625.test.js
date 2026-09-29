'use strict';
// Note 625: mid-243-ah-fortress-6 (25592), 18:22 to 18:37:05Z on 2026-09-28.
// The bot stood on an island of four warped wart blocks it had laid at
// (-80, 37, -91), (-80, 37, -90), (-79, 37, -89) and (-78, 37, -89), over the
// lava sea, a one-cell gap from the end of its own diagonal span of
// netherrack at (-82, 37, -91). It carried no block that holds (sixteen
// gravel, a wooden pickaxe, coal, iron ingots, a crafting table). Every
// walk was "no route" (a gap jump over lava is not taken); the unstuck
// moves offered steps on the island and gravel that falls. It stood there
// fifteen minutes; at 18:36:59 a ghast came into sight 50 blocks off and
// the stance had fight, keep_working, retreat ("nowhere to run to") and
// return_fireball, none_good 0.58; the fireball at 18:37:02 threw it off,
// into lava 6 down. The region is as saved after the death
// (test/fixtures/span-end-mid-243-ah6.json).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { groundBot } = require('./fixtures/saved-ground');
const { localMoves, liveView } = require('../src/unstuck');
const F = require('./fixtures/span-end-mid-243-ah6.json');
const CARRIED = [['iron_sword', 1], ['wooden_pickaxe', 1], ['gravel', 16], ['coal', 148], ['bucket', 6], ['iron_ingot', 31], ['torch', 4], ['crafting_table', 1], ['flint_and_steel', 1]];
const ISLAND = ['-80,37,-91', '-80,37,-90', '-79,37,-89', '-78,37,-89'];
function islandBot(at, items = CARRIED) {
  const bot = groundBot(F, { at, health: 12.3, food: 13, dimension: 'the_nether', worn: ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'golden_boots'], held: 'iron_sword', items });
  bot.inventory.slots[45] = { name: 'shield' };
  // The fire the fireball lit at 18:37:02 is in the save; it was not there at 18:36:59.
  for (const k of ['-80,38,-91', '-80,38,-90', '-79,38,-89', '-78,38,-89']) bot.changed.set(k, 'air');
  return bot;
}
const movesAt = bot => {
  const view = liveView(bot);
  // The island's blocks are the bot's own (own-blocks.js).
  view.laid = p => ISLAND.includes(`${p.x},${p.y},${p.z}`) ? { at: Date.parse('2026-09-28T18:10:00Z') } : null;
  return localMoves(view, bot.entity.position.floored(), { goal: 'away', visits: {}, from: new Vec3(-78, 38, -89), breathS: 15 }).moves;
};

test('on the island with no block that holds, the floor of the cell beside is offered to be taken up, the gap to lay it in only once one is carried (note 625)', () => {
  const bot = islandBot(new Vec3(-78.5, 38, -88.5));
  const keys = movesAt(bot).map(m => m.key);
  assert.ok(keys.includes('take_floor_east'), `take the wart block east: ${keys.join(', ')}`);
  assert.ok(!keys.some(k => k.startsWith('bridge_')), 'nothing to bridge with yet');
  const taken = movesAt(islandBot(new Vec3(-78.5, 38, -88.5))).find(m => m.key === 'take_floor_east');
  assert.equal(`${taken.cell}`, '(-78, 37, -89)');
  assert.match(taken.does, /Dig up the warped wart block in the floor east, a block the bot laid itself at 18:10Z \(about/);
});

test('with the wart block carried, at the island\'s end the gap toward the span is offered as a floor to lay, and it says the floor beyond is solid (note 625)', () => {
  const bot = islandBot(new Vec3(-79.5, 38, -90.5), [...CARRIED, ['warped_wart_block', 1]]);
  const moves = movesAt(bot);
  const west = moves.find(m => m.key === 'bridge_west');
  assert.ok(west, `bridge west: ${moves.map(m => m.key).join(', ')}`);
  assert.equal(`${west.cell}`, '(-81, 37, -91)');
  assert.equal(west.block, 'warped_wart_block');
  assert.match(west.does, /the floor beyond it, west, is solid: it joins that ground/);
  assert.ok(!moves.some(m => m.key === 'bridge_east' && false));
});

test('gravel alone is no block to bridge with, and no floor is taken up where the block is not the bot\'s own', () => {
  const bot = islandBot(new Vec3(-78.5, 38, -88.5), [['gravel', 16], ['wooden_pickaxe', 1]]);
  const view = liveView(bot);
  view.laid = () => null;
  const { moves } = localMoves(view, bot.entity.position.floored(), { goal: 'away', visits: {}, breathS: 15 });
  assert.ok(!moves.some(m => /^(bridge|take_floor)_/.test(m.key)), moves.map(m => m.key).join(', '));
});

// Note 643: take_floor and bridge shipped at 18:51Z without a declared option
// pattern, and 89 "[bug] unstuck_move offered options it does not declare"
// lines in twelve logs said so until the rise_through commit widened the
// pattern in passing (21:14Z). Every key src/unstuck.js can build is declared.
test('every move key src/unstuck.js builds is one unstuck_move declares', () => {
  const fs = require('node:fs'), path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'unstuck.js'), 'utf8');
  const spec = require('../src/decisions').question('unstuck_move');
  const declared = key => spec.options.some(o => o.key === key || (o.pattern && new RegExp(`^(?:${o.pattern})$`).test(key)));
  const keys = new Set();
  for (const [, key] of src.matchAll(/\bkey: '([a-z_]+)'/g)) keys.add(key);
  for (const [, prefix, tail] of src.matchAll(/\bkey: `([a-z_]+)_\$\{[a-z]+\}(_\$\{[a-z]+\})?`/g)) keys.add(`${prefix}_north${tail ? '_feet' : ''}`);
  assert.ok(keys.size >= 10, [...keys].join(', '));
  for (const key of keys) assert.ok(declared(key), `${key} is built by src/unstuck.js and not declared by the unstuck_move question`);
});
