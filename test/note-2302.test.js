'use strict';
// Note 2302: a ruined portal and a village known within reach are each offered as a trip, said with what they hold.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { foundOptions } = require('../src/found-places');

test('a ruin and a village known: both offered, with the walk, the height and the needs they cover', () => {
  const bot = { game: { dimension: 'overworld' }, entity: { position: new Vec3(0, 64, 0) }, inventory: { items: () => [], slots: {} } };
  const goal = { landmarks: [{ kind: 'ruined_portal', x: 120, y: 66, z: 0, dimension: 'overworld' }], villages: [{ x: 0, y: 90, z: 200, dimension: 'overworld', beds: 12, hay: 4 }] };
  const o = foundOptions(bot, goal, { lootActions: { navigate: async () => {} } });
  assert.match(o.visit_ruined_portal.description, /^(?:This way: .*? health(?: \(more than the bot has\))?\. )?Go to the ruined portal at \(120, 66, 0\), 120 blocks off, about \d+ minutes?.*no golden boots yet.*no flint and steel carried/);
  assert.match(o.visit_village.description, /^(?:This way: .*? health(?: \(more than the bot has\))?\. )?Go to the village at \(0, 90, 200\), 200 blocks off, 26 blocks up, about \d+ minutes.*12 beds, 4 hay bales/);
});
