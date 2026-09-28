'use strict';
// Note 617: mid-242-ah-fortress-5 (25586), "burned to death" at 17:06:21Z.
// The bot stood a block east of an edge at (-217.5, 55, -155.4) over the
// lava sea (its top at y 31), two blazes 13.6 and 14.8 blocks off to the
// east, the farther one glowing. shield_policy was asked for its shot at
// 17:06:08.3; the stance at 08.5 priced the rail at "about 8 in 100 that a
// fireball lands first" and the cover at 12, by the average rate of a
// volley every nine seconds. The volley was fired as Jev answered, the
// first fireball landed at 09.4 before a block was down, and its push
// carried the bot a block west, off the edge, 23 into the lava.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('node:events');
const { Task } = require('../src/skills');
const { Survival, shotsDue, shotChanceNow } = require('../src/survival');
const ce = require('../src/combat-estimate');

// The floor: nether bricks at y 54 from x -218 east, the lava sea's air west
// of it down to y 31.
const world = p => {
  const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z), position = new Vec3(x, y, z);
  if (y === 54 && x >= -218 && x <= -196 && z >= -162 && z <= -146) return { position, name: 'nether_bricks', boundingBox: 'block' };
  return y <= 31 ? { position, name: 'lava', boundingBox: 'empty' } : { position, name: 'air', boundingBox: 'empty' };
};
// The two blazes as the flight has them at 17:06:08.5; 342 glowing (its
// flags' bit 1), 343 not.
const blaze = (id, x, y, z, glowing) => ({ id, name: 'blaze', type: 'hostile', position: new Vec3(x, y, z), height: 1.8, width: 0.6, isValid: true, metadata: glowing ? { 16: 1 } : { 16: 0 } });
function sceneBot({ glowing = true, glowFor = 2.9, fireballs = [] } = {}) {
  const b342 = blaze(342, -203.41, 58.97, -153.03, glowing), b343 = blaze(343, -204.53, 57, -151.69, false);
  if (glowing && glowFor != null) b342._glowAt = T0 - glowFor * 1000;
  const entities = { 342: b342, 343: b343 };
  fireballs.forEach((f, i) => { entities[900 + i] = { id: 900 + i, name: 'small_fireball', type: 'projectile', position: f, isValid: true, velocity: new Vec3(0, 0, 0) }; });
  const items = [{ name: 'iron_sword', count: 1 }, { name: 'netherrack', count: 77 }, { name: 'beef', count: 5 }];
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health: 20, food: 19, oxygenLevel: 20,
    entity: { position: new Vec3(-217.5, 55, -155.42), onGround: true, height: 1.8, width: 0.6, velocity: new Vec3(0, 0, 0), metadata: [0] }, entities, time: { timeOfDay: 0 },
    inventory: { items: () => items, slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 7: { name: 'iron_leggings' }, 8: { name: 'iron_boots' }, 45: { name: 'shield' } } },
    world: { raycast: () => null }, blockAt: world, registry: require('minecraft-data')('26.1'),
    pathfinder: { movements: {}, setGoal() {}, getPathTo: () => ({ status: 'noPath', path: [] }) }, clearControlStates() {}, setControlState() {}, getControlState: () => false,
    activateItem() {}, deactivateItem() {}, lookAt: async () => {}, look: async () => {}, equip: async () => {}, attack: () => {}, findBlocks: () => [] });
  return { bot, b342, b343 };
}
// The clock held where the scene was built: the glow's seconds are read
// from Date.now, and a slow run would otherwise fire the volley meanwhile.
const T0 = Date.now();
function held(fn) {
  const real = Date.now;
  Date.now = () => T0;
  try { return fn(); } finally { Date.now = real; }
}
const threat = (bot, entity) => ({ entity, distance: entity.position.distanceTo(bot.entity.position), visible: true });

