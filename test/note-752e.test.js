'use strict';
// Note 752e. 25595 (16:43:50 to 16:53Z) was offered the fight about twelve
// times against a magma cube no run could reach, each ending in no route,
// turn_priority re-asked every one to five seconds for "a newcomer within
// six blocks" as the cubes hopped; 25598 (16:50:57 to 16:52:35Z) at 1
// health, hunger 14 and no food chose wall_in_first four times with nothing
// hitting it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const danger = require('../src/danger');
const arbiter = require('../src/arbiter');

const T0 = Date.parse('2026-09-30T16:44:27Z');
function cubeBot() {
  const cube = { id: 31, name: 'magma_cube', type: 'hostile', position: new Vec3(3.5, 45, 0.5), height: 2.04, width: 2.04, isValid: true, metadata: [] };
  const bot = { game: { dimension: 'the_nether', difficulty: 'normal', gameMode: 'survival' }, health: 20, food: 20, oxygenLevel: 20, time: { timeOfDay: 6000 },
    entity: { position: new Vec3(0.5, 46, 0.5), eyeHeight: 1.62, metadata: [0] }, entities: { 31: cube }, inventory: { items: () => [], slots: [] }, registry: { entitiesByName: {} },
    blockAt: p => p.y < 45 ? { name: 'netherrack', boundingBox: 'block', position: p } : { name: 'air', boundingBox: 'empty', position: p } };
  return { bot, cube };
}
const seen = (bot, e) => ({ entity: e, distance: e.position.distanceTo(bot.entity.position), visible: true });

test('a mob no run could reach stands off at once, said so, until it hits or the bot moves off (25595, note 752e)', t => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const { bot, cube } = cubeBot();
  assert.equal(danger.standsOff(bot, seen(bot, cube)), null, 'no run yet: not standing off');
  danger.noteNoRun(bot, seen(bot, cube));
  t.mock.timers.setTime(T0 + 12000);
  assert(danger.standsOff(bot, seen(bot, cube))?.noRun, 'stands off at once');
  assert.match(danger.reachSays(bot, seen(bot, cube)), /a run at it 12 seconds ago found no way to it from here; it has not hit the bot since: not a threat that stops the work while that holds/);
  bot._hurtById = { 31: Date.now() };
  assert.equal(danger.standsOff(bot, seen(bot, cube)), null, 'a hit ends it');
  delete bot._hurtById;
  danger.noteNoRun(bot, seen(bot, cube));
  bot.entity.position = new Vec3(6, 46, 0.5);
  assert.equal(danger.noRunTo(bot, seen(bot, cube)), null, 'moved off: tried again');
});

test('the fight against a mob no run reached says so, and every stance carries the reach fact (25595, note 752e)', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const { EventEmitter } = require('node:events');
  const { Survival } = require('../src/survival');
  const { Task } = require('../src/skills');
  const cube = { id: 31, name: 'magma_cube', type: 'hostile', position: new Vec3(4, 64, 0), height: 2.04, width: 2.04, isValid: true, metadata: [] };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health: 20, food: 20, oxygenLevel: 20,
    entities: { 31: cube }, time: { timeOfDay: 6000 }, registry: require('minecraft-data')('26.1'),
    entity: { position: new Vec3(0.5, 64, 0.5), yaw: 0, onGround: true, width: 0.6, height: 1.8, velocity: new Vec3(0, 0, 0) },
    inventory: { items: () => [{ name: 'iron_sword', count: 1 }], slots: { 45: { name: 'shield' } }, emptySlotCount: () => 10 },
    blockAt: p => { const f = p.floored(); const s = f.y < 64; return { position: f, name: s ? 'netherrack' : 'air', boundingBox: s ? 'block' : 'empty', diggable: s, shapes: s ? [[0, 0, 0, 1, 1, 1]] : [] }; },
    world: { raycast: () => null }, findBlocks: () => [], lookAt: async () => {}, look: async () => {}, equip: async () => {}, attack() {} });
  danger.noteNoRun(bot, seen(bot, cube));
  t.mock.timers.setTime(T0 + 9000);
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
  let options;
  survival.decide = async (task, goal, save, q) => { options = q.tree; return { path: ['shield_guard' in q.tree ? 'shield_guard' : Object.keys(q.tree)[0]] }; };
  survival.scoutRetreat = async () => {};
  const build = survival.stanceOptions.bind(survival);
  survival.stanceOptions = (...a) => { const o = build(...a); for (const v of Object.values(o)) v.run = async () => true; return o; };
  bot.pathfinder = { movements: {}, setGoal() {} }; bot.clearControlStates = () => {}; bot.setControlState = () => {}; bot.activateItem = () => {}; bot.deactivateItem = () => {};
  await survival.stanceStep(new Task('x'), {}, () => {}, [seen(bot, cube)], false).catch(() => {});
  assert(options?.fight, Object.keys(options || {}).join(','));
  assert.match(options.fight.description, /No way to the magma cube 3\.5 blocks off: a run at it, the last 9 seconds ago, found none from here; chosen, this closes on nothing and swings only at what comes into reach\./);
  for (const [k, o] of Object.entries(options)) if (k !== 'none_good') assert.match(o.description, /Reach now: the magma cube 3\.5 blocks off: .*a run at it 9 seconds ago found no way to it from here/, k);
});

