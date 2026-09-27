'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { Vec3 } = require('vec3');
const { watchRestartRequest } = require('../src/quiet-restart');

test('a restart asked for waits for a quiet moment: no hostile near, on the ground, off any seat or span', async () => {
  // Five midgame deaths of 2026-09-27 followed a restart by seconds: into a fight, a boat or a span.
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jev-')), 'restart-requested');
  const zombie = { id: 2, name: 'zombie', type: 'hostile', position: new Vec3(3, 64, 0), height: 1.95, isValid: true };
  const bot = { isAlive: true, entity: { position: new Vec3(0, 64, 0), onGround: true }, entities: { 2: zombie }, quit() { this.quitted = true; } };
  let exited = 0;
  const stop = watchRestartRequest(bot, file, { startedAt: Date.now() - 1000, every: 20, exit: () => { exited++; } });
  fs.writeFileSync(file, '');
  await new Promise(r => setTimeout(r, 120));
  assert.equal(bot.quitted, undefined, 'a zombie three blocks off: not now');
  delete bot.entities[2];
  bot._spanning = { target: { x: 9, y: 64, z: 0 } };
  await new Promise(r => setTimeout(r, 120));
  assert.equal(bot.quitted, undefined, 'on a span: not now');
  bot._spanning = null;
  await new Promise(r => setTimeout(r, 700));
  assert.equal(bot.quitted, true, 'quiet: quits');
  assert.equal(exited, 1);
  stop();
});

test('a request older than the process is not one for it', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jev-')), 'restart-requested');
  fs.writeFileSync(file, '');
  const bot = { isAlive: true, entity: { position: new Vec3(0, 64, 0), onGround: true }, entities: {}, quit() { this.quitted = true; } };
  const stop = watchRestartRequest(bot, file, { startedAt: Date.now() + 1000, every: 20, exit: () => {} });
  await new Promise(r => setTimeout(r, 100));
  assert.equal(bot.quitted, undefined);
  stop();
});
