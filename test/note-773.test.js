'use strict';
// Note 773, four items from the live critic (2026-10-01 ~00:45Z and ~01:06Z).
// (1) 25588 (mid-231-aa, 00:32:45 to 00:36:46Z): the night's way, a shaft
//     pocket, threw "No solid adjacent footing to move out of the work
//     position" and was refused as set aside every pass after; the plan kept
//     it, shelter_method was never asked again, and the claim promised it for
//     194 seconds. Dawn was a minute off.
// (2) 25591 (mid-239-aw, 00:41:31Z): a pocket under the rock at y 5 with no
//     reason to seal, claimed for the sleep owed with no bed known, and
//     sealed again by the held night plan with no question asked.
// (3) 25584 (mid-229-aa, 00:44:13 and 00:44:23Z): two piglin arrows landed
//     with the shield rising and were said as "with the shield up"; no option
//     said whether gold was worn.
// (4) 25594 (mid-244-ax, 00:58 to 01:03Z): at 0.3 health and hunger 17 with
//     nothing to eat, sealed and stayed beside a cave spider spawner, its
//     food errand chosen eighteen seconds before; fight_from_footing offered
//     with no way to its ground.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('node:events');
const { Task } = require('../src/skills');
const registry = require('minecraft-data')('26.1');
const seal = require('../src/seal-reason');
const { isSetAside, setAside } = require('../src/progress');

// A flat surface at y 64 (grass under y 64), open sky.
function surfaceBot({ time = 22500, items = [{ name: 'iron_sword', count: 1 }, { name: 'cobblestone', count: 64 }, { name: 'iron_pickaxe', count: 1 }], entities = {}, dimension = 'overworld', y = 64 } = {}) {
  return Object.assign(new EventEmitter(), {
    registry, game: { dimension, gameMode: 'survival', difficulty: 'normal', minY: -64, height: 384 },
    entities, health: 20, food: 20, oxygenLevel: 20, time: { timeOfDay: time, age: 100000 },
    entity: { position: new Vec3(0.5, y, 0.5), onGround: true, velocity: new Vec3(0, 0, 0), height: 1.8, width: 0.6, yaw: 0 },
    inventory: { items: () => items, slots: {}, emptySlotCount: () => 10 }, heldItem: null,
    blockAt: p => { const solid = p.y < y; return { name: solid ? 'stone' : 'air', boundingBox: solid ? 'block' : 'empty', position: p, skyLight: solid ? 0 : 15 }; },
    findBlocks: () => [], world: { raycast: () => null }, pathfinder: { movements: {}, setGoal() {}, getPathTo: () => ({ status: 'noPath', path: [] }) }, clearControlStates() {}, setControlState() {}, chat() {},
  });
}

// --- (1) the night's way failing at once ---

test('a shelter way that throws or is refused as set aside fails at once: it rests, the plan lets it go, and shelter_method is asked again with it resting said (note 773, 25588)', async () => {
  const { Survival } = require('../src/survival');
  const bot = surfaceBot({ time: 18000 });
  const survival = new Survival(bot, { navigate: async () => {}, dig: async () => {}, place: async () => {} }, { state: { shelters: [], sleptAtAge: 100000 } });
  survival.state.nightPlan = { plan: 'shelter', method: 'shaft_pocket', methodAt: Date.now() - 12000, until: Date.now() + 120000 };
  survival.shaftPocket = async () => { throw Object.assign(new Error('shaft pocket is set aside: No solid adjacent footing to move out of the work position'), { name: 'SetAside' }); };
  await assert.rejects(survival.refugeStep(new Task('t'), { kind: 'win' }, () => {}), /set aside/);
  assert.equal(survival.state.nightPlan.method, undefined, 'the plan lets the way go');
  assert(isSetAside(survival, 'shelter_method', 'shaft_pocket'), 'the way rests');
  assert.match(survival.state.shelterFailed.why, /^shaft pocket failed: shaft pocket is set aside: No solid adjacent footing/);
  // The next pass asks the way again, the shaft left out and said.
  let asked = null;
  survival.decide = async (task, goal, save, { id, tree, state }) => { asked = { id, tree, state }; return { path: ['seal_here'], stale: false }; };
  survival.sealHere = async () => true;
  await survival.refugeStep(new Task('t'), { kind: 'win' }, () => {});
  assert.equal(asked?.id, 'shelter_method');
  assert.equal(asked.tree.shaft_pocket, undefined);
  assert.match(asked.state.waysResting.shaft_pocket, /^shaft pocket failed: No solid adjacent footing to move out of the work position; back in about \d+ seconds$/);
});