test('a glowing blaze\'s volley is due within the seconds a wall takes, and counted so, not by the average of a volley every nine seconds', () => held(() => {
  const { bot, b342 } = sceneBot();
  const due = shotsDue(bot, threat(bot, b342));
  assert.equal(due.glowing, true);
  assert.equal(due.shots.length, 3, 'all three of the volley still to come');
  assert.ok(due.shots[0].in < 1.3 && due.shots[2].in < 1.9, JSON.stringify(due.shots));
  const each = ce.fireballHit(threat(bot, b342).distance);
  // Within 1.2 seconds (the rail's window), the shots there, not 8 in 100.
  const within = due.shots.filter(s => s.in <= 1.2).length;
  const { chance } = shotChanceNow(bot, 1.2, [threat(bot, b342)]);
  assert.ok(Math.abs(chance - (1 - (1 - each) ** within)) < 1e-9, `${chance}`);
  assert.ok(chance > 0.2, `the volley in the window: ${chance}`);
  // By the average rate alone it was about 8 in 100.
  assert.ok(Math.min(1, 1.2 / ce.FIREBALL.volleySeconds) * ce.volleyHit(threat(bot, b342).distance) < 0.1);
}));

test('a blaze not glowing lands nothing sooner than its glow and the flight, and a fireball already in the air is counted', () => {
  const { bot, b343 } = sceneBot({ glowing: false });
  assert.equal(shotChanceNow(bot, 1.2, [threat(bot, b343)]).chance, 0, 'three seconds of glow before any shot');
  // A fireball of 343's four blocks out from it along its line to the bot.
  const eye = bot.entity.position.offset(0, 1.5, 0), from = b343.position, dir = eye.minus(from).normalize();
  const shot = from.plus(dir.scaled(4));
  const withShot = sceneBot({ glowing: false, fireballs: [shot] });
  const due = shotsDue(withShot.bot, threat(withShot.bot, withShot.b343));
  assert.equal(due.shots.length, 1);
  assert.equal(due.shots[0].air, true);
  const { chance } = shotChanceNow(withShot.bot, 1.2, [threat(withShot.bot, withShot.b343)]);
  assert.ok(Math.abs(chance - ce.fireballHit(threat(withShot.bot, withShot.b343).distance)) < 1e-9, `${chance}`);
});

test('the stance at 17:06:08.5 says the volley due on the rail, the cover and every stance that stays open over the drop', () => held(() => {
  const { bot, b342, b343 } = sceneBot();
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {}, acquireStep: async () => {} }, { state: { shelters: [] } });
  const options = survival.stanceOptions(new Task('x'), { step: { action: 'stalk_mob' } }, () => {}, [threat(bot, b343), threat(bot, b342)], false);
  const rail = options.rail_and_fight?.description || options.hold_on_span?.description;
  assert.ok(rail, Object.keys(options).join(','));
  assert.match(rail, /the blaze 15 blocks off is glowing now, its volley of three due at the bot in about [\d.]+, [\d.]+ and [\d.]+ seconds, each landing about \d+ in 100; so about (\d+) in 100 that a fireball lands first/);
  const said = Number(rail.match(/so about (\d+) in 100 that a fireball lands first/)[1]);
  assert.ok(said >= 20, `the rail's window with the volley in it: ${said} in 100, not 8`);
  // Every stance that stays open says it is due, and what it is.
  for (const k of ['fight', 'close_in', 'charge_nearest', 'keep_working'].filter(k => options[k])) {
    assert.match(options[k].description, /Due now: the blaze 15 blocks off is glowing now, its volley of three due at the bot in about .*; at least one lands about \d+ in 100 within [\d.]+ seconds, and one that lands while the bot is still open here is that push\./, k);
  }
}));

test('with neither blaze glowing and none in the air, the wall\'s window is said at no shot due', () => {
  const { bot, b342, b343 } = sceneBot({ glowing: false });
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {}, acquireStep: async () => {} }, { state: { shelters: [] } });
  const options = survival.stanceOptions(new Task('x'), { step: { action: 'stalk_mob' } }, () => {}, [threat(bot, b343), threat(bot, b342)], false);
  const rail = options.rail_and_fight?.description || options.hold_on_span?.description;
  assert.ok(rail, Object.keys(options).join(','));
  assert.match(rail, /so about 0 in 100 that a fireball lands first/);
  assert.doesNotMatch(options.fight.description, /Due now/);
});
