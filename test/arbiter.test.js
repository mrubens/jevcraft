'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const arbiter = require('../src/arbiter');
const { EMERGENCIES } = require('../src/stillness');

const fakeBot = (over = {}) => ({ entity: { position: new Vec3(0, 64, 0) }, health: 20, food: 20, oxygenLevel: 20, entities: {}, ...over });
const claim = (layer, urgency = 'routine', extra = {}) => ({ layer, action: `${layer}_step`, urgency, facts: {}, run: async () => true, ...extra });
const reflex = key => { const r = arbiter.REFLEXES.find(x => x.key === key); return claim(r.layer, 'body', { action: r.action, reflex: key }); };
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
  assert.equal(out.winner.reflex, 'lava'); assert.equal(out.by, 'body'); assert.equal(out.ask, false);
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
  // A newcomer within six blocks (the vitals absent one pass still count:
  // ABSENT_PASSES, note 509).
  assert.equal((await at(3000, { mobs: [mob('zombie', 4, 7)] })).why, 'a newcomer within six blocks');
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

test('a creeper coming on while the work holds the turn is an alert for Jev, not a rule: the shadow says it would ask, and the work was given it', async () => {
  const bot = world();
  bot.entities = { 7: { id: 7, name: 'creeper', type: 'hostile', position: new Vec3(5, 64, 0), height: 1.7, metadata: [] } };
  const goal = { kind: 'win', step: { action: 'mine', item: 'iron_ore' }, survival: {} };
  const survival = { state: goal.survival, currentShelter: () => null };
  const claims = claimsOf(bot, goal, survival);
  // Who answers a creeper is Jev's (the user, 2026-09-27): pressing, with its facts, beside the work.
  assert.equal(claims[0].urgency, 'pressing'); assert.equal(claims[0].alert, 'creeper'); assert.equal(claims[0].reflex, undefined); assert.equal(claims[0].action, 'creeper_back_off');
  assert.equal(claims[0].facts.creeper, 5); assert.equal(claims[0].facts.seen, true);
  const lines = [];
  const turn = arbiter.shadow(bot, () => claims, { log: line => lines.push(line) });
  assert.equal(turn.would.layer, 'survival'); assert.equal(turn.would.ask, true, 'several claims: Jev is asked');
  turn.gave('work');
  assert.equal(lines.length, 1); assert.match(lines[0], /^\[arbiter\] would survival creeper_back_off \(would ask Jev: .*\), gave work$/);
  assert.equal(bot._arbiterShadow.would.action, 'creeper_back_off'); assert.equal(bot._arbiterShadow.would.ask, true);
  assert.equal(bot._arbiterShadow.gave, 'work');
  // Held after Jev would have been asked, the same difference is said once more as held; agreement never is.
  arbiter.shadow(bot, () => claims, { log: line => lines.push(line) }).gave('work');
  arbiter.shadow(bot, () => claims, { log: line => lines.push(line) }).gave('work');
  arbiter.shadow(bot, () => claims, { log: line => lines.push(line) }).gave('survival');
  assert.equal(lines.length, 2); assert.equal(lines[1], '[arbiter] would survival creeper_back_off, gave work');
  // Held to two past the line: the creeper steps back to nine and a half.
  bot.entities[7].position = new Vec3(arbiter.CREEPER_REACH + 1.5, 64, 0);
  assert.equal(require('../src/survival').claim(bot, goal, survival).alert, 'creeper');
  bot._arbiter.reflexes = [];
  assert.notEqual(require('../src/survival').claim(bot, goal, survival)?.alert, 'creeper');
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

test('the mode is live unless JEV_ARBITER=shadow (note 536)', () => {
  const was = process.env.JEV_ARBITER;
  try {
    delete process.env.JEV_ARBITER; assert.equal(arbiter.mode(), 'live');
    process.env.JEV_ARBITER = 'live'; assert.equal(arbiter.mode(), 'live');
    process.env.JEV_ARBITER = 'shadow'; assert.equal(arbiter.mode(), 'shadow');
  } finally { if (was === undefined) delete process.env.JEV_ARBITER; else process.env.JEV_ARBITER = was; }
});

test('turn_priority says each claim in words, and a ruling for the work ends when a mob stops the work (mid-218-n)', () => {
  const survival = { layer: 'survival', action: 'escape_threat', urgency: 'pressing', facts: { health: 7, threat: { name: 'drowned', distance: 5.6, seen: true } } };
  const work = { layer: 'work', action: 'recover_before_nether', urgency: 'routine', facts: { request: 'beat the game', doing: 'recover before nether' } };
  assert.match(arbiter.claimSays(survival), /^Answer the drowned 5\.6 blocks off: the stance is asked next .* Health 7\./);
  assert.match(arbiter.claimSays(work), /^Go on with the work: recover before nether \(toward "beat the game"\)\./);
  const claims = [survival, work];
  const state = { ruling: { winner: 'work', fingerprint: arbiter.fingerprintOf(claims), at: 1000, until: 61000, ids: [], health: 20, band: arbiter.foodBand(undefined) } };
  assert.equal(arbiter.rule(null, claims, { state, now: 2000, mobs: [], dry: true }).by, 'held');
  const stopped = [survival, { ...work, facts: { ...work.facts, lastError: 'Threat nearby: drowned at 5 blocks', lastErrorAt: 1500 } }];
  const r = arbiter.rule(null, stopped, { state, now: 2000, mobs: [], dry: true });
  assert.notEqual(r.by, 'held'); assert.equal(r.ask, true, 'asked again: its winner was stopped');
  // The work's own step changing is not a new question.
  const mining = [survival, { ...work, action: 'mine' }];
  state.ruling = { winner: 'work', fingerprint: arbiter.fingerprintOf(claims), at: 1000, until: 61000, ids: [], health: 20, band: arbiter.foodBand(undefined) };
  assert.equal(arbiter.rule(null, mining, { state, now: 2000, mobs: [], dry: true }).by, 'held');
});

test('an alert does not stop the layer it would give the turn to, and a layer changing its own action is not a new question (mid-236-j)', () => {
  const creeper = { key: 'creeper', layer: 'survival', action: 'creeper_back_off' };
  const bot = { entity: { position: new Vec3(0, 64, 0) }, _stance: null };
  assert.equal(arbiter.outranks(bot, creeper, { layer: 'survival', action: 'secure_shelter' }), false, 'survival answers its own creeper');
  assert.equal(arbiter.outranks(bot, creeper, { layer: 'work', action: 'mine' }), true, 'the work is stopped for it');
  assert.equal(arbiter.outranks(bot, { key: 'lava', layer: 'survival', action: 'leave_lava' }, { layer: 'vitals', action: 'eat' }), true);
  const a = [{ layer: 'survival', action: 'secure_shelter' }, { layer: 'work', action: 'mine' }];
  const b = [{ layer: 'survival', action: 'pocket_next' }, { layer: 'work', action: 'craft' }];
  assert.equal(arbiter.fingerprintOf(a), arbiter.fingerprintOf(b));
  const c = [{ layer: 'survival', action: 'creeper_back_off', alert: 'creeper' }, { layer: 'work', action: 'mine' }];
  assert.notEqual(arbiter.fingerprintOf(a), arbiter.fingerprintOf(c), 'an alert coming is');
});

test('any winner stopped by a mob ends its ruling, not only the work (mid-218-q)', async () => {
  const state = {};
  const stop = Object.assign(new Error('Threat nearby: drowned at 5 blocks'), { name: 'NeedsSafety' });
  const vitals = { layer: 'vitals', action: 'surface', urgency: 'pressing', facts: { air: 18 }, run: async () => { throw stop; } };
  const survival = { layer: 'survival', action: 'escape_threat', urgency: 'pressing', facts: { threat: { name: 'drowned', distance: 5, seen: true } }, run: async () => true };
  const claims = [vitals, survival];
  state.ruling = { winner: 'vitals', fingerprint: arbiter.fingerprintOf(claims), at: 1000, until: Date.now() + 60000, ids: [], health: 20, band: arbiter.foodBand(undefined) };
  await assert.rejects(arbiter.take(null, claims, { state, mobs: [], decide: async () => ({ path: ['vitals'] }) }), /Threat nearby/);
  const again = arbiter.rule(null, claims, { state, mobs: [], dry: true });
  assert.notEqual(again.by, 'held'); assert.equal(again.ask, true, 'asked again after the stop');
});

test('a layer whose turns were each stopped at once by the threat check says so at the next asking, with what the check finds now; the work is said with the health and the mobs about (mid-242-ab-nether-3, note 585)', async () => {
  // In a sealed pocket at 10.6 health the meal was given the turn 41 times in six seconds: each time its threat check
  // found a blaze the seal was chosen against, out of sight behind the wall, and stopped it before a bite, and the
  // meal's option said only "Eat beef now". At 2.5 health, the work was offered as "Go on with the work: find fortress"
  // with two blazes 3.4 and 3.9 blocks off out of sight, taken, and walked into their fire.
  const bot = fakeBot({ health: 10.6, food: 17, inventory: { slots: [] } });
  const state = {};
  const stop = Object.assign(new Error('Threat nearby: blaze at 6 blocks'), { name: 'NeedsSafety' });
  const vitals = { layer: 'vitals', action: 'eat', urgency: 'routine', facts: { health: 10.6, food: 17, healing: false, item: 'beef', foodPoints: 3 }, cost: { seconds: 1.6 }, run: async () => { throw stop; } };
  const survival = { layer: 'survival', action: 'pocket_next', urgency: 'routine', facts: { health: 10.6, food: 17, healing: false, inPocket: true }, run: async () => true };
  const work = { layer: 'work', action: 'find_fortress', urgency: 'routine', facts: { request: 'beat the game', doing: 'find fortress' }, run: async () => true };
  const blaze = mob('blaze', 6.2, 9, false);
  const was = arbiter.probe.threatNow;
  arbiter.probe.threatNow = () => ({ ...blaze, stance: 'seal' });
  try {
    const trees = [];
    const decide = async (id, { tree }) => { trees.push(tree); return { path: ['vitals'] }; };
    for (let i = 0; i < 3; i++) await assert.rejects(arbiter.take(bot, [survival, vitals, work], { state, mobs: [blaze], decide }), /Threat nearby/);
    assert.equal(trees.length, 3, 'asked again after each stop');
    assert.equal(trees[0].vitals.description.does, 'Eat beef now, about 1.6 seconds standing still. Health 10.6. Hunger 17 to 20. It does not come back at hunger 17.');
    assert.match(trees[1].vitals.description.does, /Its last turn was stopped at once by the threat check its run is given: Threat nearby: blaze at 6 blocks\. That check still finds one now: the blaze 6 blocks off \(out of sight\), one the seal stance was chosen against; given the turn again, it is stopped again at once\.$/);
    assert.match(trees[2].vitals.description.does, /Its last 2 turns, in the last 1 second, were each stopped at once/);
    assert.match(trees[2].vitals.description.facts.stoppedAtOnce, /stopped again at once/);
    assert(!/stopped/.test(trees[2].survival.description.does), 'only the layer that was stopped');
    assert.match(trees[0].work.description.does, /^Go on with the work: find fortress \(toward "beat the game"\)\. Health 10\.6: it does not come back at hunger 17\. Mobs within sixteen blocks now: a blaze 6\.2 blocks off \(out of sight\), about [\d.]+ a hit through the armour worn\.$/);
    // With nothing found by the check now, that is said.
    arbiter.probe.threatNow = () => undefined;
    const tree = (await (async () => { let t; await arbiter.arbitrate(bot, [survival, vitals], { state, mobs: [], decide: async (id, { tree: x }) => { t = x; return { path: ['survival'] }; }, run: false }); return t; })());
    assert.match(tree.vitals.description.does, /That check finds nothing now\.$/);
  } finally { arbiter.probe.threatNow = was; }
});

test('a ruling for the work that the loop marks stopped is asked again (mid-236-k)', () => {
  const work = { layer: 'work', action: 'fill_bucket', urgency: 'routine', facts: {} };
  const survival = { layer: 'survival', action: 'escape_threat', urgency: 'pressing', facts: { threat: { name: 'skeleton', distance: 9, seen: true } } };
  const claims = [work, survival];
  const state = { ruling: { winner: 'work', fingerprint: arbiter.fingerprintOf(claims), at: 1000, until: Date.now() + 60000, ids: [], health: 20, band: arbiter.foodBand(undefined) } };
  assert.equal(arbiter.rule(null, claims, { state, mobs: [], dry: true }).by, 'held');
  state.ruling.stoppedBy = 'Threat nearby: skeleton at 9 blocks';
  assert.equal(arbiter.rule(null, claims, { state, mobs: [], dry: true }).ask, true);
});

test('hurt at 5.5 with a blaze in sight 16.5 blocks off whose fireballs land, survival claims it, said with its reach (mid-235-p-fortress-1)', () => {
  const bot = world({ health: 5.5, food: 16 });
  bot.game.dimension = 'the_nether';
  bot.entities = { 39: { id: 39, name: 'blaze', type: 'hostile', position: new Vec3(16.5, 64, 0), height: 1.8, metadata: [] } };
  bot._hurtBy = { blaze: Date.now() - 8000 }; bot._recentHurtAt = Date.now() - 8000;
  const goal = { kind: 'win', step: { action: 'find_fortress' }, mobHunt: { entity: 'blaze', item: 'blaze_rod', targetCount: 8 }, survival: {} };
  const mine = require('../src/survival').claim(bot, goal, { state: goal.survival, currentShelter: () => null });
  assert.equal(mine?.action, 'escape_threat', 'survival claims the shooter whose fire reaches here');
  assert.equal(mine.urgency, 'pressing');
  // Said with the chance its fire lands from there, the game's scatter.
  assert.deepEqual(mine.facts.threat, { name: 'blaze', distance: 16.5, seen: true, shoots: true, reach: 48, fireballLandsPer100: 24, volleyLandsOnePer100: 56, volleysMostlyLandWithin: 22, hitItSecondsAgo: 8 });
  assert.equal(mine.facts.healing, false);
  assert.match(arbiter.claimSays(mine), /^Answer the blaze 16\.5 blocks off, which fires from as far as 48 blocks \(from here each fireball lands about 24 in 100, a volley of three at least one about 56 in 100; its volleys land more often than not within about 22\) and hit the bot 8 seconds ago: the stance is asked next .* Health 5\.5\. It does not come back at hunger 16\.$/);
});

test('turn_priority says the hunt and every other claim in words, none as its bare code (mid-235-p-fortress-1)', () => {
  const hunt = { layer: 'hunt', action: 'hunt', urgency: 'routine', facts: { entity: 'blaze', distance: 16.5, item: 'blaze_rod', have: 0, want: 8, health: 5.5 } };
  assert.match(arbiter.claimSays(hunt), /^Hunt the blaze 16\.5 blocks off for blaze rods \(0 of 8 carried\): close on it and fight it.* Health 5\.5\.$/);
  const actions = { survival: ['escape_threat', 'creeper_back_off', 'leave_lava', 'pocket_next', 'night_hunt', 'recover_items', 'secure_shelter', 'go_home_for_night', 'obtain_food'],
    vitals: ['out_of_fire', 'dig_out_of_block', 'swim_up', 'out_of_powder_snow', 'surface', 'eat'], hunt: ['hunt'] };
  for (const [layer, list] of Object.entries(actions)) for (const action of list) {
    const says = arbiter.claimSays({ layer, action, urgency: 'routine', facts: { health: 9, food: 12 } });
    assert.doesNotMatch(says, new RegExp(`^${layer}: `), `${layer} ${action} is said in words: ${says}`);
  }
});

test('a claim that drops out for one pass does not re-ask each pass; absent two, its absence counts (mid-235-p-fortress-1)', async () => {
  let asked = 0;
  const decide = async () => { asked++; return { path: ['survival'] }; };
  const bot = fakeBot({ health: 5.5, food: 16 });
  const survival = () => claim('survival', 'pressing', { action: 'escape_threat' }), hunt = () => claim('hunt'), work = () => claim('work');
  const state = {};
  const pass = (claims, now) => arbiter.take(bot, claims, { state, decide, mobs: [], now });
  assert.equal((await pass([survival(), hunt(), work()], 0)).by, 'jev');
  // The blaze drifts past a reach and back: the winner out one pass is a
  // breath, not a question, and the ruling stands.
  const out = await pass([hunt(), work()], 250);
  assert.equal(out.by, 'absent'); assert.equal(out.layer, null); assert.equal(out.acted, false);
  assert.equal((await pass([survival(), hunt(), work()], 500)).by, 'held');
  // The hunt's target coming and going past its twenty-four blocks.
  for (let i = 0; i < 6; i++) {
    const turn = await pass(i % 2 ? [survival(), hunt(), work()] : [survival(), work()], 750 + i * 250);
    assert.equal(turn.by, 'held'); assert.equal(turn.layer, 'survival');
  }
  assert.equal(asked, 1, 'asked once, not at each coming and going');
  // Gone two passes, its absence counts.
  await pass([hunt(), work()], 3000);
  const again = await pass([hunt(), work()], 3250);
  assert.equal(again.why, 'its winner no longer claims'); assert.equal(asked, 2);
});

test('a mob held by a stance chosen against it is said with the stance, which goes on, and the survival claim holds it (mid-242-a, note 535)', () => {
  const { Vec3 } = require('vec3');
  const { claim } = require('../src/survival');
  const zombie = { id: 11, name: 'zombie', type: 'hostile', position: new Vec3(8.5, 76, 0.5), height: 1.95, width: 0.6, isValid: true };
  const bot = { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, entity: { position: new Vec3(0.5, 78, 0.5) }, registry: require('minecraft-data')('26.1'),
    health: 17.4, food: 16, time: { timeOfDay: 20000 }, world: { raycast: from => ({ position: from.floored(), intersect: from }) },
    blockAt: p => ({ position: p, name: p.y < 76 ? 'stone' : 'air', boundingBox: p.y < 76 ? 'block' : 'empty' }), entities: { 11: zombie }, inventory: { items: () => [], slots: [] } };
  assert.notEqual(claim(bot, {})?.action, 'escape_threat', 'with no stance, the night is the claim');
  bot._stance = { choice: 'pillar', ids: [11], at: Date.now() - 1000, ranAt: Date.now(), health: 17.4, expects: { damage: 14.8, seconds: 15 } };
  const held = claim(bot, {});
  assert.equal(held.action, 'escape_threat');
  assert.deepEqual(held.facts.stance, { choice: 'pillar', secondsAgo: 1 });
  assert.match(arbiter.claimSays(held), /^Answer the zombie 8\.2 blocks off \(out of sight\): the pillar chosen against it 1 second ago goes on \(asked again when it fails/);
});

// mid-243-q-nether-3 (note 539): turn_priority asked with an enderman two
// blocks off never came back; six seconds of "asking Jev", hit from twenty
// to seven, no layer acting, knocked into lava.
const never = () => new Promise(() => {});
const within = (p, ms = 2000) => Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error(`still waiting after ${ms} ms`)), ms).unref())]);

