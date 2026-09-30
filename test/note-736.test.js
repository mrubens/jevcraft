'use strict';
// Trial note 736 (critic 08:17Z): three fixes.
//
// (a) 25581 (mid-243-if): set_aside_rung chose itself back within seconds,
// twice, because every other rung was already resting: "Leave the reach
// nether for thirty minutes and go on with the next thing" promised
// something the code could not deliver. Fixed by not offering set_aside_rung
// when the ladder, left with this rung aside, would compute the very same
// rung next (src/work.js nextRungSays, setAsideNotOffered). Also, gatherWood
// (upkeep's wood_reserve) called acquireStep once and returned, one log at a
// time, so upkeep was re-asked after every single block gathered instead of
// after the reserve was met or a round gained nothing (the same shape
// gatherBlocks had before note 423): fixed with the same round loop.
//
// (b) 25589 (mid-242-wb): turn_priority read "Shelter for the night... asked
// next" nine times in under three minutes while the bot sat inside its own
// pocket, sealed once already, working (smelting). survival.js's claim()
// only read pocket_next when the shell was fully sealed or its only open
// cells held a fluid (closedIn); a wall opened for other reasons (its own
// mining or working free) after being sealed once fell through to a fresh
// "secure a shelter" claim as if none existed. Fixed by treating a shelter
// verified sealed before, standing in it now, as still the pocket's question.
//
// (c) 25595 (mid-242-vh): two warped-forest walks ended "No route" one after
// the other and the ladder fell straight to the blind sweep (four
// navigation stalls), never trying to dig toward either forest it already
// knew, unlike the sweep beside it which tunnels when it cannot walk.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const registry = require('minecraft-data')('26.1');
const { setAside } = require('../src/progress');
const { observeProgress } = require('../src/game-progress');

// --- (a) set_aside_rung says nothing else can run, and is not offered ---

const T0 = Date.parse('2026-09-30T08:13:00Z');
const HERE = new Vec3(199.5, 16, 135.5);

function nothingElseGoal() {
  // In the Nether, short of rods (none carried), enough pearls already
  // carried that the pearl routes are not short, no bastion or forest
  // known: with the rods left aside on the probe, nextGameStage has nothing
  // left to fall to but "obtain_blaze_rods" again (game-progress.js line
  // 836), which is exactly "nothing else to go on with".
  const items = [{ name: 'ender_pearl', count: 20 }, { name: 'iron_pickaxe', count: 1 }, { name: 'iron_sword', count: 1 }];
  const bot = { registry, game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health: 20, food: 19, isAlive: true, chat() {}, emit() {},
    entity: { id: 1, position: HERE.clone() }, time: { timeOfDay: 6000 }, entities: {},
    inventory: { items: () => items, slots: [] }, findBlocks: () => [], clearControlStates() {},
    blockAt: p => ({ position: p, name: p.y < 16 ? 'netherrack' : 'air', boundingBox: p.y < 16 ? 'block' : 'empty' }),
    pathfinder: { movements: { blocksCantBreak: new Set() }, setGoal() {}, getPathTo: () => ({ status: 'noPath', path: [] }) } };
  const goal = { kind: 'win', request: 'beat the game', from: 'TestPlayer', survival: {}, rungTime: { phase: 'obtain_blaze_rods' },
    rungClocks: { obtain_blaze_rods: { activeMs: 60000, lastAt: T0 } }, portals: [{ x: 17, y: 58, z: 1, dimension: 'nether' }] };
  observeProgress(bot, goal);
  return { bot, goal };
}
async function ask(bot, goal, stall, pick = null) {
  const { answerStall } = require('../src/work');
  const asked = [];
  const client = { model: 'jev', systemOne: async ({ state, questions }) => {
    const answers = {};
    for (const [b, q] of Object.entries(questions)) {
      const keys = Object.keys(q.criteria || {});
      asked.push({ state, options: q.criteria });
      answers[b] = { choice: pick && keys.includes(pick) ? pick : keys.includes('keep_at_it') ? 'keep_at_it' : keys[0], confidence: 0.6 };
    }
    return { answers };
  } };
  await answerStall(bot, new Task('stall'), goal, () => {}, stall, { client }).catch(() => {});
  return asked;
}

