'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
test('every mob the game calls hostile is a threat: a zombie villager is one', () => {
  // Trial 104: killed by a zombie villager that was on no list, hit five times with no threat in sight.
  const { threats } = require('../src/danger');
  const registry = require('minecraft-data')('26.1');
  const bot = { game: { dimension: 'overworld' }, entity: { position: new Vec3(0.5, 64, 0.5) }, registry, world: { raycast: () => null }, time: { timeOfDay: 18000 }, entities: {} };
  let id = 1;
  for (const e of registry.entitiesArray.filter(e => e.type === 'hostile' && !['enderman', 'zombified_piglin', 'giant', 'wither'].includes(e.name))) {
    bot.entities = { [id]: { id, name: e.name, type: 'hostile', position: new Vec3(4.5, 64, 0.5), height: e.height, width: e.width, isValid: true } };
    assert.equal(threats(bot).length, 1, e.name);
    id++;
  }
});

test('a goat is a threat when it has rammed the bot lately, or is close and one ram would end it', () => {
  // first-days-210: at 0.7 health among goats, it walked up to a rabbit beside two and was rammed to death.
  const { threats } = require('../src/danger');
  const registry = require('minecraft-data')('26.1');
  const goat = { id: 7, name: 'goat', type: 'animal', position: new Vec3(4.5, 64, 0.5), height: 1.3, width: 0.9, isValid: true };
  const bot = { game: { dimension: 'overworld' }, entity: { position: new Vec3(0.5, 64, 0.5) }, registry, world: { raycast: () => null }, time: { timeOfDay: 6000 }, entities: { 7: goat }, health: 20 };
  assert.equal(threats(bot).length, 0, 'at full health a goat is an animal');
  bot.health = 0.7;
  assert.deepEqual(threats(bot).map(t => t.entity.name), ['goat'], 'one ram ends it');
  goat.position = new Vec3(14.5, 64, 0.5);
  assert.equal(threats(bot).length, 0, 'far off');
  bot.health = 20; bot._hurtBy = { goat: Date.now() - 5000 };
  assert.deepEqual(threats(bot).map(t => t.entity.name), ['goat'], 'rammed a moment ago');
  assert(require('../src/combat-estimate').MOBS.goat.hit > 0);
});
