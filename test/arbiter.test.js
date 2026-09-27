'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const arbiter = require('../src/arbiter');
const { EMERGENCIES } = require('../src/stillness');

const fakeBot = (over = {}) => ({ entity: { position: new Vec3(0, 64, 0) }, health: 20, food: 20, oxygenLevel: 20, entities: {}, ...over });
const claim = (layer, urgency = 'routine', extra = {}) => ({ layer, action: `${layer}_step`, urgency, facts: {}, run: async () => true, ...extra });
const reflex = key => { const r = arbiter.REFLEXES.find(x => x.key === key); return claim(r.layer, 'reflex', { action: r.action, reflex: key }); };
const look = ({ lava = false, fire = false, head = false, mobs = [] } = {}) => ({ inLava: () => lava, burning: () => fire, headInBlock: () => head, mobs: () => mobs });
const mob = (name, distance, id = 1, visible = true) => ({ entity: { name, id }, distance, visible });

test('every reflex is an emergency to the stillness watch, and none is ever set aside', () => {
  for (const r of arbiter.REFLEXES) assert(EMERGENCIES.has(r.action), r.action);
});

test('the reflexes win in their fixed order, over any claim, and are never asked', async () => {
  let asked = 0;
  const decide = async () => { asked++; return { path: ['work'] }; };
  const all = ['arm', 'creeper', 'air', 'head_in_block', 'fire', 'lava'].map(reflex);
  const out = await arbiter.arbitrate(fakeBot(), [claim('work'), claim('vitals', 'pressing'), ...all], { state: {}, decide, dry: true });
  assert.equal(out.winner.reflex, 'lava'); assert.equal(out.by, 'reflex'); assert.equal(out.ask, false);
  const next = await arbiter.arbitrate(fakeBot(), [claim('work'), reflex('arm'), reflex('creeper')], { state: {}, decide });
  assert.equal(next.winner.reflex, 'creeper');
  assert.equal(next.acted, true, 'run, not dry: the winner acts');
  assert.equal(asked, 0);
});

test('a single claim runs without a question', async () => {
  let ran = false;
  const out = await arbiter.arbitrate(fakeBot(), [null, claim('work', 'routine', { run: async () => { ran = true; return true; } })],
    { state: {}, decide: async () => assert.fail('not asked') });
  assert.equal(out.by, 'single'); assert.equal(ran, true); assert.equal(out.acted, true);
  const none = await arbiter.arbitrate(fakeBot(), [null, null], { state: {} });
  assert.equal(none.winner, null); assert.equal(none.by, 'none');
});

test('several claims are one turn_priority question, one option per claim with its facts', async () => {
  const seen = [];
  const decide = async (id, { tree }) => { seen.push([id, tree]); return { path: ['vitals'] }; };
  const claims = [claim('survival', 'pressing', { action: 'secure_shelter', facts: { health: 0.9, shelter: 'set aside: no route' } }),
    claim('vitals', 'routine', { action: 'eat', cost: { seconds: 1.6 } }), claim('work')];
  const out = await arbiter.arbitrate(fakeBot({ health: 0.9 }), claims, { state: {}, decide, mobs: [] });
  assert.equal(seen.length, 1);
  assert.equal(seen[0][0], 'turn_priority');
  assert.deepEqual(Object.keys(seen[0][1]).sort(), ['survival', 'vitals', 'work']);
  assert.deepEqual(seen[0][1].survival.description.facts, { health: 0.9, shelter: 'set aside: no route' });
  assert.deepEqual(seen[0][1].vitals.description.cost, { seconds: 1.6 });
  assert.equal(out.winner.layer, 'vitals'); assert.equal(out.by, 'jev'); assert.equal(out.ask, true);
  // Dry: nobody is asked, the rules pick (the more urgent), and the ask is said.
  const dry = await arbiter.arbitrate(fakeBot(), claims, { state: {}, dry: true, decide: async () => assert.fail('dry never asks'), mobs: [] });
  assert.equal(dry.winner.layer, 'survival'); assert.equal(dry.ask, true); assert.equal(dry.acted, undefined);
  // The question is defined, and its fallback is the same order.
  const q = require('../src/decisions').question('turn_priority');
  assert.equal(q.fallback({ work: { description: { urgency: 'routine' } }, vitals: { description: { urgency: 'pressing' } } }), 'vitals');
});

