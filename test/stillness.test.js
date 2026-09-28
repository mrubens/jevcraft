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
  assert.equal(permittedWait({}, { survivalAction: { action: 'hold_on_span', at } }, now), 'hold_on_span', 'crouched still on a span with a mob about (mid-242-o)');
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
  // mid-220-b chose "another way" sixteen times, never told it had.
  goal.survival.detourLog = { 'step:mine': [{ choice: 'look_around', at: Date.now() - 60000 }, { choice: 'look_around', at: Date.now() - 30000 }] };
  await breakStillness(bot, new Task('still'), goal, () => {}, { client, survival: { state: goal.survival, canNightMine: () => false }, reason: 'step:mine' }).catch(() => {});
  assert.match(offered.look_around, /Chosen for this same stall 2 times in the last 30 minutes, and the work stood still again after each/);
});

// mid-211-c: short of food in the Nether at y 39 by the lava sea, its portal
// 250 blocks off and 44 up, the way back blocked (note 241).
function stranded(items) {
  const hoglin = { id: 5, name: 'hoglin', position: new Vec3(-20.5, 39, 6.5), isValid: true, height: 1.4 };
  const bot = Object.assign(botAt(0.5, 39, 0.5, items), { registry, health: 16, food: 5, findBlocks: () => [], chat() {},
    game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, entities: { 5: hoglin },
    blockAt: p => {
      const name = p.y <= 31 ? 'lava' : p.y === 38 && p.x <= 2 ? 'netherrack' : 'air';
      return { name, boundingBox: name === 'netherrack' ? 'block' : 'empty', diggable: true, position: p };
    },
    pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {} });
  bot.inventory.slots = [];
  const goal = { kind: 'win', survival: {}, step: { action: 'return_to_portal', portal: { x: 250, y: 83, z: 0 } }, survivalAction: { action: 'return_for_food' },
    portals: [{ x: 250, y: 83, z: 0, dimension: 'nether' }, { x: 1990, y: 70, z: 10, dimension: 'overworld' }] };
  return { bot, goal };
}

