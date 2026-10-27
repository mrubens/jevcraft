'use strict';
// The work stopped at once by its threat check again and again: survival claims the mob (note 2313).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');

const world = () => {
  const bot = { entity: { position: new Vec3(0, 64, 0), eyeHeight: 1.62, metadata: [0] }, health: 20, food: 20, oxygenLevel: 20, entities: {},
    game: { dimension: 'overworld', difficulty: 'normal', gameMode: 'survival', minY: -64, height: 384 },
    time: { timeOfDay: 6000, age: 100000 }, inventory: { items: () => [], slots: [] }, registry: { entitiesByName: {} },
    blockAt: p => p.y < 64 ? { name: 'stone', boundingBox: 'block', position: p } : { name: 'air', boundingBox: 'empty', position: p } };
  return bot;
};

test('two stops of the work by its threat check in ten seconds, a threat there now: survival claims it', () => {
  const danger = require('../src/danger');
  const real = danger.immediateThreat;
  const creeper = { id: 7, name: 'creeper', type: 'hostile', position: new Vec3(7, 64, 0), height: 1.7, metadata: [] };
  danger.immediateThreat = () => ({ entity: creeper, distance: 7, visible: true });
  try {
    const bot = world();
    const goal = { kind: 'win', step: { action: 'ascend_to_surface' }, survival: {} };
    const survival = { state: goal.survival, currentShelter: () => null };
    const now = Date.now();
    bot._arbiter = { stopped: { layer: 'work', why: 'Threat nearby: creeper at 7 blocks', at: now - 300, first: now - 1200, count: 3 } };
    const c = require('../src/survival').claim(bot, goal, survival);
    assert.equal(c.action, 'escape_threat'); assert.equal(c.urgency, 'pressing');
    assert.match(c.facts.workStopped, /^the work's last 3 turns, in 1 seconds?, were each stopped at once by its threat check: Threat nearby: creeper at 7 blocks$/);
    assert.equal(c.facts.threats[0].name, 'creeper');
    // Once, or long ago, or no threat now: no such claim.
    bot._arbiter.stopped.count = 1;
    assert.notEqual(require('../src/survival').claim(bot, goal, survival)?.facts?.workStopped !== undefined, true);
    bot._arbiter.stopped.count = 3; bot._arbiter.stopped.at = now - 20000;
    assert.equal(require('../src/survival').claim(bot, goal, survival)?.facts?.workStopped, undefined);
    bot._arbiter.stopped.at = now - 300; danger.immediateThreat = () => null;
    assert.equal(require('../src/survival').claim(bot, goal, survival)?.facts?.workStopped, undefined);
  } finally { danger.immediateThreat = real; }
});
