'use strict';
// The Nether kit's record re-read over 2026-10-05T00:00Z to 2026-10-06T01:00Z
// (note 1336): 344 stays, 210 with no armour worn; top_up_gold offered 1,538
// times and chosen once with no record said, and piglins killed 28 that went
// in without gold, 2 with. The crossing's gold line now says the record when
// no gold is carried.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');

function bot(carried) {
  const items = Object.entries(carried).map(([name, count]) => ({ name, count, type: registry.itemsByName[name].id, durabilityUsed: 0 }));
  return {
    registry, health: 20, food: 20, game: { gameMode: 'survival', dimension: 'overworld', difficulty: 'normal' },
    entity: { position: new Vec3(0.5, 64, 0.5) }, entities: {},
    inventory: { items: () => items, slots: [], emptySlotCount: () => 20 },
  };
}

test('the crossing says the gold record when no gold is carried, and not when it is', () => {
  const { kitItems } = require('../src/crossing-kit');
  const gold = b => kitItems(b).find(i => i.key === 'gold').says;
  assert.match(gold(bot({ stone_pickaxe: 1 })), /piglins killed 2 with gold and 28 without\.$/);
  assert.match(gold(bot({ stone_pickaxe: 1 })), /without, 261 stays \(39\.8 Nether hours\): 2\.18 deaths an hour/);
  assert.doesNotMatch(gold(bot({ stone_pickaxe: 1, golden_boots: 1 })), /piglins killed/);
});