test('stranded in the Nether and short of food, the stall offers what answers it: a crossing, a hoglin, a portal here, going on without the Overworld', async () => {
  const { answerStall } = require('../src/work');
  const { isSetAside } = require('../src/progress');
  const { bot, goal } = stranded([stack('netherrack', 64), stack('obsidian', 10), stack('flint_and_steel', 1), stack('iron_sword', 1)]);
  const asked = [];
  const client = { systemOne: async ({ questions }) => { asked.push(questions.branch_0.criteria); return { answers: { branch_0: { choice: 'keep_on', confidence: 0.8 } } }; } };
  const hunts = [];
  const survival = { state: goal.survival, canNightMine: () => false, foodHunt: (g, s, kind) => hunts.push(kind) };
  await answerStall(bot, new Task('stall'), goal, () => {}, { key: 'step:return_to_portal', layer: 'work', strikes: 2, error: 'No way back to the nether portal' }, { client, survival }).catch(() => {});
  const offered = asked[0];
  for (const key of ['differently', 'cross_toward', 'hoglin_food', 'portal_here', 'keep_on']) assert(offered[key], `${key} on offer: ${Object.keys(offered).join(', ')}`);
  assert.match(offered.cross_toward, /the portal back, 250 blocks off and 44 blocks up.*32 blocks, laying 30 blocks over open air and lava \(30 of them over lava\).*64 blocks carried, 34 left after.*It ends 32 blocks nearer/);
  assert.match(offered.hoglin_food, /1 in view within thirty-two blocks, the nearest 22 blocks off.*two to four raw porkchops.*forty health.*Health does not come back meanwhile: hunger 5/);
  assert.match(offered.portal_here, /obsidian carried \(10.*flint and steel.*near 4, 4.*a new place/);
  assert.match(offered.keep_on, /nothing edible is carried.*Hunger 5.*starving takes health down to one/);
  assert(isSetAside(goal, 'nether_return', 'food'), 'going on without the Overworld leaves the trip back out');
  // Nothing to build a portal with, and not hungry: neither the portal, the hoglin nor going on is offered.
  const fed = stranded([stack('netherrack', 64)]);
  fed.bot.food = 20; delete fed.goal.survivalAction;
  asked.length = 0;
  await answerStall(fed.bot, new Task('stall'), fed.goal, () => {}, { key: 'step:return_to_portal', layer: 'work', strikes: 2 }, { client, survival: { ...survival, state: fed.goal.survival } }).catch(() => {});
  assert.deepEqual(Object.keys(asked[0]).sort(), ['cross_toward', 'differently']);
});

test('gathering food for the crossing never waits: a rested search is taken up again; without Jev a top-up worked twenty minutes is passed over unless none is carried', async () => {
  const { crossingKitReady } = require('../src/work');
  let items = [];
  const bot = Object.assign(new EventEmitter(), { registry, inventory: { items: () => items }, game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' },
    entity: { id: 1, position: new Vec3(0.5, 64, 0.5) }, health: 20, food: 20, entities: {}, time: { timeOfDay: 3000 },
    findBlocks: () => [], blockAt: () => ({ name: 'air', boundingBox: 'empty' }), pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, chat() {} });
  const kit = goal => crossingKitReady(bot, new Task('kit'), goal, () => {}, null).catch(() => false);
  const goal = { kind: 'win', survival: {} };
  const { setAside, isSetAside } = require('../src/progress');
  setAside(goal, 'food_search', 'stock', 'five minutes of searching brought no food', 600000);
  assert.equal(await kit(goal), false);
  assert.equal(goal.crossingKit.choice.pick, 'top_up_food', 'without Jev, food first');
  assert.equal(isSetAside(goal, 'food_search', 'stock'), false, 'the animal search is not left resting');
  assert.equal(goal.step.action, 'hunt_food_for_nether');
  assert(goal.stockFood && goal.preparingNether);
  // Twenty working minutes with nothing at all to eat: still food.
  const later = () => { goal.crossingKit.workedMs += 11 * 60000; };
  goal.crossingKit.spent.food.ms = 20 * 60000; later();
  await kit(goal);
  assert.equal(goal.crossingKit.choice.pick, 'top_up_food', 'with nothing to eat, twenty minutes is not a reason to pass it over');
  // With something, twenty minutes passes it over for the next item short.
  items = [{ name: 'bread', count: 2, type: registry.itemsByName.bread.id }];
  goal.crossingKit.spent.food.ms = 20 * 60000; later();
  await kit(goal);
  assert.equal(goal.crossingKit.choice.pick, 'top_up_blocks');
  assert.equal(goal.preparingNether, undefined, 'and the food reserve is no longer being stocked');
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
  // mid-205-i: a fight trading names with its swing at three spiders, the swing set aside as a stall.
  const swinger = { entity: { position: new Vec3(0.5, 100, 0.5) }, inventory: { items: () => [] } }, g3 = { step: { action: 'mine' } };
  let r3 = null;
  for (const a of ['defend', 'fight', 'defend', 'fight', 'defend']) { t += 400; g3.survivalAction = { action: a, at: new Date(t).toISOString() }; r3 = flipWatch(swinger, g3, t) || r3; }
  assert.equal(r3, null, 'a fight and its swing are one fight');
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

test('a stance Jev chose is the answer while it is carried out: a hit does not throw it out, six health gone does', () => {
  // A retreat reports nothing as it runs: the watchdog stopped its walk at
  // the first hit by a mob, and the next tick searched for a way again.
  const { EventEmitter } = require('node:events');
  const { Vec3 } = require('vec3');
  const { Survival } = require('../src/survival');
  let stopped = 0;
  const zombie = { id: 7, name: 'zombie', position: new Vec3(1, 64, 0), isValid: true };
  const bot = Object.assign(new EventEmitter(), { entity: { id: 1, position: new Vec3(0, 64, 0) }, entities: { 7: zombie }, health: 17, game: { dimension: 'overworld' }, time: { timeOfDay: 18000 },
    stopDigging: () => {}, pathfinder: { setGoal: () => { stopped++; } }, clearControlStates() {}, inventory: { items: () => [] } });
  new Survival(bot, {});
  bot._stance = { choice: 'retreat', at: Date.now(), health: 17, running: true };
  bot.emit('entityHurt', bot.entity, zombie);
  assert.equal(stopped, 0, 'the run goes on');
  bot.health = 10.5;
  bot.emit('entityHurt', bot.entity, zombie);
  assert.equal(stopped, 1, 'six health gone since the choice: the watchdog stops it');
  bot._threatAbort = false; bot._threatAbortAt = 0; bot.health = 17;
  bot._stance = { choice: 'retreat', at: Date.now() - 5000, health: 17, running: false, ranAt: Date.now() - 4000 };
  bot.emit('entityHurt', bot.entity, zombie);
  assert.equal(stopped, 2, 'not carried out for four seconds (the work is back): the watchdog is too');
});

test('standing in fire, a held stance does not keep the watchdog off', () => {
  // mid-229-g: sealed a pocket in fire from eleven health to none; the watchdog gave way to the seal.
  const { EventEmitter } = require('node:events');
  const { Vec3 } = require('vec3');
  const { Survival } = require('../src/survival');
  let stopped = 0;
  const bot = Object.assign(new EventEmitter(), { entity: { id: 1, position: new Vec3(0, 64, 0) }, entities: {}, health: 12, game: { dimension: 'the_nether' }, time: { timeOfDay: 6000 },
    blockAt: p => ({ name: 'air', position: p, boundingBox: 'empty' }),
    stopDigging: () => {}, pathfinder: { setGoal: () => { stopped++; } }, clearControlStates() {}, inventory: { items: () => [] } });
  new Survival(bot, {});
  bot._stance = { choice: 'seal', at: Date.now(), health: 13, running: true };
  bot._inFireAt = Date.now();
  bot.emit('entityHurt', bot.entity, null);
  bot.emit('entityHurt', bot.entity, null);
  assert.equal(stopped, 1, 'in fire: the seal is stopped for the way out');
  const { inFire } = require('../src/vitals');
  assert.equal(inFire(bot), true, 'the server\'s in-fire hurt says so, the blocks or not');
  bot._inFireAt = Date.now() - 5000;
  assert.equal(inFire(bot), false);
});

test('a spent search is turned whatever the stall\'s answer, not only by "another way"', () => {
  // first-days-217: its wood search spent, Jev sent it to look around each time, and each return failed at once, thirty-two times.
  const { looseEnds } = require('../src/work');
  const goal = { search: { oak_log: { attempts: 128, origin: { x: 1, y: 64, z: 2 }, leg: 5 }, sand: { attempts: 40, frontier: { heading: 7, legs: 3 } } } };
  looseEnds(goal);
  assert.deepEqual(goal.search.oak_log, { attempts: 0, origin: { x: 1, y: 64, z: 2 }, leg: 6 });
  assert.deepEqual(goal.search.sand, { attempts: 0, frontier: { heading: 0, legs: 0 } });
});

test('no reachable ground anywhere is walks failing: working free is on offer', () => {
  // mid-230-a, perched by a spruce, was asked a heading every three seconds and working free was never offered.
  const { walksFailed } = require('../src/work');
  assert(walksFailed('No reachable surveyed ground while searching for spruce_log'));
  assert(walksFailed(null, 'navigation timed out'));
  assert(!walksFailed('Cannot place dirt'));
});

test('a hold that flips with another step is refused for a while; a hold that only waits is not', () => {
  // mid-205-c: dig_in (a hold) and the way back to the surface traded turns twenty-three times; five strikes changed nothing.
  const { raise } = require('../src/stillness');
  const { Survival } = require('../src/survival');
  const bot = { entity: { position: { x: 0, y: 61, z: 0 } }, _stalls: { records: {} }, game: {}, on() {} };
  const survival = new Survival(bot, {}, { state: { shelters: [] } });
  const waited = {};
  raise(bot, waited, { record: { strikes: [] }, action: { key: 'survival:wait_in_shelter', layer: 'survival', name: 'wait_in_shelter' } });
  assert.doesNotThrow(() => survival.report(waited, () => {}, { action: 'wait_in_shelter', reason: 'dawn' }), 'forty-five idle seconds in a pocket is the hold doing its job');
  // A pocket going up is a hold while its blocks go in, and only then (mid-226-h, note 520).
  const sealing = {};
  raise(bot, sealing, { record: { strikes: [] }, action: { key: 'survival:dig_in', layer: 'survival', name: 'dig_in' } });
  bot._sealPlaced = { at: Date.now() - 1000 };
  assert.doesNotThrow(() => survival.report(sealing, () => {}, { action: 'dig_in', threats: [] }), 'a block placed a second ago');
  delete bot._sealPlaced;
  assert.throws(() => survival.report(sealing, () => {}, { action: 'dig_in', threats: [] }), { name: 'SetAside' }, 'none placed: it rests as any action does');
  const flipping = {};
  raise(bot, flipping, { record: { strikes: [] }, action: { key: 'survival:dig_in', layer: 'survival', name: 'dig_in' } }, Date.now(), 'turning between dig in and return to surface 4 times in 6 seconds without getting anywhere');
  assert.throws(() => survival.report(flipping, () => {}, { action: 'dig_in', threats: [] }), { name: 'SetAside' });
  assert.doesNotThrow(() => survival.report(flipping, () => {}, { action: 'leave_lava' }), 'never the way out of lava');
});

test('the kit for the crossing is one question: every item said against what the code would take, a top-up for each one short, the answer held', async () => {
  // The decision review (2026-09-26): forty food points, sixteen health, 128 blocks, a spare pickaxe, eight logs
  // and a table, and the valuables walked home were gates in a row between "Nether first" and the portal, none said.
  // mid-220-a stood at 39 of 40 food points for forty-four passes.
  const { crossingKitReady } = require('../src/work');
  const items = [['cooked_beef', 2], ['cobblestone', 30], ['stone_pickaxe', 1], ['oak_log', 8], ['crafting_table', 1]]
    .map(([name, count]) => ({ name, count, type: registry.itemsByName[name].id, durabilityUsed: 0 }));
  const bot = Object.assign(new EventEmitter(), { registry, inventory: { items: () => items }, game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' },
    entity: { id: 1, position: new Vec3(0.5, 64, 0.5) }, health: 20, food: 20, entities: {}, time: { timeOfDay: 3000 },
    findBlocks: () => [], blockAt: () => ({ name: 'air', boundingBox: 'empty' }), pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, chat() {} });
  let asked = null, pick = 'cross_now';
  const client = { systemOne: async ({ questions }) => { asked = questions.branch_0.criteria; return { answers: { branch_0: { choice: pick, confidence: 0.9 } } }; } };
  const goal = { kind: 'win', survival: {} };
  const task = new Task('kit');
  assert.equal(await crossingKitReady(bot, task, goal, () => {}, client), true, 'crosses with what it has');
  assert.deepEqual(Object.keys(asked).sort(), ['cross_now', 'top_up_blocks', 'top_up_food', 'top_up_gold']);
  assert.match(asked.cross_now, /short of what the code would take in food, blocks/);
  assert.match(asked.cross_now, /Food: 16 food points carried \(2 cooked beef\); the code would take 80, food for the whole stay\. The goal still needs 6 blaze rods and 12 ender pearls: a practiced player takes about 2 hours in the Nether for them .* so about 2 hours is about 80 food points, 10 cooked steaks or porkchops/);
  assert.match(asked.cross_now, /Health: 20 of 20; the code would step through at 16 or more/);
  assert.match(asked.cross_now, /Blocks: 30 carried for bridging and pillaring .*the code would take 128, two stacks/);
  assert.match(asked.cross_now, /Pickaxe: stone pickaxe carried, the best with 131 uses left/);
  assert.match(asked.cross_now, /Wood: 8 logs and a crafting table carried/);
  assert.match(asked.top_up_blocks, /^Mine stone first, up to two stacks of blocks\. Blocks: 30 carried.* Nothing has gone to it yet at this crossing\./);
  // mid-242-l was offered its gold as "undefined Gold: ...".
  for (const [k, v] of Object.entries(asked)) assert(!/undefined/.test(v), `${k}: ${v.slice(0, 80)}`);
  assert.match(asked.top_up_gold, /^Make golden boots first and wear them/);
  asked = null;
  assert.equal(await crossingKitReady(bot, task, goal, () => {}, client), true);
  assert.equal(asked, null, 'held: not asked again at once');
  // An item newly short: asked again, and the top-up chosen is worked.
  bot.health = 9; pick = 'top_up_health';
  assert.equal(await crossingKitReady(bot, task, goal, () => {}, client), false);
  assert.match(asked.top_up_health, /Health: 9 of 20; the code would step through at 16 or more\..* At hunger 20 it comes back about a point every four seconds: about 28 seconds to 16\./);
  assert.equal(goal.step.action, 'recover_before_nether');
  // Ten working minutes on one answer: asked again, with the minutes it has had.
  asked = null; goal.crossingKit.spent.health.ms = 4 * 60000; goal.crossingKit.workedMs += 10 * 60000; pick = 'cross_now';
  assert.equal(await crossingKitReady(bot, task, goal, () => {}, client), true);
  assert.match(asked.top_up_health, /4 working minutes have gone to it at this crossing, from 9 to 9\./);
});

test('both sides of a survival flip rest, so a hold on the other side is refused too', () => {
  // mid-235-b: return to the surface and a sealed shelter traded turns through eight strikes.
  const { flipWatch, flipped } = require('../src/stillness');
  const bot = { entity: { position: new Vec3(0.5, 61, 0.5) }, inventory: { items: () => [] } };
  const goal = { step: { action: 'mine' } };
  let t = Date.now() - 20000, raised = null;
  for (const a of ['return_to_surface', 'seal_shelter', 'return_to_surface', 'seal_shelter', 'return_to_surface']) {
    goal.survivalAction = { action: a, at: new Date(t += 1500).toISOString() };
    raised = flipWatch(bot, goal, t) || raised;
  }
  assert(raised, 'the flip is raised');
  assert.equal(flipped(goal, 'survival:seal_shelter'), true, 'the shelter on the other side rests');
  assert.equal(flipped(goal, 'survival:return_to_surface'), true);
});

test('a mine and its pickups trading names while the count goes down is progress, filler or not', () => {
  // mid-202-c: seventeen cobblestone to go became twelve, and the audit called it a loop.
  const { flipWatch } = require('../src/stillness');
  const bot = { entity: { position: new Vec3(0.5, 64, 0.5) }, inventory: { items: () => [{ name: 'cobblestone', count: 10 }] } };
  const goal = {};
  let t = 1_000_000, raised = null, left = 17;
  for (const a of ['mine', 'collect_nearby_resource', 'mine', 'collect_nearby_resource', 'mine']) {
    goal.step = a === 'mine' ? { action: 'mine', drops: 'cobblestone', count: left-- } : { action: 'collect_nearby_resource' };
    raised = flipWatch(bot, goal, t += 2000) || raised;
  }
  assert.equal(raised, null, 'the count went down: not a flip');
});

test('working time is counted while a pass runs and saved as it goes, so a restart mid-pass keeps it', async () => {
  // mid-242-d's cast walked two hundred blocks to lava a pass, the bot restarted every few minutes, and its clock never reached the re-ask (2026-09-27).
  const { timed } = require('../src/work');
  let total = 0, saves = 0;
  const pass = timed(() => { saves++; }, ms => { total += ms; }, () => new Promise(resolve => setTimeout(resolve, 25)));
  await pass;
  assert(total >= 20, `counted: ${total}`);
  // A pass cut off: what the ticks counted before it is kept and saved.
  const realSetInterval = global.setInterval;
  let tick; global.setInterval = fn => { tick = fn; return { unref() {} }; };
  try {
    let t2 = 0; saves = 0;
    const cut = timed(() => { saves++; }, ms => { t2 += ms; }, () => new Promise(() => {}));
    await new Promise(r => setTimeout(r, 15)); tick();
    assert(t2 >= 10 && saves === 1, `ticked: ${t2} ms, ${saves} save`);
    void cut;
  } finally { global.setInterval = realSetInterval; }
});
test('an ore found only in the Overworld is not dug for in the Nether: the step says so instead of a staircase to its depth', async () => {
  // mid-242-f's armour, fetched in the Nether, set a staircase toward y 16 under the lava sea, and it fell in (2026-09-27).
  const { mineAtSource } = require('../src/work');
  const { Vec3 } = require('vec3');
  const { Task } = require('../src/skills');
  let tunnelled = false;
  const bot = { game: { dimension: 'the_nether' }, entity: { position: new Vec3(18.5, 48, 26.5) }, entities: {}, registry: require('minecraft-data')('26.1'),
    inventory: { items: () => [{ name: 'iron_pickaxe', count: 1 }] }, findBlocks: () => [], blockAt: p => ({ name: 'netherrack', position: p, boundingBox: 'block' }),
    pathfinder: { movements: {}, setGoal() { tunnelled = true; } } };
  await assert.rejects(mineAtSource(bot, new Task('mine'), { action: 'mine', block: 'iron_ore', drops: 'raw_iron', count: 3, depth: 16 }, {}, () => {}, null), err => /No iron ore in the nether: it is only found in the overworld/.test(err.message) && err.name === 'WrongDimension');
  assert.equal(tunnelled, false);
});

test('the kit for the crossing says a piece of gold keeps piglins off, and golden boots carried meet it', () => {
  // mid-242-g crossed in iron with no gold; a piglin hit it from twenty to eight and threw it into the lava (2026-09-27).
  const { kitItems } = require('../src/crossing-kit');
  const make = items => ({ game: { gameMode: 'survival', difficulty: 'normal' }, health: 20, food: 20, registry: require('minecraft-data')('26.1'),
    inventory: { items: () => items, slots: {} } });
  const none = kitItems(make([])).find(i => i.key === 'gold');
  assert.equal(none.short, true);
  assert.match(none.says, /Piglins.*leave a player wearing a piece of gold be, and go for one wearing none on sight/);
  assert.equal(kitItems(make([{ name: 'golden_boots', count: 1 }])).find(i => i.key === 'gold').short, false);
});

test('with no ore in view, the ways down are eight headings near and far, each its own staircase area', () => {
  // mid-205-j: its four headings all resting, "every way down is set aside" fifteen passes running.
  const { descentTargets } = require('../src/work');
  const { Vec3 } = require('vec3');
  const targets = descentTargets(new Vec3(-296, 49, 637), -16);
  assert.equal(targets.length, 16);
  assert(targets.every(t => t.y === -16));
  const areas = new Set(targets.map(t => `${Math.floor(t.x / 8)},${Math.floor(t.z / 8)}`));
  assert.equal(areas.size, 16, 'no two share a resting area');
});

test('a block with lava beside it is not dug within the lava\'s run of the bot', () => {
  // mid-207-f: dug beside a lava source a block from its feet at y -55, and burned from twenty to none.
  const { opensLava } = require('../src/work');
  const { Vec3 } = require('vec3');
  const lava = new Set(['43,-55,287']);
  const bot = { game: { dimension: 'overworld' }, entity: { position: new Vec3(44.5, -55, 286.5) }, blockAt: p => ({ name: lava.has(`${p.x},${p.y},${p.z}`) ? 'lava' : 'deepslate', position: p }) };
  assert.equal(opensLava(bot, new Vec3(43, -55, 286)), true, 'beside the lava, a block from the feet');
  assert.equal(opensLava(bot, new Vec3(45, -55, 286)), false, 'no lava beside it');
  bot.entity.position = new Vec3(50.5, -55, 286.5);
  assert.equal(opensLava(bot, new Vec3(43, -55, 286)), false, 'seven blocks off: past its run');
});

test('a staircase digs a snow block without a shovel: the tool is for the drop, not the room', () => {
  // mid-231-j: stairs up a mountain rested ten minutes on "no tool for snow block".
  const { stairOptions } = require('../src/tunneling');
  const { Vec3 } = require('vec3');
  const registry = require('minecraft-data')('26.1');
  const snow = registry.blocksByName.snow_block;
  const bot = { entity: { position: new Vec3(0.5, 64, 0.5) }, inventory: { items: () => [] }, entities: {},
    blockAt: p => { const q = p.floored(); if (q.y < 64 || (q.x === 1 && q.y === 64)) return { name: 'stone', position: q, boundingBox: 'block', diggable: true, hardness: 1.5, harvestTools: { 1: true } };
      if (q.x === 1 && q.y >= 65 && q.y <= 66) return { name: 'snow_block', position: q, boundingBox: 'block', diggable: true, hardness: snow.hardness, harvestTools: { 999: true } };
      return { name: 'air', position: q, boundingBox: 'empty' }; } };
  const choices = stairOptions(bot, {}, new Vec3(20, 80, 0));
  assert(choices.some(c => c.destination.x === 1 && c.destination.y === 65), `up onto the stone through the snow: ${JSON.stringify(choices.blocked)}`);
});

test('walking a one-wide ridge over lava in the Nether, the bot crouches; before a step down it does not', async () => {
  // mid-229-h walked a netherrack ridge five blocks over a lava lake upright, slid off, and burned.
  const { EventEmitter } = require('node:events');
  const { Vec3 } = require('vec3');
  const { navigate } = require('../src/skills');
  const { Task } = require('../src/skills');
  const controls = {};
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether' }, health: 20, oxygenLevel: 20, entities: {},
    entity: { position: new Vec3(0.5, 36, 0.5), onGround: true, velocity: new Vec3(0, 0, 0) }, controlState: controls,
    setControlState: (k, v) => { controls[k] = v; }, clearControlStates() {}, stopDigging() {},
    blockAt: p => { const q = p.floored(); const solid = q.y === 35 && q.x === 0; return { name: solid ? 'netherrack' : q.y <= 30 ? 'lava' : 'air', position: q, boundingBox: solid ? 'block' : 'empty' }; },
    pathfinder: { movements: {}, setGoal() {}, isMoving: () => true, goal: null, goto: () => new Promise(r => setTimeout(r, 300)) } });
  const { goals } = require('mineflayer-pathfinder');
  const walking = navigate(bot, new Task('ridge'), new goals.GoalBlock(0, 36, 10), { timeoutMs: 400, stallMs: 300 }).catch(e => { bot._err = e; });
  for (let i = 0; i < 20 && !bot.listenerCount('physicsTick'); i++) await new Promise(r => setTimeout(r, 5));
  bot.emit('path_update', { status: 'success', path: [{ x: 0.5, y: 36, z: 1.5 }, { x: 0.5, y: 36, z: 2.5 }] });
  bot.emit('physicsTick');
  assert.equal(controls.sneak, true, `crouched on the ridge ${bot._err?.stack}`);
  bot.emit('path_update', { status: 'success', path: [{ x: 0.5, y: 34, z: 1.5 }] });
  bot.emit('physicsTick');
  assert.equal(controls.sneak, false, 'not before a step down');
  await walking;
});

test('a stair under a column of gravel is not taken: the gravel falls into the head as the bot steps in', () => {
  // mid-242-n tunnelled under a gravel column at y 36 and suffocated in its own stair.
  const { stairOptions } = require('../src/tunneling');
  const { Vec3 } = require('vec3');
  const bot = { entity: { position: new Vec3(0.5, 35, 0.5) }, inventory: { items: () => [] }, entities: {},
    blockAt: p => { const q = p.floored();
      if (q.y < 35) return { name: 'stone', position: q, boundingBox: 'block', diggable: true };
      if (q.x === 1 && q.y >= 37) return { name: 'gravel', position: q, boundingBox: 'block', diggable: true };
      return { name: q.x === 0 && q.z === 0 ? 'air' : q.y <= 36 && q.x !== 1 ? 'stone' : 'air', position: q, boundingBox: q.x === 0 && q.z === 0 ? 'empty' : (q.y <= 36 && q.x !== 1 ? 'block' : 'empty'), diggable: true }; } };
  const choices = stairOptions(bot, {}, new Vec3(20, 35, 0));
  assert(!choices.some(c => c.destination.x === 1 && c.destination.y === 35), `not under the gravel: ${JSON.stringify(choices.map(c => c.destination))}`);
});

test('a fight in the pocket is excused only while its swings land (mid-235-n, note 478)', () => {
  const now = Date.now(), at = new Date(now - 1000).toISOString(), goal = { survivalAction: { action: 'fight_in_pocket', at } };
  assert.equal(permittedWait({}, goal, now), null, 'no swing landed: the progress rule measures it');
  assert.equal(permittedWait({ _struck: { id: 7, at: now - 20000 } }, goal, now), null, 'nor one twenty seconds ago');
  assert.equal(permittedWait({ _struck: { id: 7, at: now - 2000 } }, goal, now), 'fight_in_pocket', 'a swing landed two seconds ago');
});

test('a seal or a pocket going up is excused only while its blocks go in (mid-226-h, note 520)', () => {
  // mid-226-h: seal_shelter excused by name forty seconds, two blocks placed, a skeleton in its cell shooting it from 1.6 blocks.
  const now = Date.now(), at = new Date(now - 1000).toISOString();
  for (const action of ['seal_shelter', 'dig_in']) {
    const goal = { survivalAction: { action, at } };
    assert.equal(permittedWait({}, goal, now), null, `${action}: nothing placed, the progress rule measures it`);
    assert.equal(permittedWait({ _sealPlaced: { at: now - 20000 } }, goal, now), null, `${action}: nor a block twenty seconds ago`);
    assert.equal(permittedWait({ _sealPlaced: { at: now - 2000 } }, goal, now), action, `${action}: a block placed two seconds ago`);
  }
  assert.equal(permittedWait({}, { survivalAction: { action: 'wait_in_shelter', at } }, now), 'wait_in_shelter', 'a wait in the pocket is still the hold it was');
});

test('a step dropped for another dimension still names the stall: the WrongDimension blocker is in its facts, not "step:none"', async () => {
  // mid-227-r-nether-1's stall question said "step:none" while iron ore was planned in the Nether 1,130 times (note 476).
  const { answerStall } = require('../src/work');
  const bot = Object.assign(botAt(0.5, 64, 0.5), { registry, health: 20, food: 20, findBlocks: () => [], blockAt: () => ({ name: 'netherrack', boundingBox: 'block' }),
    time: { timeOfDay: 1000 }, pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, chat() {} });
  bot.game.dimension = 'the_nether';
  const error = 'No iron ore in the nether: it is only found in the overworld';
  const from = ['at mineAtSource (src/work.js:1303:39)', 'at mine (src/work.js:1270:9)'];
  // The loop dropped the step from hand (work.js, note 433) and kept it with the record.
  const goal = { survival: {}, wrongDimension: { n: 5, at: Date.now(), error, phase: 'obtain_blaze_rods', block: 'iron_ore', to: 'overworld', from,
    step: { action: 'mine', block: 'iron_ore', drops: 'raw_iron', count: 5 } } };
  const action = actionOf(goal);
  assert.notEqual(action.key, 'step:none');
  assert.equal(action.key, 'step:iron_ore');
  assert.equal(action.blocker.wrongDimension, error); assert.deepEqual(action.blocker.from, from);
  const seen = looks(bot, goal, 57);
  const stall = raise(bot, goal, seen);
  assert.equal(stall.key, 'step:iron_ore'); assert.equal(stall.blocker.wrongDimension, error);
  const asked = [];
  const client = { systemOne: async ({ state }) => { asked.push(state); return { answers: { branch_0: { choice: 'differently', confidence: 0.9 } } }; } };
  // A rung that may wait, so there is more than one answer and Jev is asked.
  Object.assign(goal, { kind: 'win', rungTime: { phase: 'bow' } });
  await answerStall(bot, new Task('stall'), goal, () => {}, takeStall(bot), { client }).catch(() => {});
  assert(asked.length, 'the stall was asked');
  assert.equal(asked[0].stalled.blocker.wrongDimension, error, 'the question names the real blocker');
  assert.deepEqual(asked[0].stalled.blocker.from, from);
  assert.match(asked[0].situation || asked[0].stalled.what, /iron ore/);
});

test('a staircase stalled for want of ground gained is the stall question\'s failure, and a differently walk that went nowhere is the next ask\'s fact', async () => {
  // mid-230-s: flipping tunnel and retreat_from_tunnel, asked with only the strikes; its "differently" moved two
  // blocks, the walk's failure swallowed, and the new shaft began from the same spot (note 485).
  const { answerStall } = require('../src/work');
  const { tunnelStep } = require('../src/tunneling');
  // From A the only step is down to B; B has none, and the retreat is back to A.
  const open = new Set(['0,60,0', '0,61,0', '1,59,0', '1,60,0', '1,61,0']);
  const bot = Object.assign(botAt(0.5, 60, 0.5), { registry, health: 20, food: 20, findBlocks: () => [], time: { timeOfDay: 1000 }, clearControlStates() {}, chat() {},
    blockAt: p => { const f = p.floored(), air = open.has(`${f.x},${f.y},${f.z}`); return { position: f, name: air ? 'air' : 'bedrock', boundingBox: air ? 'empty' : 'block', diggable: false }; },
    pathfinder: { movements: {}, setGoal() {}, goto: async () => { throw new Error('No route to the ground eight blocks off'); } } });
  const goal = { kind: 'win', survival: {}, rungTime: { phase: 'reach_nether' } };
  const actions = { dig: async () => {}, navigate: async (_bot, _task, g) => { bot.entity.position = new Vec3(g.x + 0.5, g.y, g.z + 0.5); },
    retreat: async () => { bot.entity.position = new Vec3(0.5, 60, 0.5); } };
  let stalled = null;
  for (let round = 0; round < 24 && !stalled; round++) {
    try { await tunnelStep(bot, new Task('stair'), goal, () => {}, new Vec3(20 + round * 9, -59, 0), actions); }
    catch (err) { stalled = err; }
  }
  assert.equal(stalled?.name, 'StaircaseStalled', 'the staircase stalled');
  const asked = [];
  const client = { systemOne: async ({ state }) => { asked.push(state); return { answers: { branch_0: { choice: 'differently', confidence: 0.9 } } }; } };
  await answerStall(bot, new Task('stall'), goal, () => {}, { key: 'step:rung:reach_nether', layer: 'work', strikes: 1 }, { client });
  assert(asked.length, 'Jev was asked');
  assert.match(asked[0].stalled.failure || '', /\(1, 59, 0\).*bedrock in the way/, `the blocked reasons are the failure: ${JSON.stringify(asked[0].stalled)}`);
  // The differently walk could not move: the next ask carries that.
  await answerStall(bot, new Task('stall'), goal, () => {}, { key: 'step:rung:reach_nether', layer: 'work', strikes: 2 }, { client });
  assert.equal(asked.length, 2);
  assert.match(JSON.stringify(asked[1].stalled), /0 of 8 blocks.*No route to the ground eight blocks off/, `the short walk is a fact: ${JSON.stringify(asked[1].stalled)}`);
});

test('a dig refused for the drop it would open is the stall question\'s failure, and so is the rest met again after', async () => {
  // mid-214-f: the stairs toward its lava were refused ("Refusing to open a drop"), the staircase rested, and every
  // pass after met the rest and threw before the stall's record was kept; 26 strikes asked with no failure (note 488).
  const { answerStall } = require('../src/work');
  const { tunnelStep } = require('../src/tunneling');
  const { attemptsFor } = require('../src/progress');
  const open = new Set(['0,60,0', '0,61,0']);
  const bot = Object.assign(botAt(0.5, 60, 0.5), { registry, health: 20, food: 20, findBlocks: () => [], time: { timeOfDay: 1000 }, clearControlStates() {}, chat() {},
    blockAt: p => { const f = p.floored(), air = open.has(`${f.x},${f.y},${f.z}`); return { position: f, name: air ? 'air' : 'stone', boundingBox: air ? 'empty' : 'block', diggable: !air, hardness: 1.5 }; },
    pathfinder: { movements: {}, setGoal() {} } });
  const goal = { kind: 'win', survival: {}, rungTime: { phase: 'reach_nether' } };
  const actions = { dig: async () => { throw new Error('Refusing to open a drop beside the feet'); }, navigate: async () => {}, retreat: async () => {} };
  const step = () => tunnelStep(bot, new Task('stair'), goal, () => {}, new Vec3(40, 30, 0), actions);
  await assert.rejects(step(), err => err.name === 'StaircaseStalled' && /refusing to open a drop/.test(err.message));
  const asked = [];
  const client = { systemOne: async ({ state }) => { asked.push(state); return { answers: { branch_0: { choice: 'differently', confidence: 0.9 } } }; } };
  await answerStall(bot, new Task('stall'), goal, () => {}, { key: 'step:rung:reach_nether', layer: 'work', strikes: 1 }, { client }).catch(() => {});
  assert(asked.length, 'Jev was asked');
  assert.match(asked[0].stalled.failure || '', /refusing to open a drop beside the feet/, `the refusal is the failure: ${JSON.stringify(asked[0].stalled)}`);
  // The rest met again with the stall's record gone: kept as the failure, the rest not lengthened.
  const rest = () => Object.values(attemptsFor(goal).entries).find(e => e.action === 'staircase');
  const until = rest().until;
  delete goal.staircaseStalled;
  await assert.rejects(step(), err => err.name === 'StaircaseStalled');
  assert.match(goal.staircaseStalled?.why || '', /refusing to open a drop/, 'the rest met is the stall on the goal');
  assert.equal(rest().until, until, 'and the rest is not renewed');
});
