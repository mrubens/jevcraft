'use strict';
// Note 2283: at a live spawner, the count within sixteen is said with how it has grown this stay.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const record = require('../src/blaze-record');

test('the count within sixteen grows and is said against the stay\'s start', () => {
  const cage = new Vec3(5, 64, 0);
  const entities = {};
  const bot = { entity: { position: new Vec3(0, 64, 0) }, entities, blockAt: () => null };
  const put = n => { for (const k of Object.keys(entities)) delete entities[k]; for (let i = 0; i < n; i++) entities[i] = { name: 'blaze', position: new Vec3(i % 8, 66, 3), isValid: true }; };
  const t0 = 1_000_000;
  put(2); record.entryFacts(bot, { cage, now: t0 });
  put(8); record.entryFacts(bot, { cage, now: t0 + 120000 });
  put(25); const f = record.entryFacts(bot, { cage, now: t0 + 360000 });
  assert.match(f.says, /Within sixteen of it: 25 now, 2 when this stay began 6 minutes ago\./);
});
