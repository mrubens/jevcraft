'use strict';
// Note 951: 25592 (mid-242-ka-nether-1, 2026-10-02 22:26:32Z) ran from an
// enderman along a ledge over lava, was told nothing of it, took one blow and
// went four down into the lava from 14.3 health.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { Survival } = require('../src/survival');

// Netherrack floor at y 63; a trench of lava along z = 3 (x 2..12), four down.
function edgeBot() {
  const blockAt = p => {
    const f = p.floored();
    const trench = f.z === 3 && f.x >= 2 && f.x <= 12;
    const name = trench ? (f.y <= 59 ? 'lava' : 'air') : f.y < 64 ? 'netherrack' : 'air';
    return { position: f, name, boundingBox: name === 'netherrack' ? 'block' : 'empty', diggable: name === 'netherrack' };
  };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health: 20, food: 20, foodSaturation: 0, oxygenLevel: 20,
    entities: {}, time: { timeOfDay: 0 }, registry: require('minecraft-data')('26.1'),
    entity: { position: new Vec3(0.5, 64, 0.5), onGround: true, width: 0.6, height: 1.8, velocity: new Vec3(0, 0, 0), eyeHeight: 1.62, effects: {} },
    inventory: { items: () => [], slots: {}, emptySlotCount: () => 10 }, heldItem: null,
    blockAt, world: { raycast: () => null }, findBlocks: () => [], lookAt: async () => {}, look: async () => {}, equip: async () => {},
    clearControlStates() {}, setControlState() {}, getControlState: () => false, activateItem() {}, deactivateItem() {} });
  // The route east runs along z = 2, beside the trench; the route west on plain ground.
  const line = (from, to, z) => { const out = []; const s = Math.sign(to - from); for (let x = from; x !== to + s; x += s) out.push(new Vec3(x + 0.5, 64, z + 0.5)); return out; };
  bot.pathfinder = { movements: {}, setGoal() {}, getPathTo: (m, goal) => ({ status: 'success', path: goal.x > 0 ? line(0, 10, 2) : line(0, -10, 0) }) };
  return bot;
}

test('with a biter about, the run goes by a route off the deadly edge where there is one, and by the edge only where it is the only way', async () => {
  const bot = edgeBot();
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
  const enderman = { id: 7, name: 'enderman', position: new Vec3(0.5, 64, -3.5) };
  const east = new Vec3(10, 64, 2), west = new Vec3(-10, 64, 0);
  // East is searched first: with a biter about, it is passed over for the west.
  let way = await survival.wayAway(new Task('x'), {}, { about: [enderman], heavy: false, pushing: true }, [east, west]);
  assert.deepEqual([way.p.x, way.p.z], [-10, 0]);
  assert.equal(way.edge, undefined);
  // The edge route alone: taken, and its edge cells counted for the option's words.
  way = await survival.wayAway(new Task('x'), {}, { about: [enderman], heavy: false, pushing: true }, [east]);
  assert.deepEqual([way.p.x, way.p.z], [10, 2]);
  assert.ok(way.edge >= 8, `edge ${way.edge}`);
  // With nothing about that pushes: the first route found, as before.
  way = await survival.wayAway(new Task('x'), {}, { about: [enderman], heavy: false, pushing: false }, [east, west]);
  assert.deepEqual([way.p.x, way.p.z], [10, 2]);
});
