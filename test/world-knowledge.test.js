'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { WorldKnowledge, hydrate, harvest, seed } = require('../src/world-knowledge');

const memoryStore = (initial = null) => ({ value: initial, saves: 0, read() { return this.value; }, save(v) { this.value = JSON.parse(JSON.stringify(v)); this.saves++; } });

test('a portal found by one goal is known to the next, whoever started it', () => {
  const world = new WorldKnowledge(memoryStore());
  const dream = world.hydrate({ kind: 'win', request: 'beat the game' });
  dream.portals = [{ dimension: 'overworld', position: { x: 10, y: 64, z: 3 } }];
  dream.gameProgress = { startedAt: 1, milestones: { eyes_obtained: { at: 5 } } };
  world.harvest(dream);
  const errand = world.hydrate({ kind: 'obtain', request: 'get me wood' });
  assert.deepEqual(errand.portals, dream.portals, 'a player errand still knows the portal');
  assert.equal(errand.gameProgress, undefined, 'but does not carry the run');
  const relaunched = world.hydrate({ kind: 'win', request: 'beat the game' });
  assert.deepEqual(relaunched.gameProgress.milestones.eyes_obtained, { at: 5 }, 'the eyes milestone survives the relaunch');
});

test('a goal saved before its launch cannot blank what the world knows', () => {
  const known = { portals: [{ id: 1 }] };
  const unlaunched = { kind: 'win' };
  assert.equal(harvest(unlaunched, known).changed, false);
  assert.deepEqual(known.portals, [{ id: 1 }]);
});

test('a launched goal that drops a plan drops it for the world, and a stale plan on a resumed goal is not news', () => {
  const store = memoryStore({ version: 1, known: { portalFrame: { origin: { x: 1, y: 2, z: 3 } } } });
  const world = new WorldKnowledge(store);
  const goal = world.hydrate({ kind: 'win' });
  delete goal.portalFrame;
  world.harvest(goal);
  assert.equal(store.value.known.portalFrame, undefined);
  const resumed = hydrate({ kind: 'win', portalFrame: { origin: { x: 9, y: 9, z: 9 } } }, store.value.known);
  assert.equal(resumed.portalFrame, undefined, 'the resumed goal\'s old plan is taken off it');
});

test('the first start seeds the store from the last goal, then the idle loop', () => {
  const known = seed({ portals: ['from goal'] }, { portals: ['from idle'], villages: ['idle village'] });
  assert.deepEqual(known, { portals: ['from goal'], villages: ['idle village'] });
});

test('an unchanged save does not rewrite the file', () => {
  const store = memoryStore();
  const world = new WorldKnowledge(store);
  const goal = world.hydrate({ kind: 'obtain' });
  goal.villages = [{ id: 'v' }];
  world.harvest(goal); world.harvest(goal);
  assert.equal(store.saves, 1);
});

test('a portal pushed onto a goal\'s own list is saved, not silently shared', () => {
  const store = memoryStore({ version: 1, known: { portals: [{ id: 1 }] } });
  const world = new WorldKnowledge(store);
  const goal = world.hydrate({ kind: 'obtain' });
  goal.portals.push({ id: 2 });
  assert(world.harvest(goal), 'the push is a change');
  assert.equal(store.value.known.portals.length, 2);
});
