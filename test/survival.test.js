'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { threats, checkThreats } = require('../src/danger');
const shelter = require('../src/shelter');
const { reservedForConstruction } = require('../src/build-sites');
const { Task, navigate } = require('../src/skills');
const { Survival } = require('../src/survival');
const { EventEmitter } = require('node:events');
const { houseBlueprint, verifyHouse } = require('../src/objectives');

test('threat visibility uses the entire ray and respects solid cover', () => {
  const bot = { entity: { position: new Vec3(0, 64, 0) }, time: { timeOfDay: 13000 },
    entities: { 1: { name: 'skeleton', position: new Vec3(12, 64, 0), height: 1.8 } },
    world: { raycast: (eye, direction, distance) => {
      assert(distance > 12); assert(Math.abs(direction.norm() - 1) < 1e-6);
      return { intersect: new Vec3(4, 65.5, 0) };
    } } };
  assert.equal(threats(bot)[0].visible, false);
  assert.doesNotThrow(() => checkThreats(bot));
  bot.world.raycast = () => null;
  assert.throws(() => checkThreats(bot), { name: 'NeedsSafety' });
});

test('a shelter is safe only with complete nonfalling shell, floor, and clear interior', () => {
  const origin = new Vec3(0, 64, 0);
  const refuge = { origin, dimension: 'overworld' };
  const blocks = new Map();
  const bot = { game: { dimension: 'overworld' }, entity: { position: origin.offset(0.5, 0, 0.5) },
    blockAt: p => ({ name: blocks.get(`${p}`) || (p.y < 64 ? 'stone' : 'air'),
      boundingBox: blocks.has(`${p}`) || p.y < 64 ? 'block' : 'empty' }) };
  assert.equal(shelter.safeSite(bot, origin, {}), true);
  assert.equal(shelter.sealed(bot, refuge), false);
  for (const p of shelter.shell(origin)) blocks.set(`${p}`, 'dirt');
  assert.equal(shelter.inside(bot, refuge), true);
  assert.equal(shelter.sealed(bot, refuge), true);
  const roof = `${origin.offset(0, 2, 0)}`;
  blocks.set(roof, 'gravel');
  assert.equal(shelter.sealed(bot, refuge), false);
  blocks.set(roof, 'dirt'); blocks.set(`${origin}`, 'dirt');
  assert.equal(shelter.sealed(bot, refuge), false);
  assert(reservedForConstruction({ survival: { shelters: [refuge] } }, origin.offset(0, -1, 0)));
});

test('a newly observed threat interrupts an in-flight navigation', async () => {
  let stopped = false;
  const task = new Task('house', 'build a house');
  const bot = { oxygenLevel: 20, entity: { position: new Vec3(0, 64, 0) },
    pathfinder: { goto: () => new Promise(() => {}), setGoal: value => { if (value === null) stopped = true; } },
    clearControlStates() {}, stopDigging() {} };
  const timer = setTimeout(() => { task.interruptCheck = () => { const err = new Error('Skeleton approached'); err.name = 'NeedsSafety'; throw err; }; }, 10);
  try { await assert.rejects(navigate(bot, task, {}), { name: 'NeedsSafety' }); }
  finally { clearTimeout(timer); }
  assert.equal(stopped, true);
  assert.equal(task.cancelled, false, 'The player task remains resumable after a survival interruption');
});

test('shelter construction rechecks materials consumed by the approach before sealing exits', async () => {
  let carried = 29;
  let placed = 0;
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld' },
    entity: { position: new Vec3(5.5, 64, 0.5) },
    inventory: { items: () => [{ name: 'dirt', count: carried }] },
    blockAt: p => ({ name: p.y < 64 ? 'stone' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty' }) });
  const state = { shelters: [{ origin: { x: 0, y: 64, z: 0 }, dimension: 'overworld' }] };
  const controller = new Survival(bot, {
    navigate: async () => { bot.entity.position = new Vec3(0.5, 64, 0.5); carried = 2; },
    place: async () => { placed++; },
  }, { state });
  await controller.refugeStep(new Task('house', 'build a house'), { survival: state }, () => {});
  assert.equal(placed, 0, 'Do not close the room when travel spent the remaining roof materials');
});

test('a completed house becomes a persistent refuge with a temporary two-block night closure', async () => {
  const blueprint = houseBlueprint(new Vec3(0, 64, 0));
  const blocks = new Map(blueprint.blocks.map(p => [`${new Vec3(p.x, p.y, p.z)}`, p.material]));
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld' }, entities: {}, time: { timeOfDay: 14000 },
    entity: { position: new Vec3(0.5, 64, 0.5) }, inventory: { items: () => [{ name: 'dirt', count: 2 }] },
    blockAt: p => ({ name: blocks.get(`${p}`) || (p.y < 64 ? 'stone' : 'air'), boundingBox: blocks.has(`${p}`) || p.y < 64 ? 'block' : 'empty' }) });
  const actions = { place: async (b, t, p, material) => blocks.set(`${p}`, material),
    dig: async (b, t, p) => blocks.delete(`${p}`), navigate: async (b, t, g) => { bot.entity.position = new Vec3(g.x + 0.5, g.y, g.z + 0.5); } };
  const survival = new Survival(bot, actions);
  assert.equal(survival.rememberHouse(blueprint), true);
  assert.equal(survival.rememberHouse(blueprint), false, 'Do not duplicate a remembered home');
  const restored = new Survival(bot, actions, { state: JSON.parse(JSON.stringify(survival.state)) });
  const refuge = restored.currentShelter();
  assert.equal(refuge.kind, 'house');
  assert.equal(shelter.missingShell(bot, refuge).length, 2);
  await restored.refugeStep(new Task('test', 'shelter'), {}, () => {});
  assert(shelter.inside(bot, refuge)); assert(shelter.sealed(bot, refuge));
  assert.equal(blocks.size, blueprint.blocks.length + 2);
  await restored.leave(new Task('test', 'leave'), {}, () => {}, refuge);
  assert(!shelter.inside(bot, refuge));
  assert(verifyHouse(bot, blueprint).ok, 'The original house is intact and its doorway is clear again');
});