test('the claim says the way chosen goes on while it holds, promising no question; once it rests, the way is asked next again (note 773)', () => {
  const { claim } = require('../src/survival');
  const { claimSays, promiseOf } = require('../src/arbiter');
  const bot = surfaceBot({ time: 18000 });
  const state = { sleptAtAge: 100000, nightPlan: { plan: 'shelter', method: 'shaft_pocket', methodAt: Date.now() - 12000, until: Date.now() + 120000 } };
  const held = claim(bot, { kind: 'win' }, { state, currentShelter: () => null });
  assert.equal(held.action, 'secure_shelter');
  assert.match(claimSays(held), /the way chosen 12 seconds ago \(shaft pocket\) goes on; should it fail, it rests and the way is asked again/);
  assert.equal(promiseOf(held), null, 'nothing promised while the way holds');
  setAside({ state }, 'shelter_method', 'shaft_pocket', 'shaft pocket failed: no footing', 180000);
  const rested = claim(bot, { kind: 'win' }, { state, currentShelter: () => null });
  assert.match(claimSays(rested), /the way \(a room, a pocket here, a shaft, the bed\) is asked next/);
  assert.deepEqual(promiseOf(rested), ['survival_priority', 'shelter_method']);
});

test('the night\'s last minutes are said in seconds, with what dawn ends, and the seal priced against them (note 773, 25588 a minute from dawn)', () => {
  const why = seal.sealReason({ underground: false, night: true, minutesToDawn: 1, secondsToDawn: 62 });
  assert.match(why.says, /^Sealing for the night on the surface, about 62 seconds of it left: mobs spawn in the open until dawn; from dawn none spawn there, and the zombies and skeletons out then burn in the sun \(creepers, spiders and the rest stay out\)\./);
  assert.match(seal.sealCostSays({ blocks: 14, minutesToDawn: 1, secondsToDawn: 62 }), /^ Sealing costs about 8 seconds of building \(14 blocks\), then about 54 seconds sealed before dawn\./);
  assert.match(seal.sealCostSays({ blocks: 14, minutesToDawn: 0, secondsToDawn: 6 }), /: dawn comes about when the building is done \(6 seconds off\), so nothing of the night is spent sealed\./);
  // Earlier in the night, minutes as before.
  assert.match(seal.sealReason({ night: true, minutesToDawn: 9, secondsToDawn: 540 }).says, /about 9 real minutes off\.$/);
});

// --- (2) under the rock ---

function belowBot({ mobs = [], health = 20, food = 18, time = 20000, sight = false } = {}) {
  const entities = Object.fromEntries(mobs.map((m, i) => [i + 10, { id: i + 10, name: m.name, position: m.at, height: 1.95, width: 0.6, isValid: true, metadata: {} }]));
  const open = new Set(['0,8,0', '0,9,0']);
  return {
    registry, game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal', minY: -64, height: 384 },
    entities, health, food, oxygenLevel: 20, time: { timeOfDay: time, age: 200000 },
    entity: { position: new Vec3(0.5, 8, 0.5), onGround: true, velocity: new Vec3(0, 0, 0), height: 1.8, width: 0.6 },
    inventory: { items: () => [{ name: 'iron_sword', count: 1 }, { name: 'cobblestone', count: 64 }], slots: [], emptySlotCount: () => 10 },
    heldItem: { name: 'iron_sword' },
    blockAt: p => { const q = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) }; const air = open.has(`${q.x},${q.y},${q.z}`) || q.y > 90; return { name: air ? 'air' : 'stone', boundingBox: air ? 'empty' : 'block', position: p, skyLight: 0 }; },
    world: { raycast: () => sight ? null : ({ intersect: new Vec3(0, 0, 0) }) }, on() {}, once() {}, removeListener() {}, emit() {},
  };
}

