'use strict';
// A shot on its way met with the shield whatever the bot is doing, and a
// shooter's warning asked of Jev as it begins (src/shot-reflex.js, note 676).
// The frames are 25589's (mid-242-dc-fortress-22, 2026-09-29 18:47 to
// 18:49): stalking blazes at a fortress for the work, its back to six of
// them, ten small fireballs in the air, the shield in its off hand and down.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { Vec3 } = require('vec3');
const reflex = require('../src/shot-reflex');
const { raiseShield } = require('../src/combat');
const fixture = require('./fixtures/shots-676.json');

const registry = require('minecraft-data')('26.1');
const air = p => ({ position: p, name: 'air', boundingBox: 'empty' });
const frameAt = at => fixture.frames.find(f => f.at === at);
const v = p => new Vec3(p.x, p.y, p.z);
const BLAZE_FLAGS = registry.entitiesByName.blaze.metadataKeys.indexOf('flags');
const SMALL_FIREBALL = registry.entitiesByName.small_fireball.id;

// The bot as the frame has it: where it stood, the way it faced, the mobs
// and the shots about it, on the fortress floor (nether bricks a block under
// the feet), `under` the block below the floor's level where it is not.
function botFrom(frame, { lava = false, onGround = frame.snapshot.onGround } = {}) {
  const s = frame.snapshot, here = v(s.position), floorY = Math.floor(s.onGround ? here.y : here.y) - (s.onGround ? 1 : 1);
  const calls = { raised: 0, lowered: 0, keys: [], looks: [] };
  const client = new EventEmitter();
  const bot = Object.assign(new EventEmitter(), {
    registry, _client: client, game: { dimension: 'the_nether' }, health: s.health, time: { timeOfDay: 6000 },
    entity: { id: 1, position: here, yaw: s.yaw, pitch: s.pitch, onGround, height: 1.8, velocity: v(s.velocity), metadata: {} },
    entities: {}, inventory: { slots: { 45: { name: s.equipment.offhand }, 5: { name: s.equipment.head }, 6: { name: s.equipment.torso } }, items: () => [] },
    world: { raycast: () => null },
    blockAt: p => lava ? (p.y <= floorY ? { position: p, name: 'lava', boundingBox: 'empty' } : air(p))
      : p.y === floorY ? { position: p, name: 'nether_bricks', boundingBox: 'block' } : p.y < floorY ? { position: p, name: 'netherrack', boundingBox: 'block' } : air(p),
    controlState: {}, pathfinder: { isBuilding: () => false, setGoal() {} },
    activateItem(off) { calls.raised++; calls.offHand = off; },
    deactivateItem() { calls.lowered++; },
    setControlState(k, on) { calls.keys.push([k, on]); this.controlState[k] = on; },
    clearControlStates() { this.controlState = {}; },
    look(yaw, pitch) { calls.looks.push(yaw); this.entity.yaw = yaw; return Promise.resolve(); },
    lookAt() { calls.looks.push('lookAt'); return Promise.resolve(); },
    attack() {},
  });
  bot.entity.id = 1;
  for (const e of s.entities) {
    const entity = { id: e.id, name: e.name, type: e.kind === 'hostile' ? 'hostile' : e.kind, position: v(e.position), height: e.name === 'blaze' ? 1.8 : 0.3125, width: 0.6, isValid: true, metadata: {} };
    bot.entities[e.id] = entity;
  }
  return { bot, calls, client };
}
// Each fireball in the frame as the server told of it: spawned at the blaze
// nearest it, flying at the bot's middle at 0.8 blocks a tick.
function spawnShots(bot, client) {
  const mid = bot.entity.position.offset(0, 0.9, 0);
  for (const e of Object.values(bot.entities).filter(e => e.name === 'small_fireball')) {
    const d = mid.minus(e.position).normalize().scaled(0.8);
    const owner = Object.values(bot.entities).filter(b => b.name === 'blaze').sort((a, b) => a.position.distanceTo(e.position) - b.position.distanceTo(e.position))[0];
    client.emit('spawn_entity', { entityId: e.id, type: SMALL_FIREBALL, x: e.position.x, y: e.position.y, z: e.position.z, velocity: { x: d.x, y: d.y, z: d.z }, objectData: owner.id });
  }
}
const faces = (bot, point) => {
  const p = bot.entity.position, yaw = bot.entity.yaw;
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw), dx = point.x - p.x, dz = point.z - p.z;
  return (fx * dx + fz * dz) / Math.hypot(dx, dz);
};
const blazeMiddle = bot => { const b = Object.values(bot.entities).filter(e => e.name === 'blaze'); return b.reduce((s, e) => s.plus(e.position), new Vec3(0, 0, 0)).scaled(1 / b.length); };

