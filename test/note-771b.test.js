'use strict';
// Note 771b: food dropped for room on the way to the Nether, said as the food
// rung's stock and gone back for; leave_cooking at every asking where it is of
// use, and never inside another batch's hold.
// 25589 (mid-226-ae, 2026-10-01 03:08:19Z) dropped 18 beef (54 food points)
// for a gold ingot; at 03:11:23Z its food rung said 8 of 80 and went after one
// sheep. 25584 (Nether, 03:11:34 to 03:14:21Z) was re-asked while_cooking with
// only dig_stone and wait_here and stood 180 seconds. 25590 (03:14:13 to
// 03:14:31Z) left three batches in eighteen seconds, 13 raw copper among them.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');

const it = (name, count = 1) => { const r = registry.itemsByName[name]; return { name, count, type: r.id, stackSize: r.stackSize, slot: 0 }; };
// 25589's pockets at 03:08, full, the beef among them.
function pockets() {
  const items = [it('beef', 18), it('mutton', 4), it('bread', 2), it('egg', 3), it('arrow', 2), it('bone', 1), it('iron_pickaxe'), it('iron_pickaxe'), it('iron_sword'), it('cobblestone', 64), it('cobblestone', 64), it('coal', 64), it('lapis_lazuli', 64), it('lapis_lazuli', 50)];
  while (items.length < 36) items.push(it('white_wool'));
  items.forEach((x, i) => { x.slot = 9 + i; });
  return items;
}
function bot(items) {
  const tossed = [];
  return { registry, version: '26.1', game: { gameMode: 'survival', dimension: 'overworld', difficulty: 'normal' }, health: 20, food: 20,
    entity: { position: new Vec3(439.5, 39, 270.5), yaw: 0 }, entities: {}, time: { timeOfDay: 6000 },
    inventory: { items: () => items, emptySlotCount: () => 36 - items.length, slots: [] },
    lookAt: async () => {}, chat() {}, tossed,
    toss: async type => { const i = items.findIndex(x => x.type === type); if (i >= 0) { tossed.push(items[i].name); items.splice(i, 1); } } };
}
const winGoal = () => ({ kind: 'win', request: 'beat the game', gameProgress: { milestones: {} } });

test('the crossing\'s food carried, and a food stack\'s drop said against the rung', () => {
  const { crossingFood, crossingDropSays } = require('../src/inventory-tidy');
  const b = bot(pockets());
  const c = crossingFood(b, winGoal());
  assert.equal(c.carried, 18 * 3 + 4 * 2 + 2 * 5);
  assert.equal(c.short, c.carried < c.want);
  assert.match(crossingDropSays(b, c, it('beef', 18)), new RegExp(`^the Nether food rung's stock: 72 of the ${c.want} points the stay wants carried, 54 of them in this stack; dropped, 18 carried and ${c.want - 18} short, about 8 minutes of food errands to gather again at the record's 6\\.4 points a minute$`));
  // In the Nether entered, or not a win goal: nothing.
  assert.equal(crossingFood(b, { kind: 'win', gameProgress: { milestones: { nether_entered: true } } }), null);
  assert.equal(crossingFood(b, { kind: 'survive' }), null);
});

