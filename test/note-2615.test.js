'use strict';
// Note 2615: the pathfinder's search is bounded in detour (searchRadius), so a goal with no way to it is given up within
// the bound instead of filling the heap (mid-full-162-fortress-1, 2026-10-30 23:38Z, three heap crashes a minute after
// joining). A caller that set a bound of its own keeps it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { configureMovements } = require('../src/movement');

function bot(pathfinder) {
  return { pathfinder, registry: require('minecraft-data')('26.1'), inventory: { items: () => [], slots: [] }, entity: { position: { x: 0, y: 64, z: 0 } }, on() {}, once() {}, blockAt: () => null };
}

test('configureMovements bounds the search\'s detour at 160 where the plugin left it unlimited, and keeps a bound already set', () => {
  const a = bot({ thinkTimeout: 5000, searchRadius: -1 });
  try { configureMovements(a); } catch (_) { /* the movements may want more of the bot; the bound is set first */ }
  assert.equal(a.pathfinder.searchRadius, 160);
  assert.equal(a.pathfinder.thinkTimeout, 10000);
  const b = bot({ thinkTimeout: 12000, searchRadius: 48 });
  try { configureMovements(b); } catch (_) { /* as above */ }
  assert.equal(b.pathfinder.searchRadius, 48);
  assert.equal(b.pathfinder.thinkTimeout, 12000);
});
