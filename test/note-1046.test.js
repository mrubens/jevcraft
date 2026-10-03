'use strict';
// Note 1046: the walk takes no drop of two or more onto a cell with a deadly
// fall beside it; onto a wide floor it does as before.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const Block = require('prismarine-block')(registry);

// A cliff: floor at y 59 for z >= 63; three down, a step at y 56 for z 62
// (one wide, or five wide to z 58); lava at y 30 under everything else.
function cliffBot({ wide = false } = {}) {
  const nameAt = q => {
    if (q.y <= 30) return 'lava';
    if (q.z >= 63 && q.y <= 59) return 'netherrack';
    if (q.y <= 56 && q.z <= 62 && q.z >= (wide ? 56 : 62)) return 'netherrack';
    return 'air';
  };
  const cache = new Map();
  const blockAt = p => {
    const q = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)), k = `${q}`;
    if (!cache.has(k)) { const b = Block.fromStateId(registry.blocksByName[nameAt(q)].defaultState, 0); b.position = q; cache.set(k, b); }
    return cache.get(k);
  };
  const controls = {};
  return Object.assign(new EventEmitter(), { registry, version: '26.1', health: 20, food: 20, oxygenLevel: 20, game: { dimension: 'the_nether', gameMode: 'survival', minY: 0 },
    entity: { position: new Vec3(0.5, 60, 63.5), onGround: true, height: 1.8, width: 0.6, velocity: new Vec3(0, 0, 0) }, entities: {},
    inventory: { items: () => [], slots: [] }, controlState: controls, setControlState: (k, v) => { controls[k] = v; }, getControlState: k => !!controls[k], clearControlStates() {},
    stopDigging() {}, lookAt: async () => {}, blockAt, pathfinder: { setMovements(m) { this.movements = m; }, setGoal() {}, isMoving: () => true, goal: null } });
}

test('a drop of three onto a step one block wide over the lava sea is no landing; onto a floor five wide it is', () => {
  const { configureMovements } = require('../src/movement');
  const node = { x: 0, y: 60, z: 63, remainingBlocks: 0 }, north = { x: 0, z: -1 };
  const narrow = configureMovements(cliffBot());
  assert.equal(narrow.getLandingBlock(node, north), null, 'the edge is the landing: not taken');
  const wide = configureMovements(cliffBot({ wide: true }));
  const landing = wide.getLandingBlock(node, north);
  assert.ok(landing?.position, 'a floor with ground beyond it is landed on');
  assert.deepEqual([landing.position.x, landing.position.y, landing.position.z], [0, 57, 62]);
});
