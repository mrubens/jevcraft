'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Vec3 } = require('vec3');
const { pocketWaitSays } = require('../src/pocket-wait');

const bot = timeOfDay => ({ game: { dimension: 'overworld' }, health: 5.6, food: 12, time: { timeOfDay },
  entity: { position: new Vec3(0.5, 64, 0.5) }, inventory: { items: () => [], slots: [] }, blockAt: () => ({ name: 'stone' }), entities: {} });

test('starving in a pocket at night, the stay says it spends no hunger and the food is looked for by day (note 1377)', () => {
  const now = Date.now();
  const says = pocketWaitSays(bot(19500), { pocketWait: { since: now - 11000 } }, {}, { night: true, noFood: true, now });
  const stay = says.options?.stay ?? says.stay;
  assert.match(stay, /health does not come back in this pocket however long it waits\. Standing still spends no hunger, so hunger stays at 12 through the stay \(dawn in about \d+ real minutes?\); the food set out for then is looked for by day/);
});
