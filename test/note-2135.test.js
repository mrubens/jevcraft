'use strict';
// Note 2135: at the end of a surface food errand with animals in view, Jev
// chooses between stopping at the floor and taking the animals first; the
// mark chosen stands over the floor while it holds.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const fe = require('../src/food-enough');

function world(animals) {
  const entities = {};
  animals.forEach(([name, x, z], i) => { entities[i + 1] = { id: i + 1, name, position: new Vec3(x, 64, z), isValid: true, metadata: [] }; });
  const bot = { registry, game: { dimension: 'overworld', difficulty: 'normal' }, food: 19, health: 20, entity: { position: new Vec3(0.5, 64, 0.5) }, entities,
    inventory: { items: () => [{ name: 'cooked_beef', count: 2 }], slots: {} } };
  return bot;
}

test('the animals in view, nearest first, with their cooked points', () => {
  const prey = fe.preyInView(world([['sheep', 20, 0], ['cow', 8, 0], ['zombie', 3, 0], ['cow', 60, 0]]));
  assert.deepEqual(prey.map(p => [p.name, p.distance, p.points]), [['cow', 8, 16], ['sheep', 20, 9]]);
});

test('the two ways: stop at the floor, or take the animals to a mark', () => {
  const bot = world([['cow', 8, 0], ['sheep', 20, 0]]);
  const ways = fe.ways(bot, {}, { kind: 'win', survival: {} }, { supply: 16, floor: 12 });
  assert.equal(ways.target, 41);
  assert.match(ways.enough_now.description, /^(?:This way: .*? health(?: \(more than the bot has\))?\. )?Stop the food here with the 16 food points carried \(the floor kept here is 12, met\) and go back to the work: at the record's [\d.]+ hunger an hour of play they last about \d+ minutes of play, and the next food is a climb back up from wherever the work is then\./);
  assert.match(ways.take_more.description, /^(?:This way: .*? health(?: \(more than the bot has\))?\. )?Take the 2 animals in view first: a cow 8 blocks off \(16 food points cooked\), a sheep 20 blocks off \(9 food points cooked\)\. The errand goes on to 41 food points \(about \d+ minutes of play at the record's drain\), then this is not asked again for it; the mark holds 15 minutes or until it is carried\./);
  assert.equal(fe.ways(world([]), {}, {}, { supply: 16, floor: 12 }), null, 'no animal in view: not asked');
  assert.equal(fe.ways(world([['cow', 8, 0]]), {}, {}, { supply: 64, floor: 12 }), null, 'nothing more to take past 64');
});

test('the mark chosen stands over the floor while it holds, and the reserve reads it', () => {
  const now = Date.now();
  const state = { foodKeepTo: { at: now, until: now + fe.KEEP_MS, points: 41 } };
  assert.deepEqual(fe.keepTo(state, 16, now), state.foodKeepTo);
  assert.equal(fe.keepTo(state, 41, now), null, 'carried: done');
  assert.equal(fe.keepTo(state, 16, now + fe.KEEP_MS), null, 'fifteen minutes on: lapsed');
  assert.equal(fe.askedLately(state, now), true);
  assert.equal(fe.askedLately({ foodKeepTo: { at: now, until: now + fe.KEEP_MS } }, now), true, 'enough_now holds too');
  const reserve = require('../src/food-reserve');
  const bot = world([]);
  assert.equal(reserve.wanted(bot, { kind: 'win', survival: state }).points, 41);
  assert.equal(reserve.wanted(bot, { kind: 'win', survival: {} }).points, 12);
});
