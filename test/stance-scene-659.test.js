'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('node:events');
const { Task } = require('../src/skills');
const { Survival } = require('../src/survival');
const scenes = require('../src/stance-scene');

// 25590 (mid-242-cd, note 659): on a ledge at y 35 over the lava, no blocks,
// hunger 17 and nothing to eat, a magma cube hopping two to five blocks below
// out of the sword's reach and a crossbow piglin eight off. encounter_stance
// was asked 189 times from 03:57:00 to 04:12:40Z (the fixture, as recorded),
// 114 of them answered "none of these is good".
const fixture = require('./fixtures/ledge-magma-25590.json');

test('the fixture is the recorded loop: 189 askings in fifteen and a half minutes, 114 none good, the same few answers each ending at once or at their fifteen seconds', () => {
  const { asks } = fixture;
  assert.equal(asks.length, 189);
  assert.equal(asks.filter(a => a.noneGood).length, 114);
  const span = (Date.parse(asks.at(-1).at) - Date.parse(asks[0].at)) / 60000;
  assert(span > 15 && span < 16, String(span));
  assert.deepEqual([...new Set(asks.map(a => a.health))].sort(), [3, 7]);
  assert(asks.every(a => a.buildingBlocks === 0 && a.shield === true && a.food === 17));
  const answers = {};
  for (const a of asks) answers[a.answer] = (answers[a.answer] || 0) + 1;
  assert.deepEqual(answers, { fight: 55, shield_guard: 47, fight_from_footing: 26, hold_on_span: 32, out_of_sight: 1, retreat: 14, keep_working: 14 });
});

// The ledge as the stance step sees it: the bot on its block, the cube and the
// piglin where the recorded asking had them, each asking's facts in turn.
function ledgeBot() {
  const cube = { id: 7, name: 'magma_cube', type: 'hostile', position: new Vec3(2.5, 32.5, 0.5), height: 1, width: 1, isValid: true };
  const piglin = { id: 8, name: 'piglin', type: 'hostile', position: new Vec3(8.6, 35, 0.5), height: 1.95, width: 0.6, isValid: true, heldItem: { name: 'crossbow' } };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health: 7, food: 17, oxygenLevel: 20,
    entities: { 7: cube, 8: piglin }, time: { timeOfDay: 6000 }, registry: require('minecraft-data')('26.1'),
    entity: { position: new Vec3(0.5, 35, 0.5), onGround: true, width: 0.6, height: 1.8, velocity: new Vec3(0, 0, 0) },
    inventory: { items: () => [{ name: 'iron_sword', count: 1 }, { name: 'wheat', count: 1 }], slots: { 45: { name: 'shield' } }, emptySlotCount: () => 20 },
    blockAt: p => { const f = p.floored(); const s = f.y < 35 && Math.abs(f.x) <= 1 && Math.abs(f.z) <= 1; return { position: f, name: s ? 'netherrack' : f.y < 32 ? 'lava' : 'air', boundingBox: s ? 'block' : 'empty', diggable: s, shapes: s ? [[0, 0, 0, 1, 1, 1]] : [] }; },
    world: { raycast: () => null }, findBlocks: () => [], lookAt: async () => {}, look: async () => {}, equip: async () => {}, attack() {} });
  return { bot, cube, piglin };
}
// The facts of one recorded asking put on the bot: its health, the cube's
// distance (straight down and out, below the ledge) and whether the piglin was
// about.
function setScene({ bot, cube, piglin }, ask) {
  bot.health = ask.health;
  const c = ask.threats.find(t => t.name === 'magma_cube');
  cube.position = c ? new Vec3(0.5 + Math.sqrt(Math.max(0, c.distance ** 2 - 6.25)), 32.5, 0.5) : new Vec3(40, 32, 0.5);
  cube.isValid = !!c;
  const p = ask.threats.find(t => t.name === 'piglin');
  piglin.isValid = !!p;
  const danger = [];
  if (c) danger.push({ entity: cube, distance: c.distance, visible: c.visible });
  if (p) danger.push({ entity: piglin, distance: p.distance, visible: p.visible });
  return danger;
}
// Every stance the recorded askings offered, run as they ran: the guard, the
// fights and the run end at once with nothing struck; the hold holds its time
// (fifteen seconds); the work is left to.
function recordedOptions(survival, bot) {
  const StanceFailed = why => Object.assign(new Error(why), { name: 'StanceFailed' });
  const opt = (description, run, expects = { damage: 0.3, seconds: 15 }) => ({ description, expects, run });
  return {
    fight_from_footing: opt('Step onto firm ground away from the drop, then fight there.', async () => { throw StanceFailed('no route to footing three blocks from any drop'); }),
    hold_on_span: opt('Hold on the span, the shield toward the shots.', async () => true),
    fight: opt('Fight where the bot stands.', async () => { throw StanceFailed('nothing was struck: the magma cube is below the feet and out of the sword\'s reach from where the bot stands'); }),
    shield_guard: opt('Face the magma cube with the shield raised and let it come.', async () => { survival.state.stanceWhy = 'the guard ran 0 swings, no health lost'; return true; }),
    keep_working: opt('Carry on with the work and leave the mobs be for fifteen seconds.', async () => true),
    retreat: opt('Run for footing out of reach and sight.', async () => { throw StanceFailed('none of the 12 spots further from every mob has a route that passes none of them'); }),
  };
}
// What Jev answered there, in the order the record shows it preferring them
// when offered (the guard at 0.3 to 0.88, then the fight, the hold, the step
// off, the run, the work).
const PREFER = ['shield_guard', 'fight', 'hold_on_span', 'fight_from_footing', 'retreat', 'keep_working'];

