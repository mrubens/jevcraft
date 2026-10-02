'use strict';
// Note 853: the sheep search offers going on without the bed for now.
// 25591 (mid-239-cn, 2026-10-02 00:54:50 to 00:56:21Z), five minutes in with
// one wool and dawn come, answered sheep_search none good twelve in a row.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');

test('the sheep search offers without_bed by day; chosen, the bed\'s search rests half an hour (note 853)', async () => {
  const home = require('../src/home-base');
  const exploration = require('../src/exploration');
  const surface = require('../src/surface');
  const decisions = require('../src/decisions');
  const { isSetAside } = require('../src/progress');
  const realTrips = exploration.biomeTrips, realObs = surface.surfaceObserver, realDecide = decisions.decide;
  try {
    let asked = null;
    decisions.decide = async (id, opts) => { asked = opts; return { path: ['without_bed'], stale: false }; };
    exploration.biomeTrips = () => [{ x: 30, z: 0, biome: 'forest', distance: 32, direction: 'east', says: 'the forest 32 blocks east' }];
    surface.surfaceObserver = () => () => true;
    const said = [];
    const bot = { entity: { position: new Vec3(0.5, 70, 0.5) }, game: { dimension: 'overworld', gameMode: 'survival' }, time: { timeOfDay: 1000 }, registry,
      inventory: { items: () => [{ name: 'white_wool', count: 1 }] }, blockAt: () => null, findBlocks: () => [], chat: m => said.push(m) };
    const goal = {};
    await home.searchForSheep(bot, { check() {}, opportunityClient: {} }, goal, () => {}, { explore: async () => assert.fail('explored') });
    assert.match(asked.tree.without_bed.description, /^Go on without the bed for now: the wool search is set aside half an hour .* 1 of 3 wool carried, \d+ minutes searched so far\. Without a bed the nights are waited out/);
    assert.equal(asked.tree.until_day, undefined, 'by day, no until_day');
    assert(isSetAside(goal, 'bed_search', 'wool'));
    assert.deepEqual(said, ['No bed for now. On with the rest.']);
  } finally { exploration.biomeTrips = realTrips; surface.surfaceObserver = realObs; decisions.decide = realDecide; }
});
