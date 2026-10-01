'use strict';
// Note 771: a food reserve trip priced as the work it is, and a furnace batch
// sized to the rungs and left to cook.
// (1) 25589 (mid-236-aa, 2026-09-30 23:51 to 23:59Z) at 20 health and hunger
// 18, nothing carried, 30 blocks under rock at dusk: upkeep's food_reserve,
// then survival_priority's obtain_food 20 times in three minutes with the
// work left out after the first; sheep 37 blocks up at (236, 73, 452) chosen
// four times, "no route" each time; then, its own nether-food step begun,
// obtain_food 18 times more "for the reserve alone".
// (2) 25584, 25591 and 25597 (mid-239, 23:38Z): while_cooking told "the 80
// seconds the 8 raw iron take" with 16 more in two side furnaces unsaid and
// no leave_cooking for the batch's own step; none good 0.57.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { Task } = require('../src/skills');

const stack = (name, count = 1) => ({ name, count, type: registry.itemsByName[name]?.id ?? 0 });
// 25589's place: y 35 under stone to y 64, an iron sword, nothing to eat.
function underBot({ items = [['iron_sword', 1], ['cobblestone', 64]], food = 18, health = 20, timeOfDay = 9678 } = {}) {
  const inv = items.map(i => stack(...i));
  const at = new Vec3(205.5, 35, 422.5);
  return Object.assign(new EventEmitter(), { registry, version: '26.1', health, food, oxygenLevel: 20,
    game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, time: { timeOfDay, age: 200000 },
    entity: { position: at, onGround: true, height: 1.8, width: 0.6, velocity: new Vec3(0, 0, 0) }, entities: {},
    inventory: { items: () => inv, slots: {}, emptySlotCount: () => 20 }, heldItem: null,
    pathfinder: { movements: {}, setGoal() {}, getPathTo: () => ({ status: 'noPath', path: [] }) },
    world: { raycast: () => null }, findBlocks: () => [], chat() {},
    blockAt: p => { const y = Math.floor(p.y); const name = y >= 35 && y <= 36 ? 'air' : y < 64 ? 'stone' : 'air'; return { name, position: new Vec3(Math.floor(p.x), y, Math.floor(p.z)), boundingBox: name === 'air' ? 'empty' : 'block', skyLight: y >= 64 ? 15 : 0 }; } });
}
const survivalOf = bot => new (require('../src/survival').Survival)(bot, { navigate: async () => {}, dig: async () => {}, place: async () => {}, explore: async () => {} }, { client: { systemOne: async () => ({}) } });

test('reserve-only: hunger where health comes back, or met by what is carried; the work\'s own food step', () => {
  const fe = require('../src/food-errand');
  assert.equal(fe.reserveOnly({ food: 18 }, 0), true, '25589: hunger 18, nothing carried');
  assert.equal(fe.reserveOnly({ food: 17 }, 35), true, 'covered');
  assert.equal(fe.reserveOnly({ food: 13 }, 0), false, 'hunger under 18 with nothing to meet it');
  assert.equal(fe.workIsFood({ step: { action: 'hunt_food_for_nether' } }), true);
  assert.equal(fe.workIsFood({ gameProgress: { phase: 'nether_food' } }), true);
  assert.equal(fe.workIsFood({ step: { action: 'gather_wool' } }), false);
});

