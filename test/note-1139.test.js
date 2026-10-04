'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { quiet } = require('../src/quiet-restart');

const bot = extra => ({ isAlive: true, health: 20, entity: { position: new Vec3(0, 64, 0), onGround: true }, entities: {}, ...extra });

test('a new build is not taken in the half minute after the bot answered a mob or was hurt, nor while it closes on a target (note 1139)', () => {
  assert.equal(quiet(bot()), true);
  assert.equal(quiet(bot({ _threatResponseAt: Date.now() - 18000 })), false, 'eighteen seconds after its stance at an enderman');
  assert.equal(quiet(bot({ _threatResponseAt: Date.now() - 31000 })), true);
  assert.equal(quiet(bot({ _recentHurtAt: Date.now() - 5000 })), false);
  assert.equal(quiet(bot({ _closingOn: { name: 'enderman', until: Date.now() + 4000 } })), false);
  assert.equal(quiet(bot({ _closingOn: { name: 'enderman', until: Date.now() - 1 } })), true);
});

test('no new build is taken while the bot is in the End, however long it was asked for (note 1171)', async () => {
  const fs = require('fs'), os = require('os'), path = require('path');
  const { watchRestartRequest } = require('../src/quiet-restart');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jev-')), 'restart-requested');
  const b = { ...bot(), game: { dimension: 'the_end' }, quit() { this.quitted = true; } };
  let clock = Date.now();
  const stop = watchRestartRequest(b, file, { startedAt: clock - 1000, every: 10, exit: () => {}, now: () => clock, port: 25594, watched: () => true, say: () => {} });
  fs.writeFileSync(file, '');
  await new Promise(r => setTimeout(r, 60));
  clock += 50 * 60000;
  await new Promise(r => setTimeout(r, 60));
  assert.equal(b.quitted, undefined, 'fifty minutes asked, in the End: still up');
  b.game.dimension = 'overworld';
  await new Promise(r => setTimeout(r, 80));
  assert.equal(b.quitted, true, 'out of the End and quiet: taken');
  if (typeof stop === 'function') stop();
});

test('health that is not coming back does not hold a new build off: hungry with nothing to eat, the wait heals nothing (note 1236)', () => {
  const foods = { registry: { foodsByName: { cooked_beef: { foodPoints: 8 } } } };
  assert.equal(quiet(bot({ health: 9, food: 20, ...foods, inventory: { items: () => [] } })), false, 'healing: fed');
  assert.equal(quiet(bot({ health: 9, food: 12, ...foods, inventory: { items: () => [{ name: 'cooked_beef', count: 2 }] } })), false, 'healing: food carried');
  assert.equal(quiet(bot({ health: 5, food: 12, ...foods, inventory: { items: () => [{ name: 'stone_sword', count: 1 }] } })), true);
});
