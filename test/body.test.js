'use strict';
// Note 549: the body's own dangers (lava, fire, a head in a block, the
// breath) are asked of Jev (body_way), and the encounter's first moves (the
// span's hold, the step off an edge, the swing, the shield) are the stance's
// when Jev can be reached.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('node:events');
const { Task } = require('../src/skills');
const { Survival } = require('../src/survival');
const body = require('../src/body');
const arbiter = require('../src/arbiter');
const vitals = require('../src/vitals');
const guard = require('../src/projectile-guard');

const air = p => ({ position: p, name: 'air', boundingBox: 'empty' });

test('body_way: Jev\'s way is run at once, and burning left to burn out is held', async () => {
  const bot = { health: 16, entity: { position: new Vec3(0, 64, 0) } };
  const ran = [];
  const ways = {
    douse_bucket: { description: 'pour', run: async () => { ran.push('douse'); return true; } },
    burn_out: { description: 'leave it', hold: 15, run: async () => { ran.push('burn'); return false; } },
  };
  let asked;
  const decide = async (id, q) => { asked = { id, ...q }; return { path: ['burn_out'] }; };
  const r = await body.answer(bot, new Task('t'), 'fire', ways, { client: {}, decide, facts: { inFire: false } });
  assert.equal(asked.id, 'body_way');
  assert.equal(asked.context.default, 'douse_bucket', 'the old rule\'s way is the fallback');
  assert.match(asked.state.says, /Alight at 16 health/);
  assert.deepEqual(ran, ['burn']);
  assert.equal(r.by, 'jev');
  assert.ok(body.held(bot, 'fire'), 'held as Jev\'s choice');
  bot.health = 11;
  assert.equal(body.held(bot, 'fire'), null, 'asked again once four more health is gone');
});

test('body_way: no answer within a second takes the old order\'s way, and holds nothing', async () => {
  const bot = { health: 16, entity: { position: new Vec3(0, 64, 0) } };
  const ran = [];
  const ways = {
    to_water: { description: 'water', run: async () => { ran.push('water'); return true; } },
    burn_out: { description: 'leave it', hold: 15, run: async () => { ran.push('burn'); return false; } },
  };
  const decide = async () => { throw Object.assign(new Error('body_way: no answer in 1 seconds'), { name: 'CutShort' }); };
  const r = await body.answer(bot, new Task('t'), 'fire', ways, { client: {}, decide, log: () => {} });
  assert.deepEqual(ran, ['water']);
  assert.equal(r.by, 'fallback');
  assert.equal(body.held(bot, 'fire'), null);
});

test('burning out as the one way is taken without asking and held, not taken again at every step', async () => {
  // mid-242-aa-nether-1-fortress-1 (note 560): alight in the Nether, no apple, burn_out the only way, "asked" forty
  // times in fifteen minutes.
  const bot = { health: 16, entity: { position: new Vec3(0, 64, 0) } };
  const ran = [];
  const ways = { burn_out: { description: 'leave it', hold: 15, run: async () => { ran.push('burn'); return false; } } };
  const goal = {};
  const r = await body.answer(bot, new Task('t'), 'fire', ways, { client: { systemOne: () => assert.fail('one way is not asked') }, goal, facts: { inFire: false }, log: () => {} });
  assert.equal(r.by, 'only');
  assert.deepEqual(ran, ['burn']);
  assert.ok(body.held(bot, 'fire'), 'held: the survival step and the reflex leave it be');
  assert.equal((goal.decisions || []).length, 0, 'not recorded as a question asked');
});

test('a burn-out Jev chose is not a reflex while it holds; in the fire it still is', () => {
  const bot = { health: 15, oxygenLevel: 20, entities: {}, entity: { position: new Vec3(0.5, 64, 0.5), metadata: [1] }, game: { dimension: 'overworld' },
    inventory: { items: () => [{ name: 'water_bucket', count: 1 }] },
    blockAt: p => (p.y < 64 ? { position: p, name: 'stone', boundingBox: 'block' } : air(p)) };
  assert.deepEqual(arbiter.observeReflexes(bot, []).map(r => r.key), ['fire'], 'alight with water at hand, nothing chosen: the body\'s danger');
  bot._bodyHeld = { key: 'fire', choice: 'burn_out', at: Date.now(), until: Date.now() + 15000, health: 15 };
  assert.deepEqual(arbiter.observeReflexes(bot, []).map(r => r.key), [], 'left to burn out: the turn is not taken from the work for it');
  bot._inFireAt = Date.now();
  assert.deepEqual(arbiter.observeReflexes(bot, []).map(r => r.key), ['fire'], 'standing in fire is not what was left be');
});

