'use strict';
// Note 754e (critic-20260930T1906Z item 1): 25583 (mid-244-he, 18:51 to
// 19:05Z) wore out its pickaxe in a mineshaft, was told the nearest wood was
// an oak log 54 blocks off with the mineshaft's planks about it, and climbed
// y 40 to 60 by hand in nine minutes.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');

test('placed planks seen are planks for the breaking: the planner mines them for a pickaxe', () => {
  const { planCatalog } = require('../src/knowledge');
  const steps = planCatalog(registry, 'stone_pickaxe', 1, { crafting_table: 1, cobblestone: 10 }, { nearby: ['oak_planks'], dimension: 'overworld' });
  assert.deepEqual(steps.map(s => `${s.action}:${s.block || s.item}`), ['mine:oak_planks', 'craft:stick', 'craft:stone_pickaxe']);
  // Not seen, not a source: planks are not mined for planks from nowhere.
  const none = planCatalog(registry, 'stone_pickaxe', 1, { crafting_table: 1, cobblestone: 10 }, { nearby: [], dimension: 'overworld' });
  assert(!none.some(s => s.block === 'oak_planks'));
});

// A mineshaft: stone, a corridor of air at y 40 to 41 along x, planks at
// (126, 40, 141) and (126, 41, 141); open sky over y 64.
function mineshaftBot(items) {
  const planks = [new Vec3(126, 40, 141), new Vec3(126, 41, 141)];
  const blockAt = p => {
    const q = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
    const name = planks.some(k => k.equals(q)) ? 'oak_planks' : q.y > 64 ? 'air' : (q.y === 40 || q.y === 41) && q.z === 141 && q.x >= 116 && q.x <= 125 ? 'air' : 'stone';
    return { name, type: registry.blocksByName[name].id, position: q, boundingBox: name === 'air' ? 'empty' : 'block', diggable: name !== 'air' };
  };
  const stacks = items.map(([name, count]) => ({ name, count, type: registry.itemsByName[name].id }));
  return { registry, game: { dimension: 'overworld', gameMode: 'survival', minY: -64, height: 384 }, entity: { position: new Vec3(121.5, 40, 141.5) },
    inventory: { items: () => stacks }, blockAt, findBlocks: ({ matching }) => planks.filter(p => [].concat(matching).includes(blockAt(p).type)), entities: {} };
}

test('the nearest wood counts a mineshaft\'s planks, said as a plank a block', () => {
  const { nearestWood } = require('../src/pickaxe-budget');
  const wood = nearestWood(mineshaftBot([['cobblestone', 64], ['crafting_table', 1]]), {});
  assert(wood, 'wood is found');
  assert.equal(wood.name, 'oak_planks');
  assert.match(wood.says, /the nearest wood known is oak planks 5 blocks off .*placed planks, one plank a block/);
});

test('with no pickaxe and planks in reach, climb_out offers a pickaxe made first, priced beside the climbs by hand (25583)', () => {
  const { climbOptions, straightUpColumn } = require('../src/surface');
  const bot = mineshaftBot([['cobblestone', 64], ['crafting_table', 1]]);
  const feet = bot.entity.position.floored();
  const { options, estimate } = climbOptions(bot, feet.offset(0, 25, 0), straightUpColumn(bot, feet), { goal: {} });
  assert(options.wood_first, `offered: ${Object.keys(options)}`);
  assert.match(options.wood_first.description, /^Make a pickaxe first: the nearest wood known is oak planks 5 blocks off.*break 2 plank blocks .*craft a stone pickaxe from the cobblestone carried at the crafting table carried/);
  assert(estimate.wood_first < estimate.staircase, `made first is quicker here: ${estimate.wood_first} against ${estimate.staircase}`);
  // With a pickaxe carried it is not offered.
  const armed = mineshaftBot([['cobblestone', 64], ['stone_pickaxe', 1]]);
  assert.equal(climbOptions(armed, feet.offset(0, 25, 0), straightUpColumn(armed, feet), { goal: {} }).options.wood_first, undefined);
});