test('a ruling is held by its fingerprint until a newcomer, health, a food band or a minute breaks it', async () => {
  let asked = 0;
  const decide = async () => { asked++; return { path: ['work'] }; };
  const state = {}, claims = () => [claim('survival', 'pressing'), claim('work')];
  const bot = fakeBot({ health: 18, food: 18 });
  const at = (now, extra = {}) => arbiter.arbitrate(bot, claims(), { state, decide, now, mobs: [mob('zombie', 10, 1)], ...extra });
  assert.equal((await at(0)).by, 'jev');
  const held = await at(1000);
  assert.equal(held.by, 'held'); assert.equal(held.winner.layer, 'work'); assert.equal(asked, 1);
  // The claims changed: asked again.
  assert.equal((await arbiter.arbitrate(bot, [...claims(), claim('vitals')], { state, decide, now: 2000, mobs: [] })).why, 'the claims changed');
  assert.equal(asked, 2);
  // A newcomer within six blocks.
  assert.equal((await at(3000, { mobs: [mob('zombie', 4, 7)] })).why, 'the claims changed');
  assert.equal((await at(3500)).by, 'held');
  assert.equal((await at(4000, { mobs: [mob('zombie', 10, 1), mob('skeleton', 5, 9)] })).why, 'a newcomer within six blocks');
  // Health down six.
  bot.health = 11;
  assert.equal((await at(5000, { mobs: [] })).why, 'health fell 6');
  // Food across a band (eighteen to seventeen: no healing).
  bot.food = 17;
  assert.equal((await at(6000, { mobs: [] })).why, 'food crossed a band');
  // A minute.
  assert.equal((await at(6000 + arbiter.RULING_MS, { mobs: [] })).why, 'a minute passed');
  // A reflex ends the ruling.
  await arbiter.arbitrate(bot, [...claims(), reflex('air')], { state, decide, now: 70000 });
  assert.equal(state.ruling, undefined);
  // A winner that is not preemptible keeps its hold.
  const pinned = [claim('survival', 'pressing', { preemptible: false, minHoldMs: 10000 }), claim('work')];
  await arbiter.arbitrate(bot, pinned, { state, decide: async () => ({ path: ['survival'] }), now: 80000, mobs: [] });
  assert.equal((await arbiter.arbitrate(bot, [...pinned, claim('vitals')], { state, decide, now: 85000, mobs: [mob('zombie', 2, 5)] })).by, 'held');
});

test('the reflexes have hysteresis: in at the line, out two past it', () => {
  const reach = arbiter.CREEPER_REACH;
  const bot = fakeBot();
  const keys = (held, probe) => arbiter.observeReflexes(bot, held, probe).map(r => r.key);
  assert.deepEqual(keys([], look({ mobs: [mob('creeper', reach + 1)] })), []);
  assert.deepEqual(keys([], look({ mobs: [mob('creeper', reach - 0.5)] })), ['creeper']);
  assert.deepEqual(keys(['creeper'], look({ mobs: [mob('creeper', reach + 1.5)] })), ['creeper'], 'held to two past its line');
  assert.deepEqual(keys(['creeper'], look({ mobs: [mob('creeper', reach + 2.5)] })), []);
  // Out of sight a creeper counts within four (danger.js).
  assert.deepEqual(keys([], look({ mobs: [mob('creeper', 5, 1, false)] })), []);
  assert.deepEqual(keys([], look({ mobs: [mob('creeper', 3.5, 1, false)] })), ['creeper']);
  // Breath: in at twelve, out past fourteen.
  bot.oxygenLevel = 13;
  assert.deepEqual(keys([], look()), []);
  assert.deepEqual(keys(['air'], look()), ['air']);
  bot.oxygenLevel = 15;
  assert.deepEqual(keys(['air'], look()), []);
  // A mob at arm's length counts only at the stance's six health or under.
  bot.oxygenLevel = 20; bot.health = 10;
  assert.deepEqual(keys([], look({ mobs: [mob('zombie', 2)] })), []);
  bot.health = 5;
  assert.deepEqual(keys([], look({ mobs: [mob('zombie', 2.5)] })), ['arm']);
  assert.deepEqual(keys([], look({ mobs: [mob('zombie', 4)] })), []);
  assert.deepEqual(keys(['arm'], look({ mobs: [mob('zombie', 4)] })), ['arm']);
  assert.deepEqual(keys([], look({ lava: true, fire: true, head: true })), ['lava', 'fire', 'head_in_block']);
});

