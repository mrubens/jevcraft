'use strict';
// Note 950: 25588 (mid-236-ca, 2026-10-02 22:27:08Z), at 3.2 health under a
// pond's overhanging bank, floated at z 429.7: its own column was water to
// the air, the column at z 430 had dirt at the waterline. straight_up was
// priced at two seconds with no dig; the rise met the dirt at the head's
// edge, the bot sank three blocks and drowned.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const vitals = require('../src/vitals');
const danger = require('../src/danger');
const registry = require('minecraft-data')('26.1');
const Block = require('prismarine-block')(registry);

function pond(z) {
  const dirt = p => p.y === 62 && p.z === 1 && p.x === 0;
  const name = p => dirt(p) ? 'dirt' : p.y >= 63 ? 'air' : 'water';
  return { oxygenLevel: 8, health: 3, entity: { position: new Vec3(0.3, 57.6, z), isInWater: true, onGround: false, width: 0.6 }, inventory: { items: () => [], slots: {} },
    blockAt: p => { const f = p.floored(), n = name(f), b = Block.fromStateId(registry.blocksByName[n].defaultState, 0); b.position = f; return b; } };
}
const upSays = bot => vitals.airWays(bot, { check() {}, cancelled: false }).straight_up?.description || '';
const secondsOf = d => Number((d.match(/about ([\d.]+) seconds/) || [])[1]);

test('straight up is priced over every column the body is in: off the centre, the dirt over the edge is a dig', t => {
  t.mock.method(danger, 'threats', () => []);
  const centred = secondsOf(upSays(pond(0.5)));
  const edge = upSays(pond(0.75));
  // Centred, nothing to dig; at the edge the dirt under water is dug floating, many seconds, or not offered at all.
  assert.ok(centred > 0 && centred < 3, `centred ${centred}`);
  assert.ok(!edge || secondsOf(edge) > centred + 3, `edge: ${edge}`);
});

test('the body\'s columns: one when centred, two over an edge', () => {
  assert.equal(vitals.bodyColumns({ entity: { position: new Vec3(0.5, 60, 0.5), width: 0.6 } }).length, 1);
  assert.deepEqual(vitals.bodyColumns({ entity: { position: new Vec3(0.3, 60, 0.75), width: 0.6 } }), [[0, 0], [0, 1]]);
});
