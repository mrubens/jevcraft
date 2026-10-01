'use strict';
// Note 768c: 25593 (mid-243-bi, 2026-10-01 03:37 to 03:59Z) climbed from
// y -39 with an iron pickaxe at 47 uses against a staircase of 217 digs, a
// crafting table, 128 cobblestone and one stick carried, the trial chambers'
// oak planks 52 blocks off: wood_first was offered only with no pickaxe at
// all and within 32 blocks; the climb went on by hand from y -21, the chat
// saying "no wood for one". It walked to a column standing on a pointed
// dripstone's tip and was corrected by the server for two minutes.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { sim } = require('./support/falling-world');

const ground = y => (y <= 0 ? 'deepslate' : y <= 62 ? 'stone' : 'air');
const feet = new Vec3(0, -39, 0);
function mine(items, { planksAt = new Vec3(52, -39, 0) } = {}) {
  const cells = { '0,-39,0': 'air', '0,-38,0': 'air' };
  if (planksAt) cells[`${planksAt.x},${planksAt.y},${planksAt.z}`] = 'oak_planks';
  const w = sim({ ground, feet, cells, items });
  w.bot.findBlocks = () => (planksAt ? [planksAt] : []);
  return w;
}
const uses = (name, left) => [name, 1, { durabilityUsed: registry.itemsByName[name].maxDurability - left }];

test('25593: a pickaxe that will not last the climb, one stick short: wood_first from the planks 52 blocks off, the walk at the measured pace', () => {
  const { climbOptions, straightUpColumn } = require('../src/surface');
  const { bot } = mine([uses('iron_pickaxe', 47), ['stick', 1], ['crafting_table', 1], ['cobblestone', 128], ['cobbled_deepslate', 64]]);
  const { options, estimate } = climbOptions(bot, feet.offset(24, 32, 0), straightUpColumn(bot, feet, { throughFalls: true }), { goal: {} });
  assert(options.wood_first, `offered: ${Object.keys(options)}`);
  assert.equal(options.wood_first.item, 'stone_pickaxe');
  assert.match(options.wood_first.description, /^Make a stone pickaxe first: the nearest wood known is oak planks 52 blocks off.*break 2 plank blocks .* for the sticks \(1 stick carried\), craft it at the crafting table carried with the cobblestone carried: about \d+ (seconds|minutes) there and back with the crafting \(the walk at the bot's measured pace, .*38\.5 blocks a minute/);
  assert.match(options.wood_first.description, /against the climbs on the 47 uses carried, then by hand, beside it/);
  assert(!options.pickaxe_first, 'no pickaxe from the pockets: one stick, no planks');
  assert(Number.isFinite(estimate.wood_first));
});

test('a pickaxe that lasts the climb: nothing made first is offered', () => {
  const { climbOptions, straightUpColumn } = require('../src/surface');
  const { bot } = mine([uses('iron_pickaxe', 249), ['stick', 1], ['crafting_table', 1], ['cobblestone', 128]]);
  const { options } = climbOptions(bot, feet.offset(24, 32, 0), straightUpColumn(bot, feet, { throughFalls: true }), { goal: {} });
  assert(!options.wood_first && !options.pickaxe_first, `offered: ${Object.keys(options)}`);
});

test('a wooden pickaxe with sticks and a table and no cobblestone: a stone pickaxe from the stone here is offered first', () => {
  const { climbOptions, straightUpColumn } = require('../src/surface');
  const { bot } = mine([uses('wooden_pickaxe', 59), ['stick', 2], ['crafting_table', 1]], { planksAt: null });
  const { options, estimate } = climbOptions(bot, feet.offset(24, 32, 0), straightUpColumn(bot, feet, { throughFalls: true }), { goal: {} });
  assert(options.pickaxe_first, `offered: ${Object.keys(options)}`);
  assert.equal(options.pickaxe_first.item, 'stone_pickaxe');
  assert.match(options.pickaxe_first.description, /^Make a stone pickaxe first from the pockets: 2 sticks carried, the crafting table carried, 3 stone dug here with the pickaxe carried for the head; about \d+ seconds; then the climb with it, .*\(131 uses, beside the 59 the pickaxes carried have left against about \d+ digs on the shortest way up\)/);
  assert(!options.wood_first);
  assert(Number.isFinite(estimate.pickaxe_first));
});

test('no pickaxe, planks and cobblestone carried: the stone pickaxe from the pockets is offered', () => {
  const { climbOptions, straightUpColumn } = require('../src/surface');
  const { bot } = mine([['oak_planks', 6], ['cobblestone', 10]], { planksAt: null });
  const { options } = climbOptions(bot, feet.offset(24, 32, 0), straightUpColumn(bot, feet, { throughFalls: true }), { goal: {} });
  assert.equal(options.pickaxe_first?.item, 'stone_pickaxe');
  assert.match(options.pickaxe_first.description, /sticks from two planks, a crafting table from four planks, the cobblestone carried for the head/);
});

test('a pointed dripstone is not a floor a column walked to stands on', () => {
  const { walkedColumns } = require('../src/surface');
  const cells = { '0,-39,0': 'air', '0,-38,0': 'air', '1,-39,0': 'air', '1,-38,0': 'air', '2,-39,0': 'air', '2,-38,0': 'air', '2,-40,0': 'pointed_dripstone' };
  const { bot } = sim({ ground, feet, cells });
  const at = walkedColumns(bot, feet).map(c => `${c.cell.x},${c.cell.y},${c.cell.z}`);
  assert(at.includes('1,-39,0'), at.join(' '));
  assert(!at.some(k => k.startsWith('2,')), `not over the dripstone: ${at.join(' ')}`);
});

test('the climb\'s night line says it is on its way up, not there', () => {
  const src = require('node:fs').readFileSync(require.resolve('../src/narration'), 'utf8');
  assert(!/'Up to the surface\. Night out there/.test(src));
  assert.match(src, /On my way up to the surface\. Night out there, so eyes open\./);
});
