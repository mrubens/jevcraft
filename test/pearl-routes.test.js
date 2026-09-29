'use strict';
// Every way to the pearls from where the bot stands, and a rung set aside
// offered back when the rung that replaced it stalls (note 588).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const registry = require('minecraft-data')('26.1');
const { setAside, isSetAside } = require('../src/progress');
const { nextGameStage, observeProgress } = require('../src/game-progress');

// 25600, mid-242-ae-nether-2-fortress-2, at 05:23:03: the rods set aside at 05:16:43 for thirty minutes, the pearls
// in hand, both warped forests known set aside (their walks came no nearer), the sweep for a third turning on a
// ledge of its own stairs at (-37, 35, 81), no gold, no blocks but five planks, the fortress 66 blocks off, the
// portal back at (17, 58, 8). The stall's question offered differently, cross_toward and mine_nearby, and Jev
// answered none_good at 0.45 to 0.75.
const T0 = Date.parse('2026-09-28T05:23:03Z');
const ITEMS = { oak_log: 5, oak_planks: 5, furnace: 1, mutton: 8, white_bed: 1, stone_sword: 1, iron_pickaxe: 1, stick: 1, stone_pickaxe: 2, coal: 2, crafting_table: 1 };
function recorded(dimension = 'the_nether') {
  const items = Object.entries(ITEMS).map(([name, count]) => ({ name, count }));
  const bot = { registry, game: { dimension, gameMode: 'survival', difficulty: 'normal' }, health: 20, food: 17, isAlive: true, chat() {}, emit() {},
    entity: { id: 1, position: new Vec3(-36.5, 35, 81.5) }, time: { timeOfDay: 6000 },
    entities: { 7: { id: 7, name: 'piglin', position: new Vec3(-30, 35, 136), isValid: true } },
    inventory: { items: () => items, slots: [] }, findBlocks: () => [], clearControlStates() {},
    blockAt: p => ({ position: p, name: p.y < 35 ? 'netherrack' : 'air', boundingBox: p.y < 35 ? 'block' : 'empty' }),
    // On the ledge every walk found no route: the pathfinder's survey says so.
    pathfinder: { movements: { blocksCantBreak: new Set() }, setGoal() {}, getPathTo: () => ({ status: 'noPath', path: [] }) } };
  const goal = { kind: 'win', request: 'beat the game', from: 'TestPlayer', survival: {}, rungTime: { phase: 'obtain_ender_pearls' },
    rungClocks: { obtain_blaze_rods: { activeMs: 146756, lastAt: T0 - 6 * 60000 } },
    landmarks: [
      { kind: 'warped_forest', x: -77, y: 58, z: -4, dimension: 'nether', lastWalk: { at: T0 - 6 * 60000, from: { x: -42, y: 35, z: 81 }, began: 95, ended: 95, why: 'No path to the goal!' } },
      { kind: 'warped_forest', x: -61, y: 62, z: -147, dimension: 'nether' },
      { kind: 'nether_fortress', x: -70, y: 45, z: 140, dimension: 'nether' }],
    portals: [{ x: 17, y: 72, z: 58, dimension: 'overworld' }, { x: 17, y: 58, z: 8, dimension: 'nether' }],
    fortressSearch: { shunned: [{ x: -70, z: 140, until: T0 + 60000 }] } };
  observeProgress(bot, goal);
  return { bot, goal };
}
function setAsides(goal, now) {
  setAside(goal, 'rung', 'obtain_blaze_rods', 'Jev set it aside at the rung\'s question, worked on in 0.5 minutes on it', 1800000);
  goal.survival.attempts['rung:obtain_blaze_rods'].at = now - 6 * 60000; goal.survival.attempts['rung:obtain_blaze_rods'].until = now + 24 * 60000;
  for (const [x, z] of [[-77, -4], [-61, -147]]) setAside(goal, 'landmark_trip', `warped_forest:${x},${z}`, 'the walk there came no nearer than before (95 blocks off to 95): No path to the goal!', 1800000);
}
async function askStall(t, bot, goal, pick = null) {
  const { answerStall } = require('../src/work');
  const asked = [];
  const client = { model: 'jev', systemOne: async ({ state, questions }) => {
    const answers = {};
    for (const [b, q] of Object.entries(questions)) {
      const keys = Object.keys(q.criteria || {});
      asked.push({ state, options: q.criteria });
      answers[b] = { choice: pick && keys.includes(pick) ? pick : keys.includes('differently') ? 'differently' : keys[0], confidence: 0.6 };
    }
    return { answers };
  } };
  await answerStall(bot, new Task('stall'), goal, () => {}, { key: 'step:rung:obtain_ender_pearls', work: 'step:rung:obtain_ender_pearls', layer: 'work', strikes: 1 }, { client }).catch(() => {});
  return asked;
}

