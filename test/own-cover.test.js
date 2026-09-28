'use strict';
// Walled in by its own cover, and a barter with no gold to wear (notes 615
// and 616).
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const { localMoves, describeMove, walledSays } = require('../src/unstuck');
const { noteLaid, laidAt, ownBlocksPlugin } = require('../src/own-blocks');

// mid-242-ae-nether-2-fortress-5 (25584) at (-105, 56, 108), 15:32:40 to
// 17:04Z: oak planks it made from its logs and put round itself against a
// ghast on every side at the feet and the head and over it, cobblestone
// under it, nether bricks two blocks north. Every walk found no route.
const FEET = new Vec3(-105, 56, 108);
const LAID_AT = Date.parse('2026-09-28T15:32:43Z');
function box() {
  const cells = {};
  const put = (dx, dy, dz, name) => { cells[`${FEET.x + dx},${FEET.y + dy},${FEET.z + dz}`] = name; };
  for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) { put(dx, -1, dz, 'cobblestone'); for (let dy = 0; dy <= 3; dy++) put(dx, dy, dz, 'air'); }
  const own = [];
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const dy of [0, 1]) { put(dx, dy, dz, 'oak_planks'); own.push(`${FEET.x + dx},${FEET.y + dy},${FEET.z + dz}`); }
  put(0, 2, 0, 'oak_planks'); own.push(`${FEET.x},${FEET.y + 2},${FEET.z}`);
  put(-1, -1, 0, 'oak_planks'); put(1, -1, 0, 'oak_planks');
  return { cells, own: new Set(own) };
}
const view = (cells, own, extra = {}) => ({ name: p => cells[`${p.x},${p.y},${p.z}`] ?? 'netherrack',
  laid: p => own.has(`${p.x},${p.y},${p.z}`) && cells[`${p.x},${p.y},${p.z}`] === 'oak_planks' ? { name: 'oak_planks', at: LAID_AT } : null,
  carried: { cobblestone: 1, stone_axe: 1 }, pickaxe: 'iron_pickaxe', axe: 'stone_axe', health: 20, ...extra });

test('walled in by the planks of its own cover, working free offers the dig through them, said as its own (mid-242-ae-nether-2-fortress-5, note 615)', () => {
  const { cells, own } = box();
  const { moves } = localMoves(view(cells, own), FEET, { goal: 'away', from: FEET });
  const keys = moves.map(m => m.key);
  for (const k of ['dig_east_feet', 'dig_east_head', 'dig_west_head', 'dig_north_feet', 'dig_south_head', 'dig_up']) assert(keys.includes(k), `${k} offered`);
  const head = moves.find(m => m.key === 'dig_east_head');
  assert.match(describeMove(head), /Dig the oak planks east, at head height, a block the bot laid itself at 15:32Z \(about 0\.6 s\)/);
  // Before: planks were no ground, and nothing at all was on offer.
  const before = localMoves(view(cells, own, { laid: undefined }), FEET, { goal: 'away', from: FEET });
  assert.deepEqual(before.moves.map(m => m.key), ['dig_down'], 'only the dig down, into the netherrack, and no way out at the sides');
  // The planks of a house it did not lay stay standing.
  const other = localMoves(view(cells, new Set()), FEET, { goal: 'away', from: FEET });
  assert(!other.moves.some(m => m.kind === 'dig' && /planks/.test(m.does)));
});

test('with the feet dug and the head still its planks, the head is offered, not only the cobblestone put back (mid-242-af-fortress-5, note 615)', () => {
  // 25587's flip: place east, dig east feet, place east, for an hour.
  const { cells, own } = box();
  cells[`${FEET.x + 1},${FEET.y},${FEET.z}`] = 'air';
  const { moves } = localMoves(view(cells, own), FEET, { goal: 'away', from: FEET });
  const keys = moves.map(m => m.key);
  assert(keys.includes('place_east'));
  assert(keys.includes('dig_east_head'), 'the planks at the head east, its own, can be dug');
  cells[`${FEET.x + 1},${FEET.y + 1},${FEET.z}`] = 'air';
  const out = localMoves(view(cells, own), FEET, { goal: 'away', from: FEET }).moves.find(m => m.key === 'step_east');
  assert(out, 'then the step east');
});

test('a plank by hand is three seconds, not half of one', () => {
  const { cells, own } = box();
  const m = localMoves(view(cells, own, { axe: null }), FEET, { goal: 'away', from: FEET }).moves.find(x => x.key === 'dig_east_head');
  assert.equal(m.seconds, 3);
});

test('the offer to work free says the bot is walled in by its own blocks', () => {
  const { cells, own } = box();
  assert.match(walledSays(view(cells, own), FEET), /walled in where it stands: every side is closed at the feet or the head, 9 of the 9 blocks round it its own \(oak planks, laid from 15:32Z\), which it can dig through/);
  cells[`${FEET.x + 1},${FEET.y},${FEET.z}`] = 'air'; cells[`${FEET.x + 1},${FEET.y + 1},${FEET.z}`] = 'air';
  assert.equal(walledSays(view(cells, own), FEET), null);
});

