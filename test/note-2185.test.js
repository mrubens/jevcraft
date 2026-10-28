'use strict';
// Note 2185: the speedrun ladder's three changes — the bed question's order and words, the bed's kit chest first on the End kit, gold ore for the barter.
const test = require('node:test');
const assert = require('node:assert/strict');

test('the bed question: second_bed first, the carried bed says the run-long upside, no fleet paragraph', () => {
  const { bedAfterSleepTree } = require('../src/survival');
  const bot = { inventory: { items: () => [{ name: 'white_wool', count: 3 }] }, entity: { position: { x: 0, y: 64, z: 0 } }, spawnPoint: { x: 100, y: 64, z: 0 } };
  const goal = { gameProgress: { clock: { playedMs: 10 * 3600000, byDoing: { wait_in_shelter: 3600000 } } } };
  const tree = bedAfterSleepTree(bot, { deaths: [] }, Date.now(), { bedNow: { from: '3 wool and 3 planks', item: 'white_bed' }, goal });
  assert.deepEqual(Object.keys(tree), ['second_bed', 'leave_as_respawn'], 'no carrying the only bed (note 2251)');
  assert.match(tree.second_bed.description, /^(?:This way: .*? health(?: \(more than the bot has\))?\. )?Leave this bed standing as the respawn and make another to carry.*nothing about the respawn changes now/);
  for (const k of Object.keys(tree)) { assert.ok(!/fresh trials 2026-09-30/.test(tree[k].description), `${k} carries the fleet paragraph`); assert.ok(tree[k].description.length < 700, `${k} is ${tree[k].description.length} chars`); }
  assert.match(tree.leave_as_respawn.description, /This run so far: 60 minutes sealed in waiting/);
});

test('pearl_order: the gold ore in view is a route, priced in ingots and pearls', () => {
  const { routes, tree } = require('../src/pearl-order');
  const Vec3 = require('vec3').Vec3;
  const bot = { game: { dimension: 'the_nether' }, entity: { position: new Vec3(0, 64, 0) }, health: 20, food: 20,
    inventory: { items: () => [{ name: 'iron_pickaxe', count: 1 }], slots: [] }, registry: { blocksByName: { nether_gold_ore: { id: 7 } }, itemsByName: {} },
    findBlocks: ({ matching }) => matching === 7 ? [new Vec3(5, 64, 2), new Vec3(6, 64, 2), new Vec3(7, 63, 3), new Vec3(9, 64, 4), new Vec3(12, 64, 4), new Vec3(14, 65, 6), new Vec3(16, 64, 6), new Vec3(18, 64, 8), new Vec3(20, 64, 8)] : [],
    entities: { 1: { name: 'piglin', isValid: true, position: new Vec3(10, 64, 10) } } };
  const r = routes(bot, { landmarks: [] });
  assert.deepEqual(r.goldOre, { count: 9, nearest: 5, piglinsNear: 1 });
  const t = tree(bot, { landmarks: [], survival: {} }, r).tree;
  assert.match(t.mine_gold_for_barter.description, /^(?:This way: .*? health(?: \(more than the bot has\))?\. )?Mine the 9 nether gold ores within 32 blocks \(the nearest 5 off\) and barter the gold with the piglins: an ore drops two to six nuggets \(about four\), nine nuggets make an ingot, so about 4 ingots from these, and the measured barter is nine ingots a pearl .* about 0\.4 pearls' worth; .* 1 piglin within 32 now\./);
});
