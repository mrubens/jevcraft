'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { move, MAX_MS } = require('../src/motion');
const { Task } = require('../src/skills');

const fakeBot = () => {
  const controls = {};
  return { controls, _controller: null, lookAt: async () => {}, getControlState: key => !!controls[key],
    setControlState: (key, on) => { controls[key] = on; } };
};

test('a held-key move crouches by default, names itself while it lasts, and gives every key back', async () => {
  const bot = fakeBot(); bot.controls.sneak = true;
  let seen;
  const reached = await move(bot, new Task('m'), { label: 'bridge_step', until: () => { seen = { ...bot.controls, controller: bot._controller?.name }; return true; } });
  assert.equal(reached, true);
  assert.deepEqual(seen, { sneak: true, forward: true, controller: 'bridge_step' });
  assert.equal(bot.controls.forward, false); assert.equal(bot.controls.sneak, true, 'a crouch held before is still held after');
  assert.equal(bot._controller, null);
});

test('walking upright needs a reason, and no move outlasts five seconds', async () => {
  const bot = fakeBot();
  await assert.rejects(move(bot, new Task('m'), { label: 'bare', sneak: false }), /needs a reason/);
  assert.equal(await move(bot, new Task('m'), { label: 'jump', keys: ['jump'], sneak: false, maxMs: 30 }), false, 'a jump in place needs none');
  const started = Date.now();
  await move(bot, new Task('m'), { label: 'long', maxMs: 60000, tick: 1000 });
  assert(Date.now() - started <= MAX_MS + 1100, 'capped');
});

test('a cancelled task lets go of the keys at once', async () => {
  const bot = fakeBot(), task = new Task('m');
  setTimeout(() => task.cancel(), 30);
  await assert.rejects(move(bot, task, { label: 'walk', maxMs: 2000 }), { name: 'Cancelled' });
  assert.equal(bot.controls.forward, false); assert.equal(bot.controls.sneak, false);
});