test('under the rock the night is free unless a bed pays the sleep owed or a reason to seal holds; a held shelter plan with no reason is let go (note 773, 25591)', async () => {
  const { claim, Survival } = require('../src/survival');
  // The sleep owed, no bed known, nothing about: nothing claimed (25591's
  // "A sealed pocket under the rock (no reason to seal ...)").
  assert.equal(claim(belowBot(), { kind: 'win' }, { state: { sleptAtAge: 0 }, currentShelter: () => null }), null);
  // The night plan held from a seal chosen there, no reason: not claimed.
  const plan = { plan: 'shelter', method: 'seal_here', until: Date.now() + 60000 };
  assert.equal(claim(belowBot(), { kind: 'win' }, { state: { sleptAtAge: 199000, nightPlan: { ...plan } }, currentShelter: () => null }), null);
  // A village with beds known: the night is the bed's question.
  const village = { kind: 'win', villages: [{ dimension: 'overworld', x: 60, y: 8, z: 0, beds: 2 }] };
  assert.equal(claim(belowBot(), village, { state: { sleptAtAge: 0 }, currentShelter: () => null })?.action, 'secure_shelter');
  // A zombie in sight is a reason: the plan holds.
  const seen = claim(belowBot({ mobs: [{ name: 'zombie', at: new Vec3(12, 8, 0) }], sight: true }), { kind: 'win' }, { state: { sleptAtAge: 199000, nightPlan: { ...plan } }, currentShelter: () => null });
  assert.equal(seen?.action, 'secure_shelter');
  // The step: the held plan is let go and nothing is sealed or asked
  // (25591's "dig in" at 00:43:32Z with no question).
  const survival = new Survival(belowBot(), { navigate: async () => {}, dig: async () => {}, place: async () => {} }, { state: { sleptAtAge: 199000, nightPlan: { ...plan } } });
  const asked = [];
  survival.decide = async (task, goal, save, { id }) => { asked.push(id); return { path: ['continue_request'], stale: false }; };
  survival.refugeStep = async () => { asked.push('refugeStep'); return true; };
  assert.equal(await survival.step(new Task('t'), { kind: 'win', request: 'beat the game' }, () => {}), false);
  assert.deepEqual(asked, []);
  assert.equal(survival.state.nightPlan, undefined);
});

test('seal-reasons.js counts the seals under the rock at night by reason, question and claim, and those made with no question (note 773)', () => {
  const { analyse } = require('../scripts/seal-reasons');
  const t0 = Date.parse('2026-10-01T00:41:31Z');
  const facts = { health: 20, food: 18, timeOfDay: 20056, underground: true, count: 7, inSight: 0, sleepDebt: true, mobs: [{ name: 'skeleton', distance: 21, visible: false }], coming: [] };
  const tr = {
    decisions: [
      { t: t0, id: 'turn_priority', path: ['survival'], claim: { action: 'secure_shelter', urgency: 'routine', underground: true, sleepDebt: true, sealFor: 'no reason to seal: health 20', plan: null } },
      { t: t0 + 300, id: 'survival_priority', path: ['secure_shelter'], facts, words: 'No reason to seal' },
      { t: t0 + 500, id: 'shelter_method', path: ['seal_here'], facts, words: 'No reason to seal' },
      { t: t0 + 109000, id: 'turn_priority', path: ['survival'], claim: { action: 'secure_shelter', urgency: 'routine', underground: true, sleepDebt: true, sealFor: 'no reason to seal: health 20', plan: 'shelter' } },
    ],
    survival: [{ t: t0 + 6000, label: 'dig in' }, { t: t0 + 121000, label: 'dig in' }],
    positions: [{ t: t0, p: { x: 198, y: 5, z: -70 } }, { t: t0 + 150000, p: { x: 205, y: 11, z: -65 } }], works: [], chats: [], tods: [{ t: t0, tod: 20056 }],
  };
  const r = analyse(tr, { examples: 5 });
  assert.equal(r.deepNight.seals, 1);
  assert.deepEqual(r.deepNight.byReason, { none: 1 });
  assert.deepEqual(r.deepNight.byPath, { 'secure_shelter>seal_here': 1 });
  assert.deepEqual(r.deepNight.byClaim, { 'secure_shelter routine (sleep owed)': 1 });
  assert.equal(r.deepNight.unasked, 1, 'the dig in at 00:43:32Z with no question');
  assert.equal(r.deepNight.unaskedNone, 1);
});

