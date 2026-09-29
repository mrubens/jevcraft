'use strict';
// Note 691 (3): the shield covers only the half the bot faces. On 25589 at
// 21:18:21.456Z (test/fixtures/shield-split-25589.json) the hold faced four
// blazes out of sight behind rock (within 42 degrees of the facing) and had
// its back (130 degrees) to the one in sight, whose fireballs were in the
// air: 9 to 5.1 through the raised shield, then 5.1 to 1.2 after it turned
// to that one and back to the four.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { Vec3 } = require('vec3');
const reflex = require('../src/shot-reflex');
const rec = require('./fixtures/shield-split-25589.json');

const registry = require('minecraft-data')('26.1');
const SMALL_FIREBALL = registry.entitiesByName.small_fireball.id;
const v = p => new Vec3(p.x, p.y, p.z);
const air = p => ({ position: p, name: 'air', boundingBox: 'empty' });

function frameBot() {
  const here = v(rec.position), floorY = Math.floor(here.y) - 1;
  const calls = { raised: 0 };
  const client = new EventEmitter();
  const bot = Object.assign(new EventEmitter(), {
    registry, _client: client, game: { dimension: 'the_nether' }, health: rec.health, food: rec.food,
    entity: { id: 1, position: here, yaw: rec.yaw, pitch: rec.pitch, onGround: true, height: 1.8, velocity: new Vec3(0, 0, 0), metadata: {} },
    entities: {}, inventory: { slots: { 45: { name: 'shield' }, 5: { name: rec.equipment.head }, 6: { name: rec.equipment.torso } }, items: () => [] },
    world: { raycast: () => null },
    blockAt: p => p.y === floorY ? { position: p, name: 'nether_bricks', boundingBox: 'block' } : p.y < floorY ? { position: p, name: 'netherrack', boundingBox: 'block' } : air(p),
    controlState: {}, pathfinder: { isBuilding: () => false, setGoal() {} },
    activateItem() { calls.raised++; }, deactivateItem() {},
    setControlState(k, on) { this.controlState[k] = on; }, clearControlStates() { this.controlState = {}; },
    look(yaw) { this.entity.yaw = yaw; return Promise.resolve(); }, lookAt() { return Promise.resolve(); }, attack() {},
  });
  for (const b of rec.blazes) bot.entities[b.id] = { id: b.id, name: 'blaze', type: 'hostile', position: v(b.position), height: 1.8, width: 0.6, isValid: true, metadata: {} };
  return { bot, calls, client };
}
const offFacing = (bot, p) => {
  const here = bot.entity.position, yaw = bot.entity.yaw;
  const dir = Math.atan2(-(p.x - here.x), -(p.z - here.z));
  return Math.abs(Math.atan2(Math.sin(dir - yaw), Math.cos(dir - yaw))) * 180 / Math.PI;
};
// Every blaze glowing, each answered shield_up; the one in sight's fireballs in the air.
function warnAll(bot, now) {
  bot._shotAnswers = new Map();
  for (const b of rec.blazes) {
    const e = bot.entities[b.id];
    e._shotWarn = { key: `${b.id}:w`, at: now - 3000, kind: 'blaze' };
    bot._shotAnswers.set(b.id, { key: e._shotWarn.key, choice: 'shield_up', at: now - 2800 });
  }
  bot._shotShooters = rec.blazes.map(b => b.id);
  bot._shotWarned = new Set(bot._shotShooters);
  bot._shotInSight = new Set(rec.blazes.filter(b => b.inSight).map(b => b.id));
  bot._shotLookAt = now;
}

test('the recorded frame: its back was to the blaze in sight whose fireballs were in the air', () => {
  const { bot } = frameBot();
  const seen = rec.blazes.find(b => b.inSight);
  assert.ok(offFacing(bot, v(seen.position)) > 120, 'the one in sight behind it');
  for (const b of rec.blazes.filter(b => !b.inSight)) assert.ok(offFacing(bot, v(b.position)) < 45, `blaze ${b.id} out of sight in front`);
});

test('the hold faces the shot on its way first, then warned shooters in sight, before the ones behind rock', () => {
  const { bot, calls, client } = frameBot();
  const now = Date.now();
  reflex.watchShots(bot);
  warnAll(bot, now);
  const seen = rec.blazes.find(b => b.inSight);
  const mid = bot.entity.position.offset(0, 0.9, 0);
  for (const s of rec.shots) {
    const d = mid.minus(v(s.position)).normalize().scaled(0.8);
    client.emit('spawn_entity', { entityId: s.id, type: SMALL_FIREBALL, x: s.position.x, y: s.position.y, z: s.position.z, velocity: { x: d.x, y: d.y, z: d.z }, objectData: seen.id });
  }
  reflex.tick(bot, null, now);
  assert.ok(calls.raised >= 1);
  assert.ok(offFacing(bot, v(seen.position)) < 45, `faces the shot's blaze: ${offFacing(bot, v(seen.position))} degrees off`);
  // With no shot in the air, the warned one in sight still outweighs the four behind rock.
  const again = frameBot();
  warnAll(again.bot, now);
  reflex.tick(again.bot, null, now);
  assert.ok(offFacing(again.bot, v(seen.position)) < 45, `faces the blaze in sight: ${offFacing(again.bot, v(seen.position))} degrees off`);
});

test('shield_up says how many of the blazes about are outside the half it faces, and a split room is marked for the rule', () => {
  const { bot } = frameBot();
  const now = Date.now();
  warnAll(bot, now);
  const seen = bot.entities[rec.blazes.find(b => b.inSight).id];
  const tree = reflex.shotOptions(bot, [seen]);
  assert.match(tree.shield_up.description, /The shield blocks only the half the bot faces\./);
  assert.match(tree.shield_up.description, /Of the 5 blazes within sixteen, 4 are outside that half \(none in sight now\): the shield does not stop what they send\./);
  // Four behind rock, none in sight among them: not split for the rule.
  assert.equal(tree.shield_up.split, false);
  assert.equal(reflex.shotRule({ shield_up: { split: true }, behind_cover: {} }), 'behind_cover');
  assert.equal(reflex.shotRule({ shield_up: { split: true } }), 'shield_up');
  assert.equal(reflex.shotRule({ shield_up: { split: false }, behind_cover: {} }), 'shield_up');
  const { question } = require('../src/decisions');
  require('../src/decisions/survival');
  assert.equal(question('shot_answer').fallback({ shield_up: { split: true }, behind_cover: {}, keep_on: {} }), 'behind_cover');
});
