'use strict';
// mid-242-ba-fortress-5 (25592), 17:04 to 17:39Z on 2026-09-28: a box by a
// blaze spawner at about (-199, 56, -154), chosen sixteen times in
// thirty-five minutes with no blaze killed, flipping with the work's walk
// toward a portal it could not reach, and the rung's question never asked
// (note 620). The ledger counted the box's own walls as getting somewhere,
// the box's holds were kept nowhere and said nowhere, and the rung's
// question, cut off by a blaze's claim before it went out, was lost.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');

const answering = (asked, pick) => ({ systemOne: async ({ state, questions }) => {
  const criteria = questions.branch_0.criteria;
  asked.push({ state, keys: Object.keys(criteria), criteria });
  const choice = pick(criteria);
  return { answers: { branch_0: { choice, confidence: 0.6, probabilities: { [choice]: 0.6 } } } };
} });
// The bot in its box, 17.9 health, hunger 17, nothing within sixteen that
// changes; `worth` is what it carries that is worth keeping.
const boxBot = (items = []) => ({ entity: { position: new Vec3(-197.6, 56, -153.5) }, game: { dimension: 'the_nether', gameMode: 'survival' },
  inventory: { items: () => items }, health: 17.9, food: 17, entities: {}, _stalls: { records: {}, marks: [], marked: 0 } });
const stanceTree = () => ({ box_here: { description: 'Wall it in where the bot stands and hold it.' }, take_cover: { description: 'Two blocks in the line.' },
  seal: { description: 'Close a pocket.' }, charge_nearest: { description: 'Charge the nearest blaze alone.' } });

test('a box held with nothing changed about it came to nothing, however many of its own walls went in: said on it, and rested (note 620)', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-28T17:37:46Z') });
  const { decide } = require('../src/decisions');
  const bot = boxBot();
  const goal = { kind: 'win', gameProgress: { phase: 'obtain_blaze_rods' }, step: { action: 'cross_toward', target: { x: 2, y: 56, z: 7 } } };
  const asked = [];
  const client = answering(asked, c => c.box_here ? 'box_here' : 'take_cover');
  for (let i = 0; i < 3; i++) {
    await decide('encounter_stance', { client, bot, goal, tree: stanceTree(), state: { health: 17.9 } });
    // The hold: its walls go back in (three blocks laid), twenty seconds,
    // nothing about it changing.
    bot._stalls.marked += 3;
    t.mock.timers.tick(20000);
  }
  const boxes = goal.tried.entries.filter(e => e.q === 'encounter_stance' && e.method === 'box_here');
  assert.equal(boxes[0].outcome, 'blocked', `its own walls are not something come of it (${boxes[0].outcome}: ${boxes[0].gained || boxes[0].why})`);
  assert.equal(boxes[0].wait, true);
  assert.deepEqual(asked[2].keys.sort(), ['charge_nearest', 'seal', 'take_cover'], 'resting after two, left out with three other ways open');
  assert.match(asked[2].state.waysResting[0], /^box here: Held from about here 2 times in the last 40 seconds, 40 seconds in all, and nothing changed in any of them: health 17\.9, nothing within 16 blocks, no swing throughout\. It rests 5 minutes more from here\.$/);
  // Said to the rung's question as it was: not "getting somewhere".
  const said = require('../src/tried').summary(goal, { now: Date.now() });
  assert.match(said.find(s => /box here/.test(s)), /encounter stance: box here, 2 times, 2 coming to nothing/);
});

