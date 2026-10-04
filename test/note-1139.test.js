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
