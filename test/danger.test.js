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

test('a wolf that bites turns its pack into threats; any other mob that hurt the bot is one too', () => {
  // mid-218-k was bitten from twenty to none by wolves, never counted a threat, while it chose which cow to hunt (2026-09-27).
  const { threats } = require('../src/danger');
  const registry = require('minecraft-data')('26.1');
  const wolf = (id, x) => ({ id, name: 'wolf', type: 'animal', position: new Vec3(x, 64, 0.5), height: 0.85, width: 0.6, isValid: true });
  const bear = { id: 9, name: 'polar_bear', type: 'animal', position: new Vec3(0.5, 64, 5.5), height: 1.4, width: 1.4, isValid: true };
  const bot = { game: { dimension: 'overworld' }, entity: { position: new Vec3(0.5, 64, 0.5) }, registry, world: { raycast: () => null }, time: { timeOfDay: 6000 },
    entities: { 1: wolf(1, 2.5), 2: wolf(2, 4.5), 3: wolf(3, 6.5), 9: bear } };
  assert.equal(threats(bot).length, 0, 'wolves and a bear left be are not threats');
  bot._hurtBy = { wolf: Date.now() }; bot._hurtById = { 1: Date.now() };
  assert.deepEqual(threats(bot).map(t => t.entity.id).sort(), [1, 2, 3], 'the whole pack');
  bot._hurtById[9] = Date.now();
  assert(threats(bot).some(t => t.entity.id === 9), 'a bear that struck the bot');
  bot._hurtBy = { wolf: Date.now() - 60000 }; bot._hurtById = { 1: Date.now() - 60000, 9: Date.now() - 60000 };
  assert.equal(threats(bot).length, 0, 'a minute on, calm again');
});

test('a shooter a charge could not reach is still a threat: its bow reaches the bot', () => {
  // mid-230-p's skeleton, marked unreachable after a charge, shot it every three to six seconds and nothing answered (2026-09-27).
  const { immediateThreat } = require('../src/danger');
  const registry = require('minecraft-data')('26.1');
  const skeleton = { id: 7, name: 'skeleton', type: 'hostile', position: new Vec3(8.5, 64, 0.5), height: 1.99, width: 0.6, isValid: true };
  const zombie = { id: 8, name: 'zombie', type: 'hostile', position: new Vec3(0.5, 64, 6.5), height: 1.95, width: 0.6, isValid: true };
  const bot = { game: { dimension: 'overworld' }, entity: { position: new Vec3(0.5, 64, 0.5) }, registry, world: { raycast: () => null }, time: { timeOfDay: 6000 },
    entities: { 7: skeleton }, _unreachable: { ids: [7, 8], until: Date.now() + 20000 } };
  assert.equal(immediateThreat(bot)?.entity.id, 7, 'the skeleton');
  bot.entities = { 8: zombie };
  assert.equal(immediateThreat(bot), undefined, 'a walker the charge could not reach is left be while it lands nothing');
});

test('an unseen biter within a hit and a jump is a threat where a knock is a fall, and not on firm ground (mid-227-r-nether-1-nether-1)', () => {
  const { immediateThreat } = require('../src/danger');
  const registry = require('minecraft-data')('26.1');
  const cube = { id: 9, name: 'magma_cube', type: 'hostile', position: new Vec3(-0.5, 67, 1.5), height: 2, width: 2, isValid: true };
  // Every ray blocked: out of sight.
  const lip = p => ({ position: p, name: p.x >= 2 && p.y < 64 ? (p.y <= 20 ? 'lava' : 'air') : p.y < 64 ? 'netherrack' : 'air', boundingBox: !(p.x >= 2) && p.y < 64 ? 'block' : 'empty' });
  const bot = { game: { dimension: 'the_nether' }, entity: { position: new Vec3(0.5, 64, 0.5) }, registry, health: 20, food: 20, time: { timeOfDay: 6000 },
    world: { raycast: (from) => ({ position: from.offset(0, 0.1, 0) }) }, blockAt: lip, entities: { 9: cube }, inventory: { items: () => [], slots: [] } };
  assert.equal(immediateThreat(bot)?.entity.id, 9, 'at the lip of a drop into lava');
  bot.blockAt = p => ({ position: p, name: p.y < 64 ? 'netherrack' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty' });
  assert.equal(immediateThreat(bot), undefined, 'on firm ground an unseen one is not');
});

test('a shooter whose kind hit the bot a moment ago is a threat however far, hunted or not (mid-227-r-nether-3)', () => {
  const { immediateThreat } = require('../src/danger');
  const registry = require('minecraft-data')('26.1');
  const blaze = { id: 4, name: 'blaze', type: 'hostile', position: new Vec3(34.5, 64, 0.5), height: 1.8, width: 0.6, isValid: true };
  const bot = { game: { dimension: 'the_nether' }, entity: { position: new Vec3(0.5, 64, 0.5) }, registry, health: 12, food: 20, time: { timeOfDay: 6000 },
    world: { raycast: () => null }, blockAt: p => ({ position: p, name: p.y < 64 ? 'netherrack' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty' }),
    entities: { 4: blaze }, inventory: { items: () => [], slots: [] } };
  // In sight within its forty-eight blocks, a blaze's fire reaches the bot
  // (combat-estimate RANGE, mid-235-p-fortress-1, note 509).
  assert.equal(immediateThreat(bot)?.entity.id, 4, 'thirty-four off, in sight, unhunted: within its reach');
  // Hunted and fit, it is the hunt's while it lands nothing.
  bot.health = 20; bot._huntingEntity = { name: 'blaze', until: Date.now() + 60000 };
  assert.equal(immediateThreat(bot), undefined, 'hunted and landing nothing: the hunt\'s');
  bot._recentHurtAt = Date.now(); bot._hurtBy = { blaze: Date.now() };
  assert.equal(immediateThreat(bot)?.entity.id, 4, 'its fire landing: a threat');
});
