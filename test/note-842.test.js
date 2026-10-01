// Note 842: the head in gravel down a shaft with no cell open beside it:
// a cell beside dug and stepped into is offered, said with the column over
// the head (25581, 2026-10-01 22:37:49Z, suffocated digging at its head's cell).
const test = require('node:test'), assert = require('node:assert/strict');
const { Vec3 } = require('vec3');

test('25581: under a gravel column in a one-wide shaft, dig_aside is offered beside dig_out, said with the column; with a cell open beside, step_aside instead', () => {
  const vitals = require('../src/vitals');
  const registry = require('minecraft-data')('26.1');
  const mk = open => {
    const blockAt = p => { const f = p.floored();
      const name = f.x === 0 && f.z === 0 ? (f.y === 63 ? 'stone' : f.y === 64 ? 'air' : f.y >= 65 && f.y <= 72 ? 'gravel' : 'stone')
        : open && f.x === 1 && f.z === 0 && (f.y === 64 || f.y === 65) ? 'air' : 'stone';
      return { name, position: f, boundingBox: name === 'air' ? 'empty' : 'block', diggable: true, digTime: () => 400, material: 'mineable/pickaxe', harvestTools: undefined };
    };
    return { registry, entity: { position: new Vec3(0.5, 64, 0.5), eyeHeight: 1.62, height: 1.8 }, blockAt, entities: {}, inventory: { items: () => [{ name: 'iron_pickaxe', count: 1, type: registry.itemsByName.iron_pickaxe.id }], slots: [] }, heldItem: null };
  };
  const ways = vitals.headWays(mk(false), { cancelled: false, label: 't', check() {} });
  assert(ways.dig_aside, Object.keys(ways).join(','));
  assert.match(ways.dig_aside.description, /Dig into the wall beside the feet at .*8 blocks of gravel over the head fill its own cell again after each is dug/);
  assert.match(ways.dig_out.description, /8 blocks of it stacked over the head: each dug, the next falls into the cell/);
  const open = vitals.headWays(mk(true), { cancelled: false, label: 't', check() {} });
  assert(open.step_aside && !open.dig_aside, Object.keys(open).join(','));
});
