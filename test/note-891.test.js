'use strict';
// Note 891: walled in by its own blocks with no blaze a walk reaches, the
// hunt offers the wall opened toward the nearest.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { noteLaid } = require('../src/own-blocks');

function boxedBot({ ownEast = true } = {}) {
  const feet = new Vec3(10, 74, 10);
  const walls = new Map();
  for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const dy of [0, 1]) walls.set(`${feet.x + d[0]},${feet.y + dy},${feet.z + d[1]}`, 'netherrack');
  walls.set(`${feet.x},${feet.y + 2},${feet.z}`, 'netherrack');
  const dug = [];
  const bot = { registry, game: { dimension: 'the_nether', gameMode: 'survival' }, health: 20, food: 20, entities: {},
    entity: { position: feet.offset(0.5, 0, 0.5), height: 1.8, width: 0.6 }, inventory: { items: () => [{ name: 'netherrack', count: 60 }, { name: 'stone_pickaxe', count: 1 }], slots: {} },
    blockAt: p => { const q = p.floored ? p.floored() : p; const k = `${q.x},${q.y},${q.z}`; const n = walls.get(k) || (q.y < 74 ? 'nether_bricks' : 'air'); return { name: n, position: q, boundingBox: n === 'air' ? 'empty' : 'block', hardness: 0.4 }; },
    dig: async b => { dug.push(`${b.position}`); walls.delete(`${b.position.x},${b.position.y},${b.position.z}`); } };
  const goal = {};
  // Its own: all but (unless ownEast) the east side, which is the fortress's.
  for (const [k, name] of walls) { const [x, y, z] = k.split(',').map(Number); if (!ownEast && x === feet.x + 1) continue; noteLaid(bot, { position: new Vec3(x, y, z), name }, { goal }); }
  return { bot, goal, dug, feet };
}

test('walled in by its own netherrack, a blaze 5 blocks east and 3 up: the east side is offered to be opened, and is dug', async () => {
  const { openWallOption } = require('../src/mob-hunt');
  const { bot, goal, dug, feet } = boxedBot();
  const blaze = { name: 'blaze', position: new Vec3(feet.x + 5.5, feet.y + 3, feet.z + 0.5) };
  const o = openWallOption(bot, { check() {} }, goal, () => {}, blaze);
  assert.ok(o);
  assert.match(o.description, /^Open the wall: dig the 2 blocks of its own netherrack on the side toward the blaze 6 blocks off, about \d+ seconds?, and be asked again from the opening\. Walled in by its own blocks, no walk reaches a blaze and no fight with one is offered from in here/);
  assert.equal(await o.run(), true);
  assert.deepEqual(dug.sort(), [`(${feet.x + 1}, ${feet.y}, ${feet.z})`, `(${feet.x + 1}, ${feet.y + 1}, ${feet.z})`].sort());
  assert.equal(goal.step.action, 'open_the_wall');
});

test('the side toward the blaze not its own (the fortress\'s wall): the nearest side that is; not walled in: nothing', () => {
  const { openWallOption } = require('../src/mob-hunt');
  const { bot, goal, feet } = boxedBot({ ownEast: false });
  const blaze = { name: 'blaze', position: new Vec3(feet.x + 5.5, feet.y + 3, feet.z + 2.5) };
  const o = openWallOption(bot, { check() {} }, goal, () => {}, blaze);
  assert.ok(o, 'a side of its own is opened');
  assert.match(o.description, /dig the 2 blocks of its own netherrack/);
  const open = { ...bot, blockAt: p => ({ name: (p.floored ? p.floored() : p).y < 74 ? 'nether_bricks' : 'air', position: p, boundingBox: (p.floored ? p.floored() : p).y < 74 ? 'block' : 'empty' }) };
  assert.equal(openWallOption(open, { check() {} }, {}, () => {}, blaze), null);
});
