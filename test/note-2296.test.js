'use strict';
// Note 2296: what lies in view is offered to Jev on upkeep, with what it is, how far, the seconds, and any mob about.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { lootOption } = require('../src/loot-nearby');

const drop = (id, name, x, count = 1) => ({ id, isValid: true, position: new Vec3(x, 64, 0), getDroppedItem: () => ({ name, count }) });
test('string and rotten flesh lying near are both offered, said with distance and seconds; nothing lying, no option', () => {
  const bot = { entity: { position: new Vec3(0, 64, 0) }, entities: { 1: drop(1, 'string', 3, 2), 2: drop(2, 'rotten_flesh', 5) } };
  const o = lootOption(bot);
  assert.match(o.description, /^(?:This way: .*? health(?: \(more than the bot has\))?\. )?Pick up what is lying here: 2 string 3 blocks off; 1 rotten flesh 5 blocks off\. About \d+ seconds there and back\./);
  assert.equal(lootOption({ entity: { position: new Vec3(0, 64, 0) }, entities: {} }), null);
});
