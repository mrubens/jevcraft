'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { STALL_MS, look, actionOf, permittedWait, stillReason, recordStill, raise, checkStall, takeStall, refused } = require('../src/stillness');
const registry = require('minecraft-data')('26.1');

const stack = (name, count) => ({ name, count, type: registry.itemsByName[name]?.id });
const botAt = (x, y, z, items = []) => Object.assign(new EventEmitter(), { entity: { position: new Vec3(x, y, z) }, inventory: Object.assign(new EventEmitter(), { items: () => items }),
  game: { dimension: 'overworld', gameMode: 'survival' }, entities: {}, world: { raycast: () => null }, time: { timeOfDay: 3000 } });
// Looks a second apart, as the supervisor takes them.
const looks = (bot, goal, n, { at = Date.now(), move } = {}) => { let seen; for (let i = 0; i < n; i++) { move?.(i); seen = look(bot, goal, { now: at + i * 1000, dt: 1000 }); } return seen; };

test('progress is somewhere new, something new, a new block or nearer; pacing, re-digging and a ring round the same wood are not', () => {
  const logs = [], bot = botAt(0.5, 64, 0.5, logs);
  const goal = { step: { action: 'mine', block: 'oak_log', drops: 'oak_log' } };
  const t0 = Date.now();
  assert.equal(look(bot, goal, { now: t0 }).progress, true, 'the first look is somewhere new');
  // Two blocks back and forth for a minute: busy, and nowhere (the last ten
  // seconds of the trail do not count against it, so the clock starts then).
  const pace = looks(bot, goal, 56, { at: t0 + 1000, move: i => { bot.entity.position = new Vec3(i % 2 ? 2.5 : 0.5, 64, 0.5); } });
  assert(pace.idle >= STALL_MS, 'pacing inside one cell goes nowhere');
  // A log in the pockets is something new; a sapling off the leaves is not what the step is for.
  logs.push(stack('oak_sapling', 3));
  assert.equal(look(bot, goal, { now: t0 + 58000 }).progress, false, 'a sapling is not a log');
  logs.push(stack('oak_log', 1));
  assert.equal(look(bot, goal, { now: t0 + 59000 }).idle, 0, 'a log is');
  // Blocks: a new one dug is progress, the same one again is not (the sealing loop).
  bot._stalls.marks.push(new Vec3(3, 64, 0));
  assert.equal(look(bot, goal, { now: t0 + 60000 }).progress, true);
  bot._stalls.marks.push(new Vec3(3, 64, 0));
  assert.equal(look(bot, goal, { now: t0 + 61000 }).progress, false, 'the same block again is going nowhere');
  // A ring round a wood: new ground at first, the same ground on the second lap.
  const ring = i => { const a = (i % 24) / 24 * 2 * Math.PI; bot.entity.position = new Vec3(20 * Math.cos(a), 64, 20 * Math.sin(a)); };
  const lap1 = looks(bot, goal, 24, { at: t0 + 62000, move: ring });
  assert(lap1.idle < 10000, 'the first lap is new ground');
  const laps = looks(bot, goal, 48, { at: t0 + 86000, move: i => ring(i + 24) });
  assert(laps.idle >= STALL_MS, 'the second and third laps are not');
});

test('a slow walk in a straight line is new ground; the same trip back and forth is not, whatever the step is called', () => {
  const bot = botAt(0.5, 64, 0.5);
  const t0 = Date.now();
  // Swimming at a block and a half a second: every look is near the last, and far from ten seconds ago.
  const swim = looks(bot, { step: { action: 'reach_shore' } }, 60, { at: t0, move: i => { bot.entity.position = new Vec3(0.5 + i * 1.5, 63, 0.5); } });
  assert(swim.idle < 5000, 'never more than a look or two between new ground');
  // Twenty blocks out for stone and back for a food drop, the step renamed each way.
  const trip = i => { const leg = Math.floor(i / 5) % 2, k = i % 5; bot.entity.position = new Vec3(100 + (leg ? 20 - k * 4 : k * 4), 64, 0.5); };
  const goal = { step: { action: 'mine', block: 'stone', drops: 'cobblestone' } };
  looks(bot, goal, 30, { at: t0 + 60000, move: trip });
  const later = looks(bot, goal, 50, { at: t0 + 90000, move: i => { trip(i + 30); goal.step = i % 10 < 5 ? { action: 'mine', block: 'stone', drops: 'cobblestone' } : { action: 'return_to_mine', resource: 'stone' }; } });
  assert(later.idle >= STALL_MS, 'a stone face and a food drop twenty blocks apart, again and again, is pacing');
});