test('a block the bot placed is remembered as its own, in the goal across a restart, and forgotten once it is gone', () => {
  const blocks = {};
  const bot = new EventEmitter();
  bot.blockAt = p => ({ position: p, name: blocks[`${p}`] || 'air' });
  const goal = {};
  bot._stalls = { goalOf: () => goal };
  ownBlocksPlugin(bot);
  const p = new Vec3(-104, 56, 108);
  blocks[`${p}`] = 'oak_planks';
  bot.emit('blockPlaced', { position: p, name: 'air' }, { position: p, name: 'oak_planks' });
  assert.equal(laidAt(bot, p).name, 'oak_planks');
  assert.equal(goal.laid['-104,56,108'].name, 'oak_planks');
  // A restart: the bot's memory is new, the goal is read back.
  const again = { blockAt: bot.blockAt, _stalls: bot._stalls };
  assert.equal(laidAt(again, p).name, 'oak_planks');
  blocks[`${p}`] = 'air';
  assert.equal(laidAt(again, p), null);
  assert.equal(goal.laid['-104,56,108'], undefined);
  // Another's block, never placed by the bot, is not its own.
  blocks[`${new Vec3(0, 64, 0)}`] = 'oak_planks';
  assert.equal(laidAt(bot, new Vec3(0, 64, 0)), null);
  noteLaid(bot, { position: new Vec3(0, 64, 0), name: 'oak_planks' }, { goal: null });
  assert.equal(laidAt(bot, new Vec3(0, 64, 0)).name, 'oak_planks');
});

// Bartering: the gold to throw is the gold left once a gold piece is worn.
const registry = require('minecraft-data')('26.1');
function barterBot(items, { worn = null, piglinAt = new Vec3(-90, 41, 120) } = {}) {
  const list = Object.entries(items).map(([name, count]) => ({ name, count, type: registry.itemsByName[name].id }));
  const slots = []; if (worn) slots[8] = { name: worn };
  return { registry, game: { dimension: 'the_nether' }, entity: { position: new Vec3(-92.5, 41, 111.5) },
    entities: { 9: { id: 9, name: 'piglin', position: piglinAt, isValid: true, metadata: [] } },
    inventory: { items: () => list, slots } };
}

test('three ingots and six nuggets and no gold piece is no barter: the ladder does not take it, and the pearls say why (mid-242-af-fortress-5, note 616)', () => {
  const bartering = require('../src/bartering');
  const bot = barterBot({ gold_ingot: 3, gold_nugget: 6 });
  const goal = { kind: 'win' };
  assert.deepEqual(bartering.barterGold(bot), { total: 3, dressed: false, throwable: 0 });
  assert.equal(bartering.barterReady(bot, goal), false);
  assert.match(bartering.barterGoldSays(bot), /gold for 3 ingots carried and no gold piece to wear: piglins turn on a player in no gold, golden boots take 4 ingots, and one more is needed to throw/);
  // Five: boots and one to throw. Worn already: all three are thrown.
  assert.equal(bartering.barterGold(barterBot({ gold_ingot: 5 })).throwable, 1);
  assert.equal(bartering.barterReady(barterBot({ gold_ingot: 5 }), goal), true);
  assert.equal(bartering.barterGold(barterBot({ gold_ingot: 3 }, { worn: 'golden_boots' })).throwable, 3);
  assert.equal(bartering.barterGold(barterBot({ gold_ingot: 2, golden_helmet: 1 })).throwable, 2);
  // Nuggets make ingots: four ingots and nine nuggets is five.
  assert.equal(bartering.barterGold(barterBot({ gold_ingot: 4, gold_nugget: 9 })).throwable, 1);
});

test('the pearl routes do not offer a barter that cannot be dressed for, and say it (note 616)', () => {
  const { pearlRoutes } = require('../src/pearl-routes');
  const bot = barterBot({ gold_ingot: 3, gold_nugget: 6 }, { piglinAt: new Vec3(-40, 41, 111) });
  const goal = { kind: 'win', survival: {}, landmarks: [], portals: [] };
  const { options, notOffered } = pearlRoutes(bot, goal, { actions: { navigate: async () => {} } });
  assert.equal(options.pearls_barter, undefined);
  assert(notOffered.some(s => /a barter with piglins: gold for 3 ingots carried and no gold piece to wear/.test(s)), notOffered.join(' | '));
  const rich = barterBot({ gold_ingot: 9 }, { piglinAt: new Vec3(-40, 41, 111) });
  const offered = pearlRoutes(rich, goal, { actions: { navigate: async () => {} } }).options.pearls_barter;
  assert.match(offered.description, /gold enough for 5 ingots to throw.*golden boots made from four more first and worn/);
});