test('a wait that brought something did get somewhere: a rod picked up; a box of planks or wool, which lowers what is carried, did not (note 620)', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-28T17:38:00Z') });
  const tried = require('../src/tried');
  const items = [{ name: 'oak_planks', count: 8 }];
  const bot = boxBot(items);
  const goal = { kind: 'win', gameProgress: { phase: 'obtain_blaze_rods' } };
  const box = tried.begin(bot, goal, { q: 'encounter_stance', method: 'box_here', waiting: true });
  items[0].count = 3; bot._stalls.marked += 5;
  t.mock.timers.tick(20000);
  tried.settle(bot, goal, { q: 'encounter_stance' });
  assert.equal(box.outcome, 'blocked', 'five planks laid for its walls');
  const rod = tried.begin(bot, goal, { q: 'encounter_stance', method: 'box_here', waiting: true });
  items.push({ name: 'blaze_rod', count: 1 });
  t.mock.timers.tick(20000);
  tried.settle(bot, goal, { q: 'encounter_stance' });
  assert.equal(rod.outcome, 'progressed');
  // Not a wait: a block laid is still getting somewhere (note 603's rule).
  const dig = tried.begin(bot, goal, { q: 'unstuck_move', method: 'place_east' });
  bot._stalls.marked += 1;
  tried.settle(bot, goal, { q: 'unstuck_move' });
  assert.equal(dig.outcome, 'progressed');
});

test('the box and the corner are waits by what they are when the hunt offers them (note 620)', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-28T17:30:00Z') });
  const { decide } = require('../src/decisions');
  const bot = boxBot();
  const goal = { kind: 'win', gameProgress: { phase: 'obtain_blaze_rods' }, step: { action: 'find_fortress' } };
  const client = answering([], c => c.box_here ? 'box_here' : Object.keys(c)[0]);
  await decide('hunt_target', { client, bot, goal, tree: { box_here: { description: 'Box.' }, defer: { description: 'Leave them.' }, close_in: { description: 'Go at them.' } }, state: {} });
  assert.equal(goal.tried.entries.at(-1).waiting, true);
});

// A fortress floor along a brick wall, as blaze-tactics.test.js has it.
function floorWorld({ spawner = new Vec3(0, 64, 0), at = new Vec3(0.5, 64, 9.5) } = {}) {
  const registry = require('minecraft-data')('26.1'), Block = require('prismarine-block')(registry);
  const placed = new Map();
  const solid = p => p.y <= 63 || p.z <= -5;
  const blockAt = p => {
    const f = p.floored(), key = `${f}`;
    const name = placed.get(key) || (spawner && f.equals(spawner) ? 'spawner' : solid(f) ? 'nether_bricks' : 'air');
    const b = Block.fromStateId(registry.blocksByName[name].defaultState); b.position = f;
    return b;
  };
  const stock = [['iron_sword', 1], ['stone_pickaxe', 1], ['cobblestone', 24], ['cooked_beef', 6]];
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health: 17.9, food: 17, entities: {},
    entity: { position: at.clone(), onGround: true, metadata: [], yaw: 0, pitch: 0, height: 1.8, width: 0.6 }, registry, time: { timeOfDay: 6000 },
    inventory: { items: () => stock.map(([name, count]) => ({ name, type: registry.itemsByName[name].id, count, durabilityUsed: 0 })),
      slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 45: { name: 'shield' } } },
    blockAt, world: { raycast: () => null }, pathfinder: { movements: {}, setGoal() {} }, placed,
    lookAt: async () => {}, clearControlStates() {}, activateItem() {}, deactivateItem() {}, attack() {}, setControlState() {}, equip: async () => {} });
  bot.findBlocks = ({ matching, maxDistance = 16, count = 1, point }) => {
    const ids = [].concat(matching), c = point || bot.entity.position, out = [];
    for (let x = -16; x <= 16; x++) for (let y = -4; y <= 4; y++) for (let z = -16; z <= 16; z++) {
      const p = c.floored().offset(x, y, z);
      if (p.distanceTo(c) <= maxDistance && ids.includes(blockAt(p).type)) out.push(p);
    }
    return out.sort((a, b) => a.distanceTo(c) - b.distanceTo(c)).slice(0, count);
  };
  return bot;
}
const blazeAt = (bot, id, x, y, z) => { bot.entities[id] = { id, name: 'blaze', type: 'hostile', position: new Vec3(x, y, z), height: 1.8, width: 0.6, isValid: true, metadata: { 16: 0 } }; };

