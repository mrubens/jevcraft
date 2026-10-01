'use strict';
// Note 784: food or the work, one answer held (src/food-plan.js).
// From 2026-09-30 12:00Z to 2026-10-01 04:57Z (scripts/food-asks.js): 5,455
// food questions in 209.5 bot-hours; 1,459 food errands, 510 gaining no food
// in 562 minutes; turn_priority's claim for food asked 1,759 times, 707 of
// them "a minute passed" or "no ruling"; survival_priority asked straight
// after turn_priority had given survival the turn for the same food.
// The cases: 25589 (mid-236-aa, 23:52 to 00:00Z) at hunger 18, health 20 and
// nothing carried, y 35 under rock, obtain_food 38 times in 15 minutes, a
// herd 37 blocks up "no route" four times; 25598 (mid-242-sf, 2026-09-30
// 05:43Z) in the Nether at 7 health with nothing to eat, return_for_food
// chosen and dropped for rung_progress keep_at_it within 21 seconds.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { Task } = require('../src/skills');
const fp = require('../src/food-plan');
const arbiter = require('../src/arbiter');

const stack = (name, count = 1) => ({ name, count, type: registry.itemsByName[name]?.id ?? 0 });
function makeBot({ items = [['iron_sword', 1], ['cobblestone', 64]], food = 18, health = 20, timeOfDay = 9678, dimension = 'overworld', at = new Vec3(205.5, 35, 422.5), floor = 35 } = {}) {
  const inv = items.map(i => stack(...i));
  return Object.assign(new EventEmitter(), { registry, version: '26.1', health, food, oxygenLevel: 20,
    game: { dimension, gameMode: 'survival', difficulty: 'normal' }, time: { timeOfDay, age: 200000 },
    entity: { position: at, onGround: true, height: 1.8, width: 0.6, velocity: new Vec3(0, 0, 0) }, entities: {},
    inventory: { items: () => inv, slots: {}, emptySlotCount: () => 20 }, heldItem: null,
    pathfinder: { movements: {}, setGoal() {}, getPathTo: () => ({ status: 'noPath', path: [] }) },
    world: { raycast: () => null }, findBlocks: () => [], chat() {},
    blockAt: p => { const y = Math.floor(p.y); const name = y >= floor && y <= floor + 1 ? 'air' : y < 64 ? (dimension === 'overworld' ? 'stone' : 'netherrack') : 'air'; return { name, position: new Vec3(Math.floor(p.x), y, Math.floor(p.z)), boundingBox: name === 'air' ? 'empty' : 'block', skyLight: y >= 64 ? 15 : 0 }; } });
}
const survivalOf = (bot, more = {}) => new (require('../src/survival').Survival)(bot, { navigate: async () => {}, dig: async () => {}, place: async () => {}, explore: async () => {}, ...more }, { client: { systemOne: async () => ({}) } });
const winGoal = (more = {}) => ({ kind: 'win', request: 'beat the game', stockFood: true, step: { action: 'gather_wool' }, ...more });

