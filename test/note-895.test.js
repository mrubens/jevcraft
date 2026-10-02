'use strict';
// Note 895: the arena's four-blaze spawner drill, charged at every asking
// against answered as it came, said at a live spawner with three or more
// blazes within sixteen; not said elsewhere.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const bs = require('../src/blaze-stand');

test('said with a live spawner within sixteen and three or more blazes; not with two, nor with no spawner known', () => {
  const bot = { game: { dimension: 'the_nether' }, entity: { position: new Vec3(0.5, 64, 0.5) }, entities: {}, registry: require('minecraft-data')('26.1'),
    blockAt: p => ({ name: p.x === 4 && p.y === 65 && p.z === 0 ? 'spawner' : p.y < 64 ? 'nether_bricks' : 'air', position: p, boundingBox: p.y < 64 || (p.x === 4 && p.y === 65 && p.z === 0) ? 'block' : 'empty' }),
    findBlocks: () => [new Vec3(4, 65, 0)], inventory: { items: () => [], slots: {} } };
  const goal = { kind: 'win', fortressSearch: { map: { spawners: [{ x: 4, y: 65, z: 0 }] } } };
  const says = bs.fourNearSays(bot, goal, 4);
  assert.match(says, /^ In the arena on 2026-10-02 \(four blazes at a live spawner four to six blocks off\): the nearest charged at every asking, 3 runs, 3 rods carried away and no death, about 17 health lost a rod \(a fourth run was stopped unfinished at 3\.4 health among eight blazes\); the same answered as it came, holds and defers between the strikes, 13 runs, 3 rods and 4 deaths: held off, the spawner's blazes gather\.$/);
  assert.equal(bs.fourNearSays(bot, goal, 2), '');
  assert.equal(bs.fourNearSays(bot, { kind: 'win' }, 4) === '' || /In the arena/.test(bs.fourNearSays(bot, { kind: 'win' }, 4)), true);
  assert.equal(bs.fourNearSays({ ...bot, findBlocks: () => [], blockAt: p => ({ name: p.y < 64 ? 'nether_bricks' : 'air', position: p, boundingBox: p.y < 64 ? 'block' : 'empty' }) }, { kind: 'win' }, 4), '');
});