const sources = () => fs.readdirSync(path.join(__dirname, '..', 'src'), { recursive: true })
  .filter(f => f.endsWith('.js')).map(f => ({ file: f, text: fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8') }));

test('no code outside the motion helper holds a movement key', () => {
  // Boats steer a vehicle, not the bot's feet; everything else goes through move().
  const allowed = new Set(['motion.js', 'boats.js']);
  const offenders = sources().filter(({ file }) => !allowed.has(path.basename(file)))
    .flatMap(({ file, text }) => text.split('\n').map((line, i) => [file, i + 1, line]))
    .filter(([, , line]) => /setControlState\(\s*'(forward|back|left|right|jump|sprint)'\s*,\s*true\s*\)/.test(line));
  assert.deepEqual(offenders.map(([file, n]) => `${file}:${n}`), [], 'held movement keys belong in src/motion.js');
});

test('an await loop waits on something real between passes', () => {
  // A loop of promises that settle at once never yields to the event loop:
  // the night-mine detour spun that way and the bot drowned with its
  // process frozen. Every `while (await ...)` must sleep in its body.
  const offenders = [];
  for (const { file, text } of sources()) {
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      if (!/while \(await /.test(line)) return;
      const body = lines.slice(i, i + 14).join('\n');
      if (!/setTimeout|sleep\(|waitForTicks/.test(body)) offenders.push(`${file}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, []);
});

test('a move aimed somewhere keeps that heading while its keys are held, whatever turns the bot', async () => {
  // mid-72-e: climbing south out of a pool, it was found facing north against the far bank.
  const bot = fakeBot();
  bot.entity = { yaw: 0, pitch: 0 };
  bot.lookAt = async () => { bot.entity.yaw = Math.PI; bot.entity.pitch = 0.8; };
  bot.look = async (yaw, pitch) => { bot.entity.yaw = yaw; bot.entity.pitch = pitch; };
  let ticks = 0, headings = [];
  await move(bot, new Task('m'), { label: 'climb', sneak: false, why: 'out of the water', look: { x: 0, y: 0, z: 1 }, tick: 5, maxMs: 200,
    until: () => { headings.push(bot.entity.yaw); if (++ticks === 2) bot.entity.yaw = 0; return ticks > 4; } });
  assert.equal(headings.at(-1), Math.PI, `turned back: ${headings}`);
});

test('while the heading is wrong the keys are let go, and pressed again once it is right', async () => {
  // mid-215-e: a swing at a hoglin turned the bot about on a span, and forward, held through the turn, took it off.
  const bot = fakeBot();
  bot.entity = { yaw: 0, pitch: 0 };
  bot.lookAt = async () => { bot.entity.yaw = Math.PI; };
  const forwardWhileWrong = [];
  bot.look = async (yaw, pitch) => { forwardWhileWrong.push(bot.getControlState ? bot.getControlState('forward') : bot.controlState?.forward); bot.entity.yaw = yaw; bot.entity.pitch = pitch; };
  let ticks = 0;
  await move(bot, new Task('m'), { label: 'bridge_step', look: { x: 0, y: 0, z: 1 }, tick: 5, maxMs: 200,
    until: () => { if (++ticks === 2) bot.entity.yaw = 0; return ticks > 4; } });
  assert.deepEqual(forwardWhileWrong, [false], 'forward was let go while it turned back');
});

// A world of named cells; everything else air.
const worldBot = (cells, position, yaw) => {
  const bot = fakeBot();
  const solid = new Set(['obsidian', 'soul_sand', 'netherrack']);
  bot.entity = { position, yaw, pitch: 0 };
  bot.blockAt = p => { const name = cells[`${p.x},${p.y},${p.z}`] || 'air'; return { name, boundingBox: solid.has(name) ? 'block' : 'empty' }; };
  return bot;
};

test('a held-key move never walks into fire, nor off an edge into it; a way out of fire is left alone', async () => {
  // mid-218-m-nether-3 (note 502): out of its Nether-side portal, the step back out of the sheet went off the frame's
  // obsidian into the soul fire before it, on soul sand a block down, at 7.7 health; it burned to death in six seconds.
  const { Vec3 } = require('vec3');
  const cells = {};
  for (let x = -24; x <= -20; x++) for (let z = 80; z <= 86; z++) cells[`${x},64,${z}`] = 'soul_sand';
  for (const x of [-24, -23, -22, -21]) { cells[`${x},65,83`] = 'obsidian'; cells[`${x},65,84`] = 'soul_sand'; }
  cells['-22,65,82'] = 'soul_fire'; cells['-23,65,81'] = 'soul_fire';
  for (const y of [66, 67, 68]) { cells[`-23,${y},83`] = 'nether_portal'; cells[`-22,${y},83`] = 'nether_portal'; }
  // Facing south (+z), as it came out: back is north, into the fire.
  const bot = worldBot(cells, new Vec3(-21.5, 66, 83.5), -Math.PI);
  let held = false;
  const reached = await move(bot, new Task('m'), { label: 'leave_portal', keys: ['back'], maxMs: 200, tick: 5, until: () => { held = held || !!bot.controls.back; return false; } });
  assert.equal(reached, false);
  assert.equal(held, false, 'the key is never pressed toward the fire');
  assert.deepEqual({ ...bot._moveRefused, at: 0 }, { label: 'leave_portal', name: 'soul_fire', x: -22, y: 65, z: 82, at: 0 });
  // The other face, a soul sand floor, is walked.
  let ticks = 0;
  assert.equal(await move(bot, new Task('m'), { label: 'leave_portal', keys: ['forward'], maxMs: 200, tick: 5, until: () => ++ticks > 2 }), true);
  // Standing in the fire, the move out is its own way and not refused.
  const burning = worldBot(cells, new Vec3(-21.5, 64.875, 82.5), -Math.PI);
  ticks = 0;
  assert.equal(await move(burning, new Task('m'), { label: 'out_of_fire', keys: ['forward'], sneak: false, why: 'out', maxMs: 200, tick: 5, until: () => ++ticks > 2 }), true);
});

test('a span over the lava sea is walked with the body\'s side over the lava, and not off its end', async () => {
  const { Vec3 } = require('vec3');
  const cells = {};
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 6; z++) cells[`${x},31,${z}`] = 'lava';
  for (let z = 0; z <= 3; z++) cells[`0,32,${z}`] = 'netherrack';
  // Off the span's middle, toward its edge, heading along it (+z: yaw pi).
  const bot = worldBot(cells, new Vec3(0.75, 33, 0.5), Math.PI);
  let ticks = 0;
  assert.equal(await move(bot, new Task('m'), { label: 'bridge_step', maxMs: 200, tick: 5, until: () => ++ticks > 2 }), true);
  bot.entity.position = new Vec3(0.5, 33, 3.5);
  assert.equal(await move(bot, new Task('m'), { label: 'bridge_step', maxMs: 200, tick: 5 }), false);
  assert.equal(bot._moveRefused.name, 'lava');
});
