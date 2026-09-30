'use strict';
// Note 743: encounter_stance flipped against a single mob because it was
// re-asked on every arrow or hit and the shield came up too late.
//
// 25598 (09:22:28 to 09:24:21Z): against one skeleton, take_cover, fight,
// take_cover, fight (0.89), take_cover; hits 18 to 12 and 17.9 to 14.9, each
// "(shield rising, not yet blocking)". turn_priority was asked 53 times.
// Cause: a holding stance (take_cover, shield_guard and the rest of
// shot-reflex.js STANCE_SHOTS.holding) had its shield lowered and raised
// again on every tick it ran (survival.js's own entry to it, note 683's gap
// made general), so it never stood raised the quarter second
// (SHIELD_BLOCKS_AFTER_MS) it takes to start blocking; a blow that landed
// in that gap read as more damage than the stance was priced for, and the
// physical hold (holds.js, danger.js STANCE_HOLD_MS) ended and asked again.
//
// 25585 (~09:19 to 09:24Z): take_cover, back_to_wall, fight and take_cover
// again against sixteen blazes at a live spawner, 62 stance asks in 12.8
// minutes with the mobs at the same range throughout. Cause: a live
// spawner's swarm turns over blaze by blaze; the physical hold treated
// every newly spawned or despawned individual within six blocks as a
// newcomer even though the kind held against (blaze) had not changed.
//
// take_cover missing from the tree with no word of why (the retreat's own
// "Nowhere to run" has a counterpart, this note's item (c)).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('node:events');
const { Task } = require('../src/skills');
const { Survival } = require('../src/survival');
const combat = require('../src/combat');

function mobBot({ kind = 'skeleton', at = new Vec3(3, 65, 0), heldItem = { name: 'bow' }, dimension = 'overworld', inventory = [{ name: 'iron_sword', count: 1 }] } = {}) {
  const mob = { id: 501, name: kind, type: 'hostile', position: at, height: 1.99, width: 0.6, isValid: true, heldItem };
  const bot = Object.assign(new EventEmitter(), { game: { dimension, gameMode: 'survival', difficulty: 'normal' }, health: 18, food: 18, oxygenLevel: 20,
    entities: { 501: mob }, time: { timeOfDay: 6000 }, registry: require('minecraft-data')('26.1'),
    entity: { position: new Vec3(0, 65, 0), onGround: true, width: 0.6, height: 1.8, velocity: new Vec3(0, 0, 0), metadata: { 0: 0 } },
    inventory: { items: () => inventory, slots: { 45: { name: 'shield' } }, emptySlotCount: () => 20 },
    blockAt: p => ({ position: p.floored(), name: 'air', boundingBox: 'empty', diggable: false, shapes: [] }),
    world: { raycast: () => null }, findBlocks: () => [], lookAt: async () => {}, look: async () => {}, equip: async () => {}, attack() {},
    pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, setControlState() {},
    activateItem() {}, deactivateItem() {} });
  const threat = (e = mob) => ({ entity: e, distance: e.position.distanceTo(bot.entity.position), visible: true });
  return { bot, mob, threat };
}

// The stance step as it runs with a stubbed decision: `opts` a plain
// { key: { description, run } } tree, no game logic of its own.
async function stanceStep(survival, danger, choice, opts, capture = {}) {
  survival.stanceOptions = () => Object.fromEntries(Object.entries(opts).map(([k, v]) => [k, { description: v.description ?? k, expects: v.expects,
    run: async () => { (capture.ran ||= []).push(k); return v.done !== false; } }]));
  survival.decide = async (task, goal, save, args) => { capture.tree = args.tree; capture.asked = true; return { path: [choice] }; };
  survival.scoutRetreat = async () => {};
  await survival.stanceStep(new Task('x'), {}, () => {}, danger, false);
  return capture;
}

test('a holding stance (take_cover) keeps the shield up while it runs; a closing stance (fight) lowers it, as any stance not meant to stand behind the shield does (note 743, note 683 made general)', async () => {
  const { bot, threat } = mobBot();
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
  combat.raiseShield(bot);
  assert.equal(bot._shieldRaised, true);
  await stanceStep(survival, [threat()], 'take_cover', { take_cover: {}, fight: {} });
  assert.equal(bot._shieldRaised, true, 'take_cover kept the shield up: it never needed the hand\'s speed lowering it costs');

  const other = mobBot();
  const s2 = new Survival(other.bot, { navigate: async () => {} }, { state: { shelters: [] } });
  combat.raiseShield(other.bot);
  await stanceStep(s2, [other.threat()], 'fight', { take_cover: {}, fight: {} });
  assert.equal(other.bot._shieldRaised, false, 'fight lowered it, as before');
});

test('a stance held against a live spawner\'s swarm is not asked again for a blaze that spawned or despawned within six blocks: a newcomer of a kind already held against is not news, only one of a kind that was not there (25585, note 743)', async () => {
  const { bot } = mobBot({ kind: 'blaze', dimension: 'the_nether' });
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
  survival.state.stance = { choice: 'take_cover', kinds: 'blaze', ids: [501], at: Date.now() - 2000, health: 20, expects: { damage: 0.3, seconds: 15 } };
  bot.health = 20;
  // A different blaze (a fresh spawn), the same kind, close to the bot: not
  // the one held against by id, but not a newcomer by kind either.
  const churned = { id: 999, name: 'blaze', type: 'hostile', position: new Vec3(3, 65, 0), height: 1.8, width: 0.6, isValid: true };
  const danger = [{ entity: churned, distance: 3, visible: true }];
  const capture = await stanceStep(survival, danger, 'fight', { take_cover: {}, fight: {} });
  assert.ok(!capture.asked, 'encounter_stance was asked again over a churned blaze of the same kind, with health and range unchanged');
  assert.deepEqual(capture.ran, ['take_cover'], 'the held stance ran again unasked');
});

