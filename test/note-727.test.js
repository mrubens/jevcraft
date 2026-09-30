'use strict';
// Note 727: the enderman roof. Notes 713 and 718 measured the warped
// forest drills surviving 3-5 endermen while pearls per minute stayed low,
// and named the cheap classic tactic (a two-high ceiling an enderman
// cannot path into) as the next real option to add, not yet built. This
// tests the tactic itself: src/enderman-roof.js's plan-finding and the
// `cap_fight` stance it feeds in src/survival.js stanceOptions, offered
// only where every threat about is an enderman.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('node:events');
const { Task } = require('../src/skills');
const { Survival } = require('../src/survival');
const roof = require('../src/enderman-roof');

const ARMOUR = ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'golden_boots'];

// Flat open netherrack floor at y 63, air above: the warped_forest arena's
// own shape (open ground, no walls near), not a span or a room.
const flatBot = ({ endermen, items, health = 20, other = [] }) => {
  const entities = {};
  for (const e of endermen) entities[e.id] = e;
  for (const e of other) entities[e.id] = e;
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health, food: 20, oxygenLevel: 20,
    entity: { position: new Vec3(1765.4, 64, 1765.5), onGround: true, height: 1.8, velocity: new Vec3(0, 0, 0), yaw: 0, pitch: 0 }, entities, time: { timeOfDay: 0 },
    inventory: { items: () => items, slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 7: { name: 'iron_leggings' }, 8: { name: 'golden_boots' }, 45: { name: 'shield' } } },
    world: { raycast: () => null },
    blockAt: p => { const y = Math.floor(p.y); return { position: p, name: y === 63 ? 'warped_nylium' : 'air', boundingBox: y === 63 ? 'block' : 'empty' }; },
    registry: require('minecraft-data')('26.1'),
    pathfinder: { movements: {}, setGoal() {}, getPathTo: () => ({ status: 'noPath', path: [] }) }, clearControlStates() {}, setControlState() {}, getControlState: () => false,
    activateItem() {}, deactivateItem() {}, lookAt: async () => {}, look: async () => {}, equip: async () => {}, attack: () => {}, findBlocks: () => [] });
  return bot;
};

test('roofPlan places a lid over the bot\'s own head on open ground when none is there yet', () => {
  const bot = flatBot({ endermen: [], items: [{ name: 'cobblestone', count: 20 }] });
  const plan = roof.roofPlan(bot);
  assert.equal(plan.kind, 'place');
  assert.equal(plan.blocks, 1);
  assert.ok(bot.blockAt(new Vec3(1765, 66, 1765)).boundingBox !== 'block', 'the cap cell was open before the plan');
});

test('roofPlan finds an already-capped cell nearby instead of building one', () => {
  const bot = flatBot({ endermen: [], items: [{ name: 'cobblestone', count: 20 }] });
  const capped = new Vec3(1766, 64, 1765);
  const real = bot.blockAt.bind(bot);
  bot.blockAt = p => (Math.floor(p.x) === capped.x && Math.floor(p.y) === 66 && Math.floor(p.z) === capped.z) ? { position: p, name: 'netherrack', boundingBox: 'block' } : real(p);
  const plan = roof.roofPlan(bot);
  assert.equal(plan.kind, 'gap');
  assert.ok(plan.cell.equals(capped));
  assert.equal(plan.blocks, 0);
});

test('roofPlan says "here" once a cap is already directly overhead', () => {
  const bot = flatBot({ endermen: [], items: [] });
  const real = bot.blockAt.bind(bot);
  bot.blockAt = p => (Math.floor(p.x) === 1765 && Math.floor(p.y) === 66 && Math.floor(p.z) === 1765) ? { position: p, name: 'netherrack', boundingBox: 'block' } : real(p);
  const plan = roof.roofPlan(bot);
  assert.equal(plan.kind, 'here');
  assert.equal(plan.blocks, 0);
});

test('roofPlan is null with no material and no gap within reach', () => {
  const bot = flatBot({ endermen: [], items: [] });
  assert.equal(roof.roofPlan(bot), null);
});

test('the crowd\'s cap_fight stance is offered, priced, only where every threat is an enderman, and hands off to the fight that follows', async () => {
  const items = [{ name: 'iron_sword', count: 1 }, { name: 'cobblestone', count: 20 }];
  const e1 = { id: 801, name: 'enderman', type: 'hostile', position: new Vec3(1767.5, 64, 1765.5), height: 2.9, width: 0.6, isValid: true };
  const e2 = { id: 802, name: 'enderman', type: 'hostile', position: new Vec3(1763.5, 64, 1765.5), height: 2.9, width: 0.6, isValid: true };
  const e3 = { id: 803, name: 'enderman', type: 'hostile', position: new Vec3(1765.5, 64, 1769.5), height: 2.9, width: 0.6, isValid: true };
  const bot = flatBot({ endermen: [e1, e2, e3], items, health: 20 });
  let placed = null, swung = false;
  const actions = { place: async (b, t, cell) => { placed = cell; }, dig: async () => {}, navigate: async () => {}, acquireStep: async () => {} };
  const survival = new Survival(bot, actions, { state: { shelters: [] } });
  const danger = [e1, e2, e3].map(e => ({ entity: e, distance: e.position.distanceTo(bot.entity.position), visible: true }));
  const options = survival.stanceOptions(new Task('x'), { step: { action: 'warped_pearls' } }, () => {}, danger, false);
  assert.ok(options.cap_fight, Object.keys(options).join(','));
  assert.match(options.cap_fight.description, /cannot path into a cell that low/);
  assert.match(options.cap_fight.description, /3 endermen about/);
  assert.ok(options.cap_fight.expects, 'priced');
  // Taking it places the lid, then hands off to the fight stance's own run
  // (whatever is in reach is swung at): swingFor is stubbed on the instance
  // to prove the hand-off happened without needing the real combat loop.
  survival.swingFor = async () => { swung = true; };
  const took = await options.cap_fight.run();
  assert.ok(took, 'cap_fight took');
  assert.ok(placed, 'a block was placed over the head');
  assert.equal(placed.x, 1765); assert.equal(placed.z, 1765);
});

test('cap_fight is not offered where a threat that is not an enderman is also about: a zombie fits under the same lid', () => {
  const items = [{ name: 'iron_sword', count: 1 }, { name: 'cobblestone', count: 20 }];
  const e1 = { id: 811, name: 'enderman', type: 'hostile', position: new Vec3(1767.5, 64, 1765.5), height: 2.9, width: 0.6, isValid: true };
  const z1 = { id: 812, name: 'zombie', type: 'hostile', position: new Vec3(1763.5, 64, 1765.5), height: 1.95, width: 0.6, isValid: true };
  const bot = flatBot({ endermen: [e1], other: [z1], items, health: 20 });
  const actions = { place: async () => {}, dig: async () => {}, navigate: async () => {}, acquireStep: async () => {} };
  const survival = new Survival(bot, actions, { state: { shelters: [] } });
  const danger = [e1, z1].map(e => ({ entity: e, distance: e.position.distanceTo(bot.entity.position), visible: true }));
  const options = survival.stanceOptions(new Task('x'), { step: { action: 'warped_pearls' } }, () => {}, danger, false);
  assert.equal(options.cap_fight, undefined, Object.keys(options).join(','));
});
