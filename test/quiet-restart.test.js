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
  const stop = watchRestartRequest(bot, file, { startedAt: Date.now() - 1000, every: 20, exit: () => { exited++; }, port: 25590, watched: () => true });
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

test('with no supervisor watching the port a restart asked for is not taken (mid-242-bd and mid-243-be quit and stayed down three hours), and is once one is', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jev-')), 'restart-requested');
  const bot = { isAlive: true, entity: { position: new Vec3(0, 64, 0), onGround: true }, entities: {}, quit() { this.quitted = true; } };
  let supervisor = false, exited = 0, clock = 0;
  const said = [];
  const stop = watchRestartRequest(bot, file, { startedAt: Date.now() - 1000, every: 20, exit: () => { exited++; }, port: 25590, watched: () => supervisor, now: () => clock += 16000, say: m => said.push(m) });
  fs.writeFileSync(file, '');
  await new Promise(r => setTimeout(r, 200));
  assert.equal(bot.quitted, undefined, 'no supervisor: stays up');
  assert.equal(said.length, 1, 'and says so once');
  assert.match(said[0], /no supervisor is watching port 25590.*supervisor\.sh 25590/);
  supervisor = true;
  await new Promise(r => setTimeout(r, 700));
  assert.equal(bot.quitted, true, 'a supervisor came: quits');
  assert.equal(exited, 1);
  stop();
});

test('a supervisor is found by the process list; no port, none', () => {
  const { supervised } = require('../src/quiet-restart');
  assert.equal(supervised(null), false);
  assert.equal(supervised(1), false);
});

test('not quiet while hurt or with a shooter within forty-eight blocks (note 988)', () => {
  const { quiet } = require('../src/quiet-restart');
  const blaze = { id: 3, name: 'blaze', type: 'hostile', position: new Vec3(19, 64, 0), height: 1.8, isValid: true };
  const bot = { isAlive: true, health: 20, entity: { position: new Vec3(0, 64, 0), onGround: true }, entities: {} };
  assert.equal(quiet(bot), true);
  bot.health = 11.2;
  assert.equal(quiet(bot), false, 'hurt: not now');
  bot.health = 20; bot.entities[3] = blaze;
  assert.equal(quiet(bot), false, 'a blaze nineteen blocks off: not now');
  blaze.position = new Vec3(60, 64, 0);
  assert.equal(quiet(bot), true);
});

test('past fifteen minutes the restart still waits for a calm moment, and quits whatever only past forty-five (note 1002)', async () => {
  const { watchRestartRequest, WAIT_MS, LAST_MS } = require('../src/quiet-restart');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jev-')), 'restart-requested');
  const skeleton = { id: 4, name: 'skeleton', type: 'hostile', position: new Vec3(9, 64, 0), height: 1.95, isValid: true };
  const bot = { isAlive: true, health: 3, entity: { position: new Vec3(0, 64, 0), onGround: true }, entities: { 4: skeleton }, quit() { this.quitted = true; } };
  let clock = Date.now(), exited = 0;
  const stop = watchRestartRequest(bot, file, { startedAt: clock - 1000, every: 10, exit: () => { exited++; }, port: 25589, watched: () => true, now: () => clock });
  fs.writeFileSync(file, '');
  await new Promise(r => setTimeout(r, 60));
  clock += WAIT_MS + 60000;
  await new Promise(r => setTimeout(r, 60));
  assert.equal(bot.quitted, undefined, 'sixteen minutes on, 3 health and a skeleton nine blocks off: not quit');
  delete bot.entities[4]; bot.health = 11;
  await new Promise(r => setTimeout(r, 700));
  assert.equal(bot.quitted, true, 'calm: quits');
  stop();
  // Never calm: quit past forty-five minutes.
  const bot2 = { isAlive: true, health: 3, entity: { position: new Vec3(0, 64, 0), onGround: true }, entities: { 4: skeleton }, quit() { this.quitted = true; } };
  const file2 = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jev-')), 'restart-requested');
  let clock2 = Date.now();
  const stop2 = watchRestartRequest(bot2, file2, { startedAt: clock2 - 1000, every: 10, exit: () => {}, port: 25589, watched: () => true, now: () => clock2 });
  fs.writeFileSync(file2, '');
  await new Promise(r => setTimeout(r, 60));
  clock2 += LAST_MS + 60000;
  await new Promise(r => setTimeout(r, 700));
  assert.equal(bot2.quitted, true);
  stop2();
});
