'use strict';
// Note 1095: the Nether kit's pickaxes are counted by the uses between them.
// 25585 (2026-10-03 18:38Z) crossed with an iron and a stone pickaxe, each
// over twenty-four uses and near worn out, and no wood: both broke seven
// minutes in, and an hour on it stood at a fortress with no block to lay.
const test = require('node:test');
const assert = require('node:assert');
const registry = require('minecraft-data')('26.1');
const { kitRungs, kitRungSays, pickUses, NETHER_PICK_USES } = require('../src/crossing-kit');

const botWith = items => ({ registry, game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, health: 20, food: 20, entity: { position: { x: 0, y: 64, z: 0 } },
  inventory: { items: () => items, slots: [], emptySlotCount: () => 20 } });
const pick = (name, left) => ({ name, count: 1, durabilityUsed: registry.itemsByName[name].maxDurability - left });
const goal = { kind: 'win', netherKit: true };

test('two pickaxes over twenty-four uses each and under 250 between them are short of the kit, said by the uses (note 1095)', () => {
  const worn = botWith([pick('iron_pickaxe', 40), pick('stone_pickaxe', 30), { name: 'cobblestone', count: 64 }]);
  assert.equal(pickUses(worn), 70);
  const rung = kitRungs(worn, goal).find(r => r.phase === 'nether_pickaxe');
  assert(rung, 'the pickaxe rung is raised');
  assert.equal(rung.uses, 70);
  assert.match(kitRungSays(worn, goal, rung), new RegExp(`70 uses between them, of the ${NETHER_PICK_USES} a stay takes`));
  const fresh = botWith([pick('iron_pickaxe', 250), pick('stone_pickaxe', 131), { name: 'cobblestone', count: 64 }]);
  assert.equal(pickUses(fresh), 381);
  assert(!kitRungs(fresh, goal).some(r => r.phase === 'nether_pickaxe'), 'sound and with the uses: no rung');
});
