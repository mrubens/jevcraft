'use strict';
// Note 782: one portal plan. The way to a portal is one question
// (portal_plan), each option a whole route priced end to end, held until a
// named fact changes; the lava fetch follows the plan's lava with no
// switching of its own; lava_way, the stall's routes to other lava, the
// twenty-minute clock, the lava a third farther and the slow-trip re-asks
// are gone (src/portal-plan.js, src/work.js portalMethod, src/obsidian.js
// collectLava).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const PP = require('../src/portal-plan');
const registry = require('minecraft-data')('26.1');

const botWith = (items, at = new Vec3(0.5, 64, 0.5)) => ({ registry, game: { dimension: 'overworld' }, health: 20, food: 20, entity: { position: at },
  inventory: { items: () => items }, findBlocks: () => [], blockAt: p => ({ name: p.y < 64 ? 'stone' : 'air', position: p, boundingBox: p.y < 64 ? 'block' : 'empty' }) });

test('a route is priced end to end: buckets made first only where they shorten it, both said', () => {
  // One bucket, nine ingots, trips of four minutes: three more buckets save far more than they cost.
  const p = PP.priceCast({ reach: 60, trip: 240, cast: 10, toFetch: 10, carriers: 1, ingots: 9, raw: 0 });
  assert.equal(p.make, 3);
  assert.equal(p.trips, 3);
  assert.equal(p.seconds, 60 + 15 + 3 * 240 + 10 * PP.CAST_RECORD.secondsABlock);
  assert.equal(p.carried.trips, 10);
  assert.match(PP.priceSays(p), /^Priced end to end, about \d+ minutes: getting there about 60 seconds; 3 more buckets made first, about 15 seconds; 3 trips with 4 buckets, a trip for lava about 4 minutes each; casting the blocks about 2 minutes \(12 seconds a block at the record's pace\)\. With only the 1 bucket carried it would be 10 trips, about \d+ minutes in all\.$/);
  // Enough buckets carried for the lava owed: none made.
  assert.equal(PP.priceCast({ reach: 300, trip: 25, cast: 10, toFetch: 10, carriers: 10, ingots: 9 }).make, 0);
  // Raw iron smelted first, at ten seconds an ingot.
  const raw = PP.priceCast({ trip: 240, cast: 10, toFetch: 10, carriers: 1, ingots: 0, raw: 9 });
  assert.equal(raw.makeSeconds, 15 + 9 * 10);
  // No bucket and no iron: not priced, and said so.
  assert.match(PP.priceSays(PP.priceCast({ trip: 60, cast: 10, toFetch: 10, carriers: 0 })), /^Not priced: no bucket is carried and no iron to make one/);
});

test('the plan is asked again only when a named fact changes, each said', () => {
  const items = [{ name: 'bucket', count: 2 }, { name: 'water_bucket', count: 1 }];
  const bot = botWith(items);
  const goal = { survival: { deaths: [] } };
  assert.equal(PP.planDue(bot, goal).kind, 'none', 'no plan held: asked');
  goal.portalMethod = { kind: 'cast', key: 'here_deep', lava: { way: 'deep' }, minutes: 25, activeMs: 0 };
  assert.match(PP.planDue(bot, goal).why, /chosen before the plan question/, 'a way held from before the plan is asked once');
  goal.portalMethod.facts = PP.planFacts(bot, goal, { lavaDistance: 60 });
  assert.equal(PP.planDue(bot, goal, { planDistance: 60 }), null, 'nothing changed: held');
  // Buckets made since: held, the count kept higher.
  items[0].count = 4;
  assert.equal(PP.planDue(bot, goal, { planDistance: 60 }), null);
  assert.equal(goal.portalMethod.facts.carriers, 5);
  // Buckets lost.
  items[0].count = 1;
  assert.match(PP.planDue(bot, goal, { planDistance: 60 }).why, /^buckets lost: 2 carried \(empty, lava and water\), 5 before$/);
  items[0].count = 4;
  // Lava found nearer, not known when it was chosen: said once.
  const fresh = [{ at: { x: 30, y: 63, z: 0 }, distance: 30, how: 'pool' }];
  assert.match(PP.planDue(bot, goal, { planDistance: 60, lavaNow: fresh }).why, /^lava found at \(30, 63, 0\) \(pool\), 30 blocks off, nearer than the plan's lava \(60\)$/);
  assert.equal(PP.planDue(bot, goal, { planDistance: 60, lavaNow: [] }), null);
  // Farther lava is no fact.
  assert.equal(PP.planDue(bot, goal, { planDistance: 60, lavaNow: [{ at: { x: 90, y: 63, z: 0 }, distance: 90 }] }), null);
  // The frame: losing obsidian, or gone.
  goal.portalFrame = { origin: { x: 5, y: 64, z: 5 }, blocks: [] };
  assert.equal(PP.planDue(bot, goal, { planDistance: 60, standing: 4 }), null);
  assert.equal(goal.portalMethod.facts.frame.standing, 4);
  assert.match(PP.planDue(bot, goal, { planDistance: 60, standing: 3 }).why, /^the frame at \(5, 64, 5\) has lost obsidian: 3 of ten standing, 4 before$/);
  delete goal.portalFrame;
  assert.match(PP.planDue(bot, goal, { planDistance: 60 }).why, /^the frame at \(5, 64, 5\), 4 of ten cast, is gone$/);
  goal.portalMethod.facts.frame = null;
  // A death.
  goal.survival.deaths.push({ at: new Date().toISOString() });
  assert.equal(PP.planDue(bot, goal, { planDistance: 60 }).kind, 'death');
  goal.portalMethod.facts.lastDeathAt = Date.parse(goal.survival.deaths[0].at);
  // Its own stated minutes worked through (ten at least).
  goal.portalMethod.activeMs = 24 * 60000;
  assert.equal(PP.planDue(bot, goal, { planDistance: 60 }), null);
  goal.portalMethod.activeMs = 26 * 60000;
  assert.match(PP.planDue(bot, goal, { planDistance: 60 }).why, /^its own stated 25 minutes worked through \(26 minutes worked\) and no portal lit$/);
  goal.portalMethod.activeMs = 0;
  // The route failed: said with what failed, and kept on the plan's failures.
  PP.planFailed(goal, 'the pool at (30, 63, 0): it was found with no lava to take');
  assert.match(PP.planDue(bot, goal).why, /^the route failed: the pool at \(30, 63, 0\)/);
  assert.match(PP.failuresSays(goal, { key: 'here_deep' }), /^ Chosen before and failed: \d+ minutes? ago, the pool at \(30, 63, 0\)/);
  assert.equal(PP.failuresFor(goal, { lava: { deep: true } }).length, 1, 'the deep route\'s record has it');
});

test('the plan asked at the rung\'s start is held across passes: no portal question again while nothing named changes (note 782)', async () => {
  const { portalStep } = require('../src/work');
  const { Task } = require('../src/skills');
  const items = [{ name: 'bucket', count: 3 }, { name: 'water_bucket', count: 1 }, { name: 'cobblestone', count: 64 }, { name: 'stone_pickaxe', count: 1 }];
  const bot = { ...botWith(items), entities: {}, oxygenLevel: 20, game: { dimension: 'overworld', gameMode: 'survival' }, world: { raycast: () => null },
    pathfinder: { movements: {}, setGoal() {}, stop() {}, goto: async () => { throw new Error('No path to the goal'); } }, chat() {}, on() {}, off() {}, removeListener() {} };
  bot.blockAt = p => ({ name: p.y < 64 ? 'stone' : 'air', position: p.floored ? p.floored() : p, boundingBox: p.y < 64 ? 'block' : 'empty', getProperties: () => ({ level: 0 }) });
  const goal = { kind: 'win', survival: { deaths: [] }, gameProgress: { phase: 'reach_nether' }, landmarks: [{ kind: 'lava_pool', dimension: 'overworld', x: 40, y: 63, z: 0 }] };
  const asked = [];
  const task = new Task('nether');
  task.opportunityClient = { systemOne: async ({ questions }) => { const keys = Object.keys(questions.branch_0.criteria); asked.push(keys); return { answers: { branch_0: { choice: keys.find(k => /^beside_pool_/.test(k)) || keys[0], confidence: 0.8 } } }; } };
  for (let i = 0; i < 5; i++) await portalStep(bot, task, goal, () => {}, task.opportunityClient).catch(() => {});
  const plans = asked.filter(k => k.some(x => /^(here|beside)_/.test(x)));
  assert.equal(plans.length, 1, `the plan asked once: ${JSON.stringify(asked)}`);
  assert.match(goal.portalMethod.key, /^beside_pool_\d+$/);
  // A bucket lost (a lava bucket dropped in a fall, say): asked again, with that said.
  let state = null;
  task.opportunityClient = { systemOne: async ({ questions, state: s }) => { state = s; const keys = Object.keys(questions.branch_0.criteria); asked.push(keys); return { answers: { branch_0: { choice: keys.find(k => /^beside_pool_/.test(k)) || keys[0], confidence: 0.8 } } }; } };
  items[0].count = 1;
  await portalStep(bot, task, goal, () => {}, task.opportunityClient).catch(() => {});
  assert.match(state?.askedAgainBecause || '', /^buckets lost: 2 carried/);
});

test('the questions it replaced are gone: no lava_way or portal_method, and the stall offers no route to other lava of its own', () => {
  const { QUESTIONS } = require('../src/decisions');
  const ids = [...(QUESTIONS?.keys?.() || [])];
  const { question } = require('../src/decisions');
  assert.throws(() => question('lava_way'), /No decision is defined as lava_way/);
  assert.throws(() => question('portal_method'), /No decision is defined as portal_method/);
  const plan = question('portal_plan');
  assert.equal(plan.parent, 'rung_progress');
  const stall = question('stillness_detour').options.map(o => o.key);
  for (const k of ['to_known_lava', 'to_other_lava', 'dig_to_lava', 'cast_at_pool']) assert(!stall.includes(k), k);
  assert(stall.includes('replan_portal'));
  assert(ids.length === 0 || !ids.includes('lava_way'));
});

test('scripts/portal-plan.js counts the asks and plan changes before and replays the rung under the plan', () => {
  const { measure, slim } = require('../scripts/portal-plan');
  const t0 = Date.parse('2026-10-01T01:00:00Z');
  const at = s => new Date(t0 + s * 1000).toISOString();
  const raw = [];
  const decision = (s, id, path, said = '', state = {}) => raw.push({ kind: 'decision', at: at(s), snapshot: { position: { x: 0, y: 64, z: 0 }, dimension: 'overworld', decision: { id, path, options: { a: { description: said } }, state } } });
  const chat = (s, message) => raw.push({ kind: 'chat', at: at(s), detail: { from: 'Jev', message }, snapshot: { position: { x: 0, y: 64, z: 0 }, dimension: 'overworld' } });
  const step = (s, action, inv) => raw.push({ kind: 'observation', at: at(s), snapshot: { position: { x: 0, y: 64, z: 0 }, dimension: 'overworld', health: 20, step: { action }, ...(inv ? { inventory: inv } : {}) } });
  decision(0, 'portal_method', ['cast_at_lava']);
  step(1, 'fill_bucket', { bucket: 2 });
  chat(2, 'Walking to the lava pool at (100, 60, 0), 100 blocks off, about 3 minutes.');
  chat(200, 'Walking to the lava pool at (-80, 60, 0), 80 blocks off, about 2 minutes.'); // the fetch's own switch
  decision(260, 'lava_way', ['deep']);
  decision(300, 'portal_method', ['cast_frame'], '3 walks toward it came no nearer than 40 blocks');
  step(400, 'fill_bucket', { bucket: 1, lava_bucket: 1 });
  raw.push({ kind: 'observation', at: at(500), snapshot: { position: { x: 0, y: 64, z: 0 }, dimension: 'nether', health: 20 } });
  const frames = raw.map(o => slim(o, Date.parse(o.at)));
  const r = measure(frames);
  assert.equal(r.asks.portal_method, 2);
  assert.equal(r.asks.lava_way, 1);
  assert.equal(r.unaskedBefore, 1, 'the fetch\'s own switch');
  assert.deepEqual(r.changeWhys, ['lava named moved unasked', 'portal_method: cast_at_lava -> cast_frame']);
  assert.equal(r.asksAfter, 2, 'the rung begins, and the route failed');
  assert.deepEqual(Object.keys(r.whyAfter).sort(), ['the route failed', 'the rung begins']);
  assert.equal(r.reachedNether, true);
  assert.equal(r.obsidian, 10);
});
