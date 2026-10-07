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

test('in the Overworld with the End makings in Nether chests, the portal to them is named on each heading (note 1397)', () => {
  const g = { portals: [{ x: -23, y: 80, z: 90, dimension: 'overworld' }, { x: 4, y: 50, z: 13, dimension: 'nether' }],
    rodStashes: [{ position: { x: -167, y: 80, z: 152 }, dimension: 'nether', contents: { blaze_rod: 5 } }, { position: { x: -93, y: 39, z: 35 }, dimension: 'nether', contents: { ender_pearl: 11 } }] };
  const says = anchors.headingSays(bot(400, 300), g, 0);
  assert.match(says, /farther \d+ to \d+ blocks from the portal at \(-23, 80, 90\), the way to the bot's Nether chests \(5 blaze rods, 11 ender pearls\)/);
});
