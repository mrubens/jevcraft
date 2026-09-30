'use strict';
// Note 755c: note 755b's night-mine hold outlived the mine. 25592 (mid-237-cb,
// from 19:27:29Z) sat at (180, 5, 83) with turn_priority giving survival the
// turn every ten seconds on "Go on with the night mine chosen from the pocket
// 3 minutes ago (2 mined)" while its pocket said no night mine would dig
// (the pickaxe under the uses kept for the climb out), and its answer to go
// for food (seen_food_3, health 15.8, hunger 15, nothing to eat) was dropped
// for it; 25584 held on "(0 mined)" for six minutes. The hold now ends when
// the mine would not dig, has mined nothing for two minutes, or a food
// errand the bot chose is under way.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { claim, nightMineHolds, NIGHT_MINE_IDLE_MS } = require('../src/survival');

function below() {
  const open = new Set(['0,5,0', '0,6,0']);
  return {
    registry, entities: {}, health: 15.8, food: 15, oxygenLevel: 20, time: { timeOfDay: 16000, age: 1000 },
    game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal', minY: -64, height: 384 },
    entity: { position: new Vec3(0.5, 5, 0.5), onGround: true, velocity: new Vec3(0, 0, 0), height: 1.8, width: 0.6 },
    inventory: { items: () => [{ name: 'iron_sword', count: 1 }], slots: [], emptySlotCount: () => 10 },
    blockAt: p => { const k = `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`; const air = open.has(k); return { name: air ? 'air' : 'stone', boundingBox: air ? 'empty' : 'block', position: p, skyLight: 0 }; },
    findBlocks: () => [], world: { raycast: () => ({ intersect: new Vec3(0, 0, 0) }) }, on() {}, once() {}, removeListener() {}, emit() {},
  };
}
const mineState = (over = {}) => ({ sleptAtAge: 1000, nightMine: { startedAt: Date.now() - 180000, origin: { x: 1, y: 5, z: 0 }, mined: 2, minedAt: Date.now() - 20000, ...over } });

test('a night mine that is mining holds the turn (note 755b)', () => {
  const survival = { nightMineOff: () => null, currentShelter: () => null };
  const state = mineState();
  assert.equal(nightMineHolds(below(), state, survival), true);
  assert.equal(claim(below(), { kind: 'win' }, { ...survival, state })?.action, 'night_mine');
});

test('a night mine that has mined nothing for two minutes holds nothing (note 755c, 25584 "0 mined" for six minutes)', () => {
  const survival = { nightMineOff: () => null, currentShelter: () => null };
  const state = mineState({ mined: 0, minedAt: undefined, startedAt: Date.now() - 6 * 60000 });
  assert.equal(nightMineHolds(below(), state, survival), false);
  assert.notEqual(claim(below(), { kind: 'win' }, { ...survival, state })?.action, 'night_mine');
  const stale = mineState({ minedAt: Date.now() - NIGHT_MINE_IDLE_MS - 1000 });
  assert.equal(nightMineHolds(below(), stale, survival), false);
});

test('a night mine that would not dig holds nothing (note 755c, 25592 "No night mine from here: the best pickaxe has 131 uses left")', () => {
  const survival = { nightMineOff: () => 'the best pickaxe has 131 uses left, under the 144 kept for a dug climb out', currentShelter: () => null };
  const state = mineState();
  assert.equal(nightMineHolds(below(), state, survival), false);
  assert.notEqual(claim(below(), { kind: 'win' }, { ...survival, state })?.action, 'night_mine');
});

test('a food errand the bot chose is not taken over by the night mine (note 755c, 25592 seen_food_3 at 15.8 and hunger 15)', () => {
  const survival = { nightMineOff: () => null, currentShelter: () => null };
  for (const extra of [{ foodPlan: { until: Date.now() + 60000 } }, { pocketPlan: { choice: 'seen_food_3', until: Date.now() + 60000 } }, { searchFoodHold: { until: Date.now() + 30000 } }]) {
    const state = { ...mineState(), ...extra };
    assert.equal(nightMineHolds(below(), state, survival), false, JSON.stringify(extra));
    assert.notEqual(claim(below(), { kind: 'win' }, { ...survival, state })?.action, 'night_mine');
  }
});