test('the arbiter keeps the held reflexes for the next look', async () => {
  const state = {};
  await arbiter.arbitrate(fakeBot(), [reflex('creeper'), claim('work')], { state, dry: true });
  assert.deepEqual(state.reflexes, ['creeper']);
  await arbiter.arbitrate(fakeBot(), [claim('work')], { state, dry: true });
  assert.deepEqual(state.reflexes, []);
});

// The shadow's claims, from a bot on open ground: air above y 64, stone
// under it.
const world = (over = {}) => {
  const bot = fakeBot({ game: { dimension: 'overworld', difficulty: 'normal', gameMode: 'survival', minY: -64, height: 384 },
    time: { timeOfDay: 6000, age: 100000 }, inventory: { items: () => [], slots: [] }, registry: { entitiesByName: {} },
    blockAt: p => p.y < 64 ? { name: 'stone', boundingBox: 'block', position: p } : { name: 'air', boundingBox: 'empty', position: p }, ...over });
  bot.entity.eyeHeight = 1.62; bot.entity.metadata = [0];
  return bot;
};
const claimsOf = (bot, goal, survival) => [require('../src/survival').claim(bot, goal, survival), require('../src/vitals').claim(bot),
  require('../src/mob-hunt').claim(bot, goal), { layer: 'work', action: goal.step?.action || 'step', urgency: 'routine', facts: {} }];

test('a creeper coming on while the work holds the turn is a reflex: the shadow says the work was given it', async () => {
  const bot = world();
  bot.entities = { 7: { id: 7, name: 'creeper', type: 'hostile', position: new Vec3(5, 64, 0), height: 1.7, metadata: [] } };
  const goal = { kind: 'win', step: { action: 'mine', item: 'iron_ore' }, survival: {} };
  const survival = { state: goal.survival, currentShelter: () => null };
  const claims = claimsOf(bot, goal, survival);
  assert.equal(claims[0].urgency, 'reflex'); assert.equal(claims[0].reflex, 'creeper'); assert.equal(claims[0].action, 'creeper_back_off');
  assert.equal(claims[0].facts.creeper, 5); assert.equal(claims[0].facts.seen, true);
  const lines = [];
  const turn = arbiter.shadow(bot, () => claims, { log: line => lines.push(line) });
  assert.deepEqual({ layer: turn.would.layer, by: turn.would.by, ask: turn.would.ask }, { layer: 'survival', by: 'reflex', ask: false });
  turn.gave('work');
  assert.deepEqual(lines, ['[arbiter] would survival creeper_back_off, gave work']);
  assert.deepEqual(bot._arbiterShadow.would, { layer: 'survival', action: 'creeper_back_off', by: 'reflex' });
  assert.equal(bot._arbiterShadow.gave, 'work');
  // The same difference again at once is not said again; agreement never is.
  arbiter.shadow(bot, () => claims, { log: line => lines.push(line) }).gave('work');
  arbiter.shadow(bot, () => claims, { log: line => lines.push(line) }).gave('survival');
  assert.equal(lines.length, 1);
  // Held to two past the line: the creeper steps back to nine and a half.
  bot.entities[7].position = new Vec3(arbiter.CREEPER_REACH + 1.5, 64, 0);
  assert.equal(require('../src/survival').claim(bot, goal, survival).reflex, 'creeper');
  bot._arbiter.reflexes = [];
  assert.notEqual(require('../src/survival').claim(bot, goal, survival)?.reflex, 'creeper');
});