test('25589 18:48:19.334, the work stalking with its back to six blazes and ten fireballs in the air: the shield comes up toward them and the walk waits', () => {
  const { bot, calls, client } = botFrom(frameAt('2026-09-29T18:48:19.334Z'));
  reflex.watchShots(bot);
  spawnShots(bot, client);
  assert.ok(faces(bot, blazeMiddle(bot)) < 0, 'the frame: its back to them');
  reflex.tick(bot, null);
  assert.equal(calls.raised, 1, 'raised');
  assert.equal(calls.offHand, true, 'the off hand');
  assert.ok(faces(bot, blazeMiddle(bot)) > 0.5, `turned to them: ${faces(bot, blazeMiddle(bot))}`);
  assert.match(bot._shotHold.why, /reflex: a small fireball on its way/);
  // The work's walk presses forward and turns to its path: not while held.
  bot.setControlState('forward', true);
  assert.notEqual(bot.controlState.forward, true, 'forward refused while held');
  bot.look(0, 0);
  assert.ok(faces(bot, blazeMiddle(bot)) > 0.5, 'the walk\'s look refused while held');
  // The shots gone: the hold lets go after its grace, the shield comes down,
  // and the walk has its keys again.
  bot._shots.clear();
  reflex.tick(bot, null, Date.now() + 1000);
  assert.equal(bot._shotHold, null);
  assert.equal(calls.lowered, 1);
  bot.setControlState('forward', true);
  assert.equal(bot.controlState.forward, true);
});

test('the same shots with the bot in the air over lava, laying a span, or eating: no turn, and why is kept', () => {
  for (const [why, setup] of [
    [/in the air over lava/, () => botFrom(frameAt('2026-09-29T18:48:19.838Z'), { lava: true, onGround: false })],
    [/laying a span/, () => { const b = botFrom(frameAt('2026-09-29T18:48:19.334Z')); b.bot._spanning = { target: {} }; return b; }],
    [/eating or drawing/, () => { const b = botFrom(frameAt('2026-09-29T18:48:19.334Z')); b.bot.entity.metadata[8] = 1; return b; }],
  ]) {
    const { bot, calls, client } = setup();
    reflex.watchShots(bot); spawnShots(bot, client);
    reflex.tick(bot, null);
    assert.equal(calls.raised, 0, String(why));
    assert.match(bot._shotRefused?.why || '', why);
  }
});

test('in the air over the fortress floor (18:48:19.838, knocked up by the hit before) the shield still comes up: only lava or a drop below refuses it', () => {
  const { bot, calls, client } = botFrom(frameAt('2026-09-29T18:48:19.838Z'));
  reflex.watchShots(bot); spawnShots(bot, client);
  reflex.tick(bot, null);
  assert.equal(calls.raised, 1);
});

test('a shot away from the bot is no shot at it; one at it says how long it has', () => {
  const { bot, client } = botFrom(frameAt('2026-09-29T18:48:19.334Z'));
  reflex.watchShots(bot);
  const here = bot.entity.position;
  client.emit('spawn_entity', { entityId: 900, type: SMALL_FIREBALL, x: here.x + 6, y: here.y + 1, z: here.z, velocity: { x: 0.8, y: 0, z: 0 }, objectData: 0 });
  client.emit('spawn_entity', { entityId: 901, type: SMALL_FIREBALL, x: here.x + 6, y: here.y + 1, z: here.z, velocity: { x: -0.8, y: 0, z: 0 }, objectData: 0 });
  assert.equal(reflex.hitting(bot, bot._shots.get(900)), null, 'flying away');
  const h = reflex.hitting(bot, bot._shots.get(901));
  assert.ok(h && h.seconds > 0.3 && h.seconds < 0.5, JSON.stringify(h));
  // Passing two blocks wide: a miss.
  client.emit('spawn_entity', { entityId: 902, type: SMALL_FIREBALL, x: here.x + 6, y: here.y + 1, z: here.z + 2.5, velocity: { x: -0.8, y: 0, z: 0 }, objectData: 0 });
  assert.equal(reflex.hitting(bot, bot._shots.get(902)), null);
});

