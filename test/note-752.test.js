'use strict';
// Note 752: a mob that cannot reach the bot still owned the turn, and
// options promised questions that never came.
//
// 25595 (mid-242-ya, 10:44:47 to 10:53:30Z): at full health on a span, a
// hoglin 3.9 blocks off, no_route every ten seconds, no hit; turn_priority
// answered survival every minute, "Answer the hoglin 3.9 blocks off: the
// stance is asked next", while the stance held on the span was carried out
// and no stance was asked for five minutes; set_aside_rung was chosen and
// never carried out. 25594 (mid-239-ae, 10:45 to 10:53Z): sealed at y 8 with
// nothing to eat, "whether to stay, leave or do something else there is
// asked next" every minute, pocket_next never asked (the wait for daylight
// chosen at 10:44:57 answered stay each pass). 25589 (11:34:53Z): fight
// answered at 0.77 and asked again half a second later, shield_guard: the
// scene book read the fight's first quarter-second stand as "came to
// nothing" and left it out of its own next pass.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('node:events');
const arbiter = require('../src/arbiter');
const danger = require('../src/danger');
const { claim } = require('../src/survival');
const registry = require('minecraft-data')('26.1');

const T0 = Date.parse('2026-09-30T10:44:47Z');
const flat = over => {
  const bot = { game: { dimension: 'the_nether', difficulty: 'normal', gameMode: 'survival', minY: 0, height: 256 }, health: 20, food: 20, oxygenLevel: 20,
    time: { timeOfDay: 6000, age: 100000 }, inventory: { items: () => [], slots: [] }, registry: { entitiesByName: {} },
    entity: { position: new Vec3(0.5, 64, 0.5), eyeHeight: 1.62, metadata: [0] }, entities: {},
    blockAt: p => p.y < 64 ? { name: 'netherrack', boundingBox: 'block', position: p } : { name: 'air', boundingBox: 'empty', position: p }, ...over };
  return bot;
};
const hoglin = (x = 4.4) => ({ id: 16436, name: 'hoglin', type: 'hostile', position: new Vec3(x, 64, 0.5), height: 1.4, width: 1.4, metadata: [] });
// Every five seconds from T0 to `until`, the looks the step and the watch
// take (danger.threats feeds held-off.js's record).
function watch(t, bot, until) {
  for (let s = 0; s <= until; s += 5) { t.mock.timers.setTime(T0 + s * 1000); danger.threats(bot, 64); }
}

test('a hoglin that stands 3.9 blocks off a minute without coming nearer or landing a hit no longer stops the work, and is offered beside it as routine with that fact (25595, note 752)', t => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const bot = flat();
  bot.entities = { 16436: hoglin() };
  // Half a minute in, it is a threat as before: the work's check throws.
  watch(t, bot, 30);
  assert.equal(danger.immediateThreat(bot)?.entity.name, 'hoglin');
  assert.throws(() => danger.checkThreats(bot), /Threat nearby: hoglin/);
  const early = claim(bot, { kind: 'win', survival: {} }, { state: {}, currentShelter: () => null });
  assert.equal(early.urgency, 'pressing');
  assert.match(arbiter.claimSays(early), /Whether it can reach the bot: a way to the bot is found; about 30 seconds, 3\.9 to 3\.9 blocks off, no hit from its kind in that time\./);
  // A minute and more: stood off.
  watch(t, bot, 70);
  assert.equal(danger.immediateThreat(bot), undefined, 'not the threat that stops the work');
  assert.doesNotThrow(() => danger.checkThreats(bot));
  assert.equal(danger.pushersAbout(bot).length, 0, 'nor something that can push the bot');
  const c = claim(bot, { kind: 'win', survival: {} }, { state: {}, currentShelter: () => null });
  assert.equal(c.action, 'escape_threat');
  assert.equal(c.urgency, 'routine', 'offered beside the work, not pressing');
  assert.equal(c.facts.standsOff, 70);
  assert.match(arbiter.claimSays(c), /^Answer the hoglin 3\.9 blocks off: the stance is asked next .*Whether it can reach the bot: a way to the bot is found; it has stood off 70 seconds, 3\.9 to 3\.9 blocks off, no nearer and no hit from its kind in that time: not a threat that stops the work while that holds, and one again the moment it comes nearer, to its reach, or its kind lands a hit\./);
  // Its kind lands a hit: a threat again at once.
  bot._hurtBy = { hoglin: Date.now() };
  assert.equal(danger.immediateThreat(bot)?.entity.name, 'hoglin');
  delete bot._hurtBy;
  // It comes two blocks and more nearer: a threat again at once.
  bot.entities[16436].position = new Vec3(2.4, 64, 0.5);
  assert.equal(danger.immediateThreat(bot)?.entity.name, 'hoglin');
});