test('a turn_priority question that does not come back is cut when the bot is hurt: survival takes the turn by the rules', async () => {
  const bot = fakeBot();
  const ran = [];
  const claims = [claim('work', 'routine', { run: async () => { ran.push('work'); return true; } }),
    claim('survival', 'pressing', { action: 'escape_threat', run: async () => { ran.push('survival'); return true; } })];
  setTimeout(() => { bot._recentHurtAt = Date.now(); }, 60).unref();
  const out = await within(arbiter.take(bot, claims, { state: bot._arbiter = {}, decide: never, mobs: [] }));
  assert.equal(out.layer, 'survival'); assert.equal(out.by, 'rules'); assert.match(out.cut, /hurt/);
  assert.deepEqual(ran, ['survival']);
});

test('a turn_priority question ends when the task check throws, even if the question itself never settles', async () => {
  const bot = fakeBot();
  let stop = false;
  const task = { check() { if (stop) { const e = new Error('Preempted by newcomer'); e.name = 'NeedsSafety'; throw e; } } };
  setTimeout(() => { stop = true; }, 60).unref();
  await assert.rejects(within(arbiter.take(bot, [claim('work'), claim('survival', 'pressing')], { state: bot._arbiter = {}, decide: never, task, mobs: [] })), { name: 'NeedsSafety' });
});

