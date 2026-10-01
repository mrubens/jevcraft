'use strict';
// Note 767e: a route search out of time is not a pool's failure; a pool
// whose walk did not get there is offered as a staircase dug to it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { setAside, isSetAside, attemptsFor } = require('../src/progress');
const registry = require('minecraft-data')('26.1');

function bot(at = new Vec3(311.5, 59, 284.5)) {
  return { registry, game: { gameMode: 'survival', difficulty: 'normal', dimension: 'overworld' }, entities: {},
    entity: { position: at }, inventory: { items: () => [{ name: 'bucket', count: 3 }, { name: 'iron_pickaxe', count: 1 }] }, world: { raycast: () => null },
    blockAt: p => ({ name: p.y < 59 ? 'stone' : 'air', position: p.clone(), boundingBox: p.y < 59 ? 'block' : 'empty' }),
    findBlocks: () => [], pathfinder: { movements: {}, thinkTimeout: 5000 }, chat: () => {} };
}
const timeout = () => Object.assign(new Error('Took to long to decide path to goal!'), { name: 'Error' });

test('25593: a walk whose route search ran out of time is tried again with four times the time, and set aside short and said as that', async () => {
  const { goToLandmark, ROUTE_TIMED_OUT } = require('../src/exploration');
  const b = bot();
  const pool = { kind: 'lava_pool', dimension: 'overworld', x: 319, y: 47, z: 276 };
  const goal = { landmarks: [pool] };
  const thinks = [];
  let n = 0;
  const navigate = async (bb, t, g) => { thinks.push(b.pathfinder.thinkTimeout); if (n++ === 0) throw timeout(); b.entity.position = new Vec3(319.5, 48, 278.5); };
  assert.equal(await goToLandmark(b, new Task('lava'), goal, () => {}, ['lava_pool'], { navigate }), pool, 'arrived on the second search');
  assert.deepEqual(thinks, [5000, 20000]);
  assert.equal(b.pathfinder.thinkTimeout, 5000, 'put back');
  // Out of time both times: set aside five minutes, said as the search, the place not failed.
  const b2 = bot(), g2 = { landmarks: [{ ...pool }] };
  await goToLandmark(b2, new Task('lava'), g2, () => {}, ['lava_pool'], { navigate: async () => { throw timeout(); } });
  const e = attemptsFor(g2).entries[require('../src/progress').keyOf('landmark_trip', 'lava_pool:319,276')];
  assert(e.why.startsWith(ROUTE_TIMED_OUT));
  assert(e.until - e.at <= 300000 + 1000);
  assert.equal(g2.landmarks[0].lastWalk.timedOut, true);
});

test('the pool chosen stays chosen through a route search out of time, and is dug to; a staircase to it is a route of the portal plan (note 782)', async () => {
  const { pickFailed } = require('../src/obsidian');
  const { ROUTE_TIMED_OUT } = require('../src/exploration');
  const goal = { landmarks: [{ kind: 'lava_pool', dimension: 'overworld', x: 319, y: 47, z: 276 }] };
  const pick = { way: 'pool', at: { x: 319, y: 47, z: 276 }, chosenAt: Date.now() - 5000 };
  setAside(goal, 'landmark_trip', 'lava_pool:319,276', `${ROUTE_TIMED_OUT} (19 blocks off)`, 300000);
  assert.equal(pickFailed(goal, pick), null, 'not the pool\'s failure');
  setAside(goal, 'landmark_trip', 'lava_pool:319,276', 'the walk there came no nearer than before (19 blocks off to 19)', 1800000);
  assert.match(pickFailed(goal, pick), /the walk there came no nearer/);
  // As a route of the portal plan (note 782; the stall's dig_to_lava before): a staircase dug to it, priced, with its record.
  const { portalMethod } = require('../src/work');
  const b = bot();
  b.health = 20; b.food = 20; b.chat = () => {};
  b.inventory.items = () => [{ name: 'bucket', count: 2 }, { name: 'water_bucket', count: 1 }, { name: 'stone_pickaxe', count: 1 }];
  const g = { gameProgress: { phase: 'reach_nether' }, landmarks: [{ kind: 'lava_pool', dimension: 'overworld', x: 319, y: 47, z: 276, lastWalk: { at: Date.now(), began: 19, ended: 19, why: 'Took to long to decide path to goal!', timedOut: true } }] };
  setAside(g, 'landmark_trip', 'lava_pool:319,276', `${ROUTE_TIMED_OUT} (19 blocks off)`, 300000);
  let offered = null;
  const task = new Task('nether');
  task.opportunityClient = { systemOne: async ({ questions }) => { offered = questions.branch_0.criteria; return { answers: { branch_0: { choice: Object.keys(offered).find(k => /^here_pool_/.test(k)), confidence: 0.7 } } }; } };
  await portalMethod(b, task, g, () => {});
  const key = Object.keys(offered).find(k => /^here_pool_/.test(k));
  assert.match(offered[key], /cast from the lava pool known at \(319, 47, 276\), \d+ blocks off, 12 blocks below here, by a staircase dug to it \(its walk did not get there\)\..*Pickaxe: about \d+ blocks dug with the pickaxe\..*Its record: .*route search for the walk ran out of time/);
  assert.deepEqual(g.portalMethod.lava.at, { x: 319, y: 47, z: 276 });
  assert.equal(g.portalMethod.near, undefined, 'a frame here, 16 blocks from it');
});
