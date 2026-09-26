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

test('a goat is a threat once it has rammed the bot; near, it is a fact in riskNow, and at 0.7 health a high one', () => {
  // first-days-210: at 0.7 health among goats, it walked up to a rabbit beside two and was rammed to death, told of neither.
  const { threats } = require('../src/danger');
  const { riskNow } = require('../src/risk');
  const registry = require('minecraft-data')('26.1');
  const goat = { id: 7, name: 'goat', type: 'animal', position: new Vec3(4.5, 64, 0.5), height: 1.3, width: 0.9, isValid: true };
  const bot = { game: { dimension: 'overworld' }, entity: { position: new Vec3(0.5, 64, 0.5) }, registry, world: { raycast: () => null }, time: { timeOfDay: 6000 }, entities: { 7: goat }, health: 20, food: 20, inventory: { items: () => [], slots: [] } };
  assert.equal(threats(bot).length, 0, 'an animal until it rams');
  assert.match(riskNow(bot).animalsThatHit.what.goat, /rams whoever is near/);
  assert.deepEqual(riskNow(bot).animalsThatHit.near, [{ name: 'goat', distance: 4 }]);
  bot.health = 0.7;
  assert.equal(threats(bot).length, 0, 'still no rule: the facts are Jev\'s');
  assert.match(riskNow(bot).level, /^high: one hit from the goat 4 blocks off would end the bot/);
  bot.health = 20; bot._hurtBy = { goat: Date.now() - 5000 };
  assert.deepEqual(threats(bot).map(t => t.entity.name), ['goat'], 'rammed a moment ago: it is attacking');
  assert(require('../src/combat-estimate').MOBS.goat.hit > 0);
});

test('a spider by day is calm only in daylight: one in a dark cave is a threat', () => {
  // first-days-203: at y 19 in a cave by day, a spider at arm's length was counted by no layer.
  const { threats } = require('../src/danger');
  const registry = require('minecraft-data')('26.1');
  const spider = { id: 3, name: 'spider', type: 'hostile', position: new Vec3(2.5, 19, 0.5), height: 0.9, width: 1.4, isValid: true };
  let light = { skyLight: 0, light: 0 };
  const bot = { game: { dimension: 'overworld' }, entity: { position: new Vec3(0.5, 19, 0.5) }, registry, world: { raycast: () => null }, time: { timeOfDay: 6000 }, entities: { 3: spider }, blockAt: () => ({ name: 'cave_air', ...light }) };
  assert.deepEqual(threats(bot).map(t => t.entity.name), ['spider'], 'dark cave, midday');
  light = { skyLight: 15, light: 0 };
  assert.equal(threats(bot).length, 0, 'in the sun');
  light = { skyLight: 0, light: 14 };
  assert.equal(threats(bot).length, 0, 'by a torch');
  delete bot.blockAt;
  assert.equal(threats(bot).length, 0, 'light unknown: the hour decides, as before');
});

test('an angry enderman closing on the bot is the bot\'s before it is at arm\'s length; one keeping its distance is not', () => {
  // mid-236-c: one screaming from twenty blocks was counted only at four, and hit for seven three times in two seconds after.
  const { provoked } = require('../src/danger');
  const reg = require('prismarine-registry')('26.1');
  const { Vec3 } = require('vec3');
  const key = reg.entitiesByName.enderman.metadataKeys.indexOf('creepy');
  const bot = { registry: reg, entity: { position: new Vec3(0, 64, 0) } };
  const e = { id: 5, name: 'enderman', position: new Vec3(20, 64, 0), metadata: { [key]: true } };
  assert.equal(provoked(bot, e), false, 'first seen at twenty');
  e.position = new Vec3(12, 64, 0);
  assert.equal(provoked(bot, e), true, 'eight blocks nearer at once: coming at the bot');
  const far = { id: 6, name: 'enderman', position: new Vec3(-20, 64, 0), metadata: { [key]: true } };
  assert.equal(provoked(bot, far), false);
  far.position = new Vec3(-19, 64, 1);
  assert.equal(provoked(bot, far), false, 'angry at something else, wandering');
});
