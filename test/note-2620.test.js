'use strict';
// Note 2620: a search that has expanded NODE_CAP nodes within NODE_WINDOW_MS is given no more neighbours, said once, so
// no search can fill the heap (mid-full-162-oom-3-fortress-1, six heap crashes in sixteen minutes on the bounded pathfinder).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { configureMovements, NODE_CAP, NODE_WINDOW_MS } = require('../src/movement');

function botFixture() {
  const registry = require('prismarine-registry')('26.1');
  const bot = { registry, inventory: { items: () => [] }, entities: {}, entity: { position: new Vec3(0, 70, 0) }, game: { minY: -64 },
    pathfinder: { setMovements: m => { bot.pathfinder.movements = m; } } };
  return bot;
}

test('past the cap within the window the search gets no neighbours and the cut is said once; a new window counts afresh', () => {
  const bot = botFixture(), movement = configureMovements(bot);
  movement.getBlock = (p, dx, dy, dz) => ({ position: new Vec3(p.x + dx, p.y + dy, p.z + dz), physical: p.y + dy < 70, safe: p.y + dy >= 70, liquid: false, height: p.y + dy + (p.y + dy < 70 ? 1 : 0), name: p.y + dy < 70 ? 'stone' : 'air' });
  const said = [];
  const log = console.log;
  console.log = (...a) => { said.push(a.join(' ')); };
  try {
    const node = { x: 0, y: 70, z: 0, remainingBlocks: 0 };
    movement._nodeWindow = { at: Date.now(), count: NODE_CAP, said: false };
    assert.deepEqual(movement.getNeighbors(node), []);
    assert.deepEqual(movement.getNeighbors(node), []);
    assert.equal(said.filter(l => l.startsWith('[pathfinder] the search was cut at')).length, 1, said.join(' | '));
    assert.match(said[0], new RegExp(`^\\[pathfinder\\] the search was cut at ${NODE_CAP} nodes in ${NODE_WINDOW_MS / 1000} seconds \\(note 2620\\): no route is found past it$`));
    // The window over: counted afresh, the neighbours given.
    movement._nodeWindow = { at: Date.now() - NODE_WINDOW_MS - 1, count: NODE_CAP + 5, said: true };
    movement.getNeighbors(node);
    assert.equal(movement._nodeWindow.count, 1);
  } finally { console.log = log; }
});
