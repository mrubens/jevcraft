'use strict';
// Note 709: a stance in force answers the shooters' warnings. 25592
// mid-242-dd-fortress-26 at a blaze spawner (2026-09-30 01:39:25 to 01:40:26Z)
// answered shot_answer 14 times and encounter_stance 8 times in a minute,
// behind_cover walking it off the charge and keep_on taking the next volley;
// health 20 to 3, no rod. The frames are 25589's (note 676's fixture): six
// blazes about, the shield in the off hand.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { Vec3 } = require('vec3');
const reflex = require('../src/shot-reflex');
const fixture = require('./fixtures/shots-676.json');

const registry = require('minecraft-data')('26.1');
const air = p => ({ position: p, name: 'air', boundingBox: 'empty' });
const v = p => new Vec3(p.x, p.y, p.z);
const BLAZE_FLAGS = registry.entitiesByName.blaze.metadataKeys.indexOf('flags');
const SMALL_FIREBALL = registry.entitiesByName.small_fireball.id;

function scene() {
  const s = fixture.frames.find(f => f.at === '2026-09-29T18:48:19.334Z').snapshot;
  const here = v(s.position), floorY = Math.floor(here.y) - 1;
  const calls = { raised: 0, lowered: 0 };
  const bot = Object.assign(new EventEmitter(), {
    registry, _client: new EventEmitter(), game: { dimension: 'the_nether' }, health: 20, time: { timeOfDay: 6000 },
    entity: { id: 1, position: here, yaw: s.yaw, pitch: s.pitch, onGround: true, height: 1.8, velocity: new Vec3(0, 0, 0), metadata: {} },
    entities: {}, inventory: { slots: { 45: { name: 'shield' }, 5: { name: s.equipment.head }, 6: { name: s.equipment.torso } }, items: () => [] },
    world: { raycast: () => null },
    blockAt: p => p.y === floorY ? { position: p, name: 'nether_bricks', boundingBox: 'block' } : p.y < floorY ? { position: p, name: 'netherrack', boundingBox: 'block' } : air(p),
    controlState: {}, pathfinder: { isBuilding: () => false, setGoal() {} },
    activateItem() { calls.raised++; }, deactivateItem() { calls.lowered++; },
    setControlState(k, on) { this.controlState[k] = on; }, clearControlStates() { this.controlState = {}; },
    look(yaw) { this.entity.yaw = yaw; calls.looked = (calls.looked || 0) + 1; return Promise.resolve(); }, lookAt() { return Promise.resolve(); }, attack() {},
  });
  for (const e of s.entities) if (e.name === 'blaze') bot.entities[e.id] = { id: e.id, name: e.name, type: 'hostile', position: v(e.position), height: 1.8, width: 0.6, isValid: true, metadata: {} };
  const asked = [];
  const survival = { client: {}, decide: async (task, goal, save, q) => { asked.push(q); return { path: ['keep_on'] }; } };
  return { bot, calls, asked, survival, blaze: bot.entities[775] };
}
const stance = (bot, choice, at = Date.now()) => { bot._stance = { choice, at, running: true, health: bot.health, ids: [775] }; };

test('a charge held: the glow is not asked; the shield comes up for the volley and the charge keeps its keys and looks', async () => {
  const { bot, calls, asked, survival, blaze } = scene();
  const t0 = Date.now();
  stance(bot, 'charge_nearest', t0);
  blaze.metadata[BLAZE_FLAGS] = 1;
  reflex.tick(bot, survival, t0);
  await new Promise(r => setImmediate(r));
  assert.equal(asked.length, 0, 'not asked: the stance answers');
  const a = reflex.answerFor(bot, 775, t0);
  assert.deepEqual({ choice: a?.choice, by: a?.by, stance: a?.stance, closing: a?.closing }, { choice: 'shield_up', by: 'stance', stance: 'charge_nearest', closing: true });
  bot._shotLookAt = 0; reflex.tick(bot, survival, t0 + 2500);
  assert.equal(calls.raised, 1, 'up for the volley');
  assert.match(bot._shotHold.why, /^stance charge nearest: shield up to the blaze while it closes/);
  bot.setControlState('forward', true);
  assert.equal(bot.controlState.forward, true, 'the charge walks on behind the shield');
  const looked = calls.looked || 0;
  bot.look(0, 0);
  assert.equal(calls.looked, looked + 1, 'and turns to its path');
});