test('a shelter set aside at 0.9 health, at night, is a live survival claim beside the work, not a fall-through', async () => {
  const bot = world({ health: 0.9, food: 10, time: { timeOfDay: 14000, age: 100000 } });
  const now = Date.now();
  const goal = { kind: 'win', step: { action: 'obtain', item: 'bread' }, survival: { attempts: {
    'act:survival:secure_shelter': { action: 'act', target: 'survival:secure_shelter', why: 'no route to a shelter site (the search ran out of time)', at: now, until: now + 600000, count: 1 } } } };
  const survival = { state: goal.survival, currentShelter: () => null };
  const claims = claimsOf(bot, goal, survival);
  const mine = claims[0];
  assert.equal(mine.layer, 'survival'); assert.equal(mine.action, 'secure_shelter'); assert.equal(mine.urgency, 'pressing');
  assert.equal(mine.facts.health, 0.9);
  assert.match(mine.facts.setAside.secure_shelter, /no route to a shelter site/);
  assert.equal(claims[1], null, 'nothing to eat carried: no meal to claim');
  assert.deepEqual(Object.keys(goal.survival), ['attempts'], 'the claim wrote nothing');
  // Shadow: the rules would give it to survival, and Jev would be asked.
  const lines = [];
  const turn = arbiter.shadow(bot, () => claims, { log: line => lines.push(line) });
  assert.equal(turn.would.layer, 'survival'); assert.equal(turn.would.ask, true);
  turn.gave('work');
  assert.deepEqual(lines, ['[arbiter] would survival secure_shelter (would ask Jev: survival, work), gave work']);
  // Live: one turn_priority question, the set-aside said as a fact.
  let tree;
  const out = await arbiter.arbitrate(bot, claims, { state: {}, mobs: [], decide: async (id, q) => { tree = q.tree; return { path: ['survival'] }; } });
  assert.deepEqual(Object.keys(tree).sort(), ['survival', 'work']);
  assert.match(tree.survival.description.facts.setAside.secure_shelter, /ran out of time/);
  assert.equal(out.winner.layer, 'survival');
});

test('the shadow never throws into the loop: a claim that fails is logged once and passed over', () => {
  const bot = fakeBot();
  const turn = arbiter.shadow(bot, () => { throw new Error('no world'); });
  assert.equal(turn.would, undefined);
  assert.doesNotThrow(() => turn.gave('work'));
});

// The watch and the live turn (steps three to five of the migration).
const { checkStall } = require('../src/stillness');
const { Task } = require('../src/skills');
const stoppable = (over = {}) => {
  const stopped = [];
  const bot = fakeBot({ stopDigging: () => stopped.push('dig'), clearControlStates: () => stopped.push('keys'), pathfinder: { setGoal: () => stopped.push('walk') }, ...over });
  return { bot, stopped };
};
const creeperNear = () => look({ mobs: [mob('creeper', arbiter.CREEPER_REACH - 0.5, 7)] });

