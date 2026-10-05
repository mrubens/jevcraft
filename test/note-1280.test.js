'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const nf = require('../src/nether-food');

test('the Nether stay counts what the bot\'s chests hold: one rod wanted is not two hours (note 1280)', () => {
  const reg = require('minecraft-data')('26.1');
  const frames = Array.from({ length: 12 }, (_, i) => ({ position: { x: 600 + i, y: -37, z: 1540 }, eye: false }));
  const goal = { kind: 'win', gameProgress: { milestones: { stronghold_located: { at: 1, center: { x: 604, z: 1540 }, frames } } },
    rodStashes: [{ position: { x: 575, y: 94, z: 1531 }, dimension: 'overworld', contents: { ender_eye: 11 } }, { position: { x: -108, y: 49, z: 32 }, dimension: 'nether', contents: { ender_pearl: 1 } }] };
  const bot = { registry: reg, game: { dimension: 'the_nether' }, inventory: { items: () => [] }, entity: { position: new Vec3(0, 64, 0) }, _goal: goal };
  const s = nf.stayFacts(bot);
  assert.equal(s.rodsLeft, 1);
  assert.equal(s.minutes, 30);
  assert.equal(nf.stayFacts({ ...bot, _goal: null }).minutes, 120, 'without the goal, the pockets alone');
});
