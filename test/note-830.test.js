// Note 830: the sealed pocket's "until the threat gone" uses the work's own
// rule: a mob that has stood off out of sight is not the threat it waits on.
const test = require('node:test'), assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const danger = require('../src/danger');
const { sealThreatNear } = require('../src/survival');

function scene(visible) {
  const skeleton = { id: 3, name: 'skeleton', type: 'hostile', position: new Vec3(11.5, 64, 0.5), height: 1.99, width: 0.6, isValid: true, metadata: [], heldItem: { name: 'bow' } };
  return { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, health: 20, entities: { 3: skeleton },
    entity: { position: new Vec3(0.5, -52, 0.5).offset(0, 116, 0), height: 1.8, width: 0.6, velocity: new Vec3(0, 0, 0) },
    registry: require('minecraft-data')('26.1'), inventory: { items: () => [], slots: [] },
    blockAt: p => ({ position: p.floored(), name: 'air', boundingBox: 'empty' }),
    world: { raycast: (from, dir) => visible ? null : { position: new Vec3(2, 64, 0), intersect: from.plus(dir) } } };
}

test('25595: a skeleton out of sight that has stood off does not keep the sealed stay; one that has not, or one in sight, does', () => {
  const real = danger.standsOff;
  try {
    danger.standsOff = () => null;
    assert.equal(sealThreatNear(scene(false)), true, 'not stood off: still the threat');
    danger.standsOff = () => ({ seconds: 74, nearest: 10.7, farthest: 13.1, inSight: false });
    assert.equal(sealThreatNear(scene(false)), false, 'stood off out of sight: not the threat waited on');
    assert.equal(sealThreatNear(scene(true)), true, 'in sight: the threat');
  } finally { danger.standsOff = real; }
});
