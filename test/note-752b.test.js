'use strict';
// Note 752b: after note 752 went live (12:42Z).
//
// 25594 (mid-239-bd, 13:04:38 to 13:05:08Z) went 20 to 0 in 27 seconds
// looting a chest at y 13: a skeleton six blocks off landed the hits, two
// of them with the shield up; at 4 health every stance opened "The spider
// 18 blocks off, the hardest hitter ...", and a beef was carried, never
// eaten. 25583 (mid-244-fe, 13:04:36 to 13:06:26Z) on a pillar over two
// hoglins was asked encounter_stance seven times in a minute and a half:
// "a way not on offer when it was chosen is on offer now: come down", then
// "shoot 5353", then "the piglin brute it was chosen against is gone".
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('node:events');
const hitLog = require('../src/hit-log');
const holds = require('../src/holds');
const { Survival } = require('../src/survival');
const { Task } = require('../src/skills');

const T0 = Date.parse('2026-09-30T13:04:38Z');

function chestBot({ health = 4, beef = true } = {}) {
  const skeleton = { id: 11, name: 'skeleton', type: 'hostile', position: new Vec3(6.5, 13, 0.5), height: 1.99, width: 0.6, isValid: true, heldItem: { name: 'bow' } };
  const spider = { id: 12, name: 'spider', type: 'hostile', position: new Vec3(-12.5, 13, 13.5), height: 0.9, width: 1.4, isValid: true };
  const solid = p => p.y < 13;
  const items = [{ name: 'iron_sword', count: 1 }, { name: 'cobblestone', count: 30 }, ...(beef ? [{ name: 'cooked_beef', count: 1 }] : [])];
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, health, food: 15, oxygenLevel: 20,
    entities: { 11: skeleton, 12: spider }, time: { timeOfDay: 6000 }, registry: require('minecraft-data')('26.1'),
    entity: { position: new Vec3(0.5, 13, 0.5), yaw: 0, onGround: true, width: 0.6, height: 1.8, velocity: new Vec3(0, 0, 0) },
    inventory: { items: () => items, slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 45: { name: 'shield' } }, emptySlotCount: () => 10 },
    blockAt: p => { const f = p.floored(); const s = solid(f); return { position: f, name: s ? 'stone' : 'air', boundingBox: s ? 'block' : 'empty', diggable: s, shapes: s ? [[0, 0, 0, 1, 1, 1]] : [] }; },
    world: { raycast: () => null }, findBlocks: () => [], lookAt: async () => {}, look: async () => {}, equip: async () => {}, attack() {} });
  const t = e => ({ entity: e, distance: e.position.distanceTo(bot.entity.position), visible: true });
  return { bot, skeleton, spider, danger: () => [t(skeleton), t(spider)].sort((a, b) => a.distance - b.distance) };
}

test('the hit log says who is hitting the bot, from which side, and a hit taken with the shield up from a side it does not face as a second attacker (25594, note 752b)', t => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const { bot, skeleton, danger } = chestBot();
  // Facing north (yaw 0 faces -z): the skeleton at +x is to the side, one
  // due north in front, one due south behind.
  assert.equal(hitLog.sideOf(bot, new Vec3(0.5, 13, -5)), 'in front');
  assert.equal(hitLog.sideOf(bot, new Vec3(0.5, 13, 6)), 'behind');
  bot._shieldRaised = true;
  hitLog.note(bot, skeleton);
  t.mock.timers.setTime(T0 + 4000);
  hitLog.note(bot, skeleton);
  const says = hitLog.says(bot, danger());
  assert.match(says, /^Hitting the bot now: the skeleton 6 blocks off \(2 hits in the last 20 seconds, the last 0 seconds ago, from to the (left|right); each landed with the shield up\)\./);
  assert.match(says, /A hit landed with the shield up from to the (left|right): the shield covers only the side the bot faces, so something there is striking too\./);
  // Nothing lately: nothing said.
  t.mock.timers.setTime(T0 + 60000);
  assert.equal(hitLog.says(bot, danger()), '');
});