test('a preemption is sticky until the arbiter rules for real, with no clock', () => {
  const { bot, stopped } = stoppable();
  bot._arbiter = { holder: { layer: 'work', action: 'mine', since: 0, ids: [] } };
  const p = arbiter.watchOnce(bot, { live: true, look: creeperNear(), now: 1000, log: () => {} });
  assert.equal(p.by, 'creeper'); assert.equal(p.over, 'work mine');
  assert.deepEqual(stopped.sort(), ['dig', 'keys', 'walk']);
  // Gone from view, a minute on: still held, still thrown at every check.
  assert.equal(arbiter.watchOnce(bot, { live: true, look: look(), now: 61000, log: () => {} }), p);
  for (let i = 0; i < 3; i++) assert.throws(() => checkStall(bot), err => err.name === 'NeedsSafety' && err.preempted.by === 'creeper');
  // A dry ruling (the shadow's) picks up nothing.
  arbiter.rule(bot, [reflex('creeper'), claim('work')], { dry: true });
  assert.equal(bot._preempt, p);
  // The arbiter's ruling picks it up.
  const out = arbiter.rule(bot, [reflex('creeper'), claim('work')], {});
  assert.equal(out.winner.reflex, 'creeper'); assert.equal(bot._preempt, undefined);
  assert.doesNotThrow(() => checkStall(bot));
});

test('the preemption is on the stall check: a nested step that drops the interrupt check still meets it', () => {
  const { bot } = stoppable();
  bot._arbiter = { holder: { layer: 'work', action: 'mine', since: 0, ids: [] } };
  const task = new Task('t', 'mine');
  task.stallCheck = () => checkStall(bot);
  task.interruptCheck = () => {};
  arbiter.watchOnce(bot, { live: true, look: creeperNear(), log: () => {} });
  // As a nested step does before its own work.
  task.interruptCheck = undefined;
  assert.throws(() => task.check(), err => err.name === 'NeedsSafety' && err.preempted.by === 'creeper' && /Preempted by creeper/.test(err.message));
});

test('a creeper within its fuse\'s reach preempts a running dig; one further off, or in shadow, does not', async () => {
  const { bot, stopped } = stoppable();
  bot._arbiter = { holder: { layer: 'work', action: 'mine', since: Date.now(), ids: [] } };
  const task = new Task('t', 'mine');
  task.stallCheck = () => checkStall(bot);
  let mobs = [mob('creeper', arbiter.CREEPER_REACH + 3, 7)];
  const probe = { ...look(), mobs: () => mobs };
  const logs = [];
  arbiter.watch(bot, { live: true, look: probe, log: line => logs.push(line) });
  try {
    // The dig: a check between blows, as skills.js digs.
    const dig = (async () => { for (;;) { task.check(); await new Promise(r => setTimeout(r, 20)); } })();
    await new Promise(r => setTimeout(r, arbiter.WATCH_MS * 2));
    assert.equal(bot._preempt, undefined, 'out past its reach: the dig goes on');
    mobs = [mob('creeper', arbiter.CREEPER_REACH - 1, 7)];
    await assert.rejects(dig, err => err.name === 'NeedsSafety' && err.preempted.by === 'creeper');
    assert(stopped.includes('dig'));
    assert.match(logs[0], /^\[arbiter\] preempted work mine/);
  } finally { arbiter.unwatch(bot); }
  // Shadow: said over the work, nothing stopped.
  const quiet = stoppable();
  quiet.bot._turn = { holder: 'work', phase: 'mine', since: 0 };
  const said = [];
  assert.equal(arbiter.watchOnce(quiet.bot, { live: false, look: creeperNear(), log: line => said.push(line) }), null);
  assert.equal(quiet.bot._preempt, undefined); assert.deepEqual(quiet.stopped, []);
  assert.match(said[0], /^\[arbiter\] would preempt work mine: creeper back off/);
});