test('nearer the action\'s own target is progress, in three dimensions', () => {
  const bot = botAt(0.5, 30, 0.5);
  const goal = { step: { action: 'go_to_landmark', target: { x: 0, y: 60, z: 0 } } };
  const t0 = Date.now();
  look(bot, goal, { now: t0 });
  // Climbing a shaft in place: the same column, but a block nearer each look.
  const climb = looks(bot, goal, 20, { at: t0 + 1000, move: i => { bot.entity.position = new Vec3(0.5, 30 + (i + 1) * 0.5, 0.5); } });
  assert(climb.idle < 5000, 'height gained toward the target counts');
});

test('the action is the survival layer\'s while it is recent, else the step; a retry is charged to the step that failed', () => {
  const now = Date.now(), at = new Date(now - 1000).toISOString();
  assert.equal(stillReason({ survivalAction: { action: 'return_to_surface', at }, step: { action: 'mine', drops: 'oak_log' } }, now), 'survival:return_to_surface');
  assert.equal(stillReason({ survivalAction: { action: 'return_to_surface', at: new Date(now - 60000).toISOString() }, step: { action: 'mine', drops: 'oak_log' } }, now), 'step:oak_log');
  assert.equal(stillReason({ step: { action: 'persist', attempt: 3 }, lastStruggleStep: { action: 'smelt', item: 'iron_ingot' } }, now), 'step:iron_ingot');
  assert.equal(stillReason({ step: { action: 'combined_request', detail: { action: 'craft', item: 'bread' } } }, now), 'step:bread');
  // Mining stone, walking back to it and moving on from it are one piece of work.
  assert.equal(stillReason({ step: { action: 'mine', block: 'stone', drops: 'cobblestone' } }, now), 'step:stone');
  assert.equal(stillReason({ step: { action: 'return_to_mine', resource: 'stone' } }, now), 'step:stone');
  assert.equal(stillReason({ step: { action: 'move_on', resource: 'stone' } }, now), 'step:stone');
  assert.equal(stillReason({ step: { action: 'detour', choice: 'look_around' } }, now), 'step:detour:look_around');
  assert.deepEqual(actionOf({ step: { action: 'reach_shore', destination: { x: 1, y: 63, z: 2 } } }, now).target, { x: 1, y: 63, z: 2 });
});

test('asleep, in a fight, holding a door or getting out of danger is not measured; standing in a pocket is', () => {
  const now = Date.now(), at = new Date(now - 1000).toISOString();
  assert.equal(permittedWait({ isSleeping: true }, {}, now), 'asleep');
  assert.equal(permittedWait({ _combatEncounter: { expiresAt: now + 5000, task: {} } }, {}, now), 'in a fight');
  assert.equal(permittedWait({}, { step: { action: 'hold_bunker' } }, now), 'hold_bunker');
  assert.equal(permittedWait({}, { survivalAction: { action: 'hold_defensive_position', at } }, now), 'hold_defensive_position');
  assert.equal(permittedWait({}, { survivalAction: { action: 'wait_in_shelter', at } }, now), 'wait_in_shelter', 'held in by something watching');
  assert.equal(permittedWait({}, { survivalAction: { action: 'leave_lava', at } }, now), 'leave_lava', 'the way out of lava is never set aside');
  assert.equal(permittedWait({}, { survivalAction: { action: 'return_to_surface', at } }, now), null);
  assert.equal(permittedWait({}, { kind: 'follow', step: { action: 'follow' } }, now), 'with the player');
  assert.equal(permittedWait({ health: 15, food: 20 }, { step: { action: 'recover_before_combat' } }, now), 'recovering');
  assert.equal(permittedWait({ health: 15, food: 12 }, { step: { action: 'recover_before_combat' } }, now), null, 'no regeneration at twelve hunger: that wait goes nowhere');
  const watched = { _stalls: { records: {}, marks: [] }, entity: { position: new Vec3(0.5, 64, 0.5) }, entities: { 1: { id: 1, name: 'zombie', position: new Vec3(4.5, 64, 0.5), isValid: true, height: 1.9 } },
    world: { raycast: () => null }, time: { timeOfDay: 18000 }, inventory: { slots: {} } };
  assert.equal(permittedWait(watched, { step: { action: 'mine' } }, now), 'a hostile in view');
  assert.equal(permittedWait(watched, { step: { action: 'mine' } }, now + 61000), null, 'for a minute: a skeleton across a ravine does not hold the bot still for good');
});

