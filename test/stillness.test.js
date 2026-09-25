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

test('the way to the thing counts: ingots on the way to a helmet are progress, rock is not', () => {
  const items = [], bot = botAt(0.5, 64, 0.5, items);
  const goal = { step: { action: 'acquire_set', item: 'iron_helmet' } };
  const t0 = Date.now();
  looks(bot, goal, 30, { at: t0 });
  items.push(stack('cobblestone', 5));
  assert.equal(look(bot, goal, { now: t0 + 31000 }).progress, false, 'rock dug on the way is not');
  items.push(stack('iron_ingot', 3));
  assert.equal(look(bot, goal, { now: t0 + 32000 }).progress, true, 'the ingots are');
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
  // On the game ladder, the rung: the plot's repair and its tilling are one piece of work.
  const ladder = { kind: 'win', rungTime: { phase: 'home_plot' } };
  assert.equal(stillReason({ ...ladder, step: { action: 'repair_plot', cells: 1 } }, now), 'step:rung:home_plot');
  assert.equal(stillReason({ ...ladder, step: { action: 'till', cell: { x: 1, y: 2, z: 3 } } }, now), 'step:rung:home_plot');
  assert.equal(stillReason({ ...ladder, step: { action: 'detour', choice: 'mine_nearby' } }, now), 'step:detour:mine_nearby', 'a detour is its own');
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
  assert.equal(permittedWait({}, { survivalAction: { action: 'surface', at } }, now), 'surface', 'nor the way up to air, by the name vitals reports');
  assert.equal(permittedWait({}, { survivalAction: { action: 'return_to_surface', at } }, now), null);
  assert.equal(permittedWait({}, { kind: 'follow', step: { action: 'follow' } }, now), 'with the player');
  assert.equal(permittedWait({ health: 15, food: 20 }, { step: { action: 'recover_before_combat' } }, now), 'recovering');
  assert.equal(permittedWait({ health: 15, food: 12 }, { step: { action: 'recover_before_combat' } }, now), null, 'no regeneration at twelve hunger: that wait goes nowhere');
  const watched = { _stalls: { records: {}, marks: [] }, entity: { position: new Vec3(0.5, 64, 0.5) }, entities: { 1: { id: 1, name: 'zombie', position: new Vec3(4.5, 64, 0.5), isValid: true, height: 1.9 } },
    world: { raycast: () => null }, time: { timeOfDay: 18000 }, inventory: { slots: {} } };
  assert.equal(permittedWait(watched, { step: { action: 'mine' } }, now), 'a hostile in view');
  assert.equal(permittedWait(watched, { step: { action: 'mine' } }, now + 61000), null, 'for a minute: a skeleton across a ravine does not hold the bot still for good');
  assert.equal(permittedWait(watched, { step: { action: 'mine' } }, now + 62000), null, 'and the minute does not start again while it is still there');
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

test('a stalled mine moves on from this patch and keeps its step: no step-less marker is left for the loop to spin on', async () => {
  const { answerStall } = require('../src/work');
  const bot = Object.assign(botAt(0.5, 64, 0.5), { registry, health: 20, food: 20, findBlocks: () => [], blockAt: () => ({ name: 'air', boundingBox: 'empty' }),
    pathfinder: { movements: {}, setGoal() {}, goto: async () => {} }, clearControlStates() {}, chat() {} });
  const step = { action: 'mine', block: 'dirt', sources: ['dirt', 'grass_block'], drops: 'dirt', count: 4 };
  const goal = { kind: 'win', survival: {}, step };
  await answerStall(bot, new Task('stall'), goal, () => {}, { key: 'step:dirt', layer: 'work', strikes: 1 }).catch(() => {});
  assert.equal(goal.step, step, `the mine step is back: ${JSON.stringify(goal.step)}`);
});

test('with Jev asked, how to answer a stall is its choice: another way, the rung for later, or a detour, with the strikes as a fact', async () => {
  const { answerStall } = require('../src/work');
  const { isSetAside } = require('../src/progress');
  const asked = [];
  const client = { systemOne: async ({ state, questions }) => { asked.push({ state, criteria: Object.keys(questions.branch_0.criteria), described: questions.branch_0.criteria }); return { answers: { branch_0: { choice: 'set_aside_rung', confidence: 0.4 } } }; } };
  const bot = Object.assign(botAt(0.5, 64, 0.5), { registry, health: 20, food: 20, findBlocks: () => [], blockAt: () => ({ name: 'air', boundingBox: 'empty' }),
    time: { timeOfDay: 1000 }, game: { dimension: 'overworld' }, pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, chat() {} });
  const goal = { kind: 'win', survival: {}, step: { action: 'craft', item: 'shield' }, rungTime: { phase: 'shield' } };
  await answerStall(bot, new Task('stall'), goal, () => {}, { key: 'step:rung:shield', layer: 'work', strikes: 1 }, { client }).catch(() => {});
  assert(asked[0].criteria.includes('differently') && asked[0].criteria.includes('set_aside_rung'), asked[0].criteria.join(','));
  assert.equal(asked[0].state.stalled.strikes, 1);
  assert.match(asked[0].described.set_aside_rung, /It is for this: blocks arrows.*For those thirty minutes, every arrow and every creeper blast lands in full/, 'what the rung is for and going without it costs (the decision audit)');
  assert(isSetAside(goal, 'rung', 'shield'), 'Jev\'s pick ran at the first stall, unsure or not');
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

test('a detour underground says where the ore is and what is beside it, and that the dark spawns mobs on a walk (the decision audit)', async () => {
  const { breakStillness } = require('../src/work');
  const ore = new Vec3(3, 37, 0);
  const stacks = [{ name: 'stone_pickaxe', count: 1, type: registry.itemsByName.stone_pickaxe.id }, { name: 'stone_axe', count: 1, type: registry.itemsByName.stone_axe.id }, { name: 'stone_sword', count: 1, type: registry.itemsByName.stone_sword.id }];
  const bot = Object.assign(new EventEmitter(), { registry, inventory: Object.assign(new EventEmitter(), { items: () => stacks }), game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' },
    entity: { id: 1, position: new Vec3(0.5, 40, 0.5) }, health: 20, food: 20, entities: {}, time: { timeOfDay: 3000 },
    findBlocks: ({ matching }) => matching.includes(registry.blocksByName.iron_ore.id) ? [ore] : [],
    blockAt: p => { const f = p.floored(); const name = f.equals(ore) ? 'iron_ore' : f.equals(ore.offset(0, 1, 0)) || (f.x === 0 && f.z === 0 && f.y >= 40 && f.y <= 41) ? 'cave_air' : 'stone'; return { name, boundingBox: /air/.test(name) ? 'empty' : 'block', position: f, skyLight: 0 }; },
    pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, chat() {} });
  const goal = { kind: 'win', step: { action: 'mine' }, survival: {} };
  let offered;
  const client = { systemOne: async ({ questions }) => { offered = questions.branch_0.criteria; throw new Error('offline'); } };
  await breakStillness(bot, new Task('still'), goal, () => {}, { client, survival: { state: goal.survival, canNightMine: () => false }, reason: 'step:mine' }).catch(() => {});
  assert.match(offered.mine_nearby, /It is 3 blocks down\. It is in the wall of an open space/);
  assert.match(offered.look_around, /Underground: mobs spawn wherever it is dark along the way/);
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

test('low on air with no rescue under way, the step is stopped and every check unwinds until the survival layer runs', () => {
  const { airWatch, checkStall } = require('../src/stillness');
  let stopped = 0, closed = 0;
  const bot = { oxygenLevel: 8, pathfinder: { setGoal: g => { if (g === null) stopped++; } }, clearControlStates() {}, currentWindow: { id: 3 }, closeWindow: () => { closed++; } };
  airWatch(bot);
  assert.equal(stopped, 1); assert.equal(closed, 1);
  assert.throws(() => checkStall(bot), e => e.name === 'NeedsAir', 'the next check unwinds the step');
  assert.throws(() => checkStall(bot), e => e.name === 'NeedsAir', 'and the one after, if the first was swallowed');
  bot._airAbort = false; // the survival layer ran (Survival.stepOnce)
  assert.doesNotThrow(() => checkStall(bot));
  airWatch(bot); assert.equal(stopped, 1, 'not again within five seconds');
  const surfacing = { oxygenLevel: 6, _survivalGoal: { survivalAction: { action: 'surface', at: new Date().toISOString() } }, pathfinder: { setGoal: () => assert.fail('the rescue is not stopped') } };
  airWatch(surfacing); assert.equal(surfacing._airAbort, undefined);
});

test('hit twice with no survival response, the held step is stopped and unwinds to the survival layer', () => {
  const { EventEmitter } = require('node:events');
  const { Survival } = require('../src/survival');
  const { checkStall } = require('../src/stillness');
  let stopped = 0, closed = 0;
  const bot = Object.assign(new EventEmitter(), { entity: { id: 1, position: new (require('vec3').Vec3)(0, 64, 0) }, entities: {}, health: 14, game: { dimension: 'overworld' },
    stopDigging: () => { stopped++; }, pathfinder: { setGoal: () => {} }, clearControlStates() {}, currentWindow: { id: 2 }, closeWindow: () => { closed++; }, inventory: { items: () => [] } });
  new Survival(bot, {});
  bot.emit('entityHurt', bot.entity);
  assert.doesNotThrow(() => checkStall(bot), 'one hit is not yet a held turn');
  bot.emit('entityHurt', bot.entity);
  assert.equal(stopped, 1); assert.equal(closed, 1);
  assert.throws(() => checkStall(bot), e => e.name === 'NeedsSafety');
  assert.throws(() => checkStall(bot), e => e.name === 'NeedsSafety', 'held until the survival layer runs');
  bot._threatAbort = false; // the survival layer ran
  bot._threatResponseAt = Date.now(); bot._threatAbortAt = 0;
  bot.emit('entityHurt', bot.entity); bot.emit('entityHurt', bot.entity);
  assert.doesNotThrow(() => checkStall(bot), 'a fight the survival layer is answering is left alone');
});

test('one hit by a hostile mob stops a held step, and leaving the mobs be is not an answer to them', () => {
  // Trial 57, replayed on its ledge: told to keep working, the bot dug stone
  // by hand for its shelter while a zombie hit it five times.
  const { EventEmitter } = require('node:events');
  const { Vec3 } = require('vec3');
  const { Survival } = require('../src/survival');
  const { checkStall } = require('../src/stillness');
  let stopped = 0;
  const zombie = { id: 7, name: 'zombie', position: new Vec3(1, 64, 0), isValid: true };
  const bot = Object.assign(new EventEmitter(), { entity: { id: 1, position: new Vec3(0, 64, 0) }, entities: { 7: zombie }, health: 17, game: { dimension: 'overworld' }, time: { timeOfDay: 18000 },
    stopDigging: () => { stopped++; }, pathfinder: { setGoal: () => {} }, clearControlStates() {}, inventory: { items: () => [] } });
  const survival = new Survival(bot, {});
  survival.report({}, () => {}, { action: 'keep_working', threats: ['zombie'], stance: true });
  survival.report({}, () => {}, { action: 'gather_shelter_materials', need: 19 });
  bot.emit('entityHurt', bot.entity, zombie);
  assert.equal(stopped, 1, 'the dig is stopped at the first hit');
  assert.throws(() => checkStall(bot), e => e.name === 'NeedsSafety');
  bot._threatAbort = false; bot._threatAbortAt = 0;
  survival.report({}, () => {}, { action: 'hold_defensive_position', threats: ['zombie'] });
  bot.emit('entityHurt', bot.entity, zombie);
  assert.equal(stopped, 1, 'a hold is an answer to the mob');
});

test('where the bot has been lately is kept every fifteen seconds for three minutes, with what it was doing', () => {
  const { noteTrail, recentPositions } = require('../src/stillness');
  const { Vec3 } = require('vec3');
  const bot = { entity: { position: new Vec3(0.5, 64, 0.5) } };
  const goal = { step: { action: 'ascend_to_surface' } };
  let t = 1_000_000;
  for (let i = 0; i < 20; i++) { bot.entity.position = new Vec3(i % 2 ? 1.5 : 0.5, 57, 0.5); noteTrail(bot, goal, t); noteTrail(bot, goal, t + 5000); t += 15000; }
  const trail = recentPositions(bot, t);
  assert.equal(trail.places.length, 12, 'three minutes of places, one each fifteen seconds');
  assert.equal(trail.furthestFromNowBlocks, 1, 'a loop: never more than a block from here');
  assert.equal(trail.places.at(-1).doing, 'ascend_to_surface');
  assert.equal(trail.places[0].secondsAgo, 180);
});

test('a batch of the step\'s own cooking is not a stall for as long as it takes', () => {
  // Trial 51: twenty-four iron for the armour, called stalled at forty-five seconds.
  const { permittedWait } = require('../src/stillness');
  const bot = { entity: { position: { x: 0, y: 64, z: 0 } }, entities: {} };
  const now = Date.now();
  assert.equal(permittedWait(bot, { smelting: { count: 24, startedAt: now - 60000 } }, now), 'a batch cooking');
  assert.equal(permittedWait(bot, { smelting: { count: 2, startedAt: now - 60000 } }, now), null, 'two items are long done');
});

test('two steps handing the turn back and forth are a stall as it happens, before the audit fails the trial; progress under two names is not', () => {
  // mid-110-d: tunnel and retreat_from_tunnel; mid-110-a: make_obsidian and tunnel; trial 115: return_home and a detour.
  const { flipWatch } = require('../src/stillness');
  const { Vec3 } = require('vec3');
  const bot = { entity: { position: new Vec3(0.5, 20, 0.5) }, inventory: { items: () => [{ name: 'cobblestone', count: 30 }] } };
  const goal = {};
  let t = 1_000_000, raised = null;
  for (const [i, a] of ['tunnel', 'retreat_from_tunnel', 'tunnel', 'retreat_from_tunnel', 'tunnel'].entries()) {
    goal.step = { action: a }; bot.entity.position = new Vec3(0.5 + (i % 2) * 2, 20, 0.5);
    raised = flipWatch(bot, goal, t += 4000) || raised;
  }
  assert(raised, 'raised on the fifth change');
  assert.match(raised.why, /turning between tunnel and retreat from tunnel 4 times in 16 seconds/);
  assert.equal(bot._stalls.stall.why, raised.why);
  // A shaft that advances while two names trade places is not a flip.
  const walker = { entity: { position: new Vec3(0.5, 20, 0.5) }, inventory: { items: () => [] } }, g2 = {};
  let r2 = null;
  for (const [i, a] of ['tunnel', 'collect', 'tunnel', 'collect', 'tunnel'].entries()) {
    g2.step = { action: a }; walker.entity.position = new Vec3(0.5 + i * 2, 20 - i, 0.5);
    r2 = flipWatch(walker, g2, t += 3000) || r2;
  }
  assert.equal(r2, null);
  // Nor one that gains something worth keeping.
  const miner = { entity: { position: new Vec3(0.5, 20, 0.5) }, inventory: { items: () => [{ name: 'raw_iron', count: n }] } }, g3 = {};
  let n = 0, r3 = null;
  for (const a of ['mine', 'collect', 'mine', 'collect', 'mine']) { g3.step = { action: a }; n++; r3 = flipWatch(miner, g3, t += 3000) || r3; }
  assert.equal(r3, null);
});

test('the survival layer turning between leaving a shelter and digging in is a flip too; a fight and a raised shield are one fight', () => {
  const { flipWatch } = require('../src/stillness');
  const { Vec3 } = require('vec3');
  const bot = { entity: { position: new Vec3(0.5, 100, 0.5) }, inventory: { items: () => [] } };
  let t = 2_000_000, raised = null;
  const goal = { step: { action: 'mine' } };
  for (const a of ['leave_shelter', 'dig_in', 'leave_shelter', 'dig_in', 'leave_shelter']) { t += 2000; goal.survivalAction = { action: a, at: new Date(t).toISOString() }; raised = flipWatch(bot, goal, t) || raised; }
  assert.match(raised?.why || '', /turning between leave shelter and dig in/);
  const fighter = { entity: { position: new Vec3(0.5, 100, 0.5) }, inventory: { items: () => [] } }, g2 = { step: { action: 'mine' } };
  let r2 = null;
  for (const a of ['fight', 'block_shot', 'fight', 'block_shot', 'fight']) { t += 2000; g2.survivalAction = { action: a, at: new Date(t).toISOString() }; r2 = flipWatch(fighter, g2, t) || r2; }
  assert.equal(r2, null);
});

test('a step flipping under a recent survival action is still caught: the two are watched apart', () => {
  // mid-110-f: tunnel and retreat traded seven times in eight seconds.
  const { flipWatch } = require('../src/stillness');
  const { Vec3 } = require('vec3');
  const bot = { entity: { position: new Vec3(0.5, 58, 0.5) }, inventory: { items: () => [] } };
  let t = 3_000_000, raised = null;
  const goal = { survivalAction: { action: 'return_to_surface', at: new Date(t).toISOString() } };
  for (const a of ['tunnel', 'retreat_from_tunnel', 'tunnel', 'retreat_from_tunnel', 'tunnel']) { t += 1200; goal.step = { action: a }; goal.survivalAction.at = new Date(t).toISOString(); raised = flipWatch(bot, goal, t) || raised; }
  assert.match(raised?.why || '', /turning between tunnel and retreat from tunnel 4 times in 5 seconds/);
});