test('the drain to the next line at the record\'s rate, and the ways to food priced, the failed ones said', () => {
  const bot = makeBot();
  const d = fp.drain(bot, 0);
  assert.equal(d.rate, 23.7, 'under y 56 in the Overworld');
  assert.match(d.says, /^Hunger 18: at the record's 23\.7 hunger an hour of play \(in the Overworld under y 56\), it falls under eighteen \(where health stops coming back\) in about 3 minutes and to six \(where sprinting stops\) in about 30 minutes; nothing carried puts it off\.$/);
  assert.match(fp.drain(makeBot({ food: 12 }), 16).says, /it falls to six \(where sprinting stops\) in about 15 minutes; the 16 food points carried, eaten as it falls, put that off about 41 minutes more\.$/);
  // 25589's herd, no route at 23:53:42Z: said as a fact on the price.
  const goal = winGoal({ tried: { entries: [{ q: 'survival_priority', method: 'obtain_food/seen_food_0', at: Date.now() - 40000, place: { x: 205, y: 35, z: 422 }, outcome: 'blocked', why: 'no way to the sheep seen at (236, 73, 452) from (205, 35, 422): No route' }] } });
  const children = { seen_food_0: { description: { walkSeconds: 9, climbFirst: 'about 29 blocks up to the surface first, roughly 2 minutes' } }, search_food: { description: { climbFirst: 'about 29 blocks up to the surface first, roughly 2 minutes' } } };
  const p = fp.price(bot, goal, { children, supply: 0 });
  assert.match(p.facts.failedHere[0], /^seen food 0 failed here once in the last 30 minutes, the last 40 seconds ago: no way to the sheep/);
  assert.match(p.foodSays, /^Food or the work: the nearest way to food here is search food, about 2 minutes to the food; in the record \(2026-09-30 12:00Z to 2026-10-01 04:57Z\) such ways had food eaten or carried within ten minutes 76 of 172 times, begun in the Overworld under y 56, 16 ending in a death first/);
  assert.match(p.foodSays, /Failed here: seen food 0 failed here once/);
  assert.match(p.foodSays, /The work set aside meanwhile: gather wool\. Chosen, the way to food holds/);
  assert.equal(p.facts.waysToFood.length, 2);
  assert.match(p.facts.waysToFood[1], /^seen food 0, .*failed here once/, 'the failed way listed last');
  assert.match(p.workSays, /^Chosen over food, the work holds and no food is asked until hunger falls two from now/);
});

test('the food plan holds food over the work until food is eaten or carried, hunger or health fall a line, the way fails, or its time', () => {
  const bot = makeBot();
  const now = Date.now();
  const holder = {};
  const goal = winGoal({ tried: { entries: [] } });
  const begin = () => fp.begin(holder, bot, { choice: 'food', by: 'survival_priority', key: 'obtain_food/seen_food_0', supply: 0, minutesMs: 90000, goal, now });
  begin();
  assert.equal(holder.foodChoice.ms, 180000, 'twice the minutes to the food');
  assert.equal(fp.holding(holder, bot, { goal, supply: 0, now: now + 1000 })?.choice, 'food');
  assert.match(fp.says(holder.foodChoice, now + 1000), /^food first \(seen food 0\), chosen 1 second ago at survival priority at hunger 18 and health 20, holds until food is eaten or carried, hunger falls under eighteen, health falls a band of four, the way chosen fails, or 3 minutes pass$/);
  // Carried.
  assert.equal(fp.holding(holder, bot, { goal, supply: 3, now: now + 2000 }), null);
  assert.equal(holder.foodChoiceEnded.why, 'food is carried: 0 to 3 food points');
  // Eaten.
  begin(); bot.food = 20;
  assert.equal(fp.holding(holder, bot, { goal, supply: 0, now: now + 2000 }), null);
  assert.equal(holder.foodChoiceEnded.why, 'food was eaten: hunger 18 to 20');
  // Hunger under eighteen.
  bot.food = 18; begin(); bot.food = 17;
  assert.equal(fp.holding(holder, bot, { goal, supply: 0, now: now + 2000 }), null);
  assert.equal(holder.foodChoiceEnded.why, 'hunger fell from 18 to 17');
  // Health a band.
  bot.food = 18; begin(); bot.health = 15;
  assert.match(fp.endOf(holder.foodChoice, bot, { goal, now: now + 2000 }), /^health fell from 20 to 15$/);
  bot.health = 20;
  // The way failed in the ledger (note 765's no-op or an error).
  goal.tried.entries.push({ q: 'survival_priority', method: 'obtain_food/seen_food_0', at: now + 500, outcome: 'blocked', why: 'its run changed nothing within 90 seconds' });
  assert.equal(fp.endOf(holder.foodChoice, bot, { goal, now: now + 2000 }), 'the way chosen failed: its run changed nothing within 90 seconds');
  goal.tried.entries.length = 0;
  // Its time.
  assert.equal(fp.endOf(holder.foodChoice, bot, { goal, now: now + 181000 }), '3 minutes passed');
  // Another dimension, a death.
  assert.match(fp.endOf(holder.foodChoice, makeBot({ dimension: 'the_nether' }), { goal, now: now + 1000 }), /^the bot went to the nether$/);
});

test('the work over food holds until hunger falls two or under a line, health four, the night needs a shelter, or the drain\'s minutes', () => {
  const now = Date.now();
  const holder = {};
  const bot = makeBot({ food: 19 });
  fp.begin(holder, bot, { choice: 'work', by: 'turn_priority', supply: 0, now });
  assert(holder.foodChoice.ms >= fp.MIN_MS && holder.foodChoice.ms <= fp.MAX_MS);
  assert.equal(Math.round(holder.foodChoice.ms / 60000), 5, 'two hunger at 23.7 an hour');
  assert.equal(fp.endOf(holder.foodChoice, bot, { now: now + 1000 }), null);
  bot.food = 17;
  assert.equal(fp.endOf(holder.foodChoice, bot, { now: now + 1000 }), 'hunger fell from 19 to 17');
  bot.food = 19; bot.health = 16;
  assert.equal(fp.endOf(holder.foodChoice, bot, { now: now + 1000 }), 'health fell from 20 to 16');
  bot.health = 20;
  assert.equal(fp.endOf(holder.foodChoice, bot, { needsShelter: true, now: now + 1000 }), 'the night needs a shelter');
});

test('25589 at 23:52Z: survival_priority asks food or the work once, priced; the herd walk held while it holds; its no route ends it and the work is offered again', async () => {
  const bot = makeBot();
  const survival = survivalOf(bot);
  const asked = [];
  let runs = 0;
  survival.decide = async (task, goal, save, q) => { asked.push(q); return { path: ['obtain_food', 'search_food'], action: { run: async () => { runs++; } }, stale: false }; };
  const goal = winGoal();
  await survival.step(new Task('t', 'food'), goal, () => {});
  assert.equal(asked.length, 1);
  assert(asked[0].tree.continue_request, 'the work beside the food at the first asking');
  assert.match(asked[0].state.foodOrWork.hungerDrain, /^Hunger 18: /);
  assert.equal(survival.state.foodChoice?.key, 'obtain_food/search_food');
  // Held: the search runs again unasked, three passes.
  for (let i = 0; i < 3; i++) await survival.step(new Task('t', 'food'), goal, () => {});
  assert.equal(asked.length, 1, 'not asked while it holds');
  // The search comes to nothing (the ledger): the plan ends, the question
  // comes back with the work on offer and the failure said on it and the way.
  goal.tried = { entries: [{ q: 'survival_priority', method: 'obtain_food/search_food', at: Date.now(), place: { x: 205, y: 35, z: 422 }, outcome: 'blocked', why: 'its run changed nothing within 90 seconds' }] };
  // Asked again, carrying on is chosen this time.
  survival.decide = async (task, g, save, q) => { asked.push(q); return { path: ['continue_request'], action: { run: async () => {} }, stale: false }; };
  await survival.step(new Task('t', 'food'), goal, () => {});
  assert.equal(asked.length, 2);
  assert(asked[1].tree.continue_request);
  assert.match(asked[1].state.lastFoodChoice, /ended: the way chosen failed: its run changed nothing/);
  assert.match(asked[1].tree.obtain_food.description, /Failed here: search food failed here once/);
  // Carrying on chosen: no food asked or claimed while it holds.
  assert.equal(survival.state.foodChoice?.choice, 'work');
  const n = asked.length;
  assert.equal(await survival.step(new Task('t', 'food'), goal, () => {}), false);
  assert.equal(asked.length, n, 'not asked while the work holds');
  const { claim } = require('../src/survival');
  assert.equal(claim(bot, goal, survival), null, 'no claim on the turn while the work holds');
  // Hunger falls under eighteen: the work's hold ends, food is asked again.
  bot.food = 16;
  assert.equal(claim(bot, goal, survival)?.action, 'obtain_food');
  assert.match(survival.state.foodChoiceEnded.why, /^hunger fell from 18 to 16$/);
});

test('25589 at 23:57:55Z: a search held that has gone nowhere in its own time is recorded failed (note 765) and the question comes back with the work', async () => {
  const bot = makeBot();
  const survival = survivalOf(bot);
  const asked = [];
  survival.decide = async (task, goal, save, q) => { asked.push(q); return { path: ['obtain_food', 'search_food'], action: { run: async () => {} }, stale: false }; };
  const goal = winGoal();
  await survival.step(new Task('t', 'food'), goal, () => {});
  // As decide would have kept it: the ledger's entry and the run's mark, 100 seconds old.
  const tried = require('../src/tried'), outcome = require('../src/decisions/outcome');
  const at = Date.now() - 100000;
  tried.begin(bot, goal, { q: 'survival_priority', method: 'obtain_food/search_food', now: at });
  outcome.begin(bot, goal, require('../src/decisions').question('survival_priority'), ['obtain_food', 'search_food'], asked[0].tree.obtain_food.children.search_food, { now: at });
  survival.state.foodChoice.keyAt = at;
  await survival.step(new Task('t', 'food'), goal, () => {});
  assert.equal(asked.length, 2, 'asked again: the held search changed nothing in its time');
  assert(asked[1].tree.continue_request, 'the work on offer again');
  assert.match(asked[1].state.lastFoodChoice, /ended: the way chosen failed: .*changed nothing/);
});

test('the answer at turn_priority is the food plan: food given the turn is not put again beside the work, and the work given it holds over the claim', async () => {
  const bot = makeBot();
  const survival = survivalOf(bot);
  const goal = winGoal();
  const { claim } = require('../src/survival');
  const c = claim(bot, goal, survival);
  assert.equal(c?.action, 'obtain_food');
  assert.equal(typeof c.answered, 'function');
  assert.match(arbiter.claimSays(c), /Hunger 18: at the record's 23\.7 hunger an hour of play/);
  // Jev gives the turn to the claim for food.
  const work = { layer: 'work', action: 'gather_wool', urgency: 'routine', facts: {}, run: async () => true };
  await arbiter.arbitrate(bot, [c, work], { state: {}, decide: async () => ({ path: ['survival'] }), run: false, mobs: [] });
  assert.equal(survival.state.foodChoice?.choice, 'food');
  assert.equal(survival.state.foodChoice.by, 'turn_priority');
  // survival_priority then asks which way to food, not food or the work again.
  let tree = null;
  survival.decide = async (task, g, save, q) => { tree = q.tree; return { path: ['obtain_food', 'search_food'], action: { run: async () => {} }, stale: false }; };
  await survival.step(new Task('t', 'food'), goal, () => {});
  assert(tree.obtain_food, 'the way asked');
  assert.equal(tree.continue_request, undefined, 'carrying on not put again');
  // The claim says the plan holds; its ruling is renewed past the minute
  // whatever else of the scene moved.
  const held = claim(bot, goal, survival);
  assert.equal(held.holds, true);
  assert.match(arbiter.claimSays(held), /^Find food for the reserve: food first \(search food\), chosen \d+ seconds? ago at survival priority at hunger 18 and health 20, holds until .*; given the turn, it goes on unasked, and given the work, it ends/);
  // Jev gives the work the turn over it: the work over food, held.
  const again = claim(bot, goal, survival);
  await arbiter.arbitrate(bot, [again, work], { state: {}, decide: async () => ({ path: ['work'] }), run: false, mobs: [] });
  assert.equal(survival.state.foodChoice?.choice, 'work');
  assert.equal(claim(bot, goal, survival), null, 'no claim while the work holds');
});

test('a held food plan renews its turn past "a minute passed" though the mobs about changed; a claim without one is asked', () => {
  const mob = (name, distance, id) => ({ entity: { name, id }, distance, visible: true });
  const bot = { entity: { position: new Vec3(0, 64, 0) }, health: 7, food: 15, oxygenLevel: 20, entities: {} };
  const claims = holds => [{ layer: 'survival', action: 'obtain_food', urgency: 'routine', facts: {}, ...(holds ? { holds: true } : {}), run: async () => true }, { layer: 'work', action: 'find_fortress', urgency: 'routine', facts: {}, run: async () => true }];
  for (const holds of [true, false]) {
    const state = {};
    const first = arbiter.rule(bot, claims(holds), { state, now: 0, mobs: [], dry: true });
    assert.equal(first.ask, true);
    state.ruling.winner = 'survival';
    const later = arbiter.rule(bot, claims(holds), { state, now: arbiter.RULING_MS + 1000, mobs: [mob('blaze', 14, 3)], dry: true });
    if (holds) assert.equal(later.by, 'held', 'the food plan held: renewed');
    else assert.equal(later.why, 'a minute passed');
  }
});

test('25598 at 05:43Z: in the Nether at 7 health with nothing to eat, the trip chosen from the pocket is the food plan: the claim says it and the health that cannot come back, the work\'s stall says both', async () => {
  const bot = makeBot({ dimension: 'the_nether', health: 7, food: 15, items: [['diamond_sword', 1], ['netherrack', 63]], at: new Vec3(245.5, 60, -35.5), floor: 60 });
  const goal = { kind: 'win', request: 'beat the game', portals: [{ dimension: 'the_nether', x: 160, y: 64, z: -20 }, { dimension: 'overworld', x: 1280, y: 70, z: -160 }] };
  const survival = survivalOf(bot, { returnOverworld: async () => {} });
  fp.begin(survival.state, bot, { choice: 'food', by: 'pocket_next', key: 'go_for_food/return_for_food', need: 'heal', supply: 0, minutesMs: 4 * 60000, goal });
  const { claim } = require('../src/survival');
  const c = claim(bot, goal, survival);
  assert.equal(c?.action, 'obtain_food');
  assert.equal(c.holds, true);
  const said = arbiter.claimSays(c);
  assert.match(said, /food first \(return for food\), chosen \d+ seconds? ago at pocket next at hunger 15 and health 7/);
  assert.match(said, /The health 7 does not come back: hunger 15, under eighteen, and nothing safe carried to eat\./);
  // The survival step runs the trip again unasked while it is on offer.
  let ran = 0;
  survival.offWorldFood = () => ({ return_for_food: { description: 'Go back through the portal to the Overworld for food.', run: async () => { ran++; } } });
  survival.decide = async () => assert.fail('the trip held is not asked again');
  await survival.step(new Task('t', 'food'), goal, () => {});
  assert.equal(ran, 1);
});

test('the replay over recorded asks: a work answer held keeps the next food askings from being sent; a failed way ends a food plan', () => {
  const t0 = Date.parse('2026-09-30T23:52:00Z');
  const frame = (t, food, carried = 0, health = 20, more = {}) => ({ t, food, health, carried, dim: 'overworld', y: 35, ...more });
  const ask = (t, id, path, c, food = 18) => ({ port: '25589', t, id, path, c, food, health: 20, carried: 0, dim: 'overworld', y: 35, d: { options: {} } });
  const rec = { frames: [frame(t0, 18), frame(t0 + 10000, 18), frame(t0 + 25000, 18, 0, 20, { failed: true }), frame(t0 + 60000, 18), frame(t0 + 200000, 18)], asks: [
    ask(t0, 'turn_priority', ['work'], { food: false, work: true, leaf: 'work' }),
    ask(t0 + 30000, 'turn_priority', ['survival'], { food: true, work: false, leaf: 'survival:obtain_food' }),
    ask(t0 + 40000, 'survival_priority', ['continue_request'], { food: false, work: true, leaf: 'continue_request' }),
    ask(t0 + 400000, 'survival_priority', ['obtain_food', 'seen_food_0'], { food: true, work: false, leaf: 'obtain_food/seen_food_N' }),
    ask(t0 + 410000, 'survival_priority', ['obtain_food', 'seen_food_1'], { food: true, work: false, leaf: 'obtain_food/seen_food_N' }),
  ] };
  const R = { errands: [{ port: '25589', from: t0 + 30000, minutes: 2, gainedAt: null }] };
  rec.frames.push(frame(t0 + 405000, 18, 0, 20, { failed: true }));
  rec.frames.sort((a, b) => a.t - b.t);
  fp.replayRecord(rec, R);
  const s = fp.replaySummary(R);
  assert.equal(s.askedBefore, 5);
  assert.equal(s.heldUnderAWorkPlan, 2, 'the food answer and the carry-on within the work plan');
  assert.equal(s.errandsNotBegunUnderAWorkPlan, 1);
  assert.equal(s.deadMinutesNotBegun, 2);
  assert.equal(s.plansEndedBy['work: time'], 1);
  assert.equal(s.plansEndedBy['food: way failed'], 1, 'the herd walk failed between: the next way asked');
});

test('25581 at 12:32Z: the Nether stay\'s return_for_food says what such trips came to in the record', () => {
  const nf = require('../src/nether-food');
  const bot = makeBot({ dimension: 'the_nether', health: 20, food: 18, items: [['iron_sword', 1], ['netherrack', 64]], at: new Vec3(245.5, 60, -35.5), floor: 60 });
  const goal = { kind: 'win', request: 'beat the game', portals: [{ dimension: 'nether', x: 246, y: 60, z: -34 }, { dimension: 'overworld', x: 1960, y: 70, z: -280 }] };
  const found = nf.foodRoutes(bot, new Task('work'), goal, () => {}, { actions: { navigate: async () => {}, returnOverworld: async () => {} } });
  assert(found.routes.return_for_food, 'the trip back offered');
  assert.match(found.routes.return_for_food.description, /In the record \(2026-09-30 12:00Z to 2026-10-01 04:57Z\) such ways had food eaten or carried within ten minutes 13 of 56 times, begun in the Nether, 4 ending in a death first/);
});