test('25589 at 03:08:19Z: the beef is not offered for the gold ingot while other stacks can go, and is said as the rung\'s stock when it is', async () => {
  const { makeRoom } = require('../src/inventory-tidy');
  const items = pockets();
  const b = bot(items);
  const offered = [];
  const client = { systemOne: async ({ questions }) => {
    const answers = {};
    for (const [k, q] of Object.entries(questions)) { offered.push(q.criteria); const keys = Object.keys(q.criteria).filter(x => x !== 'none_good'); answers[k] = { choice: keys.includes('drop') ? 'drop' : keys[0], confidence: 0.8 }; }
    return { answers };
  } };
  await makeRoom(b, { opportunityClient: client, check() {} }, 'gold_ingot', { goal: winGoal() });
  const stacksOffered = offered.flatMap(c => Object.keys(c)).filter(k => k.startsWith('drop_'));
  assert(stacksOffered.length, 'asked');
  assert(!stacksOffered.some(k => /^drop_(beef|mutton|bread)/.test(k)), `no food offered: ${stacksOffered}`);
  assert(!b.tossed.includes('beef'));
  // Only food left to drop: offered, and said against the rung.
  const onlyFood = [it('beef', 18)];
  while (onlyFood.length < 36) onlyFood.push(it('bread', 1));
  const b2 = bot(onlyFood), seen = [];
  const client2 = { systemOne: async ({ questions }) => { const answers = {}; for (const [k, q] of Object.entries(questions)) { seen.push(q.criteria); answers[k] = { choice: 'none', confidence: 0.8 }; } return { answers }; } };
  await makeRoom(b2, { opportunityClient: client2, check() {} }, 'gold_ingot', { goal: winGoal() });
  const words = JSON.stringify(seen);
  assert.match(words, /drop_beef/);
  assert.match(words, /the Nether food rung's stock: 229 of the \d+ points the stay wants carried, 54 of them in this stack/);
});

test('food dropped for room is remembered, and the food rung offers the walk back while it lies there', () => {
  const { noteDroppedFood } = require('../src/inventory-tidy');
  const { droppedFoodNear } = require('../src/work');
  const b = bot(pockets());
  const goal = winGoal();
  const t0 = Date.now();
  noteDroppedFood(b, goal, it('beef', 18));
  assert.equal(goal.droppedFood.length, 1);
  b.entity.position = new Vec3(450.5, 39, 280.5);
  const near = droppedFoodNear(b, goal, t0 + 60000);
  assert.match(near.says, /^Walk back for the 18 beef dropped for room at \(439, 39, 270\) 1 minute ago: 54 food points, 15 blocks off, about 3 seconds at a walk; it vanishes about 240 seconds from now, five minutes after it fell\. The pockets are full/);
  // Gone after five minutes (less twenty seconds), or in another dimension, or far.
  assert.equal(droppedFoodNear(b, goal, t0 + 290000), null);
  b.game.dimension = 'the_nether';
  assert.equal(droppedFoodNear(b, goal, t0 + 60000), null);
});

test('25584 at 03:14Z: leave_cooking is said not offered with why, once the last leaving came back with no work done', async () => {
  const { whileCooking } = require('../src/work');
  const fb = { registry, oxygenLevel: 20, health: 20, food: 20, game: { gameMode: 'survival', dimension: 'the_nether', difficulty: 'normal' }, time: { timeOfDay: 3834 },
    entity: { position: new Vec3(0.5, 20, 0.5), height: 1.8, width: 0.6, onGround: true }, entities: {},
    inventory: { items: () => [{ name: 'raw_iron', count: 20 }, { name: 'coal', count: 10 }, { name: 'cobblestone', count: 20 }], slots: [], emptySlotCount: () => 15 },
    blockAt: p => { const q = p.floored(); const name = q.y < 20 ? 'netherrack' : 'air'; return { name, position: q, boundingBox: name === 'air' ? 'empty' : 'block', getProperties: () => ({}) }; },
    findBlocks: () => [], world: { raycast: () => null }, pathfinder: { movements: {} } };
  let q = null;
  const task = { check() {}, opportunityClient: { systemOne: async ({ questions }) => { q = questions.branch_0; return { answers: { branch_0: { choice: 'wait_here', confidence: 0.7 } } }; } } };
  // Still of use: offered again at a later asking, the leaving done before.
  await whileCooking(fb, task, { kind: 'win' }, () => {}, { cooking: 60000, oreInReach: () => null, walkTarget: () => null, what: 'raw iron', count: 6, spent: ['dig_stone'], own: { at: new Vec3(0, 20, 1) }, workOnOffer: [{ key: 'mine_nearby', description: 'Mine the quartz 9 blocks off.' }] });
  assert(q?.criteria?.leave_cooking, 'offered again after a walk spent');
  // Came back with nothing done: not offered, said.
  q = null;
  await whileCooking({ ...fb }, task, { kind: 'win' }, () => {}, { cooking: 60000, oreInReach: () => null, walkTarget: () => null, what: 'raw iron', count: 6, own: null, ownWhy: 'left once this batch already, and the work on offer then ran out at once' });
  assert(q, 'asked');
  assert.equal(q.criteria.leave_cooking, undefined);
});