test('an enchanted golden apple is a way to act on burning, in the Nether too', () => {
  const bot = { health: 6, entity: { position: new Vec3(0.5, 64, 0.5), metadata: [1] }, game: { dimension: 'the_nether' },
    inventory: { items: () => [] }, blockAt: p => (p.y < 64 ? { position: p, name: 'netherrack', boundingBox: 'block' } : air(p)) };
  assert.equal(vitals.fireToAnswer(bot), false, 'nothing puts it out there (note 548)');
  bot.inventory = { items: () => [{ name: 'enchanted_golden_apple', count: 1 }] };
  assert.equal(vitals.fireToAnswer(bot), true);
  bot._alightUntil = Date.now() + 12000;
  const ways = vitals.fireWays(bot, new Task('t'));
  assert.deepEqual(Object.keys(ways).sort(), ['burn_out', 'eat_golden_apple']);
  assert.match(ways.burn_out.description, /about 12 seconds of fire left at a health a second that armour does not stop is about 12 health, and the bot has 6: it dies of the burning in about 6 seconds, before the fire ends, unless something puts it out first; in the Nether nothing else puts it out/);
  assert.match(body.conditionSays(bot, 'fire', { inFire: false }), /about 12 seconds of fire left/);
});

test('maintainVitals asks body_way with the client it is given (a head in a block)', async () => {
  const gravel = new Vec3(0, 65, 0);
  const bot = Object.assign(new EventEmitter(), { health: 18, food: 20, oxygenLevel: 20, game: { dimension: 'overworld' }, entities: {}, _recentHurtAt: Date.now(),
    entity: { position: new Vec3(0.5, 64, 0.5), eyeHeight: 1.62, width: 0.6, onGround: true },
    blockAt: p => p.equals(gravel) ? { position: p, name: 'gravel', boundingBox: 'block', hardness: 0.6 } : p.y < 64 ? { position: p, name: 'stone', boundingBox: 'block' } : air(p),
    inventory: { items: () => [], slots: {} }, heldItem: null, clearControlStates() {}, setControlState() {}, lookAt: async () => {} });
  const seen = [];
  const client = { systemOne: async ({ questions }) => { seen.push(Object.keys(questions.branch_0.criteria)); return { answers: { branch_0: { choice: 'dig_out', confidence: 0.9 } } }; } };
  const task = new Task('vitals');
  await vitals.maintainVitals(bot, task, () => {}, { client }).catch(() => {});
  assert.equal(seen.length, 1, 'asked once');
  assert.ok(seen[0].includes('step_aside') && seen[0].includes('dig_out'), `offered: ${seen[0]}`);
});

test('the shield stays down at a shot while Jev\'s take_shots stands, and rises under shield_at_shots', async () => {
  const skeleton = { id: 5, name: 'skeleton', type: 'hostile', position: new Vec3(10.5, 64, 0.5), height: 1.99, width: 0.6, isValid: true };
  const arrow = { id: 9, name: 'arrow', position: new Vec3(4, 65.5, 0.5), velocity: new Vec3(-1.5, 0, 0), isValid: true };
  let raised = 0;
  const bot = { health: 18, entities: { 5: skeleton, 9: arrow }, entity: { position: new Vec3(0.5, 64, 0.5), height: 1.8 },
    inventory: { slots: { 45: { name: 'shield' } } }, blockAt: p => (p.y < 64 ? { position: p, name: 'stone', boundingBox: 'block' } : air(p)),
    world: { raycast: () => null }, game: { dimension: 'overworld' }, activateItem() { raised++; }, deactivateItem() {}, clearControlStates() {}, setControlState() {}, lookAt: async () => {} };
  bot._shieldPolicy = { choice: 'take_shots', ids: [5], at: Date.now(), health: 18 };
  assert.equal(await guard.deflect(bot, new Task('t'), { holdMs: 50 }), false, 'left down, as chosen');
  assert.equal(raised, 0);
  bot._shieldPolicy = { choice: 'shield_at_shots', ids: [5], at: Date.now(), health: 18 };
  assert.equal(await guard.deflect(bot, new Task('t'), { holdMs: 50 }), true);
  bot._shieldPolicy = { choice: 'take_shots', ids: [5], at: Date.now(), health: 18 };
  bot.health = 13;
  assert.equal(guard.policy(bot), null, 'four health gone: the choice no longer stands');
});

