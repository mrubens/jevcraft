'use strict';
// Note 619: mid-242-bb-fortress-5 (25584, 17:28:22Z) stood at the end of its
// own span over the lava sea, on the oak plank it had laid at (-83, 38, 107),
// a ghast 56 blocks off to the north in sight, carrying nine wool (five
// white, two light gray, two gray), fourteen gravel and no other block. The
// stance said "buildingBlocks: 0" and "Too few blocks carried (14) to wall
// the 3 open sides (6, 3 of them floors under a wall, which gravel or sand
// does not make)", offered no cover and no rail, and Jev held on the span
// (0.45, none_good 0.37). The fireball met the raised shield (no damage) and
// pushed the bot 2.3 blocks south off the span's end, 7 into the lava, with
// no ground a swim reaches: dead three seconds later. The region is as saved
// after the death (test/fixtures/span-end-ghast-mid-242-bb5.json); the span
// the blast broke at (-83, 38, 105..106) is put back.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { Survival, wallStock, wallCells } = require('../src/survival');
const { threats } = require('../src/danger');
const shelter = require('../src/shelter');
const { groundBot } = require('./fixtures/saved-ground');

const noop = async () => {};
const F = require('./fixtures/span-end-ghast-mid-242-bb5.json');
const CARRIED = [['iron_sword', 1], ['stone_axe', 1], ['wooden_pickaxe', 1], ['gravel', 14], ['oak_fence', 15], ['white_wool', 5], ['light_gray_wool', 2], ['gray_wool', 2],
  ['mutton', 8], ['cooked_mutton', 3], ['beef', 14], ['water_bucket', 1], ['crafting_table', 1]];
// 17:28:19.4, as the flight has it: the bot at (-82.5, 39, 107.25), the ghast at (-76.5, 36, 52.1), 55.6 off, in sight.
function spanEndBot({ items = CARRIED } = {}) {
  const bot = groundBot(F, { at: new Vec3(-82.5, 39, 107.25), health: 20, food: 20, dimension: 'the_nether', worn: ['iron_helmet', 'iron_chestplate'], held: 'iron_sword',
    items, mobs: [{ id: 1667, name: 'ghast', at: new Vec3(-76.5, 36, 52.1), height: 4, width: 4 }] });
  bot.inventory.slots[45] = { name: 'shield' };
  for (const k of ['-83,38,105', '-83,38,106']) bot.changed.set(k, 'netherrack');
  return bot;
}
const stance = bot => new Survival(bot, { place: noop, dig: noop, navigate: noop }, { state: { shelters: [] } })
  .stanceOptions(new Task('x'), { step: { action: 'find_fortress' } }, () => {}, threats(bot, 64), false);

test('wool and the wart blocks are blocks to build with, put after the rest (note 619)', () => {
  const bot = spanEndBot();
  assert.equal(shelter.materialStock(bot), 9, 'the nine wool are building blocks; the gravel, the fences and the table are not');
  assert.equal(shelter.buildingItem(bot)?.name, 'white_wool');
  const both = spanEndBot({ items: [['white_wool', 5], ['netherrack', 3], ['warped_wart_block', 4]] });
  assert.equal(shelter.buildingItem(both)?.name, 'netherrack', 'the netherrack is put before the wool and the wart blocks');
  assert.equal(shelter.buildingItem(both, 4)?.name, 'white_wool', 'a stack of four or more: the netherrack has three');
});

test('at the span\'s end with the ghast 56 blocks off, the walls and the cover are offered from the wool carried, the side the push goes walled first (mid-242-bb-fortress-5, 17:28:19.4)', () => {
  const bot = spanEndBot();
  const feet = new Vec3(-83, 39, 107);
  const sides = wallCells(bot, feet, {});
  // West, east and south are open over the lava; the push goes south, away from the ghast: south first.
  assert.deepEqual(sides.map(c => `${c.x},${c.z}`).sort(), ['-82,107', '-83,108', '-84,107']);
  assert.equal(`${sides[0].x},${sides[0].z}`, '-83,108', 'south, where the push goes, is walled first');
  const stock = wallStock(bot, sides);
  assert.equal(stock.floors, 3); assert.equal(stock.need, 6);
  assert.ok(stock.enough, 'the wool makes the three floors, the wool and the gravel the walls');
  const options = stance(bot);
  assert.doesNotMatch(options.hold_on_span.description, /Too few blocks carried/);
  assert.match(options.hold_on_span.description, /The 3 open sides at the feet are walled first: 6 blocks, about 3\.6 seconds/);
  assert.ok(options.rail_and_fight, `no rail: ${Object.keys(options).join(', ')}`);
  assert.match(options.rail_and_fight.description, /Carried that it can break: white wool \(5, blast resistance 0\.8\), light gray wool \(2, blast resistance 0\.8\), gray wool \(2, blast resistance 0\.8\)/);
  assert.ok(options.take_cover, `no cover: ${Object.keys(options).join(', ')}`);
  assert.match(options.take_cover.description, /^Put 2 blocks, two high, in the line from the eyes of the ghast \(56 blocks off\) to the bot's/);
  assert.match(options.take_cover.description, /None of the blocks carried holds: the cover can be blown out by the fireball it stops/);
  assert.match(options.take_cover.description, /Until the first block in the fireball's line stands, about 1\.2 seconds, the bot is open over the drop/);
});

test('with gravel alone at the span\'s end, the hold still says it cannot wall the floors, and no cover is offered', () => {
  const bot = spanEndBot({ items: [['iron_sword', 1], ['gravel', 14], ['oak_fence', 15], ['crafting_table', 1]] });
  const options = stance(bot);
  assert.match(options.hold_on_span.description, /Too few blocks carried \(14\) to wall the 3 open sides \(6, 3 of them floors under a wall, which gravel or sand does not make\)/);
  assert.equal(options.take_cover, undefined);
  assert.equal(options.rail_and_fight, undefined);
});