// --- (3) the shield at the hit, and gold ---

test('the hit log reads the shield at the hit: rising (under the quarter second to block) is said apart from up (note 773, 25584)', () => {
  const log = require('../src/hit-log');
  const now = 1_000_000;
  const bot = { health: 20, entity: { position: new Vec3(0, 64, 0), yaw: 0 }, _shieldRaised: true, _shieldRaisedAt: now - 100 };
  const piglin = { name: 'piglin', id: 5, position: new Vec3(0, 64, -6) };
  log.note(bot, piglin, now);
  bot._shieldRaisedAt = now - 2000;
  log.note(bot, piglin, now + 1000);
  bot._shieldRaised = false;
  log.note(bot, piglin, now + 2000);
  assert.equal(log.shieldAt({ _shieldRaised: true, _shieldRaisedAt: now - 100 }, now), 'rising');
  assert.equal(log.shieldAt({ _shieldRaised: true, _shieldRaisedAt: now - 400 }, now), 'up');
  assert.equal(log.shieldAt({}, now), 'down');
  const says = log.says(bot, [], { now: now + 2000 });
  assert.match(says, /the piglin not in view now \(3 hits in the last 20 seconds, the last 0 seconds ago, from in front; 1 landed with the shield up; 1 landed with the shield rising, before it blocks \(a raised shield blocks only a quarter second after it goes up\)\)/);
  // 25584's two: both rising, neither said as up.
  const b2 = { health: 20, entity: { position: new Vec3(0, 64, 0), yaw: 0 }, _shieldRaised: true, _shieldRaisedAt: now - 50 };
  log.note(b2, piglin, now); log.note(b2, piglin, now + 100);
  const s2 = log.says(b2, [], { now: now + 200 });
  assert.match(s2, /each landed with the shield rising, before it blocks/);
  assert.doesNotMatch(s2, /with the shield up/);
});

const piglinAt = (x, z = 0.5) => ({ id: 9, name: 'piglin', type: 'hostile', position: new Vec3(x, 64, z), height: 1.95, isValid: true, heldItem: { name: 'crossbow' }, metadata: {} });
function netherBot({ items = [], slots = {} } = {}) {
  const entity = piglinAt(4.5);
  const bot = surfaceBot({ dimension: 'the_nether', entities: { 9: entity }, items: [{ name: 'iron_sword', count: 1 }, { name: 'netherrack', count: 32 }, ...items] });
  bot.inventory.slots = { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 7: { name: 'iron_leggings' }, 8: { name: 'iron_boots' }, ...slots };
  bot.time = { timeOfDay: 6000 };
  return { bot, entity };
}

