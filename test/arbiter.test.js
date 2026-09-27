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