test('a turn_priority question with no answer in its time is given by the rules, and asked again soon', async () => {
  const bot = fakeBot();
  const out = await within(arbiter.take(bot, [claim('work'), claim('survival', 'pressing')], { state: bot._arbiter = {}, decide: never, askMs: 100, mobs: [] }));
  assert.equal(out.layer, 'survival'); assert.match(out.cut, /no answer/);
  assert(bot._arbiter.ruling.until - bot._arbiter.ruling.at <= arbiter.IDLE_MS);
});

test('a newcomer picked up is known to the holder: the same mob coming closer does not preempt again', () => {
  const { bot } = stoppable();
  bot._arbiter = { holder: { layer: 'work', action: 'find_fortress', since: 0, ids: [] } };
  const p = arbiter.watchOnce(bot, { live: true, look: look({ mobs: [mob('enderman', 4, 4414)] }), log: () => {} });
  assert.equal(p.by, 'newcomer');
  arbiter.rule(bot, [claim('work'), claim('survival', 'pressing')], { state: bot._arbiter, mobs: [] });
  assert.equal(bot._preempt, undefined);
  assert.equal(arbiter.watchOnce(bot, { live: true, look: look({ mobs: [mob('enderman', 2, 4414)] }), log: () => {} }), null);
});

// Note 540: mid-243-q-nether-3 was knocked into lava with a newcomer's
// preemption waiting, and the watch looked at nothing while it waited.
test('while a preemption waits, the body\'s physics is still watched and takes its place; newcomers and alerts are not', () => {
  const { bot, stopped } = stoppable();
  bot._arbiter = { holder: { layer: 'work', action: 'find_fortress', since: 0, ids: [] } };
  const lines = [];
  const waiting = arbiter.watchOnce(bot, { live: true, look: look({ mobs: [mob('enderman', 4, 4414)] }), log: line => lines.push(line) });
  assert.equal(waiting.by, 'newcomer');
  stopped.length = 0;
  // Another newcomer, and a creeper within its fuse's reach: the one waiting
  // stands, nothing is stopped again (note 539's loop stays shut).
  assert.equal(arbiter.watchOnce(bot, { live: true, look: look({ mobs: [mob('enderman', 2, 4414), mob('zombie', 3, 9)] }), log: line => lines.push(line) }), waiting);
  assert.equal(arbiter.watchOnce(bot, { live: true, look: creeperNear(), log: line => lines.push(line) }), waiting);
  assert.deepEqual(stopped, []);
  // Knocked into lava: the lava takes the newcomer's place and the holder
  // is stopped again; the newcomer's id is kept for the ruling.
  const lava = arbiter.watchOnce(bot, { live: true, look: look({ lava: true, mobs: [mob('enderman', 2, 4414)] }), log: line => lines.push(line) });
  assert.equal(lava.by, 'lava'); assert.equal(lava.waited, 'newcomer'); assert.equal(lava.id, 4414); assert.equal(lava.over, 'work find_fortress');
  assert.equal(bot._preempt, lava);
  assert.deepEqual(stopped.sort(), ['dig', 'keys', 'walk']);
  assert.match(lines.at(-1), /^\[arbiter\] preempted work find_fortress again, newcomer waiting/);
  assert.throws(() => checkStall(bot), err => err.name === 'NeedsSafety' && err.preempted.by === 'lava');
  // Fire ranks below the lava: the lava stands.
  assert.equal(arbiter.watchOnce(bot, { live: true, look: look({ lava: true, fire: true }), log: () => {} }), lava);
  // The arbiter picks up the lava, gives it the turn, and knows the enderman.
  const out = arbiter.rule(bot, [reflex('lava'), claim('work'), claim('survival', 'pressing')], { state: bot._arbiter, mobs: [] });
  assert.equal(out.winner.reflex, 'lava'); assert.equal(bot._preempt, undefined);
  assert(bot._arbiter.holder.ids.includes(4414));
});