test('the record and the place: said on a reserve-only trip, by underground and night', () => {
  const fe = require('../src/food-errand');
  assert.match(fe.reserveRecordSays(), /^Food errands for the reserve alone in the flight records \(2026-09-30 06:00Z to 2026-10-01 00:00Z\): all of them: 268 errands, 605 minutes, 35% of them gained no food, 6\.4 food points a minute in all\.$/);
  const deep = fe.reserveRecordSays({ underground: true, night: true });
  assert.match(deep, /begun underground: 90 errands, 233 minutes, 66% of them gained no food, 3 food points a minute in all; begun underground at night: 33 errands, 91 minutes, 67% of them gained no food, 2\.3 food points a minute in all\.$/);
  const bot = underBot();
  const where = fe.whereSays(bot);
  assert.match(where, /^Where: the bot is 29 blocks up to open sky: about 2 minutes at the bot's own pace/);
  assert.match(where, /day at the surface for about 2 more real minutes, night after that\.$/);
});

test('25589 at 23:55:46Z: with its own nether-food step begun, a reserve-only errand is the work\'s, not a survival question or claim', async () => {
  const bot = underBot();
  const survival = survivalOf(bot);
  let asked = null;
  survival.decide = async (task, goal, save, q) => { asked = q; return { path: ['continue_request'], action: { run: async () => {} }, stale: false }; };
  const goal = { kind: 'win', request: 'beat the game', preparingNether: true, stockFood: true, step: { action: 'hunt_food_for_nether', foodPoints: 0, required: 80 } };
  assert.equal(await survival.step(new Task('t', 'food'), goal, () => {}), false);
  assert.equal(asked, null, 'nothing asked');
  const { claim } = require('../src/survival');
  assert.equal(claim(bot, goal, survival), null, 'no claim on the turn');
  // At 23:57:06Z the rung had been set aside (the Nether first) and the
  // step was other work; the 80 points are still the ladder's rung's once
  // the reserve's floor is carried (note 796: 12 points; under it, with
  // nothing carried, the survival layer asks it, priced, the work beside).
  const aside = { ...goal, step: { action: 'mine_first', block: 'lapis_ore' } };
  const stocked = underBot({ items: [['iron_pickaxe', 1], ['cooked_beef', 2]] });
  const s2 = survivalOf(stocked);
  s2.decide = survival.decide;
  assert.equal(await s2.step(new Task('t', 'food'), aside, () => {}), false);
  assert.equal(asked, null, 'nothing asked with the rung set aside and the floor carried');
  assert.equal(claim(stocked, aside, s2), null);
  await survival.step(new Task('t', 'food'), aside, () => {});
  assert(asked?.tree?.obtain_food && asked.tree.continue_request, 'nothing carried: under the floor, asked with the work on offer');
  // Hunger under eighteen with nothing to meet it is still the survival layer's.
  const hungry = underBot({ food: 9 });
  const c = claim(hungry, goal, survivalOf(hungry));
  assert.equal(c?.action, 'obtain_food');
});

test('25589 at 23:52:38Z: the night reserve trip keeps the work on offer at every asking, priced with the place and the record', async () => {
  const bot = underBot();
  const survival = survivalOf(bot);
  const asked = [];
  survival.decide = async (task, goal, save, q) => { asked.push(q); return { path: ['obtain_food', 'search_food'], action: { run: async () => {} }, stale: false }; };
  // upkeep's food_reserve chosen: the stock flag, the work's step the wool.
  const goal = { kind: 'win', request: 'beat the game', stockFood: true, step: { action: 'gather_wool' } };
  await survival.step(new Task('t', 'food'), goal, () => {});
  assert(asked[0]?.tree?.obtain_food, 'asked');
  const food = asked[0].tree.obtain_food.description;
  assert.match(food, /This trip is for the reserve alone\. 0 food points carried of the 12 kept for healing and the night: 12 short\./);
  assert.match(food, /Where: the bot is 29 blocks up to open sky/);
  assert.match(food, /Food errands for the reserve alone in the flight records .*begun underground: 90 errands/);
  // Note 784: the answer is the food plan, priced, held until its end.
  assert.equal(survival.state.foodChoice?.key, 'obtain_food/search_food', 'the trip held as the food plan');
  assert.match(food, /Food or the work: the nearest way to food here is search food, about/);
  assert.match(food, /Hunger 18: at the record's 23\.7 hunger an hour of play \(in the Overworld under y 56\), it falls under eighteen \(where health stops coming back\) in about 3 minutes and to six \(where sprinting stops\) in about 30 minutes; nothing carried puts it off\./);
  assert.match(asked[0].tree.continue_request.description, /Chosen over food, the work holds and no food is asked until hunger falls two/);
  // Asked again while it holds: the search runs again unasked.
  await survival.step(new Task('t', 'food'), goal, () => {});
  assert.equal(asked.length, 1, 'held, not asked');
  // The way fails (the herd's no route at 23:53:42Z in 25589's case): the
  // plan ends, the work is on offer again, and the failure is said.
  goal.tried = { entries: [{ q: 'survival_priority', method: 'obtain_food/search_food', at: Date.now(), place: { x: 205, y: 35, z: 422 }, outcome: 'blocked', why: 'no way to the sheep seen at (236, 73, 452): No route' }] };
  await survival.step(new Task('t', 'food'), goal, () => {});
  assert(asked[1]?.tree?.continue_request, 'continue_request offered again once the way failed');
  assert.match(asked[1].state.lastFoodChoice, /^food first \(survival priority\), chosen \d+ seconds? ago, ended: the way chosen failed: no way to the sheep/);
  assert.match(asked[1].tree.obtain_food.children.search_food.description.failedHere, /^failed here once in the last 30 minutes, the last \d+ seconds? ago: no way to the sheep/);
  // At hunger 13 (under eighteen, nothing to meet it) a food plan keeps the work out, as before.
  const hungry = underBot({ food: 13 });
  const s2 = survivalOf(hungry);
  const q2 = [];
  s2.decide = async (task, g, save, q) => { q2.push(q); return { path: ['obtain_food', 'search_food'], action: { run: async () => {} }, stale: false }; };
  require('../src/food-plan').begin(s2.state, hungry, { choice: 'food', by: 'turn_priority', supply: 0 });
  await s2.step(new Task('t', 'food'), { kind: 'win', request: 'beat the game', stockFood: true, step: { action: 'gather_wool' } }, () => {});
  assert(q2[0]?.tree?.obtain_food, 'asked at hunger 13');
  assert.equal(q2[0].tree.continue_request, undefined);
});

test('the claim on the turn for a reserve-only trip says where and the record', () => {
  const { claim } = require('../src/survival');
  const { claimSays } = require('../src/arbiter');
  const bot = underBot();
  const c = claim(bot, { kind: 'win', request: 'beat the game', stockFood: true, step: { action: 'gather_wool' } }, survivalOf(bot));
  assert.equal(c?.action, 'obtain_food');
  const said = claimSays(c);
  assert.match(said, /^Find food for the reserve: /);
  assert.match(said, /Where: the bot is 29 blocks up to open sky/);
  assert.match(said, /Food errands for the reserve alone in the flight records/);
});

test('upkeep\'s food before dusk, underground at hunger 18, is priced as the reserve alone', () => {
  const { foodReservePrice } = require('../src/work');
  const says = foodReservePrice(underBot(), 0);
  assert.match(says, /^ The trip is for the reserve alone: hunger 18, where health comes back\. Underground the dark is the same at any hour; the animals are at the surface\. Where: the bot is 29 blocks up/);
  assert.equal(foodReservePrice(underBot({ food: 12 }), 0), '', 'real hunger is not the reserve alone');
});

test('25589 at 23:53:42Z: a walk to a herd seen with no way there is recorded as come to nothing, and said', async () => {
  const tried = require('../src/tried');
  const { forageChoices } = require('../src/foraging');
  const bot = underBot();
  const goal = { kind: 'win', request: 'beat the game', sightings: { sheep: [{ x: 236, y: 73, z: 452, count: 3, at: Date.now() - 60000, dimension: 'overworld' }] } };
  const navigate = async () => { throw new Error('No route from here to (236, 73, 452) (noPath)'); };
  const choices = await forageChoices(bot, new Task('t', 'food'), goal, () => {}, { navigate, explore: async () => {} }, {}, { target: 12 });
  const key = Object.keys(choices).find(k => /^seen_food_\d+$/.test(k));
  assert(key, 'the herd offered');
  tried.begin(bot, goal, { q: 'survival_priority', method: `obtain_food/${key}`, target: choices[key].target });
  await assert.rejects(choices[key].run(), /The walk to the sheep seen came to nothing: no way to the sheep seen at \(236, 73, 452\) from \(205, 35, 422\): No route/);
  const entry = tried.latestOf(goal, 'survival_priority');
  assert.equal(entry.outcome, 'blocked');
  assert.match(entry.why, /^no way to the sheep seen at \(236, 73, 452\)/);
});

// (2) The furnace.
function furnaceBot({ raw = 86, ingots = 0, coal = 30 } = {}) {
  const items = Object.entries({ raw_iron: raw, iron_ingot: ingots, coal, iron_pickaxe: 1, cobblestone: 109 }).filter(([, n]) => n > 0).map(([name, count]) => ({ name, count }));
  return { registry, oxygenLevel: 20, health: 20, food: 20, game: { gameMode: 'survival', dimension: 'overworld', difficulty: 'normal' }, time: { timeOfDay: 3834 },
    entity: { position: new Vec3(0.5, 20, 0.5), height: 1.8, width: 0.6, onGround: true }, entities: {},
    inventory: { items: () => items, slots: [], emptySlotCount: () => 15 },
    blockAt: p => { const q = p.floored(); const name = q.y < 20 ? 'stone' : 'air'; return { name, position: q, boundingBox: name === 'air' ? 'empty' : 'block', getProperties: () => ({}) }; },
    findBlocks: () => [], world: { raycast: () => null }, pathfinder: { movements: {} } };
}
const withRungs = async (rungs, fn) => {
  const gp = require('../src/game-progress'), was = gp.rungsOpenAhead;
  gp.rungsOpenAhead = () => rungs;
  try { return await fn(); } finally { gp.rungsOpenAhead = was; }
};

test('a batch sized to the rungs still open, up to the raw iron and the fuel carried', async () => {
  const { smeltBatch, ladderSmeltWants } = require('../src/work');
  const goal = { kind: 'win' };
  const rungs = [{ phase: 'iron_pickaxe', item: 'iron_pickaxe', count: 1 }, { phase: 'shield', item: 'shield', count: 1 }, { phase: 'iron_armour', items: ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'] }];
  await withRungs(rungs, async () => {
    const bot = furnaceBot({ raw: 40, coal: 30 });
    assert.deepEqual(ladderSmeltWants(bot, goal, 'iron_ingot').wants, 3 + 1 + 24);
    // The step's own three, made the rungs' 28.
    assert.equal(smeltBatch(bot, goal, { item: 'iron_ingot', from: 'raw_iron', count: 3 }, 3, 40, 'coal').count, 28);
    // Up to the raw iron carried.
    assert.equal(smeltBatch(furnaceBot({ raw: 10 }), goal, { item: 'iron_ingot', from: 'raw_iron', count: 3 }, 3, 10, 'coal').count, 10);
    // Up to the fuel: two coal smelt sixteen.
    assert.equal(smeltBatch(furnaceBot({ raw: 40, coal: 2 }), goal, { item: 'iron_ingot', from: 'raw_iron', count: 3 }, 3, 40, 'coal').count, 16);
    // Ingots carried count against the rungs: 25584 carried 70, and its step's 24 stays 24.
    assert.equal(smeltBatch(furnaceBot({ raw: 86, ingots: 70 }), goal, { item: 'iron_ingot', from: 'raw_iron', count: 24 }, 24, 86, 'coal').count, 24);
  });
  // Not a win goal, or another output: the step's own count.
  assert.equal(smeltBatch(furnaceBot(), {}, { item: 'iron_ingot', from: 'raw_iron', count: 3 }, 3, 86, 'coal').count, 3);
  assert.equal(smeltBatch(furnaceBot(), { kind: 'win' }, { item: 'cooked_beef', from: 'beef', count: 3 }, 3, 86, 'coal').count, 3);
});

test('mid-239 at 23:38Z: the batch\'s own step may be left to cook, priced, and the side furnaces are said', async () => {
  const { whileCooking } = require('../src/work');
  const bot = furnaceBot();
  const log = {};
  const task = { check() {}, opportunityClient: { systemOne: async ({ questions }) => { log.offered = questions.branch_0.criteria; log.state = questions.branch_0; return { answers: { branch_0: { choice: 'leave_cooking', confidence: 0.7 } } }; } } };
  const args = { cooking: 80000, oreInReach: () => null, walkTarget: () => null, what: 'raw iron', count: 8, sides: { furnaces: 2, count: 16 }, own: { at: new Vec3(0, 20, 1), rungsWant: 24, forRungs: ['iron_armour'] }, item: 'iron_ingot',
    workOnOffer: [{ key: 'mine_nearby', description: 'Mine the iron ore 9 blocks off. More.' }] };
  assert.equal(await whileCooking(bot, task, { kind: 'win' }, () => {}, args), 'leave_cooking');
  assert.match(log.offered.wait_here, /^Stand by the furnace for the 80 seconds the 8 raw iron take \(16 more in 2 furnaces beside, cooking at the same time\)\./);
  assert.match(log.offered.wait_here, /The batch is sized to what the rungs still open want \(iron armour\): 24 more iron ingot than carried\.$/);
  assert.match(log.offered.leave_cooking, /^Leave the 8 raw iron cooking \(16 more in 2 furnaces beside, cooking at the same time\) and work from here meanwhile, the smelt step held off until it is done in about 80 seconds: Work on offer meanwhile from here: Mine the iron ore 9 blocks off\. Then back to the furnace at \(0, 20, 1\) for the output: the walk back from where the work ends is about a second for every 4 blocks \(16 blocks off, about 4 seconds\), against the 80 seconds of standing by it it saves\./);
  // With nothing on offer from here, it is not offered, and why is said.
  const log2 = {};
  const task2 = { check() {}, opportunityClient: { systemOne: async ({ questions }) => { log2.offered = questions.branch_0.criteria; return { answers: { branch_0: { choice: 'wait_here', confidence: 0.7 } } }; } } };
  await whileCooking(furnaceBot(), task2, { kind: 'win' }, () => {}, { ...args, workOnOffer: [], walkTarget: () => new Vec3(4.5, 20, 0.5) });
  assert.equal(log2.offered?.leave_cooking, undefined);
  // Left once already: not offered again for the batch.
  const log3 = {};
  const task3 = { check() {}, opportunityClient: { systemOne: async ({ questions }) => { log3.offered = questions.branch_0.criteria; return { answers: { branch_0: { choice: 'wait_here', confidence: 0.7 } } }; } } };
  await whileCooking(furnaceBot(), task3, { kind: 'win' }, () => {}, { ...args, own: null, walkTarget: () => new Vec3(4.5, 20, 0.5) });
  assert.equal(log3.offered?.leave_cooking, undefined);
});

// The coordinator's cases of 01:27Z (2026-10-01).
test('25594 at 01:26:39Z: the room made for a craft, filled again by what lay on the floor, is made again before the click, said', { timeout: 15000 }, async () => {
  const { craft } = require('../src/work');
  const it = name => { const r = registry.itemsByName[name]; return { name, count: name === 'sand' ? 10 : 1, type: r.id, stackSize: r.stackSize }; };
  // Full pockets: two stacks of sand (junk) and wool.
  const items = [it('sand'), it('sand'), it('oak_log')];
  while (items.length < 36) items.push(it('white_wool'));
  const tossed = [], entities = { 7: { id: 7, name: 'item', isValid: true, position: new Vec3(1, 64, 0) } };
  const bot = { registry, game: { gameMode: 'survival' }, entity: { position: new Vec3(0, 64, 0) }, entities,
    inventory: { items: () => items, emptySlotCount: () => 36 - items.length, slots: [], selectedItem: null },
    getControlState: () => false, currentWindow: null, closeWindow() {}, lookAt: async () => {},
    toss: async (type, meta, count) => {
      const i = items.findIndex(x => x.type === type);
      if (i >= 0) { tossed.push(items[i].name); items.splice(i, 1); }
      // The five diorite lying there come into the slot a second later.
      if (entities[7]) setTimeout(() => { if (!entities[7]) return; delete entities[7]; items.push({ ...it('diorite'), count: 5 }); }, 1000);
    } };
  let clicks = 0;
  // The server's confirm comes a second and a half after the click (a
  // server behind), into whatever slot is free then.
  bot.craft = async () => { clicks++; setTimeout(() => { if (36 - items.length > 0) items.push({ ...it('oak_planks'), count: 4 }); }, 1500); };
  await craft(bot, new (require('../src/skills').Task)('craft'), { action: 'craft', item: 'oak_planks', count: 4, needs_table: false, recipe: { count: 4, ingredients: ['oak_log'] }, consumes: { oak_log: 1 } }, {});
  assert(tossed.length >= 2, `room made again for the diorite that came in: ${tossed}`);
  assert.equal(clicks, 1, 'one click, with a slot for its output when the confirm came (before, the click went in before the diorite came and timed out)');
  assert(items.some(x => x.name === 'oak_planks'));
});

test('25588 at ~01:20Z: a biome where sheep do not spawn says so on the sheep search', () => {
  const { noSheepSays } = require('../src/home-base');
  assert.equal(noSheepSays('snowy_plains'), ' No sheep spawn in the snowy plains: a flock there would have wandered in from next door.');
  assert.match(noSheepSays('ice_spikes'), /No sheep spawn in the ice spikes/);
  assert.equal(noSheepSays('plains'), '');
  assert.equal(noSheepSays('nowhere_known'), '');
});
