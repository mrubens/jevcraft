'use strict';
// Note 2610: the gap not reached, the lid goes up where the bot stands
// instead, where one can (enderman-roof.js takeRoof). full-226 (25592,
// 2026-10-30 23:02:56Z) took cap_fight for a gap 3 blocks off, the walk ended
// 'No route from here ... the way passes along a drop', and the fight in the
// open took 16.2 of 20 health in 2.6 seconds.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const roof = require('../src/enderman-roof');

// Stone floor under y 64, a wall at x -1 beside the bot (the lid's face), open air elsewhere.
function scene({ wall = true, blocks = 3 } = {}) {
  const placed = [];
  const solid = f => f.y < 64 || (wall && f.x === -1 && f.y <= 66) || placed.some(p => p.equals(f));
  const bot = { entity: { position: new Vec3(0.5, 64, 0.5), onGround: true }, entities: {},
    blockAt: p => { const f = p.floored(); const s = solid(f); return { name: s ? 'stone' : 'air', boundingBox: s ? 'block' : 'empty', position: f, diggable: s }; },
    inventory: { items: () => (blocks ? [{ name: 'cobblestone', count: blocks }] : []) } };
  const actions = { navigate: async () => { throw new Error('No route from here to (3, 64, 0) (partial): the way passes along a drop that'); },
    place: async (b, task, cell) => { placed.push(cell.floored()); } };
  return { bot, actions, placed };
}

test('the gap\'s walk refused, the lid goes up over the bot where a face is beside it, and the plan says both', async () => {
  const { bot, actions, placed } = scene();
  const plan = { kind: 'gap', cell: new Vec3(3, 64, 0), blocks: 0, seconds: 1 };
  assert.equal(await roof.takeRoof(bot, new Task('roof'), actions, plan), true);
  assert.deepEqual(placed.map(String), ['(0, 66, 0)']);
  assert.equal(plan.why, 'the walk to the gap at (3, 64, 0) failed: No route from here to (3, 64, 0) (partial): the way passes along a drop that; the lid went up where the bot stood instead, at (0, 66, 0)');
});

test('with no face beside and no blocks for a post, the failure stands as before', async () => {
  const { bot, actions, placed } = scene({ wall: false, blocks: 1 });
  const plan = { kind: 'gap', cell: new Vec3(3, 64, 0), blocks: 0, seconds: 1 };
  assert.equal(await roof.takeRoof(bot, new Task('roof'), actions, plan), false);
  assert.equal(placed.length, 0);
  assert.match(plan.why, /^the walk to the gap at \(3, 64, 0\) failed: No route from here/);
});

test('with blocks for a post and no face, the post goes up first, then the lid', async () => {
  const { bot, actions, placed } = scene({ wall: false, blocks: 8 });
  const plan = { kind: 'gap', cell: new Vec3(3, 64, 0), blocks: 0, seconds: 1 };
  assert.equal(await roof.takeRoof(bot, new Task('roof'), actions, plan), true);
  assert.equal(placed.length, 4);
  assert.equal(String(placed.at(-1)), '(0, 66, 0)');
});
