'use strict';
// Note 752g. 25584 (18:19:37 to 18:21:10Z) at 7.6 health, no food carried,
// was asked the stance twelve times in ninety seconds about a ghast 44 to 60
// blocks off in sight, no hit from its kind; hoglin_pillar was chosen seven
// times (18:05 to 18:14Z) and no hunt made, the food trip still saying "none
// of these hunts made yet". 25588 (18:39:05.9Z) chose take_cover from a
// skeleton that stepped behind a block 0.6 seconds later, and the stance came
// back without take_cover; every option led with a zombie 15 blocks off.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('node:events');
const danger = require('../src/danger');

const T0 = Date.parse('2026-09-30T18:19:37Z');

test('a ghast kept past forty blocks in sight a minute, no hit from its kind, stands off, said with the record; one within forty does not (25584, note 752g)', t => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const ghast = { id: 41, name: 'ghast', type: 'hostile', position: new Vec3(50.5, 60, 0.5), height: 4, width: 4, isValid: true, metadata: [] };
  const bot = { game: { dimension: 'the_nether', difficulty: 'normal', gameMode: 'survival' }, health: 7.6, food: 15, oxygenLevel: 20, time: { timeOfDay: 6000 },
    entity: { position: new Vec3(0.5, 45, 0.5), eyeHeight: 1.62, metadata: [0] }, entities: { 41: ghast }, inventory: { items: () => [], slots: [] }, registry: { entitiesByName: {} },
    world: { raycast: () => null }, blockAt: p => p.y < 45 ? { name: 'netherrack', boundingBox: 'block', position: p } : { name: 'air', boundingBox: 'empty', position: p } };
  for (let s = 0; s <= 70; s += 5) { t.mock.timers.setTime(T0 + s * 1000); danger.threats(bot, 64); }
  const g = danger.threats(bot, 64).find(x => x.entity === ghast);
  assert.equal(g.visible, true);
  assert(danger.standsOff(bot, g), 'stands off');
  assert.match(danger.reachSays(bot, g), /in the played record, of the ghast's shots coming at the bot from 40 blocks and more 9 of 149 landed \(from under 24, 9 of 56\)/);
  ghast.position = new Vec3(30.5, 60, 0.5);
  t.mock.timers.setTime(T0 + 71000);
  assert.equal(danger.standsOff(bot, danger.threats(bot, 64).find(x => x.entity === ghast)), null, 'within forty: not standing off');
});

test('the food trip says how often a hoglin hunt was chosen and what it came to (25584, note 752g)', () => {
  const { huntsSays } = require('../src/nether-food');
  const now = T0;
  const goal = { netherFood: { chosen: [0, 3, 5, 8].map(m => ({ at: now - (10 - m) * 60000, route: 'hoglin_pillar' })) } };
  assert.match(huntsSays(goal, now).huntsSaid, /^none of these hunts made yet; chosen 4 times in the last 10 minutes, none of them coming to a hunt: something else took the turn each time$/);
  goal.netherFood.hunts = [{ at: now - 60000, route: 'hoglin_pillar', meat: 0, why: 'walked to where a hoglin was seen and none was within thirty-two blocks' }];
  assert.match(huntsSays(goal, now).huntsSaid, /^1 hunt of a hoglin made in this trial, 0 bringing meat, the last 1 minute ago: walked to where .*; chosen 4 times in the last 10 minutes, coming to 1 hunt$/);
});

function skeletonScene() {
  const skeleton = { id: 51, name: 'skeleton', type: 'hostile', position: new Vec3(9.5, 64, 0.5), height: 1.99, width: 0.6, isValid: true, heldItem: { name: 'bow' } };
  const zombie = { id: 52, name: 'zombie', type: 'hostile', position: new Vec3(-14.5, 64, 0.5), height: 1.95, width: 0.6, isValid: true };
  let wall = false;
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, health: 20, food: 20, oxygenLevel: 20,
    entities: { 51: skeleton, 52: zombie }, time: { timeOfDay: 18000 }, registry: require('minecraft-data')('26.1'),
    entity: { position: new Vec3(0.5, 64, 0.5), yaw: 0, onGround: true, width: 0.6, height: 1.8, velocity: new Vec3(0, 0, 0) },
    inventory: { items: () => [{ name: 'iron_sword', count: 1 }, { name: 'cobblestone', count: 40 }], slots: { 45: { name: 'shield' } }, emptySlotCount: () => 10 },
    blockAt: p => { const f = p.floored(); const s = f.y < 64 || (wall && f.x === 5 && f.z === 0 && f.y <= 66); return { position: f, name: s ? 'stone' : 'air', boundingBox: s ? 'block' : 'empty', diggable: s, shapes: s ? [[0, 0, 0, 1, 1, 1]] : [] }; },
    world: { raycast: (from, dir) => wall && dir.x > 0 ? { position: new Vec3(5, 64, 0), intersect: from.offset(4.5 - from.x + 0.5 - 0.5, 0, 0) } : null }, findBlocks: () => [], lookAt: async () => {}, look: async () => {}, equip: async () => {}, attack() {} });
  return { bot, skeleton, zombie, hide: () => { wall = true; } };
}

test('a shooter seen a moment ago stays in the stance\'s danger when it steps out of sight, and the stance leads with it shooting (25588, note 752g)', t => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const { Survival } = require('../src/survival');
  const { Task } = require('../src/skills');
  const { bot, skeleton, hide } = skeletonScene();
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
  assert(survival.encounterDanger().some(x => x.entity === skeleton), 'in sight');
  hide();
  t.mock.timers.setTime(T0 + 600);
  const d = survival.encounterDanger();
  const kept = d.find(x => x.entity === skeleton);
  assert(kept, 'out of sight 0.6 s later: still in the danger');
  const options = survival.stanceOptions(new Task('x'), {}, () => {}, d, false);
  assert.match(Object.values(options)[0].description, /Shooting at the bot from here: the skeleton 9 blocks off, seen a moment ago \(it fires from as far as \d+\)\./);
  t.mock.timers.setTime(T0 + 11000);
  assert(!survival.encounterDanger().some(x => x.entity === skeleton), 'out of sight ten seconds on: gone from it');
});