test('the pearls stalling in the Nether with the rods set aside: the rods are offered back with their fortress, and every route to the pearls from here is an option or said as not one (mid-242-ae-nether-2-fortress-2, note 588)', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const { bot, goal } = recorded();
  setAsides(goal, T0);
  assert.equal(nextGameStage(bot, goal).phase, 'obtain_ender_pearls', 'the ladder is on the pearls');
  const asked = await askStall(t, bot, goal);
  assert.equal(asked.length, 1, 'the stall\'s question was asked');
  const { options, state } = asked[0];
  assert.match(options.take_up_obtain_blaze_rods || '', /^Take up the obtain blaze rods again now, its rest cut short: set aside 6 minutes ago \(Jev set it aside at the rung's question, worked on in 0\.5 minutes on it\); it would come back on its own in 24 minutes\. The obtain ender pearls in hand waits meanwhile\. Worked on it 2 minutes in all so far\. The nearest nether fortress known is 68 blocks off and 10 up at \(-70, 140\); the search left it for 1 more minutes\. A route survey from here found no way there\./);
  assert.match(options.pearls_forest_1 || '', /^Go for the warped forest at \(-77, -4\) again, 97 blocks off and 23 up: .*Its walk rests 30 minutes more \(the walk there came no nearer than before \(95 blocks off to 95\): No path to the goal!\); chosen, the rest is lifted .*5 blocks carried to bridge or pillar with\. The last walk there, from \(-42, 35, 81\), began 95 blocks off and ended 95: No path to the goal!/);
  assert.match(options.pearls_forest_2 || '', /^Go for the warped forest at \(-61, -147\) again.* A route survey from here found no way there\.$/);
  assert.match(options.pearls_overworld || '', /A route survey from here found no way there\.$/, 'the walk to the portal is surveyed too');
  assert.match(options.pearls_overworld || '', /^Go back to the Overworld for the pearls: endermen spawn in the dark there.* The nearest portal remembered is 91 blocks off, .* about 3 to 5 minutes, not seconds\..* It comes out in the Overworld at dusk, about 1 minutes before dark\..* 0 blaze rods carried/);
  assert.equal(options.pearls_barter, undefined, 'no gold: no barter');
  assert.match(state.stalled.pearlRoutesNotOffered.join(' '), /^a barter with piglins: no gold carried \(about nine ingots a pearl, measured\) and no bastion known to take gold from; 1 piglin about, the nearest 55 blocks off/);
  assert.equal(options.pearls_search, undefined, 'the sweep is not resting: it is the work in hand');
  assert.equal(options.work_free, undefined, 'no walk has failed yet');
  // The walk off that found no route, said at every asking on 25600, is a walk failing: working free is offered.
  goal.survival.wayOffShort = { at: T0 - 50000, from: { x: -37, y: 35, z: 81 }, aimed: 8, moved: 0, error: 'No path to the goal!' };
  const stuck = await askStall(t, bot, goal);
  assert.match(stuck[0].options.work_free || '', /^Work free of the terrain one move at a time.*off this spot/);
  // The sweep spent from the ledge (warped-pearls.js) and resting: offered to take up again.
  setAside(goal, 'rung', 'warped_search', 'The sweep for a warped forest got nowhere from (-41, 35, 82): every heading came to nothing', 1800000);
  delete goal.survival.wayOffShort;
  const again = await askStall(t, bot, goal);
  assert.match(again[0].options.pearls_search || '', /^Sweep the Nether for another warped forest.* The sweep rests 30 minutes more \(The sweep for a warped forest got nowhere from \(-41, 35, 82\)/);
});

test('taking the rods back lifts their rest and the ladder is on the rods again; a forest taken up again is walked to (note 588)', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const { bot, goal } = recorded();
  setAsides(goal, T0);
  await askStall(t, bot, goal, 'take_up_obtain_blaze_rods');
  assert.equal(isSetAside(goal, 'rung', 'obtain_blaze_rods'), false, 'the rods\' rest is lifted');
  assert.equal(nextGameStage(bot, goal).phase, 'obtain_blaze_rods');
  const other = recorded();
  setAsides(other.goal, T0);
  await askStall(t, other.bot, other.goal, 'pearls_forest_1');
  assert.equal(isSetAside(other.goal, 'landmark_trip', 'warped_forest:-77,-4'), false, 'the forest\'s walk is open again');
  assert.equal(require('../src/warped-pearls').warpedKnown(other.goal).length, 1);
});

test('the Overworld\'s endermen chosen for the pearls: back through the portal from the Nether, and in the Overworld the pearls before the Nether again, the rods still short (note 588)', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const { bot, goal } = recorded();
  setAsides(goal, T0);
  await askStall(t, bot, goal, 'pearls_overworld');
  assert.equal(goal.pearlRoute?.pick, 'overworld');
  const back = nextGameStage(bot, goal);
  assert.equal(back.action, 'return_overworld'); assert.equal(back.phase, 'obtain_ender_pearls');
  bot.game.dimension = 'overworld'; bot.entity.position = new Vec3(17.5, 72, 58.5);
  // The kit left for the Nether first, as recorded.
  for (const r of ['shield', 'iron_sword', 'bucket', 'iron_armour', 'golden_boots', 'bow', 'diamond_sword']) setAside(goal, 'rung', r, 'Jev chose the Nether first', 1800000);
  const there = nextGameStage(bot, goal);
  assert.equal(there.phase, 'obtain_ender_pearls', `the pearls, not the Nether again for the rods: ${JSON.stringify(there)}`);
  assert.equal(there.action, 'pearl_patrol');
  // Offered the Nether's forests back from there, and without the route the rods take the bot back in.
  const asked = await askStall(t, bot, goal, 'pearls_nether');
  assert.match(asked[0].options.pearls_nether || '', /^Drop the Overworld's hunt chosen/);
  assert.equal(goal.pearlRoute, undefined);
  // The crossing's kit first, last before the portal (note 673); gone without, the portal.
  assert.match(nextGameStage(bot, goal).phase, /^nether_(pickaxe|blocks|food)$/);
  for (const r of require('../src/crossing-kit').KIT_PHASES) setAside(goal, 'rung', r, 'Jev chose the Nether first', 1800000);
  assert.equal(nextGameStage(bot, goal).action, 'enter_nether');
});