async function replay({ preferNoneGood = false } = {}) {
  const world = ledgeBot();
  const { bot } = world;
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] }, client: { systemOne: async () => ({}) } });
  const asked = [];
  survival.scoutRetreat = async () => {};
  survival.stanceOptions = () => recordedOptions(survival, bot);
  survival.decide = async (task, g, save, q) => {
    const offered = Object.keys(q.tree);
    asked.push({ at: Date.now(), offered, state: q.state, situation: q.situation });
    return { path: [PREFER.find(k => offered.includes(k)) || offered[0]], ...(preferNoneGood ? { noneGood: true } : {}) };
  };
  const real = Date.now;
  const t0 = Date.parse(fixture.asks[0].at), end = Date.parse(fixture.asks.at(-1).at);
  let i = 0;
  try {
    // The step comes round every half second, as it did (the recorded median gap).
    for (let t = t0; t <= end; t += 500) {
      while (i + 1 < fixture.asks.length && Date.parse(fixture.asks[i + 1].at) <= t) i++;
      Date.now = () => t;
      const danger = setScene(world, fixture.asks[i]);
      await survival.stanceStep(new Task('x'), {}, () => {}, danger, false);
    }
  } finally { Date.now = real; }
  return { asked, survival, bot };
}

test('replayed through the stance step, an answer holds while the scene is unchanged: the ledge is asked a handful of times, not 189, and ends held on the span without asking (note 659)', async () => {
  const { asked, survival } = await replay();
  // 28 askings, against 189: each scene's first three (the guard and the
  // fight coming to nothing, then the hold; the scenes are the health's two
  // hearts or four, the cube in sight or not, the piglin nearer or farther
  // than eight or gone), and the hold's five-minute caps.
  assert(asked.length <= 30, `asked ${asked.length} times`);
  const book = survival.state.stanceScene;
  const last = book.answers.at(-1);
  assert.equal(last.choice, 'hold_on_span');
  assert.equal(last.asked, false, 'held without asking');
  // Each answer that came to nothing on the ledge was asked once in a scene,
  // then left out while it stood.
  const lastAsk = asked.at(-1);
  assert.deepEqual(lastAsk.offered.filter(k => ['shield_guard', 'fight'].includes(k)), [], lastAsk.offered.join(','));
  const out = lastAsk.state.notOfferedNow.map(f => f.choice).sort();
  assert(out.includes('shield_guard') && out.includes('fight'), out.join(','));
  assert.match(lastAsk.state.notOfferedNow.find(f => f.choice === 'shield_guard').why, /^came to nothing once in this same scene, the last \d+ seconds ago: the guard ran 0 swings, no health lost; nothing a stance turns on has changed since \(sameSceneSoFar\), so it would come to the same; offered again when the scene changes$/);
  // The question says the scene unchanged, its facts, and what each answer came to.
  assert.match(lastAsk.state.sameSceneSoFar, /^Nothing a stance turns on has changed here for \d+ minutes: health 3 \(2 hearts\), hunger 17, the magma cube within 8 blocks and out of the sword's reach, in sight, the piglin 8 to 16 blocks off, in sight, 0 blocks carried, the shield in the off hand, no blaze rod, no hit taken and the bot on the same block\./);
  assert.match(lastAsk.state.sameSceneSoFar, /In that time the stance was answered \d+ times \(\d askings\): .*hold on span \d+ times \(\d+ of them held without asking\), held; shield guard 1 time, it came to nothing \(the last: the guard ran 0 swings, no health lost\)/);
  assert.match(lastAsk.state.sameSceneSoFar, /An answer that holds is kept without asking while none of this changes/);
  // The none-good count is keyed on the scene, not the whole state.
  assert.equal(lastAsk.situation, `stance:${book.key}`);
});

test('the scene: whole hearts, each mob by what it can do to the bot and whether it has the bot in sight; the facts that change it said', () => {
  const world = ledgeBot();
  const one = setScene(world, { health: 3, threats: [{ name: 'magma_cube', distance: 2.6, visible: true }, { name: 'piglin', distance: 8.1, visible: true }] });
  const a = scenes.sceneOf(world.bot, one);
  // The cube hops a block nearer, still below and out of reach, and the
  // health is still two hearts: nothing a stance turns on.
  const two = setScene(world, { health: 3.4, threats: [{ name: 'magma_cube', distance: 3.4, visible: true }, { name: 'piglin', distance: 8.1, visible: true }] });
  const b = scenes.sceneOf(world.bot, two);
  assert.equal(a.key, b.key);
  // Out of sight, it is: a mob that loses sight of the bot gives it up.
  const hid = setScene(world, { health: 3, threats: [{ name: 'magma_cube', distance: 2.6, visible: false }, { name: 'piglin', distance: 8.1, visible: true }] });
  assert.notEqual(scenes.sceneOf(world.bot, hid).key, a.key);
  // The piglin out of sight, a heart gone, the cube in reach: each changes it.
  const three = setScene(world, { health: 1, threats: [{ name: 'magma_cube', distance: 2, visible: true }, { name: 'piglin', distance: 8.1, visible: false }] });
  const c = scenes.sceneOf(world.bot, three, { strikes: e => e.name === 'magma_cube' });
  assert.notEqual(a.key, c.key);
  assert.deepEqual(scenes.changed(a.facts, c.facts), ['health from 3 to 1', 'the mobs, from the magma cube within 8 blocks and out of the sword\'s reach, in sight, the piglin 8 to 16 blocks off, in sight to the magma cube within the sword\'s reach, in sight, the piglin 8 to 16 blocks off, out of sight']);
});

test('a none-good answer to the stance counts by its scene at any weight: twice in one scene and the question is spent there and sent to survival_priority, said (note 659)', async () => {
  const env = process.env.JEV_NONE_GOOD;
  process.env.JEV_NONE_GOOD = '1';
  try {
    const { decide } = require('../src/decisions');
    // As the ledge answered it: none good on top at 0.33, under the old rule's 0.4.
    const client = { model: 'jev', systemOne: async () => ({ answers: { branch_0: { choice: 'none_good', confidence: 0.15, probabilities: { none_good: 0.33, fight_from_footing: 0.31, hold_on_span: 0.26, retreat: 0.1 } } } }) };
    const bot = { entity: { position: new Vec3(-79.5, 35, 86.5) }, game: { dimension: 'the_nether' }, health: 3, food: 17, inventory: { items: () => [] } };
    const goal = { request: 'beat the game' };
    const tree = { fight_from_footing: { description: 'a' }, hold_on_span: { description: 'b' }, retreat: { description: 'c' } };
    const ask = n => decide('encounter_stance', { client, bot, goal, tree, state: { health: 3, threats: [{ name: 'magma_cube', distance: 2 + n / 10 }] }, situation: 'stance:ledge' });
    const r1 = await ask(1);
    assert.deepEqual(r1.path, ['fight_from_footing']);
    assert.equal(r1.spent, undefined);
    // The cube a tenth of a block further: the whole state differs, the scene does not.
    const r2 = await ask(2);
    assert.equal(r2.spent, true, 'spent at the second none good in the scene');
    const up = goal.tried.escalations.find(e => e.from === 'encounter_stance');
    assert.equal(up.to, 'survival_priority');
    assert.match(up.why, /none of its options was good, 2 times running with the same facts from here \(none good at 0\.33 and 0\.33\); the best listed, fight from footing, was taken meanwhile/);
    // Not asked again in that scene meanwhile: the best listed, said as spent.
    let calls = 0;
    const counting = { ...client, systemOne: async (...a) => { calls++; return client.systemOne(...a); } };
    const r3 = await decide('encounter_stance', { client: counting, bot, goal, tree, state: { health: 3 }, situation: 'stance:ledge' });
    assert.equal(calls, 0); assert.equal(r3.spent, true); assert.deepEqual(r3.path, ['fight_from_footing']);
    // Another scene is asked.
    await decide('encounter_stance', { client: counting, bot, goal, tree, state: { health: 3 }, situation: 'stance:elsewhere' });
    assert.equal(calls, 1);
  } finally { if (env === undefined) delete process.env.JEV_NONE_GOOD; else process.env.JEV_NONE_GOOD = env; }
});

test('after a rod picked up in the Nether the stance and the hunt are told what followed the trials\' rods, by what the bot did first, with the counts (note 659)', () => {
  const afterRod = require('../src/after-rod');
  let rods = 0;
  const bot = { game: { dimension: 'the_nether' }, health: 12, inventory: { items: () => rods ? [{ name: 'blaze_rod', count: rods }] : [] } };
  assert.equal(afterRod.says(bot, 1000), null, 'no rod yet');
  rods = 1;
  assert.equal(afterRod.noteRods(bot, 5000).lastGainAt, 5000);
  const says = afterRod.says(bot, 35000);
  assert.match(says, /^The last blaze rod was picked up 30 seconds ago, 1 carried now\./);
  assert.match(says, /stayed at the blazes \(its first answer a strike, a fight, cover or the work\) \(53\): 22 died before another rod or leaving the Nether \(42%; 15 within three minutes of the rod, median 86 seconds after it\), 17 took another rod first \(32%\)/);
  assert.match(says, /went away to heal or ran \(leave_and_heal, eat, retreat, leave_reach\) \(20\): 5 died before another rod or leaving the Nether \(25%; 2 within three minutes of the rod, median 224 seconds after it\), 8 took another rod first \(40%\)/);
  assert.match(says, /By the health at the rod, 8 to 16 as now \(12\): those rods \(52\)/);
  assert.match(says, /These are what followed, not what the answer caused/);
  // The rods gone (a death): nothing said until the next.
  rods = 0; afterRod.noteRods(bot, 40000);
  assert.equal(afterRod.says(bot, 41000), null);
  // Out of the Nether: not said.
  rods = 2; afterRod.noteRods(bot, 50000); bot.game.dimension = 'overworld';
  assert.equal(afterRod.says(bot, 51000), null);
});

test('at a blaze fight the place so far is said: how long, the rods and health gained and lost, each stance with what came while it stood', () => {
  const state = {};
  let rods = 0;
  const bot = { game: { dimension: 'the_nether' }, health: 20, entity: { position: new Vec3(-150, 81, 166) }, inventory: { items: () => rods ? [{ name: 'blaze_rod', count: rods }] : [] } };
  assert.equal(scenes.exposure(state, bot, { blazes: false, now: 0 }), null, 'no blaze fight, no place');
  scenes.exposure(state, bot, { blazes: true, now: 0 });
  scenes.exposureAnswered(state, 'take_cover');
  bot.health = 14;
  scenes.exposure(state, bot, { blazes: true, now: 20000 });
  scenes.exposureAnswered(state, 'charge_nearest');
  rods = 1; bot.health = 11;
  const x = scenes.exposure(state, bot, { blazes: true, now: 60000 });
  assert.equal(scenes.exposureSays(x, 80000), 'At this place (the blaze fight first met at -150, 81, 166, within 24 blocks of it) for 80 seconds in this life: 1 blaze rod gained here (1 rod carried now), 9 health lost here in all. The stances taken here: take cover 1 time, no rod, 6 health lost while it stood; charge nearest 1 time, 1 rod while it stood, 3 health lost while it stood.');
  // Another life (the rods gone) begins another record.
  rods = 0; bot.health = 20;
  const y = scenes.exposure(state, bot, { blazes: true, now: 100000 });
  assert.equal(y.gained, 0); assert.deepEqual(y.answers, {});
});