test('a stall is set aside, thrown at every check until the loop takes it, and a stalled survival action is refused', () => {
  const { Task } = require('../src/skills');
  const { Survival } = require('../src/survival');
  const bot = botAt(0.5, 40, 0.5);
  const goal = { survival: {}, survivalAction: { action: 'return_to_surface', at: new Date().toISOString() } };
  const t0 = Date.now();
  // The survival layer reports its action afresh every tick.
  const seen = looks(bot, goal, 57, { at: t0, move: i => { goal.survivalAction.at = new Date(t0 + i * 1000).toISOString(); } });
  assert(seen.idle >= STALL_MS);
  const stall = raise(bot, goal, seen);
  assert.equal(stall.key, 'survival:return_to_surface'); assert.equal(stall.strikes, 1);
  const task = new Task('work'); task.stallCheck = () => checkStall(bot);
  assert.throws(() => task.check(), { name: 'Stalled' });
  assert.throws(() => task.check(), { name: 'Stalled' }, 'a step that swallowed the first throw meets it again');
  assert.equal(takeStall(bot).key, 'survival:return_to_surface');
  task.check();
  assert(refused(goal, 'survival:return_to_surface'), 'set aside for a while');
  assert.throws(() => Survival.prototype.report.call({ state: goal.survival, bot }, goal, () => {}, { action: 'return_to_surface' }), { name: 'SetAside' });
  Survival.prototype.report.call({ state: goal.survival, bot }, goal, () => {}, { action: 'dig_in' });
  assert.equal(goal.survivalAction.action, 'dig_in', 'the next answer, a wait worth making, goes ahead');
});

test('a stalled step is done differently first, then something else, then its rung is left for later', async () => {
  const { answerStall } = require('../src/work');
  const { isSetAside } = require('../src/progress');
  const said = [];
  const bot = Object.assign(botAt(0.5, 64, 0.5), { registry, health: 20, food: 20, findBlocks: () => [], blockAt: () => ({ name: 'air', boundingBox: 'empty' }),
    pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, chat: line => said.push(line) });
  const goal = { kind: 'win', survival: {}, step: { action: 'tunnel', resource: 'fortress' }, tunnel: { steps: 400 }, search: { oak_log: { attempts: 3, frontier: { heading: 2, legs: 1 } } },
    miningSites: { 'nether:fortress': { workPosition: { x: 1, y: 2, z: 3 } } }, rungTime: { phase: 'shield' } };
  await answerStall(bot, new Task('stall'), goal, () => {}, { key: 'step:tunnel', layer: 'work', strikes: 1 });
  assert.equal(goal.tunnel, undefined, 'the shaft that stalled is dropped');
  assert.equal(goal.miningSites['nether:fortress'].workPosition, undefined);
  assert.match(said[0], /getting nowhere with the tunnel\. Trying another way/);
  await answerStall(bot, new Task('stall'), goal, () => {}, { key: 'step:tunnel', layer: 'work', strikes: 3 });
  assert(isSetAside(goal, 'rung', 'shield'), 'the third stall in ten minutes leaves the rung for later');
  const survivalSaid = said.length;
  await answerStall(bot, new Task('stall'), goal, () => {}, { key: 'survival:night_mine', layer: 'survival', strikes: 2 });
  assert.equal(said.length, survivalSaid, 'a survival stall is said once, not at every strike');
  assert(goal.survival.stillness.events.some(e => e.reason === 'survival:night_mine'));
});