test('a creeper never stands off: one that stays five blocks off for minutes is still the threat (note 752)', t => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const bot = flat({ game: { dimension: 'overworld', difficulty: 'normal', gameMode: 'survival', minY: -64, height: 384 } });
  bot.entities = { 9: { id: 9, name: 'creeper', type: 'hostile', position: new Vec3(5.5, 64, 0.5), height: 1.7, metadata: [] } };
  watch(t, bot, 180);
  assert.equal(danger.immediateThreat(bot)?.entity.name, 'creeper');
  assert.equal(danger.immediateThreat(bot, { stoodOff: true }), undefined);
});

test('the work option says the mob that stood off beside it, so the work is offered with the fact (25595, note 752)', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const bot = flat();
  bot.entities = { 16436: hoglin() };
  watch(t, bot, 70);
  const survival = claim(bot, { kind: 'win', survival: {} }, { state: {}, currentShelter: () => null });
  let tree;
  const decide = async (id, q) => { tree = q.tree; return { path: ['work'] }; };
  const work = { layer: 'work', action: 'cross_toward', urgency: 'routine', facts: { doing: 'cross toward' }, run: async () => true };
  const out = await arbiter.take(bot, [{ ...survival, run: async () => true }, work], { decide, now: Date.now() });
  assert.equal(out.layer, 'work');
  assert.match(tree.work.description.does, /a hoglin 3\.9 blocks off.*it has stood off 70 seconds, 3\.9 to 3\.9 blocks off, no nearer and no hit from its kind in that time/);
  assert.equal(tree.survival.description.urgency, 'routine');
});

test('with a stance held, a threat claim says that stance goes on, not "the stance is asked next": the step carries it out and asks none (25595, note 752)', t => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const bot = flat();
  bot.entities = { 16436: hoglin() };
  danger.threats(bot, 64);
  bot._stance = { choice: 'hold_on_span', ids: [999], kinds: 'hoglin', at: T0 - 5000, running: true, health: 20 };
  const c = claim(bot, { kind: 'win', survival: {} }, { state: {}, currentShelter: () => null });
  assert.equal(c.action, 'escape_threat');
  assert.deepEqual(c.facts.stance, { choice: 'hold_on_span', secondsAgo: 5, noHitSeconds: 5, other: true });
  const says = arbiter.claimSays(c);
  assert.doesNotMatch(says, /asked next/);
  assert.match(says, /^Answer the hoglin 3\.9 blocks off: the hold on span chosen 5 seconds ago \(against the mobs about then\) goes on \(asked again when it fails/);
  assert.equal(arbiter.promiseOf(c), null, 'no question promised');
});

