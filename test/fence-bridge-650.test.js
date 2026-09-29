'use strict';
// Note 650: mid-242-bb-nether-1-fortress-9 (25598), 23:22Z on 2026-09-28 to
// past 01:00Z. The bot stood on the tip of its own span of netherrack at
// y 51 (a diagonal from (-116, 51, 146) to (-109, 51, 140) with a bar north
// along x -114), twenty over the lava sea, and did not leave for 110
// minutes: 138 blocks walked, net 2, unstuck_move asked 52 times and none
// good 132 of 254 answers. It carried fifteen oak fences, a crafting table,
// a bed, sticks, a water bucket, an iron pickaxe and no block that
// PLACEABLE named; take_floor was offered every time and refused by the dig
// guard every time ("Refusing to open a drop beside the feet"); the rock
// mass that the piglins stood on lay five cells north. The region is as
// saved at 01:00Z (test/fixtures/span-end-mid-242-bb9.json).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { groundBot } = require('./fixtures/saved-ground');
const { localMoves, liveView, perform, islandOf, bridgeStock } = require('../src/unstuck');
const F = require('./fixtures/span-end-mid-242-bb9.json');

const KIT = [['gold_nugget', 20], ['bone', 1], ['coal', 119], ['stick', 3], ['flint', 10], ['mutton', 8], ['crafting_table', 1], ['lapis_lazuli', 9], ['raw_iron', 1], ['iron_sword', 1], ['leaf_litter', 19], ['oak_fence', 15], ['string', 2], ['white_bed', 1], ['wooden_hoe', 1], ['rotten_flesh', 2], ['raw_copper', 9], ['beef', 14], ['leather', 5], ['egg', 1], ['iron_pickaxe', 1], ['stone_axe', 1], ['water_bucket', 1], ['bucket', 1], ['cooked_mutton', 4], ['flint_and_steel', 1], ['quartz', 3]];
const without = (...names) => KIT.filter(([n]) => !names.includes(n));
const SPAN = [];
for (let x = -118; x <= -107; x++) for (let z = 136; z <= 148; z++) SPAN.push(`${x},51,${z}`);
function tipBot(items = KIT, at = new Vec3(-109.5, 52, 140.5)) {
  const bot = groundBot(F, { at, health: 20, food: 20, dimension: 'the_nether', worn: ['iron_helmet', 'iron_chestplate'], held: 'iron_sword', items });
  return bot;
}
function movesOf(bot, at = bot.entity.position.floored()) {
  const view = liveView(bot);
  // The span is the bot's own (own-blocks.js): every netherrack of it at y 51.
  view.laid = p => p.y === 51 && SPAN.includes(`${p.x},${p.y},${p.z}`) && view.name(p) === 'netherrack' ? { at: Date.parse('2026-09-28T23:23:00Z') } : null;
  return { view, ...localMoves(view, at, { goal: 'away', visits: {}, from: new Vec3(-109, 52, 140), breathS: 15 }) };
}

test('at the tip with the fifteen oak fences carried, a bridge is offered with its price: the ground is five cells of gap north, fifteen carried (note 650)', () => {
  const { moves } = movesOf(tipBot());
  const keys = moves.map(m => m.key);
  assert.ok(keys.includes('bridge_north') && keys.includes('bridge_west'), keys.join(', '));
  const north = moves.find(m => m.key === 'bridge_north');
  assert.equal(north.block, 'oak_fence');
  assert.match(north.does, /^By way of this cell the nearest ground that is not part of what the bot stands on is 5 cells of gap away, at \(-108, 50, 136\): 5 of the 15 fences carried would reach it\. Put an oak fence into the gap in the floor north, against the floor stood on: a floor cell to walk onto, not a whole block: a bar a quarter of a block wide and a block and a half tall, its top half a block over the floor beside it, so it is walked crouched \(a step up of half a block, no jump; a crouched body is held at the edge of the bar and does not walk off it\), one bar wide, and a fence cannot be pillared on; beyond it, north, there is no floor; under it, a drop of 19 blocks into lava under it/);
    assert.ok(!keys.some(k => k.startsWith('take_floor_')), 'no floor taken up: a fence is carried to put down');
});

