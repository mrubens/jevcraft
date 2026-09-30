'use strict';
// Note 709: upkeep's carry_on with no pickaxe totals what the step in hand
// digs by hand on its line to its own target. 25590 mid-242-mg (2026-09-30
// 01:35Z, (888, 69, -145), the fortress leg's end at (888, 69, -193)) carried
// on over fetch_stems 0.68 to 0.31 with the rock priced a block at a time,
// then took a leg of "67 of rock to dig (about 10.9 seconds a cell by hand)".
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const bs = require('../src/block-stock');

const block = (name, p) => name === 'air' ? { name, position: p, boundingBox: 'empty' } : { name, position: p, boundingBox: 'block', hardness: registry.blocksByName[name].hardness, harvestTools: registry.blocksByName[name].harvestTools };
function bot(items, rock) {
  const inv = items.map(([name, count]) => ({ name, count, type: registry.itemsByName[name].id }));
  return { registry, game: { dimension: 'the_nether', gameMode: 'survival' }, entity: { position: new Vec3(888.5, 69, -144.5) }, inventory: { items: () => inv },
    blockAt: p => block(rock(p), p) };
}
const step = { action: 'find_fortress', target: { x: 888, y: 69, z: -193 }, legs: 22 };

test('25590: the leg in hand through netherrack, totalled by hand, and said on carry_on', () => {
  const b = bot([['stick', 2], ['oak_planks', 3]], p => p.y >= 69 && p.y <= 70 ? 'netherrack' : 'air');
  const says = bs.aheadByHandSays(b, { step });
  assert.equal(says, ' The find fortress in hand heads for (888, 69, -193), 49 blocks off: straight there digs 96 cells of rock by hand, about 3 minutes, nothing dropped.');
});

test('basalt on the line costs its own seconds; a pickaxe carried or no target says nothing', () => {
  const b = bot([], p => p.y >= 69 && p.y <= 70 ? (p.z < -160 ? 'basalt' : 'netherrack') : 'air');
  assert.match(bs.aheadByHandSays(b, { step }), /digs 96 cells of rock by hand, about \d+ minutes, nothing dropped\.$/);
  const secs = bs.handLine(b, step.target).handSeconds;
  assert.ok(secs > 300, `basalt by hand is slow: ${secs}`);
  assert.equal(bs.aheadByHandSays(bot([['wooden_pickaxe', 1]], () => 'netherrack'), { step }), '');
  assert.equal(bs.aheadByHandSays(bot([], () => 'netherrack'), { step: { action: 'find_fortress' } }), '');
  assert.equal(bs.aheadByHandSays(bot([], () => 'air'), { step }), '', 'an open line digs nothing');
});