test('sealed in a pocket with the wait for daylight chosen, the pocket claim says stay goes on and when the pocket is asked again, not "asked next" (25594, note 752)', t => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const origin = new Vec3(169, 8, -42);
  const bot = { registry, game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, health: 18.5, food: 17,
    entity: { position: origin.offset(0.5, 0, 0.5) }, entities: {}, time: { timeOfDay: 14000 }, inventory: { items: () => [] },
    blockAt: p => (p.x === origin.x && p.z === origin.z && (p.y === origin.y || p.y === origin.y + 1)) ? { name: 'air', boundingBox: 'empty', position: p } : { name: 'stone', boundingBox: 'block', position: p } };
  const refuge = { kind: 'pocket', origin: { x: origin.x, y: origin.y, z: origin.z }, dimension: 'overworld', verifiedAt: new Date(T0 - 3000).toISOString() };
  // Under rock the wait for daylight is not held (note 752i): the pocket's
  // own held answer is.
  const dawn = claim(bot, { kind: 'win', survival: { sealedWait: { until: T0 + 600000 } } }, { state: { sealedWait: { until: T0 + 600000 } }, currentShelter: () => refuge });
  assert.equal(dawn.facts.pocketHeld, undefined, 'no dawn wait held under rock');
  const state = { pocketPlan: { choice: 'stay', key: 'k', at: T0 - 5000, until: T0 + 85000 } };
  const c = claim(bot, { kind: 'win', survival: state }, { state, currentShelter: () => refuge });
  assert.equal(c.action, 'pocket_next');
  assert.equal(c.facts.pocketHeld.choice, 'stay');
  const says = arbiter.claimSays(c);
  assert.doesNotMatch(says, /asked next/);
  assert.match(says, /: stay goes on, as chosen \(pocket next's own answer, held while the pocket and what is about stay as they were\) 5 seconds ago, nothing having hurt the bot in the \d+ seconds in it, about 85 seconds more before whether to stay, leave or do something else there is asked again\./);
  assert.match(says, /Underground here: daylight does not come down to it, and mobs spawn in the dark by day as by night\./);
  // With nothing held, the pocket's question is what comes, and it is said so.
  const free = claim(bot, { kind: 'win', survival: {} }, { state: {}, currentShelter: () => refuge });
  assert.match(arbiter.claimSays(free), /whether to stay, leave or do something else there is asked next/);
  assert.deepEqual(arbiter.promiseOf(free), ['pocket_next']);
});

test('every turn_priority option that says a question is asked next names it in arbiter.ASKS, each a question that exists (note 752)', () => {
  const decisions = require('../src/decisions');
  const facts = { health: 9, food: 12, threat: { name: 'zombie', distance: 5 }, entity: 'blaze', distance: 9, creeper: 5, lightsAt: 3, fuse: 1.5, blocksASecond: 1.3 };
  const layers = { survival: ['escape_threat', 'creeper_back_off', 'leave_lava', 'pocket_next', 'night_hunt', 'recover_items', 'secure_shelter', 'go_home_for_night', 'obtain_food', 'wait_for_day_sealed', 'surface', 'out_of_powder_snow'],
    vitals: ['out_of_fire', 'dig_out_of_block', 'swim_up', 'eat'], hunt: ['hunt'], work: ['mine'] };
  let promising = 0;
  for (const [layer, actions] of Object.entries(layers)) for (const action of actions) {
    const c = { layer, action, urgency: 'routine', facts };
    const says = arbiter.claimSays(c);
    if (!/asked next/.test(says)) continue;
    promising++;
    const asks = arbiter.ASKS[action];
    assert(asks?.length, `${action} says "asked next" with no question named in ASKS: ${says}`);
    for (const id of asks) assert.doesNotThrow(() => decisions.question(id), `${action}: ${id} is a question`);
  }
  assert(promising >= 5, `${promising} promising actions`);
});

test('a claim given the turn that said a question is asked next, and it was not asked within thirty seconds, says so the next time it is offered, until the question is asked (25594, note 752)', async () => {
  const bot = flat();
  const lines = [];
  const state = {};
  const t0 = T0;
  const pocket = () => ({ layer: 'survival', action: 'pocket_next', urgency: 'routine', facts: { health: 18.5, food: 17, healing: false, inPocket: true }, run: async () => true });
  const work = () => ({ layer: 'work', action: 'craft', urgency: 'routine', facts: {}, run: async () => true });
  let tree;
  const decide = async (id, q) => { tree = q.tree; return { path: ['survival'] }; };
  bot._survivalGoal = { survivalAction: { action: 'wait_in_shelter' } };
  await arbiter.take(bot, [pocket(), work()], { decide, mobs: [], now: t0, state });
  assert.deepEqual(state.promise.asks, ['pocket_next']);
  // A pass half a minute on, nothing asked meanwhile.
  const u = arbiter.promised(bot, state, pocket(), t0 + 31000, l => lines.push(l));
  assert.equal(u.did, 'wait_in_shelter');
  assert.match(lines[0], /^\[arbiter\] survival pocket_next said pocket_next is asked next 31 seconds ago; not asked \(the step did wait_in_shelter\)$/);
  // Offered again: the promise is not repeated, the fact is said.
  delete state.ruling; state.scenes = {};
  await arbiter.take(bot, [pocket(), work()], { decide, mobs: [], now: t0 + 61000, state });
  assert.doesNotMatch(tree.survival.description.does, /is asked next\./);
  assert.match(tree.survival.description.does, /this said \d+ seconds ago that pocket next is asked next, and it has not been asked since: the survival step went on with wait in shelter instead; given the turn, it goes on so/);
  // The question comes: the fact goes.
  require('../src/turn').takeTurn(bot, 'decision', 'asking Jev: pocket_next');
  assert.equal(arbiter.withUnkept(bot, state, pocket(), t0 + 62000).facts.askedNextNotAsked, undefined);
});

// The stance step as note 743's harness runs it.
function mobBot() {
  const mob = { id: 8825, name: 'magma_cube', type: 'hostile', position: new Vec3(4, 65, 0), height: 2.04, width: 2.04, isValid: true, metadata: [] };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health: 20, food: 19, oxygenLevel: 20,
    entities: { 8825: mob }, time: { timeOfDay: 6000 }, registry: require('minecraft-data')('26.1'),
    entity: { position: new Vec3(0, 65, 0), onGround: true, width: 0.6, height: 1.8, velocity: new Vec3(0, 0, 0), metadata: { 0: 0 } },
    inventory: { items: () => [{ name: 'iron_sword', count: 1 }], slots: { 45: { name: 'shield' } }, emptySlotCount: () => 20 },
    blockAt: p => ({ position: p.floored(), name: 'air', boundingBox: 'empty', diggable: false, shapes: [] }),
    world: { raycast: () => null }, findBlocks: () => [], lookAt: async () => {}, look: async () => {}, equip: async () => {}, attack() {},
    pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, setControlState() {}, activateItem() {}, deactivateItem() {} });
  return { bot, threat: () => ({ entity: mob, distance: mob.position.distanceTo(bot.entity.position), visible: true }) };
}

