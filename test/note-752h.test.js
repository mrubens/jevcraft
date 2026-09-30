'use strict';
// Note 752h. The reviewer's check-in (17:09Z problem 2): 25585 took
// shield_guard at 6.2 health with four zombies within three blocks and was
// dead in four seconds; 25597 held retreat standing still from 7 health to
// 1. 25597 (19:04:43Z) chose bed_nook at y -36 with monsters near and sat
// seventy seconds, "I can't sleep: there are monsters nearby".
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('node:events');
const { Survival } = require('../src/survival');
const { Task } = require('../src/skills');

const T0 = Date.parse('2026-09-30T17:09:00Z');
function zombiesBot({ health = 6.2, n = 4 } = {}) {
  const entities = {};
  const spots = [[1.8, 0.5], [0.5, 2.1], [-1.2, 0.5], [0.5, -1.5]];
  for (let i = 0; i < n; i++) entities[60 + i] = { id: 60 + i, name: 'zombie', type: 'hostile', position: new Vec3(spots[i][0], 64, spots[i][1]), height: 1.95, width: 0.6, isValid: true };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, health, food: 17, oxygenLevel: 20,
    entities, time: { timeOfDay: 18000 }, registry: require('minecraft-data')('26.1'),
    entity: { position: new Vec3(0.5, 64, 0.5), yaw: 0, onGround: true, width: 0.6, height: 1.8, velocity: new Vec3(0, 0, 0) },
    inventory: { items: () => [{ name: 'iron_sword', count: 1 }, { name: 'cobblestone', count: 40 }], slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 45: { name: 'shield' } }, emptySlotCount: () => 10 },
    blockAt: p => { const f = p.floored(); const s = f.y < 64; return { position: f, name: s ? 'stone' : 'air', boundingBox: s ? 'block' : 'empty', diggable: s, shapes: s ? [[0, 0, 0, 1, 1, 1]] : [] }; },
    world: { raycast: () => null }, findBlocks: () => [], lookAt: async () => {}, look: async () => {}, equip: async () => {}, attack() {},
    pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, setControlState() {}, activateItem() {}, deactivateItem() {} });
  const danger = () => Object.values(entities).map(e => ({ entity: e, distance: e.position.distanceTo(bot.entity.position), visible: true })).sort((a, b) => a.distance - b.distance);
  return { bot, danger };
}

test('a stance that stands still says the blows a second at arm\'s length against the health left, the shield taking the one it faces (25585 17:09Z, note 752h)', t => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const { bot, danger } = zombiesBot();
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
  const options = survival.stanceOptions(new Task('x'), {}, () => {}, danger(), false);
  assert(options.shield_guard, Object.keys(options).join(','));
  assert.match(options.shield_guard.description, /Standing here: 4 at arm's length \(the zombie [\d.]+ blocks off, .*\) land about [\d.]+ health a second through the armour worn, the zombie the shield faces blocked: at 6\.2 health, about \d+ seconds of it\./);
  if (options.fight) assert.doesNotMatch(options.fight.description, /Standing here:/, 'a fight is not a stance that stands still');
});

test('a retreat held two seconds that has not moved a block has failed, is said so and is asked again (25597 15:49Z, note 752h)', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const { bot, danger } = zombiesBot({ health: 7, n: 1 });
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
  survival.state.stance = { choice: 'retreat', kinds: 'zombie', ids: [60], at: T0 - 2500, ranAt: T0 - 100, health: 7, start: { swingAt: 0, blocks: 0, carried: 0, food: 17, pos: { x: 0.5, y: 64, z: 0.5 } } };
  let asked = null;
  survival.stanceOptions = () => ({ retreat: { description: 'Run.', run: async () => true }, shield_guard: { description: 'Shield.', run: async () => true }, fight: { description: 'Fight.', run: async () => true } });
  survival.decide = async (task, goal, save, q) => { asked = q.state; return { path: ['shield_guard'] }; };
  survival.scoutRetreat = async () => {};
  await survival.stanceStep(new Task('x'), {}, () => {}, danger(), false);
  assert(asked, 'asked again');
  assert.match(asked.previousStance.askedAgainFor, /^the retreat has not moved: 0 blocks in 3 seconds$/);
  assert.match(asked.failedHereJustNow.find(f => f.choice === 'retreat').why, /moved 0 blocks: the run is not running/);
});

test('the bed nook with monsters near says the sleep is refused while they stay and what the nook then gains (25597 19:04:43Z, note 752h)', () => {
  const { nookSaysFor } = require('../src/survival');
  const zombie = { id: 70, name: 'zombie', type: 'hostile', position: new Vec3(4.5, -36, 0.5), height: 1.95, width: 0.6, isValid: true };
  const bot = { game: { dimension: 'overworld' }, entities: { 70: zombie }, time: { timeOfDay: 14000 }, entity: { position: new Vec3(0.5, -36, 0.5) }, world: { raycast: () => null },
    blockAt: p => ({ name: p.y < -36 ? 'stone' : 'air', boundingBox: p.y < -36 ? 'block' : 'empty', position: p }), inventory: { items: () => [], slots: [] } };
  const says = nookSaysFor(bot, { dig: [], foot: new Vec3(0, -36, 0), enclosed: true });
  assert.match(says, /1 is now, the rock between counting for nothing\. 1 monster is within eight blocks sideways and five up or down of the bed now, seen or not: sleep is refused while any are\..*So chosen now, the bed goes down and the sleep is refused while they stay; the nook then gains only a pocket to wait in awake/);
});

test('the retreat says the shots at its back while it runs, and the fight says a creeper\'s blast at its range (25585 19:26Z, 25590 19:24:48Z, note 752h)', t => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const { bot } = zombiesBot({ health: 20, n: 0 });
  bot.entities = {
    80: { id: 80, name: 'skeleton', type: 'hostile', position: new Vec3(9.5, 64, 0.5), height: 1.99, width: 0.6, isValid: true, heldItem: { name: 'bow' } },
    81: { id: 81, name: 'creeper', type: 'hostile', position: new Vec3(0.5, 64, 3.5), height: 1.7, width: 0.6, isValid: true, metadata: [] },
  };
  const danger = Object.values(bot.entities).map(e => ({ entity: e, distance: e.position.distanceTo(bot.entity.position), visible: true })).sort((a, b) => a.distance - b.distance);
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
  const options = survival.stanceOptions(new Task('x'), {}, () => {}, danger, false);
  assert(options.retreat, 'retreat offered'); assert.match(options.retreat.description, /With its back to them and the shield down while it runs: the skeleton 9 blocks off: about \d+ shots? in the [\d.]+ seconds of running, about [\d.]+ landing/);
  assert(options.fight, Object.keys(options).join(','));
  assert.match(options.fight.description, /The creeper 3 blocks off: about \d+ swings?, [\d.]+ seconds, (kill it inside its fuse|do not kill it inside its fuse by the estimate: it goes off about)/);
});
