'use strict';
// Note 2173: a death chosen to start over, offered in the Nether with no pickaxe and no block, its cost said.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const RF = require('../src/respawn-fresh');

const botWith = (items, dimension = 'the_nether') => ({ game: { dimension }, entity: { position: new Vec3(0, 64, 0) }, spawnPoint: new Vec3(100, 64, 200), health: 20, inventory: { items: () => items } });

test('offered only in the Nether with no pickaxe, no block and lava known; said with the drops, the respawn and the re-kit record', () => {
  const lava = { distance: 12, at: { x: 10, y: 63, z: 4 } };
  const bare = botWith([{ name: 'blaze_rod', count: 2 }, { name: 'iron_sword', count: 1 }, { name: 'rotten_flesh', count: 3 }]);
  assert.deepEqual(RF.offered(bare, {}, { lava }), { lava });
  assert.equal(RF.offered(botWith([{ name: 'stone_pickaxe', count: 1 }]), {}, { lava }), null, 'a pickaxe carried');
  assert.equal(RF.offered(botWith([{ name: 'netherrack', count: 4 }]), {}, { lava }), null, 'blocks carried');
  assert.equal(RF.offered(botWith([], 'overworld'), {}, { lava }), null, 'not the Overworld');
  assert.equal(RF.offered(bare, {}, { lava: null }), null, 'no lava known');
  const s = RF.says(bare, { survival: { spawnBed: { foot: { x: 5, y: 63, z: 9 } } } }, { lava });
  assert.match(s, /^Die here on purpose and come back to life at the bed at \(5, 63, 9\) in the Overworld, a position reset as speedrunners use it: walk into the lava 12 blocks off at \(10, 63, 4\) and stay in it, about \d+ seconds\. The trade in minutes: with no pickaxe and no block the bot can only walk the ground here; on the full runs/);
  assert.match(s, /what is carried and not stashed is lost: 2 blaze rods, 1 iron sword, and 1 other stack\./);
  assert.match(s, /For scale, a death that loses a whole kit cost about 73 minutes on the full runs \(2026-10-25 06:00Z to 10-26 08:00Z\); a death here loses only what is listed\./);
  assert.match(RF.says(bare, {}, { lava }), /the world spawn at \(100, 64, 200\) in the Overworld, with nothing/);
  assert.equal(RF.standing({ deliberateDeath: { at: Date.now() - 1000 } }), true);
  assert.equal(RF.standing({ deliberateDeath: { at: Date.now() - 100000 } }), false);
  assert.equal(RF.standing({}), false);
});

test('the End (note 2236): offered with no pickaxe and nothing to eat and the edge known; said with the void, the lost kit, the health that does not come back and the re-kit record', () => {
  const edge = { at: { x: 30, z: -12 }, distance: 7, side: 'east', dx: 1, dz: 0 };
  const bare = botWith([{ name: 'bow', count: 1 }, { name: 'arrow', count: 54 }, { name: 'white_bed', count: 1 }], 'the_end');
  bare.health = 1.3; bare.food = 11;
  assert.deepEqual(RF.offeredEnd(bare, {}, { edge }), { edge });
  assert.equal(RF.offeredEnd(botWith([{ name: 'stone_pickaxe', count: 1 }], 'the_end'), {}, { edge }), null, 'a pickaxe carried');
  assert.equal(RF.offeredEnd(botWith([{ name: 'cooked_rabbit', count: 2 }], 'the_end'), {}, { edge }), null, 'food carried');
  assert.equal(RF.offeredEnd(bare, {}, { edge: null }), null, 'no edge known');
  assert.equal(RF.offeredEnd(botWith([], 'the_nether'), {}, { edge }), null, 'not the Nether');
  const s = RF.saysEnd(bare, { survival: { spawnBed: { foot: { x: 5, y: 63, z: 9 } } } }, { edge }, { dragonHealth: 200 });
  assert.match(s, /^Die here on purpose and come back to life at the bed at \(5, 63, 9\) in the Overworld, a position reset as speedrunners use it: walk off the island's edge 7 blocks east at \(30, -12\) into the void, about \d+ seconds\. The trade in minutes: here, with no pickaxe and nothing to eat, health 1\.3 at hunger 11 does not come back/);
  assert.match(s, /What is carried and not stashed is lost at once in the void: 1 bow, 54 arrow, 1 white bed\./);
  assert.match(s, /The dragon keeps its health \(200 of 200\)\. For scale, a death that loses a whole kit cost about 73 minutes/);
});
