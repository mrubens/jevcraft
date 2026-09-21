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

test('a failed source stays failed when the same tree reappears under its next-nearest block, and set-aside blocks are dropped', () => {
  const { setAsideSource } = require('../src/decision-options');
  const bot = world([[3, 64, 0, 'oak_log'], [3, 65, 0, 'oak_log'], [3, 66, 0, 'oak_log'], [20, 64, 0, 'oak_log']]);
  const now = Date.now(), all = [new Vec3(3, 64, 0), new Vec3(3, 65, 0), new Vec3(3, 66, 0), new Vec3(20, 64, 0)];
  const first = resourceSources(bot, all, { now });
  assert.equal(first[0].key, 'source_oak_log_3_64_0');
  // The seed block is gone; the tree would come back as source_oak_log_3_65_0.
  const failures = { [first[0].key]: { at: now } };
  const again = resourceSources(bot, all.slice(1), { now, failures });
  assert.deepEqual(again.map(s => s.key), ['source_oak_log_20_64_0']);
  const goal = {};
  setAsideSource(goal, first[0], now);
  assert.deepEqual(Object.keys(goal.unreachable).sort(), ['(3, 64, 0)', '(3, 65, 0)', '(3, 66, 0)']);
  assert.deepEqual(resourceSources(bot, all, { now, unreachable: goal.unreachable }).map(s => s.key), ['source_oak_log_20_64_0']);
});

test('a chosen source is kept until it is exhausted, set aside, or the resource changes', () => {
  const { rememberSource, committedSource } = require('../src/decision-options');
  const bot = world([[3, 64, 0, 'oak_log'], [3, 65, 0, 'oak_log']]);
  const [source] = resourceSources(bot, [new Vec3(3, 64, 0), new Vec3(3, 65, 0)]);
  const goal = {}, step = { action: 'mine', drops: 'oak_log' };
  rememberSource(goal, source, step);
  const revived = committedSource(JSON.parse(JSON.stringify({ bot: null })) && bot, JSON.parse(JSON.stringify(goal)), step);
  assert.equal(revived.key, source.key); assert.equal(revived.blocks.length, 2);
  assert.equal(committedSource(bot, goal, { action: 'mine', drops: 'birch_log' }), null, 'a different resource is a new choice');
  goal.unreachable = { '(3, 64, 0)': Date.now(), '(3, 65, 0)': Date.now() };
  assert.equal(committedSource(bot, goal, step), null); assert.equal(goal.workingSource, undefined, 'an exhausted source is forgotten');
});