test('a charge with the blaze at the sword\'s reach: no hold, the swings are the stance\'s', async () => {
  const { bot, calls, survival, blaze } = scene();
  const t0 = Date.now();
  stance(bot, 'charge_nearest', t0);
  blaze.position = bot.entity.position.offset(1.5, 0, 0);
  blaze.metadata[BLAZE_FLAGS] = 1;
  reflex.tick(bot, survival, t0);
  bot._shotLookAt = 0; reflex.tick(bot, survival, t0 + 2500);
  assert.equal(reflex.answerFor(bot, 775, t0 + 2500)?.choice, 'shield_up');
  assert.equal(calls.raised, 0, 'not raised at arm\'s length');
});

test('leaving to heal: the glow is not asked and holds nothing; a fireball on its way that hits still meets the shield', async () => {
  const { bot, calls, asked, survival, blaze } = scene();
  const t0 = Date.now();
  stance(bot, 'leave_and_heal', t0);
  blaze.metadata[BLAZE_FLAGS] = 1;
  reflex.watchShots(bot);
  reflex.tick(bot, survival, t0);
  await new Promise(r => setImmediate(r));
  assert.equal(asked.length, 0);
  assert.equal(reflex.answerFor(bot, 775, t0)?.choice, 'reflex');
  assert.equal(reflex.answeredOtherwise(bot, 775, t0), false, 'deflect and the volley stand still meet its shots');
  bot._shotLookAt = 0; reflex.tick(bot, survival, t0 + 2500);
  assert.equal(calls.raised, 0, 'the walk goes on through the glow');
  const mid = bot.entity.position.offset(0, 0.9, 0), d = mid.minus(blaze.position).normalize().scaled(0.8);
  bot._client.emit('spawn_entity', { entityId: 951, type: SMALL_FIREBALL, x: blaze.position.x, y: blaze.position.y + 0.9, z: blaze.position.z, velocity: { x: d.x, y: d.y, z: d.z }, objectData: 775 });
  bot._shotLookAt = Date.now();
  reflex.tick(bot, survival);
  assert.equal(calls.raised, 1, 'the shot on its way raises it');
  assert.match(bot._shotHold.why, /the stance leave and heal walking on/);
});

test('a box holds its spot: answered by the rule\'s answer there, not asked; keep_working and a stance run out still ask', async () => {
  const boxed = scene();
  const t0 = Date.now();
  stance(boxed.bot, 'box_here', t0);
  boxed.blaze.metadata[BLAZE_FLAGS] = 1;
  reflex.tick(boxed.bot, boxed.survival, t0);
  await new Promise(r => setImmediate(r));
  assert.equal(boxed.asked.length, 0);
  assert.match(reflex.answerFor(boxed.bot, 775, t0)?.choice || '', /^(shield_up|behind_cover)$/);
  assert.equal(reflex.answerFor(boxed.bot, 775, t0)?.by, 'stance');
  for (const [choice, at] of [['keep_working', Date.now()], ['charge_nearest', Date.now() - 20000]]) {
    const s = scene();
    stance(s.bot, choice, at);
    s.blaze.metadata[BLAZE_FLAGS] = 1;
    reflex.tick(s.bot, s.survival);
    await new Promise(r => setImmediate(r));
    assert.equal(s.asked.length, 1, `${choice} ${Date.now() - at} ms ago: asked`);
  }
});

test('every stance named in the table is a stance the encounter offers or held, and the stance question says the rule', () => {
  const { STANCE_SHOTS } = reflex;
  const all = Object.values(STANCE_SHOTS).flatMap(s => [...s]);
  assert.equal(new Set(all).size, all.length, 'each stance in one row');
  const guidance = require('../src/decisions').question('encounter_stance').instructions.guidance;
  assert.match(guidance, /A stance held answers each volley: a charge shields as it closes, a hold in place, a walk walks on\./);
});
