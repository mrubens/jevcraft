'use strict';
const test = require('node:test');
const assert = require('node:assert');
const nr = require('../src/night-record');

const bot = (worn = {}) => ({ inventory: { slots: worn, items: () => [] } });

test('a bare bot is told the night by armour, not the pooled odds alone (note 1370)', () => {
  const says = nr.keepOnSays('surface', { minutesToDawn: 6, bot: bot() });
  assert.doesNotMatch(says, /1 in 43/);
  assert.match(says, /most of them in iron/);
  assert.match(says, /with nothing worn 1\.6 deaths an hour \(71 in 44\.5 bot-hours\), in armour 0\.76/);
  assert.match(says, /Nothing is worn now: to dawn, about 6 real minutes, that is about 1 in 6 of a death at that rate\./);
});

test('in armour the armoured rate is the one said to dawn', () => {
  const says = nr.keepOnSays('surface', { minutesToDawn: 6, bot: bot({ 6: { name: 'iron_chestplate' } }) });
  assert.match(says, /Armour is worn now: to dawn, about 6 real minutes, that is about 1 in 13 of a death/);
});

test('with no bot the old line stands', () => {
  assert.match(nr.keepOnSays('surface', { minutesToDawn: 6 }), /about 1 in 43 of a death at the night's rate/);
});
