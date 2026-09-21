'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { resourceSources, nearestRemaining, decisionFingerprint } = require('../src/decision-options');

function world(blocks) {
  const named = new Map(blocks.map(([x, y, z, name]) => [`${x},${y},${z}`, name]));
  return { entity: { position: new Vec3(0.5, 64, 0.5) }, blockAt: p => ({ name: named.get(`${p.x},${p.y},${p.z}`) || 'air' }) };
}

test('blocks of one tree become one source; Jev is offered sources that differ, not neighbouring logs', () => {
  const bot = world([[3, 64, 0, 'oak_log'], [3, 65, 0, 'oak_log'], [3, 66, 0, 'oak_log'], [30, 70, 4, 'oak_log'], [31, 70, 4, 'oak_log'], [9, 64, 9, 'birch_log']]);
  const sources = resourceSources(bot, [new Vec3(30, 70, 4), new Vec3(3, 66, 0), new Vec3(3, 64, 0), new Vec3(31, 70, 4), new Vec3(3, 65, 0), new Vec3(9, 64, 9)]);
  assert.deepEqual(sources.map(s => [s.block, s.description.blocksWithinReach, s.description.distance, s.description.elevationChange]),
    [['oak_log', 3, 3, 0], ['birch_log', 1, 12, 0], ['oak_log', 2, 30, 6]]);
  assert.equal(nearestRemaining(bot, sources[0]).y, 64);
});

test('a source that failed moments ago is not offered again, and a vanished source is reported', () => {
  const bot = world([[3, 64, 0, 'oak_log'], [20, 64, 0, 'oak_log']]);
  const now = Date.now();
  const all = resourceSources(bot, [new Vec3(3, 64, 0), new Vec3(20, 64, 0)], { now });
  const after = resourceSources(bot, [new Vec3(3, 64, 0), new Vec3(20, 64, 0)], { now, failures: { [all[0].key]: { at: now - 1000 } } });
  assert.deepEqual(after.map(s => s.key), [all[1].key]);
  const stale = resourceSources(bot, [new Vec3(3, 64, 0), new Vec3(20, 64, 0)], { now, failures: { [all[0].key]: { at: now - 600000 } } });
  assert.equal(stale.length, 2);
  bot.blockAt = () => ({ name: 'air' });
  assert.equal(nearestRemaining(bot, all[0]), null);
});

test('a decision stays fresh while a mob wanders, and goes stale when what it depends on changes', () => {
  let threat = false, food = 20;
  const bot = { get food() { return food; }, health: 20, game: { dimension: 'overworld' } };
  const facts = { inventory: () => ({ oak_log: 2 }), immediateThreat: () => threat, needsAir: () => false };
  const before = decisionFingerprint(bot, facts);
  assert.equal(decisionFingerprint(bot, facts), before);
  food = 14;
  assert.notEqual(decisionFingerprint(bot, facts), before);
  food = 20; threat = true;
  assert.notEqual(decisionFingerprint(bot, facts), before);
});
