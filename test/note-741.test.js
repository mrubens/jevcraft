'use strict';
// Note 741 (critic-20260930T0923Z.md item 1, 25584 mid-208-k-nether-3-
// fortress-2): sealed at (-112, 73, 156) from about 08:55Z at 6.4 health,
// hunger 15, no food carried, 3 of 7 rods, the portal 181 blocks off.
// turn_priority's survival claim and pocket_next's stay already say health
// cannot come back at this hunger (src/arbiter.js, src/decisions/
// survival.js), but three things kept the food trip from ever being
// reached or honestly priced:
//
//   (a) huntObserved (the live arbiter's hunt claim, note 672) had no path
//       to foodLeave's leave_nether question (go_back, keep_on,
//       restock_food) at all: prepareMobHunt's own fitness gate reaches it
//       on a different call path, so a hunt observed while hungry with
//       nothing to eat fell straight to fortress_visit's thinner food
//       branch (which offers no portal trip at all) or another box built
//       to wait out a hunger that never comes back.
//   (b) restock_food's keep_on and leave_nether's keep_on said only the
//       rule ("health comes back only at eighteen or more"), never what
//       twenty minutes at this health with no food has cost in the played
//       record.
//   (c) stillness_detour's "differently" was offered again from the same
//       spot its own text said had just got 0 of 8 blocks with no route.
//       Checked, not changed: work.js's answerStall already says that
//       fact plainly on the option (shortSays, note 485's own
//       "differently" case, tested in test/stillness.test.js's staircase
//       case), so Jev is not misled about the ground; hiding the option
//       instead would be the hidden gate the project's own rule (fix the
//       general rule with honest facts, not a threshold Jev cannot see)
//       argues against, and it would break that existing, deliberate
//       behavior. Left as it is.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { Task } = require('../src/skills');

const HERE = new Vec3(-112.5, 73, 156.5);

// A bare bot in the Nether, hungry with nothing to eat, no live spawner
// known: standing ground below the feet, open air above, as huntObserved's
// own footing check (canBegin) needs.
function hungryBot({ health = 6.4, food = 15, items = [] } = {}) {
  const bot = Object.assign(new EventEmitter(), {
    registry, version: '26.1',
    entity: { position: HERE.clone(), height: 1.8, width: 0.6, onGround: true, metadata: [0] }, health, food, foodSaturation: 0, oxygenLevel: 20,
    game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, time: { timeOfDay: 6000 },
    entities: {}, inventory: { items: () => items, slots: [] },
    blockAt: p => p.y < HERE.y ? { name: 'netherrack', boundingBox: 'block', diggable: true, hardness: 0.4 } : { name: 'air', boundingBox: 'empty' },
    findBlocks: () => [], world: { raycast: () => null },
    pathfinder: { movements: { canDig: true, allow1by1towers: true, allowParkour: false, scafoldingBlocks: [1] }, setGoal: () => {}, getPathTo: () => ({ status: 'success', path: [] }) },
    clearControlStates: () => {}, lookAt: async () => {}, activateItem: () => {}, deactivateItem: () => {},
    attack: () => {}, dig: async () => {}, chat() {},
  });
  const goal = { kind: 'win', mobHunt: { entity: 'blaze', item: 'blaze_rod', targetCount: 7 }, survival: {} };
  return { bot, goal };
}

const stubClient = picks => { const asked = []; return { asked, systemOne: async ({ questions }) => {
  const keys = Object.keys(questions.branch_0.criteria);
  asked.push({ options: questions.branch_0.criteria });
  const choice = picks.find(p => keys.includes(p)) || keys[0];
  return { answers: { branch_0: { choice, confidence: 0.8 } } };
} }; };

test('(a) huntObserved asks the food trip (leave_nether: go_back, keep_on, restock_food) before fortress_visit or a fresh fight when hungry with nothing to eat (25584, note 741)', async () => {
  const { huntObserved } = require('../src/mob-hunt');
  const { bot, goal } = hungryBot();
  const task = new Task('hunt');
  const client = stubClient(['go_back']);
  let returned = false;
  const actions = { navigate: async () => {}, returnOverworld: async () => { returned = true; } };
  const result = await huntObserved(bot, task, goal, () => {}, actions, client);
  assert.equal(result, true, 'the trip home was carried out, not left for a fortress_visit or a fresh fight');
  assert.equal(returned, true, 'actions.returnOverworld was called');
  assert.equal(client.asked.length, 1, 'the leave_nether question, once');
  assert.ok(client.asked[0].options.go_back, 'go_back is offered');
  assert.ok(client.asked[0].options.keep_on, 'keep_on is offered too, priced');
  assert.equal(goal.step?.action, 'return_for_food');
});

