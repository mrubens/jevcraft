'use strict';
// The coming night said by day on the strategy question (note 2158).
const test = require('node:test');
const assert = require('node:assert');
const { nightAheadSays, pickaxeSays, NIGHT_MINUTES } = require('../src/night-ahead');

const botWith = (items, timeOfDay = 2045, dimension = 'overworld') => ({ time: { timeOfDay }, game: { dimension }, inventory: { items: () => items } });
const goal = { gameProgress: { clock: { byDoing: { wait_in_shelter: 153 * 60000, night_mine: 49 * 60000, sleep: 4 * 60000 } } } };

test('a bare bot by day is told the night ahead: dusk, its length, what it is spent on, and that no pickaxe can be made (full-6, 2026-10-26 05:13Z)', () => {
  const s = nightAheadSays(botWith([{ name: 'dirt', count: 16 }, { name: 'beef', count: 3 }]), goal);
  assert.match(s, /^Dusk in about 6\.2 real minutes; the night from dusk to dawn is about 11\.3 real minutes\./);
  assert.equal(NIGHT_MINUTES, 11.3);
  assert.match(s, /no bed is carried/);
  assert.match(s, /no pickaxe is carried and none can be made from what is carried \(0 logs, 0 planks, no crafting table: a table and a wooden pickaxe take two logs' worth of planks\)/);
  assert.match(s, /This run so far: 153 minutes sealed waiting through nights, 49 night-mining, 4 asleep\./);
});

test('a pickaxe carried, or logs for one, is said as the mine the night can be', () => {
  assert.equal(pickaxeSays([{ name: 'stone_pickaxe', count: 1 }]), 'a stone pickaxe is carried');
  assert.match(pickaxeSays([{ name: 'oak_log', count: 2 }]), /^no pickaxe is carried, but a wooden pickaxe can be made from what is carried \(2 logs\)/);
  assert.match(pickaxeSays([{ name: 'oak_log', count: 2 }, { name: 'cobblestone', count: 5 }]), /a stone pickaxe can be made/);
  assert.match(pickaxeSays([{ name: 'oak_log', count: 1 }]), /none can be made/);
  assert.match(pickaxeSays([{ name: 'crafting_table', count: 1 }, { name: 'oak_planks', count: 3 }, { name: 'stick', count: 2 }]), /a wooden pickaxe can be made/);
});

test('nothing is said off the Overworld or without a clock; by night, the dawn (note 2306)', () => {
  assert.match(nightAheadSays(botWith([], 12000), goal), /^Night now: dawn in about 9\.2 real minutes\./);
  assert.equal(nightAheadSays(botWith([], 2000, 'the_nether'), goal), null);
  assert.equal(nightAheadSays({ time: {}, game: { dimension: 'overworld' }, inventory: { items: () => [] } }, goal), null);
});
