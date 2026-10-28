'use strict';
// Note 2191: the far ring's way across water, said and offered.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const RW = require('../src/ring-way');

test('the facts and the two ways, priced', () => {
  const water = (x, z) => x < 1660 ? 'water' : 'grass_block';
  const bot = { entity: { position: new Vec3(1669.5, 62, -238.5) }, health: 20, food: 18, registry: { itemsByName: { stone_pickaxe: { maxDurability: 131 } } },
    inventory: { items: () => [{ name: 'stone_pickaxe', count: 1, durabilityUsed: 31 }, { name: 'ender_eye', count: 11 }] },
    blockAt: p => ({ name: p.y === 62 ? water(p.x, p.z) : p.y < 62 ? 'stone' : 'air', position: p }) };
  const center = new Vec3(1878, 32, -294);
  const f = RW.facts(bot, {}, center, { flat: 215 });
  assert.equal(f.flat, 215); assert.equal(f.down, 30); assert.equal(f.picks, 1); assert.equal(f.uses, 100);
  const t = RW.tree(f);
  assert.deepEqual(Object.keys(t), ['swim_on', 'tunnel_under']);
  assert.match(t.tunnel_under.description, /^(?:This way: .*? health(?: \(more than the bot has\))?\. )?Dig a tunnel straight at the ring through the rock, two high, down to its level: about 215 cells and 460 digs \(about 11 minutes at three seconds a cell\), 100 digs left in the pickaxe carried \(short by 360: the tunnel stops there unless another is made\)/);
  assert.match(t.swim_on.description, /^(?:This way: .*? health(?: \(more than the bot has\))?\. )?Swim straight at the ring along its line, the head kept up/);
  assert.match(RW.says(f), /^The ring is 215 blocks off across the ground and 30 down\./);
});