test('(a) held off for the twenty minutes keep_on bought: huntObserved does not ask the food trip again while it stands', async () => {
  const { huntObserved } = require('../src/mob-hunt');
  const { setAside } = require('../src/progress');
  const { bot, goal } = hungryBot();
  setAside(goal, 'nether_return', 'food', 'chosen to go on without food for twenty minutes, at 6.4 health', 20 * 60000);
  const task = new Task('hunt');
  let asked = 0;
  const client = { systemOne: async () => { asked++; return { answers: {} }; } };
  const actions = { navigate: async () => {}, returnOverworld: async () => { throw new Error('should not be called'); } };
  // With nothing to fight and no fortress hold, huntObserved's own tree is
  // empty and it returns false, but it must not re-ask the food trip first.
  await huntObserved(bot, task, goal, () => {}, actions, client);
  assert.equal(asked, 0, 'not asked again while the twenty minutes held');
});

test('(b) keep_on (restock_food) says what fights begun at this hunger with nothing to eat came to in the record, not just the rule (note 741)', async () => {
  const { bot, goal } = hungryBot({ items: [] });
  goal.sightings = {}; goal.survival = {};
  const task = new Task('food');
  const client = stubClient(['keep_on']);
  // A trip home too (return_for_food), so restock_food's tree has more
  // than the one way and is actually asked rather than taken as the only
  // option.
  await require('../src/nether-food').askRestockFood(bot, task, goal, () => {}, { actions: { returnOverworld: async () => {} }, client });
  assert.equal(client.asked.length, 1);
  const { keep_on: keepOn } = client.asked[0].options;
  assert.ok(keepOn, 'keep_on is offered');
  assert.match(keepOn, /health comes back only at eighteen or more/);
  assert.match(keepOn, /died.*brought a rod|record of the trials|played record/i, 'the record\'s own numbers are said, not just the rule');
});

test('(b) foodLeave\'s keep_on (leave_nether) says the same record', async () => {
  const { bot, goal } = hungryBot();
  const stats = require('../src/food-facts');
  // Reach into the module through the exported huntObserved path so the
  // private foodLeave tree is exercised the same way the trial hit it.
  const { huntObserved } = require('../src/mob-hunt');
  const task = new Task('hunt');
  const client = stubClient(['keep_on']);
  const actions = { navigate: async () => {}, returnOverworld: async () => {} };
  await huntObserved(bot, task, goal, () => {}, actions, client);
  assert.equal(client.asked.length, 1);
  assert.match(client.asked[0].options.keep_on, /died|record/i);
  // The record function itself, sanity: it names the row this bot is in.
  assert.match(stats.recordSays(bot), /nothing to eat carried/);
});

test('(c) stillness_detour\'s "differently" already says a same-spot 0-of-8 no-route failure plainly, and stays offered rather than being hidden (25584, note 741; unchanged, matches note 485)', async () => {
  const { answerStall } = require('../src/work');
  const bot = { registry, game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health: 6.4, food: 15, isAlive: true, chat() {}, emit() {},
    entity: { id: 1, position: HERE.clone(), onGround: true }, time: { timeOfDay: 0 }, entities: {},
    inventory: { items: () => [{ name: 'stone_pickaxe', count: 1 }], slots: [] }, findBlocks: () => [], clearControlStates() {}, setControlState() {},
    blockAt: p => ({ position: p, name: p.y < HERE.y ? 'netherrack' : 'air', boundingBox: p.y < HERE.y ? 'block' : 'empty' }),
    pathfinder: { movements: { blocksCantBreak: new Set() }, setGoal() {}, getPathTo: () => ({ status: 'noPath', path: [] }) } };
  const goal = { version: 1, kind: 'survive', request: 'Stay alive', survival: {} };
  // The last "differently" got nowhere from right here, moments ago: this
  // is what work.js's turn.wayOffShort holds after such a try.
  const here = bot.entity.position.floored();
  goal.survival.wayOffShort = { at: Date.now() - 15000, from: { x: here.x, y: here.y, z: here.z }, aimed: 8, moved: 0, error: 'No route from here to (-113, 73, 148) (noPath)' };
  const task = new Task('stall');
  const asked = [];
  const client = { systemOne: async ({ questions }) => {
    for (const q of Object.values(questions)) asked.push(q.criteria);
    task.cancel();
    const keys = Object.keys(Object.values(questions)[0].criteria || {});
    return { answers: Object.fromEntries(Object.keys(questions).map(b => [b, { choice: keys[0], confidence: 0.6 }])) };
  } };
  const stall = { key: 'step:find_fortress', work: 'step:rung:obtain_blaze_rods', layer: 'work', strikes: 2, error: 'No route from here to (-113, 73, 148) (noPath)', until: Date.now() + 23000 };
  await answerStall(bot, task, goal, () => {}, stall, { client }).catch(() => {});
  assert.equal(asked.length, 1);
  assert.ok(asked[0].differently, 'still offered: the ground itself is not off-limits');
  assert.match(asked[0].differently, /0 of 8 blocks.*No route/, 'the failure is said plainly, not swallowed');
});
