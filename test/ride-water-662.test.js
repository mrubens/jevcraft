'use strict';
// Note 662: the two falls of the overnight run (25595 mid-244-eb, 05:54:47Z,
// and mid-244-dg, 10:51:36Z on 2026-09-29) were both rides down a waterfall of
// 53 and 55 blocks, chosen over dig_down and step_off (0.52 and 0.79) as "no
// fall damage in the water". A second or two down, the survival watch took the
// turn from the ride (a push about, the air) and the body was out of the
// one-wide stream and fell the rest of the way.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { sinkDown } = require('../src/way-down');

function fakeBot({ x = 70.3, landAfter = 400 } = {}) {
  const t0 = Date.now(), controls = {};
  const bot = { controls, looks: [], entity: { position: new Vec3(x, 38, 79.5), onGround: false, isInWater: true, velocity: new Vec3(0, -0.3, 0) },
    look: async yaw => { bot.looks.push(yaw); }, setControlState: (k, v) => { controls[k] = v; } };
  const tick = setInterval(() => { if (Date.now() - t0 > landAfter) { bot.entity.position.y = -15.5; bot.entity.onGround = true; bot.entity.velocity = new Vec3(0, 0, 0); } }, 10);
  bot.stop = () => clearInterval(tick);
  return bot;
}

test('from the step off until the ground the ride keeps the turn: an interrupt (a push about, the air) is not run, and is put back after', async () => {
  const bot = fakeBot();
  const task = new Task('ride');
  let interrupts = 0;
  task.interruptCheck = () => { interrupts++; throw new Error('Preempted by air'); };
  task.stallCheck = () => { interrupts++; };
  const landed = await sinkDown(bot, task, new Vec3(71, 40, 79), new Vec3(71, -16, 79), 3000);
  bot.stop();
  assert.equal(landed, true);
  assert.equal(interrupts, 0);
  assert.equal(typeof task.interruptCheck, 'function', 'put back');
  assert.throws(() => task.check(), /Preempted by air/);
});

test('a cancel still lands mid-ride', async () => {
  const bot = fakeBot({ landAfter: 5000 });
  const task = new Task('ride');
  setTimeout(() => task.cancel(), 100);
  await assert.rejects(sinkDown(bot, task, new Vec3(71, 40, 79), new Vec3(71, -16, 79), 3000), /cancelled/);
  bot.stop();
});

test('a body the current carried a block west of the stream is steered back toward its middle, and not when it is in it', async () => {
  const bot = fakeBot({ x: 70.3 });
  const task = new Task('ride');
  await sinkDown(bot, task, new Vec3(71, 40, 79), new Vec3(71, -16, 79), 3000);
  bot.stop();
  assert(bot.looks.length > 0, 'looked toward the middle');
  // The middle is east (+x) and slightly south of a body at x 70.3, z 79.5: mineflayer's yaw for +x is -pi/2.
  assert(Math.abs(bot.looks[0] - Math.atan2(-(71.5 - 70.3), -(79.5 - 79.5))) < 1e-9);
  const centred = fakeBot({ x: 71.5 });
  await sinkDown(centred, new Task('ride'), new Vec3(71, 40, 79), new Vec3(71, -16, 79), 3000);
  centred.stop();
  assert.equal(centred.looks.length, 0);
});
