'use strict';
// Note 1140: walled in by its own blocks, the wall opened toward the hunt's
// mob is offered on every hunt, not the blazes' alone.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { noteLaid } = require('../src/own-blocks');

test('walled in its own cobblestone with an enderman twenty blocks off and fourteen down, the wall toward it is offered and said of the enderman', async () => {
  const { openWallOption } = require('../src/mob-hunt');
  const feet = new Vec3(-94, 66, 17), walls = new Map(), dug = [];
  for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const dy of [0, 1]) walls.set(`${feet.x + d[0]},${feet.y + dy},${feet.z + d[1]}`, 'cobblestone');
  walls.set(`${feet.x},${feet.y + 2},${feet.z}`, 'cobblestone');
  const bot = { registry, game: { dimension: 'the_nether', gameMode: 'survival' }, health: 20, food: 17, entities: {},
    entity: { position: feet.offset(0.5, 0, 0.5), height: 1.8, width: 0.6 }, inventory: { items: () => [{ name: 'cobblestone', count: 60 }, { name: 'iron_pickaxe', count: 1 }], slots: {} },
    blockAt: p => { const q = p.floored ? p.floored() : p; const n = walls.get(`${q.x},${q.y},${q.z}`) || (q.y < 66 ? 'netherrack' : 'air'); return { name: n, position: q, boundingBox: n === 'air' ? 'empty' : 'block', hardness: 2 }; },
    dig: async b => { dug.push(`${b.position}`); walls.delete(`${b.position.x},${b.position.y},${b.position.z}`); } };
  const goal = {};
  for (const [k, name] of walls) { const [x, y, z] = k.split(',').map(Number); noteLaid(bot, { position: new Vec3(x, y, z), name }, { goal }); }
  const enderman = { name: 'enderman', position: new Vec3(feet.x + 14.5, feet.y - 14, feet.z + 0.5) };
  const o = openWallOption(bot, { check() {} }, goal, () => {}, enderman);
  assert.ok(o);
  assert.match(o.description, /^Open the wall: dig the 2 blocks of its own cobblestone on the side toward the enderman 20 blocks off/);
  assert.match(o.description, /no walk reaches the enderman and no fight with one is offered from in here/);
  assert.doesNotMatch(o.description, /blaze/);
  assert.equal(await o.run(), true);
  assert.equal(dug.length, 2);
});
