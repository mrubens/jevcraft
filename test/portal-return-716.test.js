'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { groundBot } = require('./fixtures/saved-ground');

// 25583 (mid-242-mh, 01:59-02:26Z on 2026-09-30, note 716) chose
// return_for_blocks with its portal 22 blocks off and no pickaxe carried.
// The walk into the portal and the crossing toward it both failed, and the
// stair to it (work.js stairsOrWay -> tunnelToward) asked for a stone
// pickaxe first, since the portal was past the old STAIR_ACROSS (16
// blocks) and note 678's fix only spared a shorter stair. Getting that
// pickaxe meant wood, none carried, so it turned into a fresh nether_gather
// stems errand (leg_north, crimson_stem) half a second after the chat said
// "Going back through the portal..."; the errand failed noPath, and
// fortress_leg was asked again. The bot never took a step toward its own
// portal, twelve times in twenty-five minutes.
//
// note 629 (mid-243-af-nether-3-fortress-5, 25586) shows going for the
// pickaxe first is still right for a genuinely long stair (hundreds of
// blocks: twenty minutes by hand against three with a pickaxe), so the fix
// is not "never fetch wood for a portal stair" but a wider STAIR_ACROSS
// (tunneling.js): a stair a couple of dozen blocks by hand finishes in
// under a minute, well inside what a wood fetch's own search risks losing
// to a single noPath, so 25583's 22-block stair now digs by hand instead.
function world() {
  // A floor and ceiling of solid netherrack the whole way, with a two-tall
  // room carved at the start and, 25 blocks off (past the old
  // STAIR_ACROSS, inside the widened one), at the target; the 25 blocks
  // between are solid rock to dig through.
  const box = { x: [-3, 30], y: [59, 62], z: [0, 2] };
  const palette = ['air', 'netherrack'];
  const carved = x => (x >= -1 && x <= 1) || (x >= 24 && x <= 26);
  const at = (x, y, z) => {
    if (z !== 1) return 1;
    if (y === 59 || y === 62) return 1;
    return carved(x) ? 0 : 1;
  };
  const rows = [];
  for (let y = box.y[0]; y <= box.y[1]; y++) for (let z = box.z[0]; z <= box.z[1]; z++) {
    let row = '';
    for (let x = box.x[0]; x <= box.x[1]; x++) row += String.fromCharCode(97 + at(x, y, z));
    rows.push(row);
  }
  return { box, palette, rows };
}
function stairBot() {
  const bot = groundBot(world(), { at: new Vec3(0.5, 60, 1.5), dimension: 'the_nether', items: [] });
  // Real digging, as a mineflayer bot's own dig would: the block dug turns
  // to air in the same map blockAt already reads through (bot.changed).
  bot.dig = async block => { bot.changed.set(`${block.position.x},${block.position.y},${block.position.z}`, 'air'); };
  bot.canDigBlock = () => true;
  bot.stopDigging = () => {};
  // The one step into the cleared cell, as the pathfinder's own goto would
  // land it: this fixture's pathfinder (saved-ground.js) only surveys
  // routes, so the actual walk in is a plain move to the goal's block.
  bot.pathfinder.goto = async goal => { bot.entity.position = new Vec3(goal.x + 0.5, goal.y, goal.z + 0.5); bot.entity.onGround = true; };
  return bot;
}
const NEAR = new Vec3(25, 60, 1); // 24.5 blocks off: past the old STAIR_ACROSS (16), inside the new one (32)
const FAR = new Vec3(50, 60, 1); // 49.5 blocks off: past the new STAIR_ACROSS too

test('a stair to a portal 22 to 25 blocks off, no pickaxe, is dug by hand, not fetched wood first (note 716)', async () => {
  const work = require('../src/work');
  const bot = stairBot(), goal = {}, task = new Task('work');
  const before = bot.entity.position.clone();
  const t = require('../src/tunneling');
  assert.equal(Math.hypot(NEAR.x - before.x, NEAR.z - before.z) <= t.STAIR_ACROSS, true);
  await work.tunnelToward(bot, task, goal, () => {}, NEAR, 'portal_nether');
  // The pickaxe-fetch branch was never taken: nothing was ever wanted for.
  assert.equal(bot._wantedFor, undefined);
  // Real ground was dug toward the target, not a trip to gather wood.
  assert.equal(goal.tunnel.steps >= 1, true);
});

test('a stair well past the widened STAIR_ACROSS still asks for a pickaxe first (note 629 kept)', async () => {
  const work = require('../src/work');
  const bot = stairBot(), goal = {}, task = new Task('work');
  const t = require('../src/tunneling');
  assert.equal(Math.hypot(FAR.x - bot.entity.position.x, FAR.z - bot.entity.position.z) > t.STAIR_ACROSS, true);
  // tunnelToward runs synchronously up to its first await (acquireStep,
  // work.js's own and not injectable): by then, if the pickaxe-fetch branch
  // was taken, bot._wantedFor is already set to what it is wanted for. The
  // task is cancelled right after reading it, so the real gather (this
  // world has no known wood) does not have to run to completion here.
  const p = work.tunnelToward(bot, task, goal, () => {}, FAR, 'portal_nether');
  assert.equal(bot._wantedFor?.item, 'stone_pickaxe');
  assert.equal(bot._wantedFor?.what, 'the stair to the portal');
  task.cancel();
  await assert.rejects(p);
});