test('the watch: a reflex above the one held preempts it, the same one does not, and a stance Jev chose holds off the mob reflexes', () => {
  const { bot } = stoppable();
  bot._arbiter = { holder: { layer: 'survival', action: 'creeper_back_off', reflex: 'creeper', since: 0, ids: [] } };
  assert.equal(arbiter.watchOnce(bot, { live: true, look: creeperNear(), log: () => {} }), null);
  assert.equal(arbiter.watchOnce(bot, { live: true, look: look({ lava: true }), log: () => {} }).by, 'lava');
  const held = stoppable();
  held.bot._arbiter = { holder: { layer: 'survival', action: 'secure_shelter', since: 0, ids: [] } };
  held.bot._stance = { choice: 'pillar', at: Date.now(), running: true, health: 20 };
  assert.equal(arbiter.watchOnce(held.bot, { live: true, look: creeperNear(), log: () => {} }), null);
  assert.equal(arbiter.watchOnce(held.bot, { live: true, look: look({ fire: true }), log: () => {} }).by, 'fire');
});

test('a hostile newcomer preempts the work once: the ruling was made without it', () => {
  const { bot } = stoppable();
  bot._arbiter = { holder: { layer: 'work', action: 'mine', since: 0, ids: [1] } };
  assert.equal(arbiter.watchOnce(bot, { live: true, look: look({ mobs: [mob('zombie', 5, 1)] }), log: () => {} }), null, 'known when the turn was given');
  assert.equal(arbiter.watchOnce(bot, { live: true, look: look({ mobs: [mob('zombie', 5, 2, false)] }), log: () => {} }), null, 'unseen past four');
  const p = arbiter.watchOnce(bot, { live: true, look: look({ mobs: [mob('zombie', 5, 1), mob('skeleton', 5.5, 3)] }), log: () => {} });
  assert.equal(p.by, 'newcomer'); assert.equal(p.facts.mob, 'skeleton');
});

test('live: at 0.9 health with the shelter set aside, Jev is asked between survival and the work, and the work does not get the turn by default', async () => {
  const bot = world({ health: 0.9, food: 10, time: { timeOfDay: 14000, age: 100000 } });
  const now = Date.now();
  const goal = { kind: 'win', step: { action: 'obtain', item: 'bread' }, survival: { attempts: {
    'act:survival:secure_shelter': { action: 'act', target: 'survival:secure_shelter', why: 'no route to a shelter site', at: now, until: now + 600000, count: 1 } } } };
  const ran = [];
  const runs = { survival: async () => { ran.push('survival'); return false; }, work: async () => { ran.push('work'); return true; } };
  const claims = b => claimsOf(b, goal, { state: goal.survival, currentShelter: () => null }).map(c => c && { ...c, run: runs[c.layer] });
  const asked = [];
  const decide = async (id, q) => { asked.push([id, q]); return { path: ['survival'] }; };
  const turn = await arbiter.take(bot, claims(bot), { decide, mobs: [], now });
  assert.equal(asked.length, 1); assert.equal(asked[0][0], 'turn_priority');
  assert.deepEqual(Object.keys(asked[0][1].tree).sort(), ['survival', 'work']);
  assert.equal(asked[0][1].state.health, 0.9);
  assert.equal(turn.layer, 'survival'); assert.equal(turn.acted, false);
  assert.deepEqual(ran, ['survival'], 'the step did nothing, and the turn stayed with it');
  // Without Jev, the question's own fallback: survival, the more urgent.
  const alone = world({ health: 0.9, food: 10, time: { timeOfDay: 14000, age: 100000 } });
  const byRule = await arbiter.take(alone, claims(alone), { mobs: [], now });
  assert.equal(byRule.layer, 'survival'); assert.equal(byRule.winner.action, 'secure_shelter');
});

