'use strict';
// Note 752f. 25597 (17:35:52 to 17:35:58Z): the same creeper's alert cut
// turn_priority nine times in five seconds, the work still the holder while
// the question was out; the blast took 20 to 6.4. 25584 (17:38:10 to
// 17:40:01Z): body_way asked about forty times at the water's top, the
// breath at 20 throughout.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const arbiter = require('../src/arbiter');

test('an alert the turn\'s question is out about does not preempt the holder again; another alert or the body\'s physics still would (25597, note 752f)', () => {
  const creeper = { entity: { id: 9, name: 'creeper', position: new Vec3(5, 64, 0) }, distance: 5, visible: true };
  const bot = { entity: { position: new Vec3(0, 64, 0) }, health: 20, food: 20, oxygenLevel: 20, entities: {}, game: { gameMode: 'survival' } };
  const look = { inLava: () => false, burning: () => false, headInBlock: () => false, hotFloor: () => null, burnLeft: () => false, mobs: () => [creeper], noWay: () => new Set(), atReach: () => [], pushOver: () => null };
  const logs = [];
  bot._arbiter = { holder: { layer: 'work', action: 'tunnel', ids: [9], knew: { reach: false, push: false } }, askingAlerts: new Set(['creeper']) };
  bot.pathfinder = { setGoal() {} }; bot.clearControlStates = () => {}; bot.stopDigging = () => {};
  assert.equal(arbiter.watchOnce(bot, { live: true, look, log: l => logs.push(l) }), null, 'not preempted while the question about it is out');
  delete bot._arbiter.askingAlerts;
  assert.equal(arbiter.watchOnce(bot, { live: true, look, log: l => logs.push(l) })?.by, 'creeper', 'preempted once the question is not out');
});

test('arbitrate marks the alerts its question is out about, and clears them when it is answered (note 752f)', async () => {
  const bot = { entity: { position: new Vec3(0, 64, 0) }, health: 20, food: 20, oxygenLevel: 20, entities: {} };
  const state = {};
  let during;
  const decide = async () => { during = state.askingAlerts && [...state.askingAlerts]; return { path: ['survival'] }; };
  const claims = [{ layer: 'survival', action: 'creeper_back_off', urgency: 'pressing', alert: 'creeper', facts: { creeper: 5 }, run: async () => true },
    { layer: 'work', action: 'tunnel', urgency: 'routine', facts: {}, run: async () => true }];
  await arbiter.arbitrate(bot, claims, { decide, mobs: [], state, run: false });
  assert.deepEqual(during, ['creeper']);
  assert.equal(state.askingAlerts, undefined);
});

test('at the water\'s top with the breath full the head is kept up with the jump key and nothing is asked; with breath lost the way up is Jev\'s as before (25584, note 752f)', async () => {
  const vitals = require('../src/vitals');
  const water = { name: 'water', boundingBox: 'empty', metadata: 0, getProperties: () => ({ level: 0 }) };
  const keys = {};
  const bot = { game: { gameMode: 'survival', dimension: 'overworld' }, health: 20, food: 20, oxygenLevel: 20,
    entity: { position: new Vec3(13.41, 61.1, 123.52), eyeHeight: 1.62 }, inventory: { items: () => [] },
    blockAt: p => p.floored().y <= 62 ? { ...water, position: p.floored() } : { name: 'air', boundingBox: 'empty', position: p.floored() },
    setControlState: (k, v) => { keys[k] = v; if (k === 'jump' && v) bot.entity.position = new Vec3(13.41, 61.5, 123.52); } };
  assert.equal(vitals.headSubmerged(bot), true);
  assert.equal(vitals.atWaterTop(bot), true);
  const c = vitals.claim(bot);
  assert.notEqual(c?.action, 'surface', 'no surface claim for a dip at the top');
  await vitals.bobUp(bot, { check() {} });
  assert.equal(keys.jump, false, 'the jump key let go after');
  bot.entity.position = new Vec3(13.41, 61.1, 123.52);
  bot.oxygenLevel = 15;
  assert.equal(vitals.atWaterTop(bot), false, 'breath going: not a bob');
  assert.equal(vitals.claim(bot)?.action, 'surface');
});

test('a fight or a shield guard is not asked again for a hit from the mob it was chosen against (its price covers that); a pillar is (25597 17:54:44Z, note 752f)', () => {
  const holds = require('../src/holds');
  const zombie = { entity: { id: 4, name: 'zombie' }, distance: 1.5, visible: true };
  const T = 1_800_000_000_000;
  for (const choice of ['fight', 'shield_guard']) {
    const hold = holds.begin({ choice, at: T, health: 15.9, expects: { damage: 8, seconds: 15, oneHit: 2 }, mobs: [zombie], offered: [choice] });
    assert.equal(holds.diverged(hold, { now: T + 3000, health: 14.6, mobs: [zombie], offered: [choice], hurtBy: { zombie: T + 2000 } }), null, choice);
  }
  const pillar = holds.begin({ choice: 'pillar', at: T, health: 15.9, expects: { damage: 0, seconds: 15, oneHit: 2 }, mobs: [zombie], offered: ['pillar'] });
  assert.match(holds.diverged(pillar, { now: T + 3000, health: 14.6, mobs: [zombie], offered: ['pillar'], hurtBy: { zombie: T + 2000 } }), /hit the bot/);
});

test('under a held shield guard the shield is kept up between passes while a biter it guards is within five, not only at its reach (25593 17:51:40Z, note 752f)', () => {
  const { keepShieldForStance } = require('../src/survival');
  const zombie = { id: 4, name: 'zombie', type: 'hostile', position: new Vec3(4.5, 64, 0.5), height: 1.95, width: 0.6, isValid: true };
  const bot = { entity: { position: new Vec3(0.5, 64, 0.5), metadata: [0] }, entities: { 4: zombie }, game: { dimension: 'overworld' }, time: { timeOfDay: 18000 },
    world: { raycast: () => null }, inventory: { items: () => [], slots: { 45: { name: 'shield' } } },
    blockAt: p => ({ name: p.y < 64 ? 'stone' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty', position: p }),
    _shieldRaised: true, _stance: { choice: 'shield_guard', at: Date.now() } };
  assert.equal(keepShieldForStance(bot), true, 'a zombie four blocks off: the shield stays up');
  zombie.position = new Vec3(12.5, 64, 0.5);
  assert.equal(keepShieldForStance(bot), false, 'none within five: lowered for the walk');
});