test('the shield chosen against the shots holds through the hits; one shooter more than were about asks again', () => {
  // mid-208-k-nether-3-fortress-2 (note 560): shield_policy asked five times in eight seconds, shield_at_shots each
  // time, a wither skeleton's blows taking four health a hit and the blazes going in and out of sight.
  const blaze = (id, visible) => ({ id, name: 'blaze', type: 'hostile', position: new Vec3(14.5, 66, 0.5), height: 1.8, width: 0.6, isValid: true, _visible: visible });
  const mobs = { 1: blaze(1, false), 2: blaze(2, true) };
  const bot = { health: 20, entities: mobs, entity: { position: new Vec3(0.5, 64, 0.5), height: 1.8 }, game: { dimension: 'the_nether' },
    blockAt: p => (p.y < 64 ? { position: p, name: 'netherrack', boundingBox: 'block' } : air(p)), world: { raycast: () => null } };
  const kinds = { blaze: 2 };
  bot._shieldPolicy = { choice: 'shield_at_shots', ids: [1, 2], kinds, at: Date.now(), health: 20 };
  bot.health = 10;
  assert.ok(guard.policy(bot), 'ten health gone to blows: the shield at the shots still stands');
  // A third blaze in sight is more than were about: asked again.
  mobs[3] = { ...blaze(3, true), position: new Vec3(10.5, 66, 3.5) };
  assert.equal(guard.policy(bot), null, 'a shooter not counted');
});

// A one-wide netherrack span over lava, as the span tests build it.
const spanBot = (mob, extra = {}) => {
  const span = p => { const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z);
    return y === 64 && z === 0 && x >= -10 && x <= 10 ? { position: p, name: 'netherrack', boundingBox: 'block' }
      : y <= 40 ? { position: p, name: 'lava', boundingBox: 'empty' } : air(p); };
  const events = [];
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health: 18, food: 20, oxygenLevel: 20,
    entity: { position: new Vec3(0.5, 65, 0.5), onGround: true, height: 1.8, velocity: new Vec3(0, 0, 0) }, entities: { [mob.id]: mob }, time: { timeOfDay: 6000 },
    inventory: { items: () => [{ name: 'iron_sword', type: 1 }, { name: 'netherrack', count: 20 }], slots: {} }, world: { raycast: () => null }, blockAt: span, registry: require('minecraft-data')('26.1'),
    pathfinder: { movements: {}, setGoal() {}, getPathTo: () => ({ status: 'noPath', path: [] }) }, clearControlStates() {}, setControlState: (k, on) => { if (k === 'sneak' && on) events.push('crouch'); }, getControlState: () => false,
    activateItem() {}, deactivateItem() {}, lookAt: async () => {}, look: async () => {}, equip: async () => {}, attack: () => events.push('swing'), findBlocks: () => [], ...extra });
  return { bot, events };
};

test('on a span with Jev reachable, the stance is asked before anything is done, and holding on the span is one of its options', async () => {
  const zombie = { id: 4, name: 'zombie', type: 'hostile', position: new Vec3(2.5, 65, 0.5), height: 1.95, width: 0.6, isValid: true };
  const { bot, events } = spanBot(zombie);
  const survival = new Survival(bot, { navigate: async () => { events.push('walk'); }, place: async () => { events.push('place'); }, dig: async () => {} }, { state: { shelters: [] }, client: { systemOne: async () => ({}) } });
  let tree;
  survival.decide = async (task, goal, save, q) => { events.push(`ask:${q.id}`); if (q.id === 'encounter_stance') tree = q.tree; return { path: ['fight'], stale: false }; };
  const goal = {};
  await survival.flee(new Task('span'), goal, () => {}).catch(() => {});
  assert.equal(events[0], 'ask:encounter_stance', `first: ${events.join(',')}`);
  assert.ok(tree?.hold_on_span, `offered: ${Object.keys(tree || {})}`);
  assert.match(tree.hold_on_span.description, /open sides? at the feet .* walled first/);
});

test('without Jev the span is held by the code first, as before', async () => {
  const zombie = { id: 4, name: 'zombie', type: 'hostile', position: new Vec3(2.5, 65, 0.5), height: 1.95, width: 0.6, isValid: true };
  const { bot, events } = spanBot(zombie);
  const survival = new Survival(bot, { navigate: async () => {}, place: async () => {}, dig: async () => {} }, { state: { shelters: [] } });
  survival.decide = async (task, goal, save, q) => { events.push(`ask:${q.id}`); return { fallback: true }; };
  const goal = {};
  await survival.flee(new Task('span'), goal, () => {}).catch(() => {});
  assert.equal(events[0], 'crouch', `first: ${events.join(',')}`);
  assert.ok(!events.some(e => e.startsWith('ask:')), 'nothing asked');
});