test('too few carried says how many short', () => {
  const few = movesOf(tipBot([...without('oak_fence', 'crafting_table'), ['oak_fence', 3]])).moves.find(m => m.key === 'bridge_north');
  assert.match(few.does, /is 5 cells of gap away, at \(-108, 50, 136\): 3 fences carried, 2 short of it\./);
  const one = movesOf(tipBot([...without('oak_fence', 'crafting_table'), ['oak_fence', 1]])).moves.find(m => m.key === 'bridge_north');
  assert.match(one.does, /: 1 fence carried, 4 short of it\./);
});

test('the crafting table alone is a block to bridge with, said as the only one and staying where it is put; a fence is used before it', () => {
  const table = movesOf(tipBot(without('oak_fence'))).moves.find(m => m.key === 'bridge_north');
  assert.equal(table.block, 'crafting_table');
  assert.match(table.does, /Put the crafting table into the gap in the floor north, against the floor stood on: a whole block to walk onto; it is the crafting table carried, the only one, and it stays where it is put/);
  assert.equal(bridgeStock(liveView(tipBot())).name, 'oak_fence');
  assert.equal(bridgeStock(liveView(tipBot(without('oak_fence', 'crafting_table')))), null);
});

test('with nothing carried that holds, the floor beside is not offered to be taken up over the lava (its block burns) and the line says why; no bridge', () => {
  const { moves, here } = movesOf(tipBot(without('oak_fence', 'crafting_table')));
  const keys = moves.map(m => m.key);
  assert.ok(!keys.some(k => /^(take_floor|bridge)_/.test(k)), keys.join(', '));
  assert.ok(here.notOffered.some(t => /^take up the floor beside \((east|south|north|west)(, (east|south|north|west))*\): the block dug drops out of its cell with nothing under the cell to hold it, into lava, and burns; nothing is picked up and that cell of the floor is gone$/.test(t)), here.notOffered.join(' | '));
});

test('a span is an island of its own cells, twenty-one of them at the tip, and the rock mass beside it is ground', () => {
  const view = liveView(tipBot());
  const span = islandOf(view, new Vec3(-110, 51, 140));
  assert.equal(span.size, 21);
  assert.ok(span.has('(-116, 51, 146)') && span.has('(-114, 51, 137)'));
  assert.equal(islandOf(view, new Vec3(-108, 50, 136)), null, 'more than a hundred and fifty cells of floor: ground');
});

test('fences carried are said not to count toward a pillar or a rise, which lays a block under the feet as the body jumps', () => {
  const name = new Map();
  const set = (y, n) => name.set(y, n);
  for (let y = 40; y <= 60; y++) set(y, y <= 40 ? 'netherrack' : y <= 47 ? 'air' : y <= 50 ? 'netherrack' : 'air');
  const view = { name: p => p.x === 0 && p.z === 0 ? (name.get(p.y) ?? 'air') : p.y <= 40 ? 'netherrack' : 'air', carried: { oak_fence: 15, iron_pickaxe: 1 }, pickaxe: 'iron_pickaxe', pickaxeUses: 100, laid: () => null, health: 20 };
  const { risePlan } = require('../src/unstuck');
  const plan = risePlan(view, new Vec3(0, 41, 0));
  assert.match(plan.blocked, /^rise straight up through the rock over the head: \d+ blocks to lay before the rock, 0 carried that can be laid; the 15 oak fences carried cannot be laid under the feet \(a fence is a block and a half tall, and the body jumping over its cell cannot have one put there\)$/);
});

test('the bridge move equips the fence and places it against the floor stood on', async () => {
  const bot = tipBot();
  const placed = [];
  const fence = { name: 'oak_fence', count: 15 };
  bot.inventory.items = () => [fence];
  bot.equip = async item => { bot.heldItem = item; };
  bot.placeBlock = async (ref, face) => { placed.push([`${ref.position}`, `${face}`]); };
  const { moves } = movesOf(bot);
  const north = moves.find(m => m.key === 'bridge_north');
  await perform(bot, { check() {} }, north, { dig: async () => { throw new Error('no dig'); } });
  assert.equal(bot.heldItem.name, 'oak_fence');
  assert.equal(placed.length, 1);
  // The gap is (-110, 51, 139); the block it is placed against is the span's own at (-110, 51, 140), on its north face.
  assert.deepEqual(placed[0], ['(-110, 51, 140)', '(0, 0, -1)']);
});