test('at 4 health under a skeleton\'s hits, every stance leads with the skeleton hitting, not the spider 18 blocks off, and eating and breaking the line are named and listed first with their times (25594, note 752b)', t => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const { bot, skeleton, danger } = chestBot();
  hitLog.note(bot, skeleton);
  bot._hurtBy = { skeleton: T0 }; bot._recentHurtAt = T0;
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
  const options = survival.stanceOptions(new Task('x'), {}, () => {}, danger(), false);
  const keys = Object.keys(options);
  for (const [k, o] of Object.entries(options)) {
    if (k === 'none_good') continue;
    assert.match(o.description, /Hitting the bot now: the skeleton 6 blocks off \(1 hit in the last 20 seconds/, k);
    assert.doesNotMatch(o.description, /^The spider/, k);
  }
  assert(options.eat, 'the beef is offered');
  assert.equal(keys[0], Object.entries(options).filter(([, o]) => o.quick).sort((a, b) => a[1].quick.seconds - b[1].quick.seconds)[0][0], 'the quickest way out of the hits listed first');
  assert.match(options.eat.description, /^At 4 health and being hit, the ways out of the hits here, quickest first: .*eat the cooked beef, 1\.6 seconds standing still/);
});

test('a stance held on a pillar is not asked again for its own way down coming on offer, a shot at another mob, or one of several mobs gone that was not the nearest (25583, note 752b)', () => {
  const hoglin = { entity: { id: 1, name: 'hoglin' }, distance: 6.1, visible: true };
  const hoglin2 = { entity: { id: 2, name: 'hoglin' }, distance: 9.2, visible: true };
  const brute = { entity: { id: 3, name: 'piglin_brute' }, distance: 10.5, visible: true };
  const hold = holds.begin({ choice: 'pillar', at: T0, health: 20, expects: { damage: 0, seconds: 15 }, mobs: [hoglin, hoglin2, brute], offered: ['pillar', 'shield_guard', 'shoot_5316', 'fight'] });
  const now = T0 + 20000;
  assert.equal(holds.diverged(hold, { now, health: 20, mobs: [hoglin, hoglin2, brute], offered: ['pillar', 'shield_guard', 'shoot_5353', 'fight'] }), null, 'a shot at another mob is the same way');
  assert.equal(holds.diverged(hold, { now, health: 20, mobs: [hoglin, hoglin2], offered: ['pillar', 'fight'] }), null, 'the brute behind the hoglins gone is not news');
  assert.match(holds.diverged(hold, { now, health: 20, mobs: [hoglin2, brute], offered: ['pillar', 'fight'] }), /the hoglin it was chosen against is gone/, 'the nearest gone is');
  assert.match(holds.diverged(hold, { now, health: 20, mobs: [hoglin, hoglin2, brute], offered: ['pillar', 'fight', 'seal'] }), /a way not on offer when it was chosen is on offer now: seal/, 'a way truly new still is');
});

