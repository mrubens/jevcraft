'use strict';
// Note 1127: the stair does not step onto the cell over a fence or a wall.
// 25594 (2026-10-03 21:32 to 22:02Z): the step chosen onto the cell over a nether brick fence, no path to it, every ten seconds for half an hour.
const test = require('node:test');
const assert = require('node:assert');
const { Vec3 } = require('vec3');
const { stairChoices } = require('../src/tunneling');

const world = fenceAt => ({ game: { dimension: 'the_nether' }, entity: { position: new Vec3(0.5, 34, 0.5) }, entities: {}, registry: require('minecraft-data')('26.1'),
  inventory: { items: () => [{ name: 'iron_pickaxe', count: 1 }] }, world: { raycast: () => null },
  blockAt: p => { const f = p.floored(); const fence = fenceAt && f.x === fenceAt.x && f.y === fenceAt.y && f.z === fenceAt.z; const solid = f.y <= 33;
    return { name: fence ? 'nether_brick_fence' : solid ? 'netherrack' : 'air', position: f, boundingBox: solid ? 'block' : 'empty', diggable: true, hardness: 0.4 }; } });
const ends = bot => { let c; try { c = stairChoices(bot, {}, new Vec3(10, 34, 0), { hostiles: false }); } catch (err) { return { err: err.message }; } return (Array.isArray(c) ? c : c.choices || []).map(x => `${x.destination.x},${x.destination.y},${x.destination.z}`); };

test('a level step whose floor is a fence is not among the stair\'s steps; the same step over netherrack is (note 1127)', () => {
  const plain = ends(world(null)), fenced = ends(world({ x: 1, y: 33, z: 0 }));
  assert(Array.isArray(plain) && plain.includes('1,34,0'), JSON.stringify(plain));
  assert(!Array.isArray(fenced) || !fenced.includes('1,34,0'), JSON.stringify(fenced));
});
