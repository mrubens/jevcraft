'use strict';
// Note 872: three or more blazes within two and a half blocks: the body
// breaks out to footing six clear of them before any stance is asked.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { Vec3 } = require('vec3');
const { Survival } = require('../src/survival');
const { Task } = require('../src/skills');

function swarmBot(blazes) {
  const registry = require('minecraft-data')('26.1');
  const entities = {};
  blazes.forEach(([x, z], i) => { entities[70 + i] = { id: 70 + i, name: 'blaze', type: 'hostile', position: new Vec3(x, 64.5, z), height: 1.8, width: 0.6, isValid: true }; });
  const footing = [new Vec3(9, 63, 0), new Vec3(3, 63, 0)];
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health: 14.9, food: 19, oxygenLevel: 20,
    entities, time: { timeOfDay: 6000 }, registry, entity: { position: new Vec3(0.5, 64, 0.5), yaw: 0, onGround: true, width: 0.6, height: 1.8, velocity: new Vec3(0, 0, 0) },
    inventory: { items: () => [{ name: 'iron_sword', count: 1 }, { name: 'netherrack', count: 40 }], slots: { 45: { name: 'shield' } }, emptySlotCount: () => 10 },
    blockAt: p => { const f = p.floored(); const s = f.y < 64; return { position: f, name: s ? 'nether_bricks' : 'air', boundingBox: s ? 'block' : 'empty', diggable: s }; },
    world: { raycast: () => null }, findBlocks: o => (o.count === 512 ? footing : []), lookAt: async () => {}, equip: async () => {}, attack() {},
    pathfinder: { movements: {}, setGoal() {}, getPathTo: () => ({ status: 'success', path: [new Vec3(9.5, 64, 0.5)] }) }, clearControlStates() {}, setControlState() {}, activateItem() {}, deactivateItem() {} });
  const danger = () => Object.values(entities).map(e => ({ entity: e, distance: e.position.distanceTo(bot.entity.position), visible: true })).sort((a, b) => a.distance - b.distance);
  return { bot, danger };
}

test('four blazes at arm\'s length: out to footing six clear of them, no stance asked; two are not a swarm (note 872)', async () => {
  const { bot, danger } = swarmBot([[1.7, 0.5], [0.5, 1.9], [-0.9, 0.5], [0.5, -1.0]]);
  const went = [];
  let asked = 0;
  const s = new Survival(bot, { navigate: async (b, t, goal) => { went.push([goal.x, goal.y, goal.z]); b.entity.position = new Vec3(goal.x + 0.5, goal.y, goal.z + 0.5); } }, { state: { shelters: [] } });
  s.decide = async () => { asked++; return { path: ['fight'], stale: true }; };
  const reports = []; s.report = (g, sv, r) => reports.push(r);
  assert.equal(await s.stanceStep(new Task('x'), {}, () => {}, danger(), false), true);
  assert.deepEqual(went, [[9, 64, 0]], 'the footing six clear, not the one three off');
  assert.equal(asked, 0);
  assert.equal(reports[0].action, 'break_from_swarm');
  assert.equal(reports[0].blazes, 4);
  // Two at arm's length: no break (the stance is asked as before).
  const two = swarmBot([[1.7, 0.5], [0.5, 1.9]]);
  const s2 = new Survival(two.bot, { navigate: async () => { throw new Error('walked'); } }, { state: { shelters: [] } });
  assert.equal(await s2.breakFromSwarm(new Task('x'), {}, () => {}, two.danger(), []).catch(() => 'threw'), false);
});