test('a mob of a kind not held against, close by, is still a newcomer and is asked again (the rule stays a rule, not a blanket hold)', async () => {
  const { bot } = mobBot({ kind: 'blaze', dimension: 'the_nether' });
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
  survival.state.stance = { choice: 'take_cover', kinds: 'blaze', ids: [501], at: Date.now() - 2000, health: 20, expects: { damage: 0.3, seconds: 15 } };
  bot.health = 20;
  const zombie = { id: 998, name: 'zombie', type: 'hostile', position: new Vec3(3, 65, 0), height: 1.95, width: 0.6, isValid: true };
  const danger = [{ entity: zombie, distance: 3, visible: true }];
  const capture = await stanceStep(survival, danger, 'fight', { take_cover: {}, fight: {} });
  assert.ok(capture.asked, 'a zombie is a kind not held against: a newcomer, and encounter_stance was asked again');
});

test('a re-ask says what the last stance was and prices the reversal when the new pick opposes it (closing vs holding, shot-reflex.js STANCE_SHOTS): take_cover then fight is not a fresh pick with nothing behind it (25598, note 743)', async () => {
  const { bot, mob, threat } = mobBot();
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
  survival.state.stance = { choice: 'take_cover', kinds: 'skeleton', ids: [mob.id], at: Date.now() - 3000, health: 20, expects: { damage: 0.3, seconds: 15 } };
  bot.health = 10; // more lost than take_cover was priced for: a fresh ask, held said
  const capture = await stanceStep(survival, [threat()], 'fight', { take_cover: { description: 'take cover text' }, fight: { description: 'fight text' } });
  assert.ok(capture.asked, 'the damage lost past what take_cover was priced for asks again');
  assert.match(capture.tree.fight.description, /This reverses take cover, chosen 3 seconds ago: it held\.?$/);
  // The option that does not oppose it (another holding stance) is not
  // marked as a reversal.
  const other = mobBot();
  const s2 = new Survival(other.bot, { navigate: async () => {} }, { state: { shelters: [] } });
  s2.state.stance = { choice: 'take_cover', kinds: 'skeleton', ids: [other.mob.id], at: Date.now() - 3000, health: 20, expects: { damage: 0.3, seconds: 15 } };
  other.bot.health = 10;
  const c2 = await stanceStep(s2, [other.threat()], 'bunker', { take_cover: { description: 'take cover text' }, bunker: { description: 'bunker text' } });
  assert.doesNotMatch(c2.tree.bunker.description, /reverses/);
});

test('take_cover missing from the tree because no route was found for it says so, as the retreat\'s own "no route" does; it is not left a silent gap in the list (note 743)', () => {
  const { bot } = mobBot({ at: new Vec3(6, 65, 0) });
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
  const danger = [{ entity: bot.entities[501], distance: 6, visible: true }];
  const opts = survival.stanceOptions(new Task('x'), {}, () => {}, danger, false);
  assert.ok(!opts.take_cover, 'nothing in this open scene can cut the skeleton\'s line');
  assert.match(survival.state.stanceTakeCoverNoRoute, /Nowhere to hide: no block can cut the line of skeleton from here\./);
});

test('take_cover offered normally clears the no-route fact', () => {
  const { Vec3: V } = require('vec3');
  const piglin = { id: 8, name: 'piglin', type: 'hostile', position: new V(8.6, 35, 0.5), height: 1.95, width: 0.6, isValid: true, heldItem: { name: 'crossbow' } };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health: 20, food: 20, oxygenLevel: 20,
    entities: { 8: piglin }, time: { timeOfDay: 6000 }, registry: require('minecraft-data')('26.1'),
    entity: { position: new V(0.5, 35, 0.5), onGround: true, width: 0.6, height: 1.8, velocity: new V(0, 0, 0) },
    inventory: { items: () => [{ name: 'iron_sword', count: 1 }, { name: 'netherrack', count: 8 }], slots: { 45: { name: 'shield' } }, emptySlotCount: () => 20 },
    blockAt: p => { const f = p.floored(); const s = f.y < 35 && Math.abs(f.x) <= 1 && Math.abs(f.z) <= 1; return { position: f, name: s ? 'netherrack' : f.y < 32 ? 'lava' : 'air', boundingBox: s ? 'block' : 'empty', diggable: s, shapes: s ? [[0, 0, 0, 1, 1, 1]] : [] }; },
    world: { raycast: () => null }, findBlocks: () => [], lookAt: async () => {}, look: async () => {}, equip: async () => {}, attack() {} });
  const survival = new Survival(bot, { navigate: async () => {}, place: async () => {} }, { state: { shelters: [] } });
  survival.state.stanceTakeCoverNoRoute = 'stale fact from a moment ago';
  const danger = [{ entity: piglin, distance: 8.1, visible: true }];
  const opts = survival.stanceOptions(new Task('x'), {}, () => {}, danger, false);
  assert.ok(opts.take_cover, 'blocks are carried and a route is found');
  assert.equal(survival.state.stanceTakeCoverNoRoute, undefined);
});
