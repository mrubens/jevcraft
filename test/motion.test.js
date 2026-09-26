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
