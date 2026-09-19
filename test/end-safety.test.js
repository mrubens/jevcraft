'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { dragonThreat, checkEndEmergency, dodgeRoutes, evadeOverTerrain, evadeDragon } = require('../src/end-safety');
const registry = require('prismarine-registry')('26.1');
function fixture() {
  const phase = registry.entitiesByName.ender_dragon.metadataKeys.indexOf('phase');
  const dragon = { id: 20, name: 'ender_dragon', position: new Vec3(40, 66, .5), metadata: { [phase]: 8 } };
  const controls = {};
  const bot = { registry, game: { dimension: 'the_end' }, health: 20, isAlive: true,
    entity: { position: new Vec3(.5, 64, .5), onGround: true }, entities: { 20: dragon },
    blockAt: p => ({ name: p.y < 64 ? 'end_stone' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty' }),
    pathfinder: { setGoal() {} }, clearControlStates: () => { for (const key in controls) controls[key] = false; },
    setControlState: (key, value) => { controls[key] = value; }, look: async () => {}, emit() {},
  };
  return { bot, dragon, phase, controls };
}
test('charging and close flying dragons trigger reflexes, while distant flight and perched heads do not', () => {
  const { bot, dragon, phase } = fixture();
  assert.equal(dragonThreat(bot), dragon); assert.throws(() => checkEndEmergency(bot), { name: 'EndEmergency' });
  dragon.metadata[phase] = 0; assert.equal(dragonThreat(bot), undefined);
  dragon.position.x = 10; assert.equal(dragonThreat(bot), dragon);
  for (const value of [5, 6, 7, 9]) { dragon.metadata[phase] = value; assert.equal(dragonThreat(bot), undefined); }
  dragon.metadata[phase] = 8; dragon.position.y = 105; assert.equal(dragonThreat(bot), undefined);
});
test('dodge corridors prefer sideways ground and reject cliffs across the whole player footprint', () => {
  const { bot, dragon } = fixture();
  const route = dodgeRoutes(bot, dragon)[0]; assert.equal(Math.abs(route.direction.x), 0); assert.equal(route.direction.z, 1);
  assert.equal(route.distance, 8);
  const original = bot.blockAt;
  bot.blockAt = p => p.z >= 1 || p.z < 0 ? { name: 'air', boundingBox: 'empty' } : original(p);
  const bridgeRoutes = dodgeRoutes(bot, dragon);
  assert.equal(bridgeRoutes.length, 1); assert.equal(bridgeRoutes[0].direction.x, -1);
  bot.blockAt = () => ({ name: 'air', boundingBox: 'empty' });
  assert.deepEqual(dodgeRoutes(bot, dragon), []);
});
test('evasion cancellation clears movement and never publishes success', async () => {
  const { bot, controls } = fixture(), task = new Task('dodge'), goal = { endCombat: {} };
  const timer = setTimeout(() => task.cancel(), 30);
  await assert.rejects(evadeDragon(bot, task, goal, () => {}), { name: 'Cancelled' });
  clearTimeout(timer); assert(Object.values(controls).every(value => !value)); assert.equal(goal.endCombat.lastEvasion, undefined);
});

test('a small airborne knockback waits for real footing before inspecting a dodge corridor', async () => {
  const { bot } = fixture(), task = new Task('airborne dodge'), goal = { endCombat: {} };
  bot.entity.position.y = 64.3; bot.entity.onGround = false; bot.entity.velocity = new Vec3(0, .31, 0);
  let looked = false;
  bot.look = async () => { assert.equal(bot.entity.onGround, true); assert.equal(bot.entity.position.y, 64); looked = true; };
  const timer = setTimeout(() => { bot.entity.position.y = 64; bot.entity.onGround = true; }, 20);
  assert(await evadeDragon(bot, task, goal, () => {}, { timeoutMs: 10 }));
  clearTimeout(timer); assert(looked);
});

test('uneven-ground evasion surveys bounded routes without digging, placing or large drops and restores policy', async () => {
  for (const cancel of [false, true]) {
    const { bot, dragon } = fixture(), task = new Task('terrain dodge'), goal = { endCombat: {} };
    const movement = bot.pathfinder.movements = { canDig: true, maxDropDown: 3, allowSprinting: false, allow1by1towers: true, scafoldingBlocks: [1] };
    const original = { ...movement }; let surveys = 0, walked = false;
    bot.pathfinder.getPathTo = (m, dest) => {
      assert.equal(m.canDig, false); assert.equal(m.maxDropDown, 1); assert.deepEqual(m.scafoldingBlocks, []);
      // Reject the first route because it requires terrain mutation.
      return { status: 'success', path: [{ x: dest.x, y: dest.y, z: dest.z, toBreak: ++surveys === 1 ? [new Vec3(1, 64, 1)] : [] }] };
    };
    const run = evadeOverTerrain(bot, task, goal, () => {}, dragon, { walk: async (b, t, dest, options) => {
      assert.equal(options.timeoutMs, 3000); assert.equal(options.stallMs, 1000);
      walked = true; if (cancel) { task.cancel(); task.check(); }
      bot.entity.position = new Vec3(dest.x + .5, dest.y, dest.z + .5);
    } });
    if (cancel) await assert.rejects(run, { name: 'Cancelled' }); else { assert(await run); assert.equal(goal.endCombat.lastEvasion.terrainRoute, true); }
    assert(walked); assert.equal(surveys, 2); assert.deepEqual(movement, original);
  }
});