test('a step down onto a post the span does not join says so in the step: a floor of one cell, and the way back up (note 650)', () => {
  // (-109, 49, 139) is the top of three netherrack over the lava, two under the tip's floor.
  const { moves } = movesOf(tipBot(KIT, new Vec3(-108.6, 52, 140.5)));
  const north = moves.find(m => m.key === 'step_north');
  assert.match(north.does, /^Walk one block north, dropping 2, and it lands on a floor of 1 cell that is not joined to the floor stood on \(the way back up is 2 blocks, and a jump climbs one\)\.$/);
  assert.equal(north.dryFooting, false, 'not "ends on dry ground"');
  const west = moves.find(m => m.key === 'step_west');
  assert.doesNotMatch(west.does, /lands on/, 'a step along the span is the same floor');
});

test('the floor stood on says how big it is and where the nearest ground lies from any of its cells, and how far along it (here.floor)', () => {
  const { here } = movesOf(tipBot(KIT, new Vec3(-109.5, 52, 141.5)));
  assert.equal(here.floor, 'a floor of 21 cells, joined to no ground (a span or an island); the nearest ground that is not part of it is 4 cells of gap from the floor cell at (-109, 51, 140), 1 step along it from here, at (-108, 50, 136)');
});

// The same day, 25585 (mid-242-ca-nether-1): a bar of netherrack at y 42 laid
// north over the lava sea for 110 cells; out of netherrack at (117, 43, -357)
// it walled itself in with gravel behind it and stood at (117.5, 43, -360)
// for half an hour, fifteen oak fences, a crafting table, a furnace and six
// gravel carried, no pickaxe. The bar ends at (116, 42, -374); land lies west.
test('25585 on its bar: the floor beyond its own wall is 18 cells, the ground is eight steps along it and four cells of gap west; from here twelve, fifteen fences carried', () => {
  const G = require('./fixtures/span-tip-mid-242-ca.json');
  const items = [['crimson_roots', 1], ['oak_planks', 1], ['coal', 108], ['cooked_mutton', 5], ['bucket', 1], ['white_bed', 1], ['oak_fence', 15], ['gold_nugget', 29], ['water_bucket', 1], ['iron_sword', 1], ['gravel', 6], ['crafting_table', 1], ['flint_and_steel', 1], ['furnace', 1], ['stone_axe', 1]];
  const bot = groundBot(G, { at: new Vec3(117.5, 43, -359.5), health: 20, food: 20, dimension: 'the_nether', worn: ['iron_helmet', 'iron_chestplate'], held: 'iron_sword', items });
  const view = liveView(bot);
  view.laid = p => p.y === 42 && p.x >= 116 && p.x <= 117 && view.name(p) === 'netherrack' ? { at: Date.parse('2026-09-29T01:00:00Z') } : null;
  const { moves, here } = localMoves(view, bot.entity.position.floored(), { goal: 'away', visits: {}, from: new Vec3(117, 43, -360), breathS: 15 });
  assert.equal(here.floor, 'a floor of 18 cells, joined to no ground (a span or an island); the nearest ground that is not part of it is 4 cells of gap from the floor cell at (117, 42, -368), 8 steps along it from here, at (112, 41, -368)');
  const west = moves.find(m => m.key === 'bridge_west'), east = moves.find(m => m.key === 'bridge_east');
  assert.match(west.does, /^By way of this cell the nearest ground that is not part of what the bot stands on is 12 cells of gap away, at \(112, 41, -368\): 12 of the 15 fences carried would reach it\. Put an oak fence/);
  assert.match(east.does, /24 cells of gap away, at \(112, 41, -378\): 15 fences carried, 9 short of it\. The shortest of the ways from here is west, 12 cells\./);
  // Gravel falls and is no bridge; the wall behind is the bot's own.
  assert.ok(here.notOffered.some(t => /^place east: a block that falls \(gravel\)/.test(t)));
});

test('the shortest of the bridge ways is said on the longer ones, with the same ground at their ends', () => {
  const { moves } = movesOf(tipBot(KIT, new Vec3(-109.5, 52, 141.5)));
  const east = moves.find(m => m.key === 'bridge_east'), south = moves.find(m => m.key === 'bridge_south');
  assert.equal(east.groundCells, 6);
  assert.equal(south.groundCells, 8);
  assert.doesNotMatch(east.does, /shortest of the ways/);
  assert.match(south.does, /8 cells of gap away, at \(-108, 50, 136\): 8 of the 15 fences carried would reach it\. The shortest of the ways from here is east, 6 cells\. Put an oak fence/);
});
