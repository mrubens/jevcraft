'use strict';
// Note 749d (critic-20260930T1501Z items 2, 4 and 5).
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const loops = require('../src/decisions/loops');
const fixture = require('./fixtures/night-mine-25588.json');

test('an ore beside one whose way failed rests with it: the next block of the vein is not offered (25588, 14:57 to 14:59Z)', async () => {
  const { Survival } = require('../src/survival');
  const { Task } = require('../src/skills');
  const { attemptsFor } = require('../src/progress');
  // As recorded: copper at (40, 53, 49), then (39, 53, 50), (40, 53, 50), (40, 52, 50), (41, 53, 49)... each walk stalling.
  const ores = { '40,53,49': 'copper_ore', '39,53,50': 'copper_ore', '41,53,49': 'copper_ore', '47,40,52': 'iron_ore' };
  const bot = Object.assign(new EventEmitter(), { registry, game: { dimension: 'overworld' }, entities: {}, entity: { position: new Vec3(37.5, 53, 46.5) },
    inventory: { items: () => [{ name: 'iron_pickaxe', count: 1 }, { name: 'raw_copper', count: 7 }], emptySlotCount: () => 10, slots: [] },
    findBlocks: ({ matching }) => Object.keys(ores).filter(k => [].concat(matching).includes(registry.blocksByName[ores[k]].id)).map(k => new Vec3(...k.split(',').map(Number))),
    blockAt: p => ({ name: ores[`${p.x},${p.y},${p.z}`] || 'stone', boundingBox: 'block', position: p }) });
  const survival = new Survival(bot, {}, {});
  survival.client = { systemOne: async () => ({}) };
  let tree;
  survival.decide = async (task, goal, save, q) => { tree = q.tree; return { path: ['branch'], stale: false }; };
  const ask = async () => { await survival.nightTarget(new Task('night'), {}, () => {}, new Vec3(37, 53, 46)); return Object.values(tree).map(o => o.target).filter(Boolean).map(t => `${t.x},${t.y},${t.z}`); };
  assert.deepEqual((await ask()).sort(), ['40,53,49', '47,40,52'].sort(), 'the nearest of each kind');
  // The walk to (40, 53, 49) stalls: abandoned, its way failed.
  survival.abandonTarget({ target: { x: 40, y: 53, z: 49 }, targetOre: 'copper_ore' }, 'navigation timed out without reaching new ground');
  const e = Object.values(attemptsFor(survival).entries).find(x => x.action === 'night_mine');
  assert.equal(e.wayFailed, true);
  assert.deepEqual(await ask(), ['47,40,52'], 'the copper beside it rests too; the iron away from it is offered');
  // A block given up for itself (its own dig), not its way, rests alone.
  const s2 = new Survival(bot, {}, {});
  s2.abandonTarget({ target: { x: 47, y: 40, z: 52 }, targetOre: 'iron_ore' }, 'the block was not there');
  assert.equal(Object.values(attemptsFor(s2).entries).find(x => x.action === 'night_mine').wayFailed, undefined);
});

test('raw copper, which nothing on the way to the dragon uses, is not a gain for the spell; iron is', () => {
  const s = { first: 0, last: 0, n: 12, ng: 0, walked: 10, lastP: { x: 0, y: 0, z: 0 }, start: { p: { x: 0, y: 0, z: 0 }, carried: { kinds: { raw_copper: 7, raw_iron: 2 } } }, choices: { ore_1: 12 } };
  const copper = loops.judge(s, { here: { x: 5, y: 0, z: 0 }, carried: { kinds: { raw_copper: 12, raw_iron: 2 } }, now: 60000 });
  assert.match(copper.why, /^12 askings over 60 seconds have gone nowhere/);
  assert.match(copper.says, /more raw copper, which nothing on the way to the dragon uses, not a gain/);
  const iron = loops.judge(s, { here: { x: 5, y: 0, z: 0 }, carried: { kinds: { raw_copper: 7, raw_iron: 3 } }, now: 60000 });
  assert.equal(iron.why, null);
  // As recorded, the 25588 spell did gain iron (47, 40, 52 was dug): it was not going nowhere, and is not sent up.
  const asks = fixture.asks.map(a => ({ t: Date.parse(a.at), id: 'night_mine_target', choice: a.choice, pos: a.position, dimension: 'overworld', inventory: a.inventory, noneGood: a.top === 'none_good' }));
  assert.equal(asks.length, 21);
  assert.ok(fixture.asks.at(-1).inventory.raw_iron > fixture.asks[0].inventory.raw_iron);
});

test('a flock seen leads sheep_search\'s options and says it is the one place sheep are known (25585, 14:57:29Z)', async () => {
  const home = require('../src/home-base');
  const exploration = require('../src/exploration');
  const decisions = require('../src/decisions');
  const realTrips = exploration.biomeTrips, realDecide = decisions.decide;
  exploration.biomeTrips = () => [{ x: 30, z: 0, biome: 'jungle', distance: 32, direction: 'east', says: 'the jungle 32 blocks east' }, { x: -30, z: 0, biome: 'birch_forest', distance: 32, direction: 'west', says: 'the birch forest 32 blocks west' }];
  try {
    let asked;
    decisions.decide = async (id, opts) => { asked = opts; return { path: ['biome_jungle'], stale: false }; };
    const bot = { entity: { position: new Vec3(200.5, 70, 0.5) }, game: { dimension: 'overworld', gameMode: 'survival' }, entities: {}, registry, time: { timeOfDay: 6000 },
      inventory: { items: () => [], slots: [] }, blockAt: () => null, findBlocks: () => [], chat() {} };
    const goal = { sightings: { sheep: [{ x: 312, y: 70, z: -112, count: 3, at: Date.now() - 5 * 60000, dimension: 'overworld' }] } };
    await home.searchForSheep(bot, { check() {}, opportunityClient: {} }, goal, () => {}, { explore: async () => {} });
    assert.equal(Object.keys(asked.tree)[0], 'seen_0');
    assert.match(asked.tree.seen_0.description, /The one place sheep are known to be\./);
  } finally { exploration.biomeTrips = realTrips; decisions.decide = realDecide; }
});

test('underground, a biome trip says the climb is its first leg, and arriving is being on the ground of it (25597, 14:55 to 15:03Z)', async () => {
  const { sideTrips } = require('../src/work');
  const exploration = require('../src/exploration');
  const surface = require('../src/surface');
  const realTrips = exploration.biomeTrips, realObs = surface.surfaceObserver, realClimb = surface.climbToSurface;
  exploration.biomeTrips = () => [{ x: 60, z: 0, biome: 'river', distance: 60, direction: 'east', says: 'the river 60 blocks east' }];
  surface.surfaceObserver = () => () => false; surface.climbToSurface = () => 36;
  try {
    const bot = { entity: { position: new Vec3(0.5, 30, 0.5) }, game: { dimension: 'overworld' }, registry, time: { timeOfDay: 6000 }, health: 20, food: 20,
      inventory: { items: () => [] }, entities: {}, blockAt: () => null, findBlocks: () => [] };
    const trips = sideTrips(bot, { survival: {} });
    assert.match(trips.travel_river.description, /Underground here \(about 36 blocks up to open sky, roughly \d+ minutes? to climb\): the climb to the surface is the first leg/);
    surface.surfaceObserver = () => () => true;
    assert.doesNotMatch(sideTrips(bot, { survival: {} }).travel_river.description, /Underground here/);
  } finally { exploration.biomeTrips = realTrips; surface.surfaceObserver = realObs; surface.climbToSurface = realClimb; }
});
