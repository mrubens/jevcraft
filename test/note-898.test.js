'use strict';
// Note 898: planks seen where no walk reaches rest as a source, and the plan
// for sticks goes back to logs.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { catalogPlan } = require('../src/work');
const { setAside } = require('../src/progress');

test('mid-237-ci: oak planks in a mineshaft seen, sticks wanted: the plan mines the planks; that source resting, it is logs', () => {
  const position = new Vec3(0.5, -30, 0.5);
  const bot = { registry, entity: { position }, game: { gameMode: 'survival', dimension: 'overworld' }, inventory: { items: () => [] },
    _catalogObservation: { at: Date.now(), position: { ...position }, nearby: ['oak_planks', 'stone'] },
    findBlocks: () => [], blockAt: () => ({ name: 'air' }) };
  const goal = { kind: 'win', survival: {} };
  const seen = catalogPlan(bot, 'stick', 4, {}, goal);
  assert.ok(seen.some(s => s.action === 'mine' && /_planks$/.test(s.block)), JSON.stringify(seen.map(s => [s.action, s.block || s.item])));
  setAside(goal, 'source', 'planks', 'no walk reaches the oak planks seen', 15 * 60000);
  const rested = catalogPlan(bot, 'stick', 4, {}, goal);
  assert.ok(!rested.some(s => s.action === 'mine' && /_planks$/.test(s.block)), JSON.stringify(rested.map(s => [s.action, s.block || s.item])));
  assert.ok(rested.some(s => s.action === 'mine' && /_log$/.test(s.block)), 'logs instead');
});