test('a fight answered and standing for the mob to come is not asked again half a second later for having struck nothing yet: it is under way until it ends (25589, note 752)', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const { Survival } = require('../src/survival');
  const { Task } = require('../src/skills');
  const { bot, threat } = mobBot();
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
  const asked = [], ran = [];
  // Fight stands facing the cube a quarter second at a time, nothing struck
  // (its run returns true, as the stand does); the guard the same.
  survival.stanceOptions = () => ({
    fight: { description: 'Fight here.', expects: { damage: 35.2, seconds: 17 }, run: async () => { ran.push('fight'); return true; } },
    shield_guard: { description: 'Face it with the shield raised.', expects: { damage: 3, seconds: 15 }, run: async () => { ran.push('shield_guard'); return true; } },
    retreat: { description: 'Run.', run: async () => true },
    keep_working: { description: 'Carry on.', run: async () => true },
  });
  survival.decide = async (task, goal, save, q) => { asked.push(Object.keys(q.tree)); return { path: [asked.length === 1 ? 'fight' : 'shield_guard'] }; };
  survival.scoutRetreat = async () => {};
  for (let ms = 0; ms <= 5000; ms += 500) {
    t.mock.timers.setTime(T0 + ms);
    await survival.stanceStep(new Task('x'), {}, () => {}, [threat()], false);
  }
  assert.equal(asked.length, 1, `asked ${asked.length} times: ${JSON.stringify(asked)}`);
  assert.equal(ran.filter(k => k === 'fight').length, 11, 'the fight held its five seconds, run each pass');
});

