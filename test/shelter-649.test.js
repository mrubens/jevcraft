'use strict';
// Note 649: mid-244-bg logged "seal_shelter failed: Cannot dig nether_portal"
// 128 times. A portal's sheet has no collision box (so it was not a wall),
// is not diggable and takes no block: the shell counted it missing, the seal
// pass dug at it and threw, every pass. A cell holding a block the game never
// lets be dug or filled is not part of the ring to be closed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const shelter = require('../src/shelter');
const registry = require('minecraft-data')('26.1');

const origin = new Vec3(0, 51, 0);
// A pocket in stone: feet and head open, the shell stone, with `overrides`
// naming other blocks at cells ('x,y,z').
function world(overrides = {}) {
  return p => {
    const key = `${p.x},${p.y},${p.z}`, open = p.equals(origin) || p.equals(origin.offset(0, 1, 0));
    const name = overrides[key] || (open ? 'air' : 'stone');
    const b = registry.blocksByName[name];
    return { name, position: p, boundingBox: b.boundingBox, diggable: b.diggable };
  };
}
const bot = overrides => ({ game: { dimension: 'the_nether' }, entity: { position: origin.offset(0.5, 0, 0.5) }, blockAt: world(overrides) });
const refuge = { origin, dimension: 'the_nether' };

test('a nether portal cell in the shell is not counted missing: it cannot be dug or filled', () => {
  const b = bot({ '1,51,0': 'nether_portal', '1,52,0': 'nether_portal' });
  assert.deepEqual(shelter.missingShell(b, refuge), []);
  assert.equal(shelter.sealed(b, refuge), true);
  // The seal pass digs every missing cell that is not air: none of these is dug.
  const dug = shelter.missingShell(b, refuge).filter(p => !shelter.replaceable(b.blockAt(p)));
  assert.deepEqual(dug, []);
});

test('the end portal, the gateway and a light block are left as they are too; bedrock, a barrier and a frame were walls already', () => {
  for (const name of ['end_portal', 'end_gateway', 'light', 'bedrock', 'barrier', 'end_portal_frame']) {
    const b = bot({ '0,53,0': name });
    assert.deepEqual(shelter.missingShell(b, refuge), [], name);
  }
});

test('an open cell, water or lava in the shell is still a gap to be filled', () => {
  assert.equal(shelter.missingShell(bot({ '1,51,0': 'air' }), refuge).length, 1);
  assert.equal(shelter.missingShell(bot({ '1,51,0': 'water' }), refuge).length, 1);
  assert.equal(shelter.missingShell(bot({ '-1,52,0': 'lava' }), refuge).length, 1);
  // A portal beside a real gap: only the gap is missing.
  const b = bot({ '1,51,0': 'nether_portal', '-1,51,0': 'air' });
  assert.deepEqual(shelter.missingShell(b, refuge).map(String), [String(new Vec3(-1, 51, 0))]);
});
