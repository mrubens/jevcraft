'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const trip = require('../src/trip-kit');
const { registry, establishedHome } = require('./fixtures/home-world');

const byItem = moves => Object.fromEntries(moves.map(m => [m.item, m.count]));
const carrying = items => ({ registry, inventory: { items: () => items.map(([name, count]) => ({ name, count })) } });

test('a trip takes its kit: the best tools, shield, bow, twenty points of food, half a stack of blocks, torches, water and the bed', () => {
  const bot = carrying([['diamond_sword', 1], ['iron_sword', 1], ['diamond_pickaxe', 1], ['stone_pickaxe', 1], ['shield', 1], ['bow', 1], ['arrow', 64],
    ['cooked_beef', 12], ['cobblestone', 128], ['torch', 40], ['water_bucket', 1], ['white_bed', 1], ['raw_iron', 58], ['lapis_lazuli', 64], ['diamond', 3], ['blaze_rod', 7]]);
  const keep = trip.tripKeep(bot, 'deep_dark');
  assert.deepEqual(keep, { diamond_sword: 1, diamond_pickaxe: 1, shield: 1, bow: 1, water_bucket: 1, white_bed: 1, arrow: 32, torch: 16, cobblestone: 32, cooked_beef: 3 });
  const out = byItem(trip.tripDeposits(bot, 'deep_dark'));
  assert.deepEqual(out, { iron_sword: 1, stone_pickaxe: 1, arrow: 32, cooked_beef: 9, cobblestone: 96, torch: 24, raw_iron: 58, lapis_lazuli: 64, diamond: 3, blaze_rod: 7 });
  assert.equal(trip.tripKeep(carrying([['golden_helmet', 1], ['golden_boots', 1]]), 'bastion').golden_helmet, 1, 'gold goes to a bastion');
});

test('packing light leaves the rest in a chest held for the trip, and the chest is not emptied while the trip is on', async () => {
  const w = await establishedHome({ items: [['diamond_sword', 1], ['diamond_pickaxe', 1], ['cooked_beef', 12], ['cobblestone', 64], ['raw_iron', 58], ['lapis_lazuli', 64], ['diamond', 3]] });
  const container = [];
  const window = { inventoryStart: 27, inventoryEnd: 63,
    items: () => w.bot.inventory.items().map(i => Object.assign(i, { slot: 27 + w.stacks.indexOf(i) })),
    containerItems: () => container.map((i, n) => Object.assign(i, { slot: n })),
    firstEmptyContainerSlot: () => container.length < 27 ? container.length : null,
    get slots() { const all = Array(63).fill(null); container.forEach((c, n) => { all[n] = c; }); return all; },
    deposit: async (type, meta, count) => { const name = registry.items[type].name; w.take(name, count); container.push({ name, count, type }); },
    close: () => {} };
  w.bot.openContainer = async () => window;
  const actions = { ...w.actions, acquireStep: async (b, t, item, n) => w.give(item, n) };
  await trip.packLight(w.bot, new Task('trip'), w.goal, w.save, actions, 'deep_dark');
  const stored = Object.fromEntries(container.map(i => [i.name, i.count]));
  assert.equal(stored.raw_iron, 58); assert.equal(stored.diamond, 3); assert.equal(stored.cobblestone, 32);
  assert(!stored.diamond_sword && !stored.diamond_pickaxe, 'the tools go on the trip');
  assert.equal(w.goal.caches[0].hold, 'deep_dark');
  assert.equal(require('../src/field-cache').nearCache(w.bot, w.goal), null, 'held while the trip is on');
  assert(trip.packedFor(w.goal, 'deep_dark'), 'the next turn does not pack again');
  trip.tripOver(w.goal, 'deep_dark');
  assert(require('../src/field-cache').nearCache(w.bot, w.goal), 'the trip over, the chest is emptied when passing');
});