test('the box\'s holds are kept where they were held and said on the box, in the stance as in the hunt: no blaze killed, none came within reach, how each ended (note 620)', async () => {
  const stand = require('../src/blaze-stand');
  const bot = floorWorld();
  blazeAt(bot, 1, 3.5, 65, -1.5); blazeAt(bot, 2, -3.5, 65.5, 1.5);
  const near = () => require('../src/danger').threats(bot, 24);
  const first = stand.blazeStands(bot, near(), { holds: [] });
  assert(first.box_here, Object.keys(first).join(','));
  assert.doesNotMatch(first.box_here.description, /Held from about here/);
  // Its walls already in, the stance takes the box and the hold is cut off
  // (the turn taken for something else).
  for (const c of first.box_here.site.walls) bot.placed.set(`${c}`, 'cobblestone');
  const goal = {};
  const task = new Task('x');
  task.check = () => { throw Object.assign(new Error('Preempted by push'), { name: 'NeedsSafety' }); };
  await assert.rejects(stand.takeStand(bot, task, goal, null, first.box_here, {}), /Preempted by push/);
  const kept = goal.mobHunt.standResults;
  assert.equal(kept.length, 1);
  assert.deepEqual(kept[0].place, { x: 0, y: 64, z: 9 });
  assert.equal(kept[0].kind, 'box');
  assert.equal(kept[0].ended, 'cut');
  // A second, held to its end with nothing in line or within eight.
  kept.push({ ...kept[0], at: new Date(Date.now() - 30000).toISOString(), seconds: 20, ended: 'twenty seconds with no blaze in line with its window or within eight' });
  kept.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const again = stand.blazeStands(bot, near(), { holds: kept });
  assert.match(again.box_here.description, /Held from about here twice in the last \d+ seconds, \d+ seconds in all: 0 blazes killed, 0 rods, no blaze came within the sword's reach, none in sight; the last ended: cut off, something else taking the turn\./);
  // The hunt's box keeps its place too, and says the same.
  const hunted = stand.blazeStands(bot, near(), { holds: kept, hunted: true });
  assert.match(hunted.box_here.description, /Held from about here twice/);
});

test('the rung\'s question cut off before it went out is put off and asked at a later pass, after any other stall; one asked, or cut by an ordinary failure, is not (note 620)', async () => {
  const { answerOrPutOff } = require('../src/work');
  const { takeStall, deferStall } = require('../src/stillness');
  const bot = { _stalls: { records: {}, marks: [] } };
  const rung = { key: 'step:detour:until_rest_ends', layer: 'work', rung: { rung: 'obtain_blaze_rods', says: '13 minutes on the obtain blaze rods without a new best' } };
  // Cut off (inCatch's true: a claim that outranks the work, a threat, air).
  assert.equal(await answerOrPutOff(bot, rung, async () => true), false);
  assert.equal(bot._stalls.deferred.rung.says, rung.rung.says);
  // A stall raised meanwhile is taken first; the rung's question after it.
  bot._stalls.stall = { key: 'step:rung:obtain_blaze_rods', why: 'turning between return to portal and detour' };
  assert.equal(takeStall(bot).why, 'turning between return to portal and detour');
  const back = takeStall(bot);
  assert.equal(back.rung.says, rung.rung.says);
  assert.equal(takeStall(bot), null);
  // Asked (the question went out before the cut): not put off.
  assert.equal(await answerOrPutOff(bot, { ...rung, asked: true }, async () => true), true);
  // An ordinary failure (inCatch's false), or no cut: answered as any stall.
  assert.equal(await answerOrPutOff(bot, { ...rung }, async () => false), true);
  assert.equal(await answerOrPutOff(bot, { ...rung }, async () => undefined), true);
  // The stall's own question is not put off.
  assert.equal(await answerOrPutOff(bot, { key: 'step:rung:obtain_blaze_rods', layer: 'work' }, async () => true), true);
  assert.equal(bot._stalls.deferred, undefined);
  // Put off twenty times, it is let go.
  let s = { ...rung };
  for (let i = 0; i < 20; i++) s = deferStall(bot, s);
  delete bot._stalls.deferred;
  assert.equal(await answerOrPutOff(bot, s, async () => true), true);
});