test('seconds stalled are kept per hour and per reason, for the notes to read back', () => {
  const state = {}, now = Date.parse('2026-09-22T19:30:00Z');
  recordStill(state, 'step:stock_food_for_nether', 25000, { now, detour: 'look_around' });
  recordStill(state, 'survival:wait_in_shelter', 40000, { now });
  const hour = state.stillness.hours['2026-09-22T19'];
  assert.equal(hour.seconds, 65); assert.equal(hour.stalls, 2);
  assert.deepEqual(hour.byReason, { 'step:stock_food_for_nether': 25, 'survival:wait_in_shelter': 40 });
  assert.equal(state.stillness.events[0].detour, 'look_around');
});

test('something else useful from here, and the stalled step is kept', async () => {
  const { breakStillness } = require('../src/work');
  const stacks = [{ name: 'wooden_pickaxe', count: 1, type: registry.itemsByName.wooden_pickaxe.id }];
  const bot = Object.assign(new EventEmitter(), { registry, inventory: Object.assign(new EventEmitter(), { items: () => stacks }), game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' },
    entity: { id: 1, position: new Vec3(0.5, 64, 0.5) }, health: 20, food: 20, entities: {}, time: { timeOfDay: 3000 },
    findBlocks: () => [], blockAt: () => ({ name: 'air', boundingBox: 'empty' }), pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, chat() {} });
  const goal = { kind: 'win', step: { action: 'stock_food_for_nether' }, survival: {} };
  const survival = { state: goal.survival, canNightMine: () => false };
  // No client: the first option on the list runs (stone tools are missing).
  // In this bare world it fails, which the loop's catch would take; it has
  // still been tried, and set to rest.
  await breakStillness(bot, new Task('still'), goal, () => {}, { survival, reason: 'step:stock_food_for_nether' }).catch(() => {});
  assert(goal.survival.attempts['detour:stone_tools'], 'the detour ran, failed here, and rests for a while');
  assert.equal(goal.step.action, 'stock_food_for_nether', 'the stalled step is back when the detour ends');
  const hour = Object.values(goal.survival.stillness.hours)[0];
  assert.equal(hour.stalls, 1); assert(hour.byReason['step:stock_food_for_nether'] >= 20);
});

test('the Nether food gate never waits: a rested search is taken up again, and twenty minutes lets the crossing go', async () => {
  const { gameHandlers } = require('../src/work');
  const bot = Object.assign(new EventEmitter(), { registry, inventory: { items: () => [] }, game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' },
    entity: { id: 1, position: new Vec3(0.5, 64, 0.5) }, health: 20, food: 20, entities: {}, time: { timeOfDay: 3000 },
    findBlocks: () => [], blockAt: () => ({ name: 'air', boundingBox: 'empty' }), pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, chat() {} });
  const gate = gameHandlers(bot, null).food_reserve;
  const goal = { kind: 'win', survival: {} };
  const { setAside, isSetAside } = require('../src/progress');
  setAside(goal, 'food_search', 'stock', 'five minutes of searching brought no food', 600000);
  await gate(bot, new Task('gate'), goal, () => {}).catch(() => {});
  assert.equal(isSetAside(goal, 'food_search', 'stock'), false, 'the animal search is not left resting');
  assert.equal(goal.step.action, 'hunt_food_for_nether');
  assert(goal.stockFood && goal.preparingNether);
  const noFoodFor = ms => { goal.survival.progress['food_gate:nether'].bestAt -= ms; };
  noFoodFor(20 * 60000);
  await gate(bot, new Task('gate'), goal, () => {}).catch(() => {});
  assert.equal(goal.step.action, 'hunt_food_for_nether', 'with nothing at all to eat, twenty minutes is not a reason to cross');
  const bread = [{ name: 'bread', count: 2, type: registry.itemsByName.bread.id }];
  bot.inventory.items = () => bread;
  await gate(bot, new Task('gate'), goal, () => {}).catch(() => {});
  noFoodFor(20 * 60000);
  assert.equal(await gate(bot, new Task('gate'), goal, () => {}), true, 'with something, and twenty minutes with no more, the crossing goes with what there is');
  assert.equal(goal.survival.progress['food_gate:nether'], undefined, 'and the gate is done with');
});
