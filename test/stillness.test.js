'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { STILL_MS, watchActivity, stillFor, permittedWait, stillReason, recordStill } = require('../src/stillness');
const registry = require('minecraft-data')('26.1');

test('activity is what the world can see: a step of a block, a dig, a pickup, a blow landed, a pocket changed', () => {
  const bot = Object.assign(new EventEmitter(), { entity: { position: new Vec3(0.5, 64, 0.5) }, inventory: new EventEmitter() });
  const activity = watchActivity(bot);
  activity.at -= 60000;
  bot.entity.position = new Vec3(0.9, 64, 0.5); bot.emit('move');
  assert(stillFor(bot) >= 59000, 'shuffling in place is not moving');
  bot.entity.position = new Vec3(2.5, 64, 0.5); bot.emit('move');
  assert(stillFor(bot) < 1000, 'a block and more is');
  for (const [event, ...args] of [['diggingCompleted'], ['playerCollect', bot.entity], ['entityHurt', {}, bot.entity]]) {
    activity.at -= 60000; bot.emit(event, ...args); assert(stillFor(bot) < 1000, event);
  }
  activity.at -= 60000; bot.emit('entityHurt', bot.entity, {});
  assert(stillFor(bot) >= 59000, 'being hit is not doing anything');
  bot.inventory.emit('updateSlot'); assert(stillFor(bot) < 1000);
});

test('asleep, in a fight or holding a door is a wait worth making; standing in a pocket is not', () => {
  const now = Date.now(), at = new Date(now - 1000).toISOString();
  assert.equal(permittedWait({ isSleeping: true }, {}, now), 'asleep');
  assert.equal(permittedWait({ _combatEncounter: { expiresAt: now + 5000, task: {} } }, {}, now), 'in a fight');
  assert.equal(permittedWait({}, { step: { action: 'hold_bunker' } }, now), 'hold_bunker');
  assert.equal(permittedWait({}, { survivalAction: { action: 'hold_defensive_position', at } }, now), 'hold_defensive_position', 'the name survival really reports');
  assert.equal(permittedWait({}, { survivalAction: { action: 'wait_in_shelter', at } }, now), 'wait_in_shelter', 'held in by something watching');
  assert.equal(permittedWait({}, { kind: 'follow', step: { action: 'follow' } }, now), 'with the player', 'a player standing still is not a stall to follow');
  assert.equal(permittedWait({ health: 15, food: 20 }, { step: { action: 'recover_before_combat' } }, now), 'recovering');
  assert.equal(permittedWait({ health: 15, food: 12 }, { step: { action: 'recover_before_combat' } }, now), null, 'no regeneration at twelve hunger: that wait goes nowhere');
  const watched = { entity: { position: new Vec3(0.5, 64, 0.5) }, entities: { 1: { id: 1, name: 'zombie', position: new Vec3(4.5, 64, 0.5), isValid: true, height: 1.9 } },
    world: { raycast: () => null }, time: { timeOfDay: 18000 }, inventory: { slots: {} } };
  assert.equal(permittedWait(watched, { step: { action: 'mine' } }, now), 'a hostile in view', 'the survival layer\'s moment, not an idle one');
  assert.equal(permittedWait({}, { step: { action: 'stock_food_for_nether' } }, now), null);
  assert.equal(stillReason({ survivalAction: { action: 'wait_in_shelter', at }, step: { action: 'mine' } }, now), 'survival:wait_in_shelter');
  assert.equal(stillReason({ step: { action: 'stock_food_for_nether' } }, now), 'step:stock_food_for_nether');
});

test('seconds still are kept per hour and per reason, for the notes to read back', () => {
  const state = {}, now = Date.parse('2026-09-22T19:30:00Z');
  recordStill(state, 'step:stock_food_for_nether', 25000, { now, detour: 'look_around' });
  recordStill(state, 'survival:wait_in_shelter', 40000, { now });
  const hour = state.stillness.hours['2026-09-22T19'];
  assert.equal(hour.seconds, 65); assert.equal(hour.stalls, 2);
  assert.deepEqual(hour.byReason, { 'step:stock_food_for_nether': 25, 'survival:wait_in_shelter': 40 });
  assert.equal(state.stillness.events[0].detour, 'look_around');
});

test('a stall is broken with something useful from here, and the stalled step is kept', async () => {
  const { breakStillness } = require('../src/work');
  const stacks = [{ name: 'wooden_pickaxe', count: 1, type: registry.itemsByName.wooden_pickaxe.id }];
  const bot = Object.assign(new EventEmitter(), { registry, inventory: Object.assign(new EventEmitter(), { items: () => stacks }), game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' },
    entity: { id: 1, position: new Vec3(0.5, 64, 0.5) }, health: 20, food: 20, entities: {}, time: { timeOfDay: 3000 },
    findBlocks: () => [], blockAt: () => ({ name: 'air', boundingBox: 'empty' }), pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, chat() {} });
  watchActivity(bot).at -= STILL_MS + 1000;
  const goal = { kind: 'win', step: { action: 'stock_food_for_nether' }, survival: {} };
  const survival = { state: goal.survival, canNightMine: () => false };
  // No client: the first option on the list runs (stone tools are missing).
  // In this bare world it fails, which the loop's catch would take; it has
  // still been tried, and set to rest.
  await breakStillness(bot, new Task('still'), goal, () => {}, { survival }).catch(() => {});
  assert(goal.survival.attempts['detour:stone_tools'], 'the detour ran, failed here, and rests for a while');
  assert.equal(goal.step.action, 'stock_food_for_nether', 'the stalled step is back when the detour ends');
  const hour = Object.values(goal.survival.stillness.hours)[0];
  assert.equal(hour.stalls, 1); assert(hour.byReason['step:stock_food_for_nether'] >= 20);
  assert(stillFor(bot) < 5000, 'the detour counts as activity');
});

test('the Nether food gate never waits: a rested search is taken up again, and twenty minutes lets the crossing go', async () => {
  const { gameHandlers } = require('../src/work');
  const bot = Object.assign(new EventEmitter(), { registry, inventory: { items: () => [] }, game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' },
    entity: { id: 1, position: new Vec3(0.5, 64, 0.5) }, health: 20, food: 20, entities: {}, time: { timeOfDay: 3000 },
    findBlocks: () => [], blockAt: () => ({ name: 'air', boundingBox: 'empty' }), pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, chat() {} });
  const gate = gameHandlers(bot, null).food_reserve;
  const goal = { kind: 'win', survival: { foodStockPausedUntil: Date.now() + 600000, foodSearch: { since: 1 } } };
  await gate(bot, new Task('gate'), goal, () => {}).catch(() => {});
  assert.equal(goal.survival.foodStockPausedUntil, undefined, 'the animal search is not left resting');
  assert.equal(goal.step.action, 'hunt_food_for_nether');
  assert(goal.stockFood && goal.preparingNether);
  goal.foodGate.activeMs = 20 * 60000;
  await gate(bot, new Task('gate'), goal, () => {}).catch(() => {});
  assert.equal(goal.step.action, 'hunt_food_for_nether', 'with nothing at all to eat, twenty minutes is not a reason to cross');
  const bread = [{ name: 'bread', count: 2, type: registry.itemsByName.bread.id }];
  bot.inventory.items = () => bread;
  goal.foodGate.activeMs = 20 * 60000;
  assert.equal(await gate(bot, new Task('gate'), goal, () => {}), true, 'with something, the crossing goes with what there is');
  assert.equal(goal.foodGate, undefined);
});