test('set_aside_rung is not offered when nothing else could run in its place, and says why (25581, note 736)', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const { bot, goal } = nothingElseGoal();
  const stall = { key: 'step:none', work: 'step:rung:obtain_blaze_rods', layer: 'work', strikes: 1,
    escalated: { from: 'stillness_detour', to: 'rung_progress', says: 'stillness detour: every way it had from here rests' } };
  const asked = await ask(bot, goal, stall, 'set_aside_rung');
  assert.equal(asked.length, 1);
  assert.equal(asked[0].options.set_aside_rung, undefined, 'not offered: it would come straight back');
  assert.match(asked[0].state.stalled.setAsideNotOffered || '', /^setting the obtain blaze rods aside is not offered: every other rung is already resting, so there is nothing else for the ladder to go on with; it would come straight back$/);
});

// --- (a) gatherWood: one round is one log, not the whole reserve ---

test('gatherWood keeps a round tally (goal.woodRounds) the way gatherBlocks does, so a round that gains nothing twice rests it, instead of upkeep being asked again after every single log (the gatherBlocks shape before note 423, note 736)', async () => {
  const { gatherWood } = require('../src/work');
  // No tool, no wood, no tree in view and no findBlocks: acquireStep throws
  // at once (a plain Error, not NeedsAir/NeedsSafety/Cancelled), so this
  // exercises exactly one round, but through the same try/catch/finally
  // shape as gatherBlocks (round loop, gained tracked, a second empty round
  // rests it) rather than a bare single call with no loop at all.
  const bot = { game: { gameMode: 'survival', dimension: 'overworld' }, time: { timeOfDay: 3000 }, entity: { isInWater: false, position: new Vec3(0, 64, 0) },
    registry, inventory: { items: () => [] } };
  const goal = { kind: 'win' };
  await gatherWood(bot, { check() {} }, goal, () => {}).catch(() => {});
  assert.equal(goal.step.action, 'wood_reserve');
  assert.ok(Array.isArray(goal.woodRounds) && goal.woodRounds.length === 1, 'one round tried and tallied, gatherBlocks\' own shape');
  assert.ok(goal.woodRounds[0].gained <= 0, 'nothing gained: acquireStep failed at once with nothing carried');
  // A second empty round in ten minutes rests wood gathering, as
  // gatherBlocks rests a gather that gained nothing twice.
  await gatherWood(bot, { check() {} }, goal, () => {}).catch(() => {});
  const { isSetAside } = require('../src/progress');
  assert.equal(isSetAside(goal, 'block_reserve', 'wood'), true, 'wood sought twice with nothing gained: rests, so upkeep is not asked a third time at once');
});

// --- (b) turn_priority / survival.claim(): already sheltered ---

test('standing in a shelter sealed once before, its wall opened since by the bot\'s own mining, is still the pocket\'s question, not a fresh "shelter for the night" (25589, note 736)', () => {
  const shelter = require('../src/shelter');
  const { claim } = require('../src/survival');
  const origin = new Vec3(-22, 82, 239);
  const bot = { registry, game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal', time: 18000 }, health: 20, food: 20,
    entity: { position: origin.offset(0.5, 0, 0.5) }, entities: {}, time: { timeOfDay: 14000 }, inventory: { items: () => [] },
    blockAt: p => {
      // A sealed dirt box round the origin, except the north wall (feet and
      // head), opened by the bot's own mining after it was once whole.
      const inside = p.x === origin.x && p.z === origin.z && (p.y === origin.y || p.y === origin.y + 1);
      if (inside) return { name: 'air', boundingBox: 'empty' };
      if (p.y === origin.y - 1) return { name: 'dirt', boundingBox: 'block' };
      if (p.x === origin.x && p.z === origin.z - 1 && (p.y === origin.y || p.y === origin.y + 1)) return { name: 'air', boundingBox: 'empty' };
      return { name: 'dirt', boundingBox: 'block' };
    } };
  const refuge = { kind: 'pocket', origin: { x: origin.x, y: origin.y, z: origin.z }, dimension: 'overworld', verifiedAt: new Date(Date.now() - 120000).toISOString() };
  assert.equal(shelter.inside(bot, refuge), true);
  assert.equal(shelter.sealed(bot, refuge), false, 'the north wall is open now');
  assert.equal(shelter.closedIn(bot, refuge), null, 'the open cells are air, not a fluid: closedIn does not cover this');
  const goal = { kind: 'win', survival: {} };
  const survival = { state: goal.survival, currentShelter: () => refuge };
  const c = claim(bot, goal, survival);
  assert.equal(c?.action, 'pocket_next', JSON.stringify(c));
  assert.match(c.facts.pocketNotWhole, /^shut before, but not now: a wall was opened since it was last sealed/);
});

