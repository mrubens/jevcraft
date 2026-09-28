'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('node:events');
const { Task } = require('../src/skills');
const { Survival } = require('../src/survival');
const { attemptsFor } = require('../src/progress');

// mid-242-ag (25594, note 593): at 05:50:13 the bot stood at (29.7, 70,
// 61.7), a skeleton 7 blocks off and closing to 4.5, beside a pocket it had
// made two days before at (31, 70, 61), over a pool. turn_priority gave the
// survival layer the turn six times; every pass went to the emergency's
// seal of that saved site, which refugeStep refused (a pocket over water is
// not gone back to) and counted as done: 508 refusals, "the saved shelter
// is out of reach", no stance asked, no swing, no shield, 20 health to none.
function besidePool({ client = { systemOne: async () => ({}) } } = {}) {
  const skeleton = { id: 2319, name: 'skeleton', type: 'hostile', position: new Vec3(29.5, 70, 66.2), height: 1.99, width: 0.6, isValid: true };
  const pool = p => p.y === 67 && p.x >= 25 && p.x <= 36 && p.z >= 56 && p.z <= 66;
  const bot = Object.assign(new EventEmitter(), { registry: require('minecraft-data')('26.1'),
    game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal', minY: -64, height: 384 },
    entity: { position: new Vec3(29.7, 70, 61.7), onGround: true, velocity: new Vec3(0, 0, 0), height: 1.8 }, entities: { 2319: skeleton },
    health: 14.9, food: 17, oxygenLevel: 20, time: { timeOfDay: 6000 }, world: { raycast: () => null }, findBlocks: () => [], heldItem: null,
    inventory: { items: () => [{ name: 'iron_sword', count: 1 }, { name: 'dirt', count: 60 }], slots: { 45: { name: 'shield' } }, emptySlotCount: () => 10 },
    blockAt: p => { const f = p.floored(); const name = f.y >= 70 ? 'air' : pool(f) ? 'water' : 'stone'; return { position: f, name, boundingBox: name === 'stone' ? 'block' : 'empty', diggable: true }; },
    pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, setControlState() {}, getControlState: () => false,
    activateItem() {}, deactivateItem() {}, lookAt: async () => {}, look: async () => {}, equip: async () => {}, attack() {},
    _hurtTimes: [Date.now() - 1000], _recentHurtAt: Date.now() - 1000, _hurtBy: { skeleton: Date.now() - 1000 } });
  const state = { shelters: [{ origin: { x: 31, y: 70, z: 61 }, dimension: 'overworld', emergency: true, verifiedAt: '2026-09-26T18:36:05.698Z' }] };
  const survival = new Survival(bot, { navigate: async () => {}, dig: async () => {}, place: async () => {} }, { state, client });
  return { bot, skeleton, survival, goal: { kind: 'win', request: 'beat the game', survival: state } };
}

test('with Jev reachable, a threat at hand beside a saved site is the stance question, not the site\'s seal (mid-242-ag, note 593)', async () => {
  const { survival, goal } = besidePool();
  const went = [];
  survival.flee = async () => { went.push('stance'); };
  const sealed = survival.refugeStep.bind(survival);
  survival.refugeStep = async (...args) => { went.push('seal'); return sealed(...args); };
  for (let pass = 0; pass < 3; pass++) assert.equal(await survival.step(new Task('pass'), goal, () => {}), true);
  assert.deepEqual(went, ['stance', 'stance', 'stance'], 'every survival turn goes to the encounter\'s question');
});

test('the stance is asked of the skeleton, not passed over (mid-242-ag, note 593)', async () => {
  const { survival, goal } = besidePool();
  const asked = [];
  survival.decide = async (task, g, save, { id, tree }) => { asked.push({ id, options: Object.keys(tree || {}) }); return { stale: true, path: [] }; };
  survival.shieldPolicy = () => null;
  await survival.step(new Task('pass'), goal, () => {});
  const stance = asked.find(a => a.id === 'encounter_stance');
  assert(stance, `asked: ${asked.map(a => a.id).join(', ') || 'nothing'}`);
  assert(stance.options.length > 1, `options: ${stance.options.join(', ')}`);
  assert.equal(attemptsFor(survival).of('shelter_method').saved_shelter, undefined, 'the saved site is not tried and refused');
});

test('without Jev, the saved site the seal refuses is no answer: the rules answer the mob (note 593)', async () => {
  const { survival, goal } = besidePool({ client: null });
  const went = [];
  survival.flee = async () => { went.push('flee'); };
  assert.equal(await survival.step(new Task('pass'), goal, () => {}), true);
  assert.deepEqual(went, ['flee']);
  assert.match(attemptsFor(survival).of('shelter_method').saved_shelter?.why || '', /out of reach/, 'the seal was tried and refused');
  // And refugeStep says so to the caller that gave it the method.
  assert.equal(await survival.refugeStep(new Task('pass'), goal, () => {}, { method: 'saved_shelter' }), false);
});

// The same trial at 05:49:52: a pocket sealed against the skeleton (the seal
// stance, 05:49:37) was opened the moment it closed by the leave Jev had
// chosen at 05:48:59 in another pocket, a shaft 3 blocks off, held ninety
// seconds by a key that did not name the pocket; twice, and no question.
function twoPockets() {
  const a = new Vec3(0, 64, 0), b = new Vec3(3, 64, 1);
  const open = new Set([a, a.offset(0, 1, 0), b, b.offset(0, 1, 0)].map(String));
  const bot = Object.assign(new EventEmitter(), { registry: require('minecraft-data')('26.1'), game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' },
    entities: { 7: { id: 7, name: 'skeleton', type: 'hostile', position: new Vec3(12.5, 64, 0.5), height: 1.99, width: 0.6, isValid: true } },
    health: 20, food: 18, time: { timeOfDay: 6000 }, oxygenLevel: 20, entity: { position: a.offset(0.5, 0, 0.5), onGround: true, velocity: new Vec3(0, 0, 0) },
    inventory: { items: () => [{ name: 'iron_sword', count: 1 }, { name: 'dirt', count: 40 }], emptySlotCount: () => 10, slots: [] },
    blockAt: p => ({ name: open.has(`${p.floored()}`) ? 'air' : 'stone', boundingBox: open.has(`${p.floored()}`) ? 'empty' : 'block', position: p.floored() }),
    world: { raycast: from => ({ intersect: from.offset(0.6, 0, 0) }) } });
  const state = { shelters: [{ origin: { ...a }, dimension: 'overworld', emergency: true }, { origin: { ...b }, dimension: 'overworld', emergency: true }] };
  const survival = new Survival(bot, {}, { state, client: { systemOne: async () => ({}) } });
  return { bot, a, b, survival, goal: { kind: 'win', request: 'beat the game', survival: state } };
}

test('an answer held in one pocket is not carried into another: the new pocket is asked (mid-242-ag, note 593)', async () => {
  const { bot, b, survival, goal } = twoPockets();
  const asked = [];
  survival.decide = async (task, g, save, { id }) => { asked.push(id); return { path: ['stay'], stale: false }; };
  survival.wait = async () => {};
  await survival.step(new Task('first'), goal, () => {});
  assert.deepEqual(asked, ['pocket_next']);
  await survival.step(new Task('same'), goal, () => {});
  assert.deepEqual(asked, ['pocket_next'], 'held in the same pocket');
  bot.entity.position = b.offset(0.5, 0, 0.5);
  await survival.step(new Task('other'), goal, () => {});
  assert.deepEqual(asked, ['pocket_next', 'pocket_next'], 'asked again in the other pocket');
});