test('every option facing a piglin says whether gold is worn and what is carried toward it; golden boots carried are offered to put on (note 773, 25584)', () => {
  const { Survival, piglinGoldClause, wearGoldOf } = require('../src/survival');
  // 25584's: iron worn, 2 raw gold carried, no gold armour.
  {
    const { bot, entity } = netherBot({ items: [{ name: 'raw_gold', count: 2 }] });
    const danger = [{ entity, distance: 4, visible: true }];
    assert.match(piglinGoldClause(bot, danger), /^ No gold armour worn: a piglin goes for a player wearing none on sight, and leaves one wearing any gold piece alone \(save one struck\); 2 raw gold \(an ingot each, smelted\) carried, of the four ingots golden boots take\.$/);
    assert.equal(wearGoldOf(bot, danger), null);
    const survival = new Survival(bot, { navigate: async () => {}, place: async () => {} }, { state: { shelters: [] } });
    const options = survival.stanceOptions(new Task('t'), {}, () => {}, danger, false);
    assert(!options.wear_gold);
    for (const [k, o] of Object.entries(options)) if (typeof o.description === 'string') assert.match(o.description, /No gold armour worn/, k);
  }
  // Golden boots carried: offered, in place of the iron boots, and said on the rest.
  {
    const { bot, entity } = netherBot({ items: [{ name: 'golden_boots', count: 1 }] });
    const danger = [{ entity, distance: 4, visible: true }];
    const survival = new Survival(bot, { navigate: async () => {}, place: async () => {} }, { state: { shelters: [] } });
    const options = survival.stanceOptions(new Task('t'), {}, () => {}, danger, false);
    assert(options.wear_gold, Object.keys(options).join(','));
    assert.match(options.wear_gold.description, /^Put on the golden boots carried, in place of the iron boots \(1 armour point less\): one move in the inventory, under half a second\. Worn, a piglin leaves the bot alone, save one angry with it/);
    assert.match(options.wear_gold.description, /each piglin here stops going for the bot once it is on\. About 0 damage from the mobs here in the next fifteen seconds this way, the 0\.5 seconds of putting it on included, from 20 health\./);
    assert.equal(options.wear_gold.expects.damage, 0);
    assert.match(options.fight.description, /the golden boots is carried, not worn \(wear_gold puts it on in under half a second\)/);
  }
  // Worn: said so.
  {
    const { bot, entity } = netherBot({ slots: { 8: { name: 'golden_boots' } } });
    assert.match(piglinGoldClause(bot, [{ entity, distance: 4, visible: true }]), /^ Gold worn \(golden boots\): a piglin leaves the bot alone, save one it struck/);
  }
  // No piglin: nothing said.
  assert.equal(piglinGoldClause(netherBot().bot, []), '');
  // wear_gold is declared in the catalogue.
  assert.match(require('fs').readFileSync(require.resolve('../src/decisions/survival.js'), 'utf8'), /\{ key: 'wear_gold', label: 'put on the gold armour piece carried/);
});

test('the golden boots rung is priced with the piglin record (note 773)', () => {
  const src = require('fs').readFileSync(require.resolve('../src/strategy.js'), 'utf8');
  assert.match(src, /golden_boots: 'every piglin in the Nether goes for the bot on sight \(141 piglin hits on the bots in the Nether from 06:00Z on 2026-09-30/);
});

// --- (4) at low health with no food, beside a spawner ---

test('the hiding ways say health does not come back under hunger eighteen with nothing to eat, and the food errand they put off (note 773, 25594)', () => {
  const { healWaitSays } = require('../src/survival');
  const bot = surfaceBot();
  bot.health = 0.3; bot.food = 17;
  const now = Date.now();
  const said = healWaitSays(bot, { foodChoice: { choice: 'food', key: 'obtain_food/seen_food_2', at: now - 18000, ms: 120000, facts: {} } }, now);
  assert.equal(said, ' Health does not come back while this holds: 0.3 now, hunger 17, under the eighteen it comes back at; nothing carried to eat, so the wait gains no health, and only food brings it back. The food errand chosen 18 seconds ago (seen food 2) waits while this holds.');
  bot.food = 19;
  assert.equal(healWaitSays(bot, {}, now), '', 'health comes back at eighteen and more: nothing to add');
});
