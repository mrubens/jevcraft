'use strict';
// Note 917: a ghast's fireball on a line to the bot is struck as it comes
// into reach, with the look on it; the strike's price is the arena's
// measure and the bot's own count since.
const test = require('node:test');
const assert = require('node:assert');
const { Vec3 } = require('vec3');
const ghast = require('../src/ghast');
const reflex = require('../src/shot-reflex');

function botLooking(at, ball) {
  const position = new Vec3(0.5, 64, 0.5);
  const eye = position.offset(0, 1.62, 0), d = at.minus(eye);
  const struck = [];
  const bot = { entity: { position, yaw: Math.atan2(-d.x, -d.z), pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)) }, entities: { 7: { id: 7, name: 'fireball', position: ball, isValid: true } },
    attack: e => struck.push(e.id) };
  bot._fireballTrack = { balls: new Map([[7, { id: 7, pos: ball, at: 1000, v: { x: 0, y: 0, z: 1.2 } }]]), at: (b, t) => ghast.flyTicks(b.pos, b.v, Math.max(0, (t - b.at) / 50)) };
  return { bot, struck };
}

test('a fireball within the strike\'s reach, the look on it, is struck', () => {
  const ball = new Vec3(0.5, 65.5, -4);
  const { bot, struck } = botLooking(ball, ball);
  const s = { id: 7, name: 'fireball' };
  assert.equal(reflex.strikeFireball(bot, s, 1000), true);
  assert.deepEqual(struck, [7]);
  assert.equal(s.struck, 1);
});

test('one still out of reach is not struck, and is once it has flown in', () => {
  const ball = new Vec3(0.5, 65.5, -14);
  const { bot, struck } = botLooking(ball, ball);
  const s = { id: 7, name: 'fireball' };
  assert.equal(reflex.strikeFireball(bot, s, 1000), false);
  assert.deepEqual(struck, []);
  // Flown on by the tracker: six ticks at 1.2 and gaining.
  assert.equal(reflex.strikeFireball(bot, s, 1000 + 6 * 50), true);
});

test('with the look elsewhere (down at a block being laid) it is not struck: it would fly where the look goes', () => {
  const ball = new Vec3(0.5, 65.5, -4);
  const { bot, struck } = botLooking(new Vec3(0.5, 62, 1.5), ball);
  assert.equal(reflex.strikeFireball(bot, { id: 7, name: 'fireball' }, 1000), false);
  assert.deepEqual(struck, []);
});

test('a blaze\'s small fireball is not struck (only a ghast\'s is sent back)', () => {
  const ball = new Vec3(0.5, 65.5, -4);
  const { bot, struck } = botLooking(ball, ball);
  assert.equal(reflex.strikeFireball(bot, { id: 7, name: 'small_fireball' }, 1000), false);
  assert.deepEqual(struck, []);
});

test('the strike is priced by the arena\'s measure and the bot\'s own count, the record before the timing said and not priced', () => {
  const m = ghast.measured(null);
  assert.equal(m.came, ghast.ARENA.came);
  assert.ok(Math.abs(m.rate - ghast.ARENA.sentBack / ghast.ARENA.came) < 1e-9);
  assert.match(m.says, /In the arena since/);
  assert.match(m.says, /none was seen to go back/);
  // Two more came live, one sent back, one landed.
  const live = ghast.measured({ watches: 1, came: 2, struck: 2, sentBack: 1, landed: 1 });
  assert.ok(Math.abs(live.rate - (ghast.ARENA.sentBack + 1) / (ghast.ARENA.came + 2)) < 1e-9);
  assert.equal(live.landed, 1);
});