test('the pillar\'s own come_down, on offer once the bot is up within the stance\'s own time, does not end the hold (25583, note 752b)', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const hoglin = { id: 5, name: 'hoglin', type: 'hostile', position: new Vec3(4, 65, 0), height: 1.4, width: 1.4, isValid: true, metadata: [] };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health: 20, food: 20, oxygenLevel: 20,
    entities: { 5: hoglin }, time: { timeOfDay: 6000 }, registry: require('minecraft-data')('26.1'),
    entity: { position: new Vec3(0, 65, 0), onGround: true, width: 0.6, height: 1.8, velocity: new Vec3(0, 0, 0), metadata: { 0: 0 } },
    inventory: { items: () => [{ name: 'iron_sword', count: 1 }], slots: { 45: { name: 'shield' } }, emptySlotCount: () => 20 },
    blockAt: p => ({ position: p.floored(), name: 'air', boundingBox: 'empty', diggable: false, shapes: [] }),
    world: { raycast: () => null }, findBlocks: () => [], lookAt: async () => {}, look: async () => {}, equip: async () => {}, attack() {},
    pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, setControlState() {}, activateItem() {}, deactivateItem() {} });
  const threat = () => ({ entity: hoglin, distance: hoglin.position.distanceTo(bot.entity.position), visible: true });
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
  let up = false;
  const asked = [];
  survival.stanceOptions = () => ({
    pillar: { description: 'Pillar up two.', expects: { damage: 0, seconds: 15 }, run: async () => { up = true; return true; } },
    shield_guard: { description: 'Shield.', expects: { damage: 3, seconds: 15 }, run: async () => true },
    ...(up ? { come_down: { description: 'Come down.', run: async () => true } } : {}),
  });
  survival.decide = async (task, goal, save, q) => { asked.push(Object.keys(q.tree)); return { path: ['pillar'] }; };
  survival.scoutRetreat = async () => {};
  for (let ms = 0; ms <= 40000; ms += 1000) {
    t.mock.timers.setTime(T0 + ms);
    await survival.stanceStep(new Task('x'), {}, () => {}, [threat()], false);
  }
  assert.equal(asked.length, 1, `asked ${asked.length} times`);
});

test('a creeper parked 7.3 blocks off for a minute, not walking at the bot, stands off: no alert, no threat that stops the work, a routine claim that says so; one walking at the bot or within six is the threat again (25597, note 752b)', t => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const danger = require('../src/danger'), arbiter = require('../src/arbiter'), { claim } = require('../src/survival');
  const bot = { game: { dimension: 'overworld', difficulty: 'normal', gameMode: 'survival', minY: -64, height: 384 }, health: 20, food: 20, oxygenLevel: 20,
    time: { timeOfDay: 6000, age: 100000 }, inventory: { items: () => [], slots: [] }, registry: { entitiesByName: {} },
    entity: { position: new Vec3(0.5, -10, 0.5), eyeHeight: 1.62, metadata: [0] },
    entities: { 9: { id: 9, name: 'creeper', type: 'hostile', position: new Vec3(7.8, -10, 0.5), height: 1.7, metadata: [] } },
    blockAt: p => p.y < -10 ? { name: 'stone', boundingBox: 'block', position: p } : { name: 'air', boundingBox: 'empty', position: p } };
  for (let s = 0; s <= 30; s += 5) { t.mock.timers.setTime(T0 + s * 1000); danger.threats(bot, 64); }
  assert.equal(danger.immediateThreat(bot)?.entity.name, 'creeper', 'half a minute: still the threat');
  assert(arbiter.observeReflexes(bot).some(r => r.key === 'creeper'), 'and the alert');
  for (let s = 35; s <= 70; s += 5) { t.mock.timers.setTime(T0 + s * 1000); danger.threats(bot, 64); }
  assert.equal(danger.immediateThreat(bot), undefined);
  assert(!arbiter.observeReflexes(bot).some(r => r.key === 'creeper'), 'no alert for a creeper parked past six');
  const c = claim(bot, { kind: 'win', survival: {} }, { state: {}, currentShelter: () => null });
  assert.equal(c.action, 'escape_threat'); assert.equal(c.urgency, 'routine');
  assert.match(arbiter.claimSays(c), /Whether it can reach the bot: .*it has stood off 70 seconds, 7\.3 to 7\.3 blocks off, no nearer and never within 6 \(its lighting distance and a second's walk\), not walking at the bot/);
  // It walks in to 5.5: the threat, and the alert, at once.
  bot.entities[9].position = new Vec3(6, -10, 0.5);
  t.mock.timers.setTime(T0 + 71000);
  assert.equal(danger.immediateThreat(bot)?.entity.name, 'creeper');
  assert(arbiter.observeReflexes(bot).some(r => r.key === 'creeper'));
});
