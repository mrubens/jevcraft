'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { hungerRecordSays } = require('../src/healing');

const bot = (worn = {}, dimension = 'overworld') => ({ game: { dimension }, inventory: { slots: worn } });

test('under hunger 18 in the Overworld, the deaths by hunger are said with the bot\'s own row (note 1374)', () => {
  assert.match(hungerRecordSays(bot(), 13), /under 14, 1\.45 and 3\.13\. At hunger 13 with nothing worn: 3\.13 an hour, against 0\.16 fed to 18$/);
  assert.match(hungerRecordSays(bot({ 6: { name: 'iron_chestplate' } }), 16), /At hunger 16 with armour on: 0\.61 an hour, against 0\.12 fed to 18$/);
});

test('fed, or out of the Overworld, nothing is said', () => {
  assert.equal(hungerRecordSays(bot(), 18), null);
  assert.equal(hungerRecordSays(bot({}, 'the_nether'), 10), null);
});