test('a shelter never sealed before (still being built) is not read as the pocket\'s question: a fresh site with an open wall still claims secure_shelter', () => {
  const shelter = require('../src/shelter');
  const { claim } = require('../src/survival');
  const origin = new Vec3(10, 70, 10);
  const bot = { registry, game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, health: 20, food: 20,
    entity: { position: origin.offset(0.5, 0, 0.5) }, entities: {}, time: { timeOfDay: 14000 },
    inventory: { items: () => [{ name: 'dirt', count: 64 }] },
    blockAt: p => {
      const inside = p.x === origin.x && p.z === origin.z && (p.y === origin.y || p.y === origin.y + 1);
      if (inside) return { name: 'air', boundingBox: 'empty' };
      return { name: 'air', boundingBox: 'empty' };
    } };
  const refuge = { kind: 'pocket', origin: { x: origin.x, y: origin.y, z: origin.z }, dimension: 'overworld' };
  assert.equal(shelter.inside(bot, refuge), true);
  assert.equal(shelter.sealed(bot, refuge), false);
  const goal = { kind: 'win', survival: {} };
  const survival = { state: goal.survival, currentShelter: () => refuge };
  const c = claim(bot, goal, survival);
  assert.notEqual(c?.action, 'pocket_next', 'never sealed before: still the shelter to build, not the pocket');
});

// --- (c) a forest walk with no route at all tries the tunnel too ---

test('a known warped forest with no route at all is tried by tunnel too before its trip rests, and the sweep is not the first fallback (25595, note 736)', async () => {
  const warped = require('../src/warped-pearls');
  const bot = { registry, game: { dimension: 'the_nether', gameMode: 'survival' }, health: 20, food: 20, isAlive: true, entities: {}, chat() {},
    entity: { position: new Vec3(17.5, 43, 58.5) }, inventory: { items: () => [] } };
  const goal = { kind: 'win', landmarks: [{ kind: 'warped_forest', x: -80, y: 34, z: 34, dimension: 'nether' }] };
  let tunnels = 0;
  const actions = {
    navigate: async () => { throw new Error('No route from here to (-80, 44, 34) (partial)'); },
    tunnel: async (b) => { tunnels++; b.entity.position = b.entity.position.offset(-20, 0, -8); },
    acquireStep: async () => assert.fail('no hunt short of the forest'), notice: () => {},
  };
  const done = await warped.warpedPearls(bot, new Task('pearls'), goal, () => {}, actions, { count: 12 });
  assert.equal(tunnels, 1, 'tried by tunnel before giving up');
  assert.equal(done, true, 'the tunnel gained ground: not thrown as a failure this pass');
});

test('a known warped forest with no route at all, and the tunnel gaining no ground either, is said as tried and unreachable, not just resting', async () => {
  const warped = require('../src/warped-pearls');
  const bot = { registry, game: { dimension: 'the_nether', gameMode: 'survival' }, health: 20, food: 20, isAlive: true, entities: {}, chat() {},
    entity: { position: new Vec3(17.5, 43, 58.5) }, inventory: { items: () => [] } };
  const goal = { kind: 'win', landmarks: [{ kind: 'warped_forest', x: -80, y: 34, z: 34, dimension: 'nether' }] };
  let tunnels = 0;
  const actions = {
    navigate: async () => { throw new Error('No route from here to (-80, 44, 34) (partial)'); },
    tunnel: async () => { tunnels++; },
    acquireStep: async () => assert.fail('no hunt short of the forest'), notice: () => {},
  };
  await assert.rejects(warped.warpedPearls(bot, new Task('pearls'), goal, () => {}, actions, { count: 12 }),
    /tried and unreachable on foot, a staircase toward it gaining no ground either/);
  assert.equal(tunnels, 1);
});
