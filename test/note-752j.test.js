'use strict';
// Note 752j. 25591 (21:15 to 21:22Z) held creeper_dance for minutes against
// a creeper 2.2 blocks off behind a block that never came round; 25584 chose
// the wait for daylight at y 19 under rock (21:14:31Z), and by day (21:20:55Z)
// was told of "about 20 real minutes" to the next dawn.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('node:events');

test('no wait for daylight is offered under rock; by day it is said as through the night, the claim too (25584, note 752j)', () => {
  const { sealedWaitSaysFor } = require('../src/survival');
  const bot = { game: { dimension: 'overworld', difficulty: 'normal' }, health: 9, food: 16, time: { timeOfDay: 18000 } };
  assert(sealedWaitSaysFor(bot), 'night, surface');
  assert.equal(sealedWaitSaysFor(bot, { underground: true }), null, 'under rock');
  bot.time.timeOfDay = 3000;
  assert.equal(sealedWaitSaysFor(bot).day, true, 'by day, said as through the night');
  const { claimSays } = require('../src/arbiter');
  assert.match(claimSays({ layer: 'survival', action: 'obtain_food', facts: { food: 16, health: 9, waitSealedMinutes: 20, waitSealedDayNow: true } }), /beside waiting sealed in a pocket for the next daylight \(it is day now: the wait runs through dusk and the whole night\), about 20 real minutes/);
});

test('a held stance whose mob stays out of sight and no nearer thirty seconds ends and is asked again, said as tried (25591, note 752j)', async t => {
  const T0 = Date.parse('2026-09-30T21:17:43Z');
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const { Survival } = require('../src/survival');
  const { Task } = require('../src/skills');
  const creeper = { id: 99, name: 'creeper', type: 'hostile', position: new Vec3(2.7, 64, 0.5), height: 1.7, width: 0.6, isValid: true, metadata: [] };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, health: 20, food: 20, oxygenLevel: 20,
    entities: { 99: creeper }, time: { timeOfDay: 18000 }, registry: require('minecraft-data')('26.1'),
    entity: { position: new Vec3(0.5, 64, 0.5), onGround: true, width: 0.6, height: 1.8, velocity: new Vec3(0, 0, 0), metadata: { 0: 0 } },
    inventory: { items: () => [{ name: 'iron_sword', count: 1 }], slots: {}, emptySlotCount: () => 20 },
    blockAt: p => ({ position: p.floored(), name: 'air', boundingBox: 'empty', diggable: false, shapes: [] }),
    world: { raycast: () => null }, findBlocks: () => [], lookAt: async () => {}, look: async () => {}, equip: async () => {}, attack() {},
    pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, setControlState() {}, activateItem() {}, deactivateItem() {} });
  const unseen = () => [{ entity: creeper, distance: 2.2, visible: false }];
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
  survival.state.stance = { choice: 'creeper_dance', kinds: 'creeper', ids: [99], mobs: [{ name: 'creeper', distance: 2.2, visible: true }], at: T0 - 5000, ranAt: T0 - 100, health: 20,
    expects: { damage: 0, seconds: 15 }, hold: require('../src/holds').begin({ choice: 'creeper_dance', at: T0 - 5000, health: 20, expects: { damage: 0, seconds: 15 }, mobs: [{ entity: creeper, distance: 2.2, visible: true }], offered: ['creeper_dance', 'block_creeper'] }) };
  const asked = [];
  survival.stanceOptions = () => ({ creeper_dance: { description: 'Dance.', expects: { damage: 0, seconds: 15 }, run: async () => true }, block_creeper: { description: 'Block.', run: async () => true } });
  survival.decide = async (task, goal, save, q) => { asked.push(q.state); return { path: ['block_creeper'] }; };
  survival.scoutRetreat = async () => {};
  await survival.stanceStep(new Task('x'), {}, () => {}, unseen(), false);
  const before = asked.length;
  t.mock.timers.setTime(T0 + 31000);
  await survival.stanceStep(new Task('x'), {}, () => {}, unseen(), false);
  assert.equal(asked.length, before + 1, 'asked again');
  assert.match(asked.at(-1).previousStance.askedAgainFor, /^the creeper it was chosen against has been out of sight and no nearer for \d+ seconds$/);
  assert.match(asked.at(-1).failedHereJustNow.find(f => f.choice === 'creeper_dance').why, /out of sight and no nearer for \d+: nothing for it to answer/);
});

test('a creeper round a corner within four is not kept marked by its own mark past thirty seconds unseen beyond four (note 752j)', () => {
  const danger = require('../src/danger');
  const bot = {};
  const t = { entity: { id: 5, name: 'creeper', isValid: true }, distance: 4.5, visible: false };
  const T = Date.now();
  danger.markCreeper(bot, t, T);
  assert.equal(danger.creeperMarked(bot, t, T + 10000), true);
  assert.equal(danger.creeperMarked(bot, t, T + 31000), false);
});
