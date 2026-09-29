'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { groundBot } = require('./fixtures/saved-ground');

// mid-242-ch-fortress-10 (25591, 2026-09-29 17:20-19:03Z, note 678): at 1.6
// health, no food, no pickaxe and no blocks, the bot stood on netherrack at
// y 81 with its portal at (-20, 71, 19), 10 blocks straight below. It was
// told the portal was "10 blocks off, about 2 seconds at a walk", chose to go
// back (leave_nether go_back) again and again, and the way back, wanting a
// stone pickaxe for the stair to the portal, asked nether_gather for wood,
// whose portal_trip was that same trip back. Netherrack digs by hand in two
// seconds a block. Here: solid netherrack to y 80, air above, the portal's
// frame in a pocket at y 70 to 74.
function world() {
  const box = { x: [-28, -12], y: [60, 90], z: [11, 27] };
  const palette = ['air', 'netherrack', 'obsidian', 'nether_portal'];
  const at = (x, y, z) => {
    if (y > 80) return 0;
    if (z === 19 && (x === -20 || x === -19) && y >= 71 && y <= 73) return 3;
    if (z === 19 && x >= -21 && x <= -18 && y >= 70 && y <= 74) return 2;
    if ((z === 18 || z === 20) && x >= -21 && x <= -18 && y >= 71 && y <= 73) return 0;
    return 1;
  };
  const rows = [];
  for (let y = box.y[0]; y <= box.y[1]; y++) for (let z = box.z[0]; z <= box.z[1]; z++) {
    let row = '';
    for (let x = box.x[0]; x <= box.x[1]; x++) row += String.fromCharCode(97 + at(x, y, z));
    rows.push(row);
  }
  return { box, palette, rows };
}
const PORTAL = { x: -20, y: 71, z: 19 };
const above = () => groundBot(world(), { at: new Vec3(-21.5, 81, 20.5), health: 1.6, food: 10, dimension: 'the_nether', items: [['iron_sword', 1], ['coal', 12]] });
const goalOf = () => ({ kind: 'win', request: 'beat the game', portals: [{ ...PORTAL, dimension: 'nether' }], gameProgress: { phase: 'obtain_blaze_rods' }, rungTime: { phase: 'obtain_blaze_rods' } });
function jevStub(picks) {
  const asked = [];
  return { asked, systemOne: async ({ state, questions }) => { asked.push({ state, options: questions.branch_0.criteria }); return { answers: { branch_0: { choice: picks.shift(), confidence: 0.9 } } }; } };
}

test('a stair down through netherrack gains ground with no pickaxe, dug by hand at 2 seconds a block (note 678)', () => {
  const t = require('../src/tunneling');
  const bot = above(), portal = new Vec3(PORTAL.x, PORTAL.y, PORTAL.z);
  const netherrack = bot.blockAt(new Vec3(-21, 80, 20));
  assert.equal(t.digSeconds(bot, netherrack), 2);
  const stair = t.stairFromHere(bot, {}, portal);
  assert.equal(stair.gains, true);
  assert.equal(stair.steps, 10);
  assert.deepEqual(stair.byHand, ['netherrack']);
  assert(stair.seconds >= 20 && stair.seconds <= 70, `${stair.seconds}`);
  assert.match(t.stairSays(bot, stair, portal), /^A stair dug down to it: about 10 steps, about \d+ seconds, netherrack dug by hand \(no drops\)\.$/);
});

test('the trip back says the portal\'s height, not a flat two seconds, and the stair down to it (note 678)', () => {
  const { portalTrip } = require('../src/game-progress');
  const says = portalTrip(above(), goalOf());
  assert.match(says, /^The nearest portal remembered is 2 blocks off, about 0 seconds at a walk, and back through one after\. It lies 10 blocks below as well: the seconds are the walk across, and a way down is its own\. A stair dug down to it: about 10 steps/);
});

test('nether_gather offers the portal below by the stair, and not as a crossing that ends 10 blocks above it (note 678)', async () => {
  const { netherGather } = require('../src/nether-gather');
  const bot = above(), goal = goalOf(), went = [];
  const client = jevStub(['portal_trip']), task = new Task('work');
  const navigate = async () => { throw Object.assign(new Error('No route'), { name: 'NoRoute' }); };
  await netherGather(bot, task, goal, () => {}, 'warped_stem', { navigate, mineAt: async () => {}, client, forItem: 'stone_pickaxe', returnOverworld: async () => { went.push('back'); } });
  const { options } = client.asked[0];
  assert.match(options.portal_trip, /^Go back through the portal to the Overworld for wood, by a stair dug down to it\. The nether portal at \(-20, 71, 19\), 2 blocks across and 10 below\./);
  assert.match(options.portal_trip, /A stair dug down to it: about 10 steps/);
  // The stair is the way back's own: straight to it.
  assert.deepEqual(went, ['back']);
});

test('the wood wanted for the stair to the portal is not offered a trip back through that portal (note 678)', async () => {
  const { netherGather } = require('../src/nether-gather');
  const bot = above(), goal = goalOf();
  bot._wantedFor = { item: 'stone_pickaxe', what: 'the stair to the portal', target: { ...PORTAL } };
  const client = jevStub(['without']), task = new Task('work');
  await netherGather(bot, task, goal, () => {}, 'warped_stem', { navigate: async () => {}, mineAt: async () => {}, client, forItem: 'stone_pickaxe', returnOverworld: async () => { throw new Error('not this'); } });
  const { options, state } = client.asked[0];
  assert.equal(options.portal_trip, undefined);
  assert.match(state.portal, /^The stone pickaxe this wood is for is for the stair to the portal at \(-20, 71, 19\): going back through it for wood is the trip that wants it, so it is not offered\.$/);
  // Going without says the trip back ends, and what it set aside stands
  // from here for the next question (asideStands): search_on is not offered
  // back a second later (25584, note 678).
  assert.match(options.without, /^Go on without the stone pickaxe this warped stem is for, wanted for the stair to the portal, which ends here: leave the obtain blaze rods/);
  assert.equal(goal.rungAside.phase, 'obtain_blaze_rods');
  assert.match(require('../src/game-progress').asideStands(bot, goal, 'obtain_blaze_rods') || '', /Jev chose to go on without the stone pickaxe/);
});
