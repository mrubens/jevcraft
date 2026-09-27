'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { sculkAbout, hearing } = require('../src/sculk');

// mid-230-n ran from a creeper into the deep dark, worked beside four sensors and a shrieker, and the warden it called killed it (2026-09-27).
function world({ canSummon = 'true' } = {}) {
  const registry = require('minecraft-data')('26.1');
  const at = { sensor: new Vec3(4, -27, 1), shrieker: new Vec3(5, -29, -4) };
  const bot = { registry, entity: { position: new Vec3(0.5, -25, 0.5) }, _shrieks: [Date.now() - 60000, Date.now() - 20000],
    findBlocks: ({ matching, maxDistance }) => {
      const out = [];
      if (matching.includes(registry.blocksByName.sculk_sensor.id)) out.push(at.sensor);
      if (matching.includes(registry.blocksByName.sculk_shrieker.id)) out.push(at.shrieker);
      return out.filter(p => p.distanceTo(bot.entity.position) <= maxDistance);
    },
    blockAt: p => ({ position: p, name: p.equals(at.shrieker) ? 'sculk_shrieker' : 'stone', getProperties: () => (p.equals(at.shrieker) ? { can_summon: canSummon } : {}) }) };
  return bot;
}

test('sculk near is said: the sensors and what they hear, the shrieker that calls a warden, and the warnings so far', () => {
  const said = sculkAbout(world());
  assert.equal(said.sensors, 1); assert.equal(said.shriekers, 1); assert.equal(said.withinHearing, true);
  assert.match(said.says, /1 sculk sensor, the nearest 4 blocks off \(within its hearing\); 1 sculk shrieker that can call a warden, the nearest 8 blocks off/);
  assert.match(said.says, /the fourth within about ten minutes calls a warden/);
  assert.match(said.says, /warned 2 times in the last ten minutes/);
  // A shrieker a player set down calls nothing.
  assert.equal(sculkAbout(world({ canSummon: 'false' })).shriekers, 0);
});

test('the retreat can tell a footing within a sensor\'s hearing from one out of it', () => {
  const heard = hearing(world(), 40);
  assert.equal(heard(new Vec3(6, -25, 1)), true);
  assert.equal(heard(new Vec3(20, -25, 1)), false);
});

test('every question about playing the game is told of the sculk near', async () => {
  const { decide } = require('../src/decisions');
  let seen = null, said = null;
  const client = { systemOne: async ({ state, rootInstructions }) => { seen = state; said = rootInstructions; return { answers: { branch_0: { choice: 'stay', confidence: 0.9 } } }; } };
  const bot = Object.assign(world(), { game: { dimension: 'overworld' } });
  await decide('pocket_next', { client, bot, goal: {}, tree: { stay: { description: 'a' }, leave: { description: 'b' } }, state: {} });
  assert.match(seen.sculk || '', /sculk shrieker that can call a warden/);
});
