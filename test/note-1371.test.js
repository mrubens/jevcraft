'use strict';
const test = require('node:test');
const assert = require('node:assert');
const anchors = require('../src/anchors');

const bot = (x, z) => ({ entity: { position: { x, y: 63, z } }, game: { dimension: 'overworld' } });
const goal = { endPortal: { center: { x: 604, y: -37, z: 1540 } },
  rodStashes: [{ position: { x: 203, y: 63, z: 245 }, dimension: 'overworld', contents: { ender_eye: 12, ender_pearl: 6 } },
    { position: { x: -118, y: 74, z: 160 }, dimension: 'nether', contents: { blaze_rod: 2 } }] };

test('each heading says how it changes the distance to the eyes and the End portal (note 1371)', () => {
  const east = anchors.headingSays(bot(736, -370), goal, 0);
  assert.match(east, /^ 128 blocks this way: farther \d+ to \d+ blocks from the chest with [^;]*12[^;]* at \(203, 63, 245\); /);
  assert.match(east, /from the End portal at \(604, -37, 1540\)\.$/);
  assert.doesNotMatch(east, /-118/);
  const southWest = anchors.headingSays(bot(736, -370), goal, 3);
  assert.match(southWest, /nearer \d+ to \d+ blocks from the chest/);
  assert.match(anchors.nowSays(bot(736, -370), goal), /^814 blocks from the chest/);
});

test('nothing banked and no portal found says nothing', () => {
  assert.strictEqual(anchors.headingSays(bot(0, 0), {}, 0), '');
  assert.strictEqual(anchors.nowSays(bot(0, 0), {}), null);
});