// 25585 (mid-239-ba, 11:48 to 11:58Z): sealed at y 11, leave chosen at
// 11:55:32 and the pocket never opened (leaving set aside by the stall watch
// at 11:50:38); stay told the surface's daylight burns the zombies.
function stonePocket() {
  const origin = new Vec3(206, 11, -65);
  const open = new Set([`${origin}`, `${origin.offset(0, 1, 0)}`]);
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, entities: {}, health: 20, food: 18,
    registry: require('minecraft-data')('26.1'), time: { timeOfDay: 6000, age: 100000 }, entity: { position: origin.offset(0.5, 0, 0.5), onGround: true, velocity: new Vec3(0, 0, 0) }, oxygenLevel: 20,
    inventory: { items: () => [{ name: 'iron_pickaxe', count: 1 }, { name: 'iron_sword', count: 1 }, { name: 'cobblestone', count: 43 }], emptySlotCount: () => 10, slots: [] },
    blockAt: p => ({ name: open.has(`${p}`) ? 'air' : 'stone', boundingBox: open.has(`${p}`) ? 'empty' : 'block', position: p }),
    world: { raycast: from => ({ intersect: from.offset(0.6, 0, 0) }) } });
  return { bot, origin };
}

test('underground, stay does not offer the surface\'s daylight as what the wait is for, and a leave the stall watch set aside is said so and carried out when Jev chooses it (25585, note 752)', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const { Survival } = require('../src/survival');
  const { Task } = require('../src/skills');
  const progress = require('../src/progress');
  const { bot, origin } = stonePocket();
  const goal = { kind: 'win', request: 'beat the game' };
  const survival = new Survival(bot, {}, { state: { shelters: [{ origin: { ...origin }, dimension: 'overworld', verifiedAt: new Date(T0 - 60000).toISOString() }] }, client: { systemOne: async () => ({}) } });
  progress.setAside(survival, 'act', 'survival:leave_shelter', 'leave shelter is not getting anywhere', 600000);
  let tree, chosenSeen = null;
  survival.leave = async () => { chosenSeen = survival.state.leaveChosen; return true; };
  survival.wait = async () => {};
  survival.decide = async (task, g, save, { id, tree: tr }) => { if (id === 'pocket_next') tree = tr; return { path: [tr.leave ? 'leave' : 'stay'], stale: false }; };
  await survival.step(new Task('x'), goal, () => {});
  assert(tree, 'pocket_next was asked');
  assert.doesNotMatch(tree.stay.description, /surface's zombies and skeletons burn/);
  assert.match(tree.stay.description, /It is day.*up on the surface: underground here the daylight does not come down/);
  assert.match(tree.leave.description, /Leaving stalled here before \(leave shelter is not getting anywhere; back in about \d+ seconds\); chosen, the pocket is opened all the same\./);
  assert.equal(chosenSeen, true, 'the leave Jev chose runs past the stall\'s refusal');
  assert.equal(survival.state.leaveChosen, undefined, 'for that run only');
  // The report the leave makes is not refused for it, chosen; unchosen it is.
  assert.doesNotThrow(() => survival.report(goal, () => {}, { action: 'leave_shelter', chosen: true }));
  assert.throws(() => survival.report(goal, () => {}, { action: 'leave_shelter' }), /set aside/);
});