test('beside a deadly drop with Jev reachable, no step off the edge and no swing come before the stance question', async () => {
  // Ground x <= 0, a drop into lava from x = 1 on.
  const ground = p => { const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z);
    return y === 64 && x <= 0 && x >= -12 && Math.abs(z) <= 12 ? { position: p, name: 'stone', boundingBox: 'block' }
      : y <= 30 ? { position: p, name: 'lava', boundingBox: 'empty' } : air(p); };
  const zombie = { id: 4, name: 'zombie', type: 'hostile', position: new Vec3(-1.5, 65, 1.5), height: 1.95, width: 0.6, isValid: true };
  const { bot, events } = spanBot(zombie, { blockAt: ground, game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' } });
  const survival = new Survival(bot, { navigate: async () => { events.push('walk'); }, place: async () => {}, dig: async () => {} }, { state: { shelters: [] }, client: { systemOne: async () => ({}) } });
  let tree;
  survival.decide = async (task, goal, save, q) => { events.push(`ask:${q.id}`); if (q.id === 'encounter_stance') tree = q.tree; return { path: ['fight'], stale: false }; };
  const goal = {};
  await survival.flee(new Task('edge'), goal, () => {}).catch(() => {});
  assert.equal(events[0], 'ask:encounter_stance', `first: ${events.join(',')}`);
  assert.notEqual(goal.survivalAction?.action, 'off_the_edge');
  assert.ok(tree?.fight_from_footing, `the step to firm ground is an option: ${Object.keys(tree || {})}`);
});

test('shield_policy is asked beside the stance when shooters are about and a shield is carried', async () => {
  const skeleton = { id: 5, name: 'skeleton', type: 'hostile', position: new Vec3(8.5, 65, 0.5), height: 1.99, width: 0.6, isValid: true, heldItem: { name: 'bow' } };
  const { bot } = spanBot(skeleton, { inventory: { items: () => [{ name: 'iron_sword', type: 1 }], slots: { 45: { name: 'shield' } } },
    blockAt: p => (p.y < 65 ? { position: p, name: 'stone', boundingBox: 'block' } : air(p)), game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' } });
  const survival = new Survival(bot, { navigate: async () => {}, place: async () => {}, dig: async () => {} }, { state: { shelters: [] }, client: { systemOne: async () => ({}) } });
  const asked = {};
  survival.decide = async (task, goal, save, q) => { asked[q.id] = q; return { path: [q.id === 'shield_policy' ? 'take_shots' : Object.keys(q.tree)[0]], stale: false }; };
  await survival.flee(new Task('shots'), {}, () => {}).catch(() => {});
  await new Promise(r => setTimeout(r, 20));
  assert.ok(asked.shield_policy, `asked: ${Object.keys(asked)}`);
  assert.match(asked.shield_policy.tree.shield_at_shots.description, /the skeleton 8 blocks off, its shot about 0\.3 seconds in the air/);
  assert.match(asked.shield_policy.tree.take_shots.description, /the skeleton's about 3 health a shot/);
  assert.equal(bot._shieldPolicy?.choice, 'take_shots');
});

test('the survival step hands its client to the vitals: a head in a block is asked of Jev there too', async () => {
  const gravel = new Vec3(0, 65, 0);
  const bot = Object.assign(new EventEmitter(), { health: 18, food: 20, oxygenLevel: 20, game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, entities: {}, _recentHurtAt: Date.now(),
    entity: { position: new Vec3(0.5, 64, 0.5), eyeHeight: 1.62, width: 0.6, height: 1.8, onGround: true, velocity: new Vec3(0, 0, 0) }, time: { timeOfDay: 6000 },
    blockAt: p => p.equals(gravel) ? { position: p, name: 'gravel', boundingBox: 'block', hardness: 0.6 } : p.y < 64 ? { position: p, name: 'stone', boundingBox: 'block' } : air(p),
    inventory: { items: () => [], slots: {} }, heldItem: null, world: { raycast: () => null }, pathfinder: { movements: {}, setGoal() {} },
    clearControlStates() {}, setControlState() {}, getControlState: () => false, lookAt: async () => {}, findBlocks: () => [] });
  const seen = [];
  const client = { systemOne: async ({ questions }) => { seen.push(Object.keys(questions.branch_0.criteria)); return { answers: { branch_0: { choice: 'dig_out', confidence: 0.9 } } }; } };
  const survival = new Survival(bot, { navigate: async () => {}, place: async () => {}, dig: async () => {} }, { state: { shelters: [] }, client });
  await survival.step(new Task('vitals'), {}, () => {}).catch(() => {});
  assert.ok(seen.some(k => k.includes('step_aside') && k.includes('dig_out')), `asked: ${JSON.stringify(seen)}`);
});
