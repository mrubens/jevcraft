'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { nextGameStage } = require('../src/game-progress');

// The stage past the kit's rungs: each kit item the ladder asks for is given until it asks for something else.
function stagePastKit(goal, eyes) {
  const items = [{ name: 'blaze_powder', count: 1 }, ...(eyes ? [{ name: 'ender_eye', count: eyes }] : [])];
  const bot = { game: { dimension: 'overworld', gameMode: 'survival' }, health: 20, food: 20, entity: { position: new Vec3(0, 64, 0) }, entities: {}, time: { timeOfDay: 2000 },
    registry: require('minecraft-data')('26.1'), inventory: { items: () => items, slots: {} }, blockAt: () => null, findBlocks: () => [] };
  let stage = null;
  for (let i = 0; i < 30; i++) {
    stage = nextGameStage(bot, JSON.parse(JSON.stringify(goal)));
    if (stage.action === 'acquire' && stage.item && !/ender|blaze/.test(stage.item)) { items.push({ name: stage.item, count: stage.count || 1 }); continue; }
    break;
  }
  return stage;
}

test('the portal found and no number of frames saved: the way to the End wants the eyes its frames show empty, not none (note 1210)', () => {
  const located = () => ({ kind: 'win', gameProgress: { version: 1, milestones: { nether_entered: { at: 1 }, eyes_obtained: { at: 2 }, stronghold_located: { at: 3, center: { x: 604, y: -37, z: 1540 }, frames: Array.from({ length: 12 }, () => ({ eye: false })) } } } });
  assert.notEqual(stagePastKit(located(), 0).phase, 'enter_end', '25594 was on the End\'s kit with no eye');
  assert.equal(stagePastKit(located(), 12).phase, 'enter_end');
  // Two frames come filled: ten is enough.
  const two = located(); two.gameProgress.milestones.stronghold_located.frames[0].eye = two.gameProgress.milestones.stronghold_located.frames[1].eye = true;
  assert.equal(stagePastKit(two, 10).phase, 'enter_end');
});

test('the twelve eyes in the bot\'s chest and none carried: the chest is the step before the way to the End, not the portal (note 1388)', () => {
  const goal = { kind: 'win', gameProgress: { version: 1, milestones: { nether_entered: { at: 1 }, eyes_obtained: { at: 2 }, stronghold_located: { at: 3, center: { x: 604, y: -37, z: 1540 },
    frames: Array.from({ length: 12 }, (_, i) => ({ position: { x: i, y: -37, z: 0 }, eye: false })) } } },
    rodStashes: [{ position: { x: 203, y: 63, z: 245 }, dimension: 'overworld', contents: { ender_eye: 12, ender_pearl: 6 }, storedAt: '2026-10-06T17:00:00Z' }],
    endKit: { choice: { pick: 'fill_frame_first', at: 1 } } };
  const stage = stagePastKit(goal, 0);
  assert.equal(stage.phase, 'collect_rod_stash', JSON.stringify(stage));
  assert.deepEqual(stage.at, { x: 203, y: 63, z: 245 });
  // Taken out and carried, the way to the End.
  goal.rodStashes[0].contents = {};
  assert.equal(stagePastKit(goal, 12).phase, 'enter_end');
});
