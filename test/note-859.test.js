'use strict';
// Note 859: escapeFootings' block search is kept three seconds for the same
// cell and radius; 650 ms a call at every stance froze 25589 while shot.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Survival } = require('../src/survival');

test('the footing search runs once for two stances asked from the same cell, again from another (note 859)', () => {
  const registry = require('minecraft-data')('26.1');
  let searches = 0;
  const bot = { on() {}, once() {}, removeListener() {}, emit() {}, registry, entity: { position: new Vec3(0.5, 64, 0.5) }, entities: {}, game: { dimension: 'overworld' },
    blockAt: p => ({ name: p.y < 64 ? 'stone' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty', position: p }),
    findBlocks: o => { if (o.count === 512) searches++; return o.count === 512 ? [new Vec3(5, 63, 5)] : []; }, inventory: { items: () => [] } };
  const s = new Survival(bot, {}, { state: {} });
  const zombie = { entity: { id: 1, name: 'zombie', position: new Vec3(3, 64, 0) }, distance: 2.5, visible: true };
  s.escapeFootings([zombie]);
  s.escapeFootings([zombie]);
  assert.equal(searches, 1);
  bot.entity.position = new Vec3(2.5, 64, 0.5);
  s.escapeFootings([zombie]);
  assert.equal(searches, 2);
});