test('a waiting alert gives way to the body\'s physics, and a waiting reflex to one above it only', () => {
  const { bot } = stoppable();
  bot._arbiter = { holder: { layer: 'work', action: 'mine', since: 0, ids: [] } };
  assert.equal(arbiter.watchOnce(bot, { live: true, look: creeperNear(), log: () => {} }).by, 'creeper');
  assert.equal(arbiter.watchOnce(bot, { live: true, look: look({ fire: true }), log: () => {} }).by, 'fire');
  assert.equal(arbiter.watchOnce(bot, { live: true, look: look({ head: true }), log: () => {} }).by, 'fire', 'the head in a block ranks below the fire');
  assert.equal(arbiter.watchOnce(bot, { live: true, look: look({ lava: true }), log: () => {} }).by, 'lava');
});

test('with a turn_priority question out and a newcomer waiting, the watch still takes up the lava', async () => {
  const { bot } = stoppable();
  bot._arbiter = { holder: { layer: 'work', action: 'find_fortress', since: 0, ids: [] } };
  const task = new Task('t', 'win');
  task.stallCheck = () => checkStall(bot);
  let inLava = false;
  arbiter.watch(bot, { live: true, look: { ...look(), inLava: () => inLava }, log: () => {} });
  try {
    const asked = arbiter.take(bot, [claim('work'), claim('survival', 'pressing')], { state: bot._arbiter, decide: never, task, mobs: [], askMs: 60000 });
    // The question is out; the enderman a step closer waits as a newcomer's
    // preemption, then the knock into the lava.
    bot._preempt = { by: 'newcomer', id: 77, over: 'work find_fortress', at: Date.now() };
    inLava = true;
    await assert.rejects(within(asked), err => err.name === 'NeedsSafety');
    await new Promise(r => setTimeout(r, arbiter.WATCH_MS * 2));
    assert.equal(bot._preempt.by, 'lava'); assert.equal(bot._preempt.id, 77);
  } finally { arbiter.unwatch(bot); }
});