test('turn_priority is not asked again for one of a kind already about coming within six; more of that kind is news (25595, note 752e)', () => {
  const m = (name, distance, id) => ({ entity: { name, id }, distance, visible: true });
  const bot = { entity: { position: new Vec3(0, 64, 0) }, health: 20, food: 20, oxygenLevel: 20, entities: {} };
  // A ruling that is not survival's answer to a threat (a fight ruling holds
  // through its fight, note 764).
  const claims = () => [{ layer: 'survival', action: 'secure_shelter', urgency: 'pressing', facts: {} }, { layer: 'work', action: 'mine', urgency: 'routine', facts: {} }];
  const state = {};
  arbiter.rule(bot, claims(), { dry: true, state, now: 1000, mobs: [m('magma_cube', 5, 1), m('magma_cube', 9, 2)] });
  const hop = arbiter.rule(bot, claims(), { dry: true, state, now: 2000, mobs: [m('magma_cube', 8, 1), m('magma_cube', 4, 2)] });
  assert.equal(hop.by, 'held', 'the second cube hopping inside six is not a newcomer');
  const more = arbiter.rule(bot, claims(), { dry: true, state, now: 3000, mobs: [m('magma_cube', 8, 1), m('magma_cube', 4, 2), m('magma_cube', 3.5, 3)] });
  assert.equal(more.why, 'a newcomer within six blocks', 'a third is');
});

test('walling in is not offered at 1 health when nothing is hitting the bot or about to get to it, and is said with what it keeps off and whether health comes back when it is (25598, note 752e)', t => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const low = require('../src/low-health');
  const items = [{ name: 'cobblestone', count: 60 }];
  const bot = { health: 1, food: 14, game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, entities: {},
    registry: require('minecraft-data')('26.1'), time: { timeOfDay: 6000 }, entity: { position: new Vec3(0.5, 30, 0.5), yaw: 0 }, inventory: { items: () => items, slots: [] },
    blockAt: p => ({ position: p.floored(), name: p.y < 30 ? 'stone' : 'air', boundingBox: p.y < 30 ? 'block' : 'empty' }), world: { raycast: () => null } };
  bot._shotSurvival = { sealHere: async () => true };
  const quiet = low.ways(bot, { task: { check() {} }, goal: {} });
  assert.equal(quiet.tree.wall_in_first, undefined);
  assert.match(quiet.says, /Nothing carried is food, and nothing is hitting the bot or about to get to it, so walling in keeps off nothing\./);
  bot.entities = { 7: { id: 7, name: 'zombie', type: 'hostile', position: new Vec3(5.5, 30, 0.5), height: 1.95, width: 0.6 } };
  const about = low.ways(bot, { task: { check() {} }, goal: {} });
  assert(about.tree.wall_in_first, JSON.stringify(Object.keys(about.tree)));
  assert.match(about.tree.wall_in_first.description, /it keeps off the zombie 5 blocks off; health does not come back in it at hunger 14 with nothing carried to eat;/);
});