test('a blaze begins to glow while the work holds the turn: shot_answer is asked aside, and the answer holds for that glow only', async () => {
  const { bot } = botFrom(frameAt('2026-09-29T18:48:19.334Z'));
  for (const e of Object.values(bot.entities)) if (e.name === 'small_fireball') delete bot.entities[e.id];
  const asked = [];
  const survival = { client: {}, decide: async (task, goal, save, q) => { asked.push(q); return { path: ['keep_on'] }; } };
  const blaze = bot.entities[775];
  blaze.metadata[BLAZE_FLAGS] = 1;
  reflex.tick(bot, survival);
  await new Promise(r => setImmediate(r));
  assert.equal(asked.length, 1);
  const q = asked[0];
  assert.equal(q.id, 'shot_answer');
  assert.equal(q.aside, true, 'asked aside: the work keeps the turn');
  assert.ok(q.tree.shield_up && q.tree.keep_on, Object.keys(q.tree).join());
  assert.match(q.tree.shield_up.description, /Measured at work/);
  assert.match(q.tree.keep_on.description, /the blaze's about \d(\.\d)? health a shot/);
  assert.equal(q.state.shooters[0].name, 'blaze');
  assert.equal(reflex.answerFor(bot, 775)?.choice, 'keep_on');
  // Taken, as chosen: its fireball in the air is left to land.
  bot._client.emit('spawn_entity', { entityId: 950, type: SMALL_FIREBALL, x: blaze.position.x, y: blaze.position.y + 1, z: blaze.position.z,
    velocity: { x: -0.8, y: -0.1, z: 0.2 }, objectData: 775 });
  bot._shotLookAt = Date.now();
  reflex.tick(bot, survival);
  assert.ok(!bot._shotHold, `keep_on: not raised (${bot._shotHold?.why})`);
  // The glow ends and a new one begins: asked again.
  blaze.metadata[BLAZE_FLAGS] = 0; bot._shotLookAt = 0; reflex.tick(bot, survival);
  blaze.metadata[BLAZE_FLAGS] = 1; blaze._glowAt = Date.now() + 5; bot._shotLookAt = 0; reflex.tick(bot, survival);
  await new Promise(r => setImmediate(r));
  assert.equal(asked.length, 2, 'the next glow is its own question');
});

test('the shield_up answer raises the shield when the volley is due, 2.4 s into the glow, with no shot yet in the air', async () => {
  const { bot, calls } = botFrom(frameAt('2026-09-29T18:48:19.334Z'));
  for (const e of Object.values(bot.entities)) if (e.name === 'small_fireball') delete bot.entities[e.id];
  const survival = { client: {}, decide: async () => ({ path: ['shield_up'] }) };
  const blaze = bot.entities[775];
  blaze.metadata[BLAZE_FLAGS] = 1;
  const t0 = Date.now();
  reflex.tick(bot, survival, t0);
  await new Promise(r => setImmediate(r));
  assert.equal(reflex.answerFor(bot, 775)?.choice, 'shield_up');
  bot._shotLookAt = 0; reflex.tick(bot, survival, t0 + 1000);
  assert.equal(calls.raised, 0, 'not before the shots are due');
  bot._shotLookAt = 0; reflex.tick(bot, survival, t0 + 2500);
  assert.equal(calls.raised, 1, 'up for the volley');
  assert.ok(faces(bot, blaze.position) > 0.7);
});

test('without Jev (JEV_ENCOUNTERS=0 or no client) a glow is answered with the shield by rule', () => {
  const { bot } = botFrom(frameAt('2026-09-29T18:48:19.334Z'));
  bot.entities[775].metadata[BLAZE_FLAGS] = 1;
  reflex.tick(bot, { client: null });
  assert.equal(reflex.answerFor(bot, 775)?.choice, 'shield_up');
  assert.equal(reflex.answerFor(bot, 775)?.by, 'rules');
});

test('an answer holds while its warning lasts, then until its shots are past; a shooter gone from view, until the most a warning takes', () => {
  const { bot } = botFrom(frameAt('2026-09-29T18:48:19.334Z'));
  const blaze = bot.entities[775];
  // A glow held eleven seconds while the blaze had no line: still answered.
  blaze._shotWarn = { key: '775:1', at: Date.now() - 11000, kind: 'blaze' };
  bot._shotAnswers = new Map([[775, { key: '775:1', choice: 'shield_up', at: Date.now() - 10800, until: Date.now() - 5900 }]]);
  assert.equal(reflex.answerFor(bot, 775)?.choice, 'shield_up');
  // Ended: its shots' flight, then no more.
  blaze._shotWarn = null;
  bot._shotAnswers.get(775).endsAt = Date.now() - 1;
  assert.equal(reflex.answerFor(bot, 775), null);
  // Gone from view mid-warning: the most a warning takes.
  delete bot._shotAnswers.get(775).endsAt;
  delete bot.entities[775];
  assert.equal(reflex.answerFor(bot, 775), null);
  bot._shotAnswers.get(775).until = Date.now() + 1000;
  assert.equal(reflex.answerFor(bot, 775)?.choice, 'shield_up');
});

test('a strike is offered at a glowing blaze the sword reaches, with its swings against the seconds to its volley', async () => {
  const { bot } = botFrom(frameAt('2026-09-29T18:48:19.334Z'));
  const blaze = bot.entities[775];
  blaze.position = bot.entity.position.offset(1.8, 0.4, 0);
  blaze.metadata[BLAZE_FLAGS] = 1;
  bot.inventory.items = () => [{ name: 'iron_sword', type: 1 }];
  const asked = [];
  reflex.tick(bot, { client: {}, decide: async (task, goal, save, q) => { asked.push(q); return { path: ['shield_up'] }; } });
  await new Promise(r => setImmediate(r));
  assert.ok(asked[0]?.tree.strike_first, Object.keys(asked[0]?.tree || {}).join());
  assert.match(asked[0].tree.strike_first.description, /about 4 swings, [\d.]+ seconds, against [\d.]+ seconds before it shoots/);
});

test('split shooters: the shield faces the side with more of them and the option says which is left behind', () => {
  const { bot } = botFrom(frameAt('2026-09-29T18:48:19.334Z'));
  const here = bot.entity.position;
  const pts = [{ at: here.offset(6, 1, 0) }, { at: here.offset(6, 1, 2) }, { at: here.offset(-6, 1, 0) }];
  const { point, left } = reflex.facingFor(bot, pts);
  assert.ok(point.x > here.x, 'faces the two');
  assert.equal(left.length, 1);
});

test('raiseShield raises again when the server says the shield is down though the flag says up (a meal ended it), not within half a second', () => {
  let raised = 0;
  const bot = { inventory: { slots: { 45: { name: 'shield' } } }, entity: { metadata: { 8: 0 } }, activateItem() { raised++; } };
  bot._shieldRaised = true; bot._shieldRaisedAt = Date.now() - 200;
  assert.equal(raiseShield(bot), false, 'too soon: its own raise may not have been said yet');
  bot._shieldRaisedAt = Date.now() - 2000;
  assert.equal(raiseShield(bot), true);
  assert.equal(raised, 1);
  bot.entity.metadata[8] = 3; bot._shieldRaisedAt = Date.now() - 2000;
  assert.equal(raiseShield(bot), false, 'up by the server\'s word');
});

test('what each shot on a line came to is tallied and said to Jev', () => {
  const { bot } = botFrom(frameAt('2026-09-29T18:48:19.334Z'));
  bot._shots = new Map([[1, { id: 1, name: 'small_fireball', hitting: true }], [2, { id: 2, name: 'small_fireball', hitting: true, landed: Date.now() }]]);
  const said = [];
  bot.on('shot', d => said.push(d));
  bot.entity.metadata[8] = 3; bot._shieldRaised = true; bot._shieldRaisedAt = Date.now() - 1000;
  reflex.settle(bot, bot._shots.get(1));
  bot.entity.metadata[8] = 0;
  reflex.settle(bot, bot._shots.get(2));
  assert.deepEqual(bot._shotTally, { up: { landed: 0, not: 1 }, down: { landed: 1, not: 0 } });
  assert.deepEqual(said.map(d => [d.shield, d.landed]), [['up', false], ['down', true]]);
  assert.match(reflex.blockedSays(bot), /This run, of the shots on a line to the bot: with the shield up 0 landed and 1 did not; with it down 1 landed/);
});