test('live: a hungry bot in a renewing shelter plan gets its turn to eat', async () => {
  const bread = { name: 'bread', count: 3 };
  const bot = world({ health: 12, food: 5, time: { timeOfDay: 14000, age: 100000 }, inventory: { items: () => [bread], slots: [] },
    registry: { entitiesByName: {}, foodsByName: { bread: { effectiveQuality: 13 } } } });
  const now = Date.now();
  const goal = { kind: 'win', step: { action: 'mine', item: 'iron_ore' }, survival: { nightPlan: { plan: 'shelter', until: now + 120000 } } };
  const ran = [];
  // The shelter plan renews itself and says it acted, every pass: the old
  // loop never reached the meal behind it.
  const runs = { survival: async () => { ran.push('survival'); return true; }, vitals: async () => { ran.push('vitals'); return true; }, work: async () => { ran.push('work'); return true; } };
  const claims = claimsOf(bot, goal, { state: goal.survival, currentShelter: () => null }).map(c => c && { ...c, run: runs[c.layer] });
  assert.equal(claims[0].action, 'secure_shelter'); assert.equal(claims[1].action, 'eat'); assert.equal(claims[1].urgency, 'pressing');
  let tree;
  const turn = await arbiter.take(bot, claims, { decide: async (id, q) => { tree = q.tree; return { path: ['vitals'] }; }, mobs: [], now });
  assert.deepEqual(tree.vitals.description.cost, { seconds: 1.6 });
  assert.equal(tree.vitals.description.facts.item, 'bread');
  assert.equal(turn.layer, 'vitals'); assert.deepEqual(ran, ['vitals']);
});

test('live: the ruling is held pass after pass and asked again when its winner has done nothing for a while', async () => {
  const bot = fakeBot({ health: 10 });
  let asked = 0, facts;
  const decide = async (id, q) => { asked++; facts = q.tree.survival.description.facts; return { path: ['survival'] }; };
  const claims = () => [claim('survival', 'pressing', { action: 'secure_shelter', run: async () => false }), claim('work')];
  const t0 = 1000000;
  for (let i = 0; i < 20; i++) {
    const turn = await arbiter.take(bot, claims(), { decide, mobs: [], now: t0 + i * 250 });
    assert.equal(turn.layer, 'survival');
    assert.equal(turn.by, i ? 'held' : 'jev');
  }
  assert.equal(asked, 1, 'asked once, not every pass');
  const again = await arbiter.take(bot, claims(), { decide, mobs: [], now: t0 + arbiter.IDLE_MS + 1 });
  assert.equal(again.why, `its winner did nothing for ${arbiter.IDLE_MS / 1000} seconds`);
  assert.equal(asked, 2);
  assert.equal(facts.didNothingWithItSeconds, 10); assert.equal(facts.hasHadTheTurnSeconds, 10);
});

test('live: the survival step still runs first when survival claims nothing, and is said when it acts', async () => {
  const bot = fakeBot();
  const ran = [], lines = [];
  const original = console.log; console.log = line => lines.push(line);
  try {
    const work = () => claim('work', 'routine', { run: async () => { ran.push('work'); return true; } });
    const turn = await arbiter.take(bot, [work()], { backstop: async () => { ran.push('backstop'); return true; }, mobs: [] });
    assert.equal(turn.layer, 'survival'); assert.equal(turn.backstop, true); assert.deepEqual(ran, ['backstop']);
    assert(lines.some(l => /survival acted with no claim, ahead of work/.test(l)));
    const through = await arbiter.take(bot, [work()], { backstop: async () => false, mobs: [] });
    assert.equal(through.layer, 'work'); assert.deepEqual(ran, ['backstop', 'work']);
    // Only for the layers named: runGoal runs the work's backstop itself.
    const own = await arbiter.take(bot, [claim('work')], { backstop: async () => assert.fail('not for the work'), backstopFor: ['vitals'], mobs: [] });
    assert.equal(own.layer, 'work'); assert.equal(own.unclaimed, true);
  } finally { console.log = original; }
});

test('the mode is shadow unless JEV_ARBITER=live', () => {
  const was = process.env.JEV_ARBITER;
  try {
    delete process.env.JEV_ARBITER; assert.equal(arbiter.mode(), 'shadow');
    process.env.JEV_ARBITER = 'live'; assert.equal(arbiter.mode(), 'live');
    process.env.JEV_ARBITER = 'shadow'; assert.equal(arbiter.mode(), 'shadow');
  } finally { if (was === undefined) delete process.env.JEV_ARBITER; else process.env.JEV_ARBITER = was; }
});
