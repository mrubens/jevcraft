'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { perchOf, waysDown, oldOrderWay } = require('../src/way-down');

// A view over a world given as a function of the cell.
const viewOf = at => ({ name: p => at(p.x, p.y, p.z) });
const air = () => 'air';

// mid-243-ab's top, in small (note 565): ground at 64, and over it the bot's
// own scattered column at x 0, z 0, a shelter ring round its top with the
// west side open, and gaps in the column where its blocks were laid apart.
// Feet at 90: under them cobblestone at 89, a gap at 88, dirt at 87 and 86,
// a gap at 85 and 84, cobblestone at 83, six open cells to the dirt at 76,
// and dirt down to the ground.
function tower({ below = {} } = {}) {
  const column = y => y in below ? below[y] : y === 89 || y === 83 ? 'cobblestone' : y === 87 || y === 86 ? 'dirt' : y <= 76 && y >= 65 ? 'dirt' : 'air';
  return viewOf((x, y, z) => {
    if (y <= 64) return y === 64 ? 'grass_block' : 'stone';
    if (x === 0 && z === 0) return column(y);
    // The ring: walls north, east and south at the feet and the head.
    if ((y === 90 || y === 91) && ((x === 1 && z === 0) || (x === 0 && Math.abs(z) === 1))) return 'cobblestone';
    return 'air';
  });
}

test('a top whose every way off falls more than three is a perch; ground, a hill or a sealed shelter on the ground is not', () => {
  const perch = perchOf(tower(), new Vec3(0, 90, 0));
  assert(perch, 'the tower top');
  assert.deepEqual(perch.cells.map(String), ['(0, 90, 0)']);
  assert.equal(perch.least, 25, 'the open west side falls to the grass at 64');
  // Flat ground.
  assert.equal(perchOf(viewOf((x, y) => y <= 64 ? 'stone' : 'air'), new Vec3(0, 65, 0)), null);
  // A ring of cobblestone sealed round the feet on the ground: dug through,
  // its walls stand on ground.
  const sealed = viewOf((x, y, z) => y <= 64 ? 'stone' : (y === 65 || y === 66) && Math.max(Math.abs(x), Math.abs(z)) === 1 ? 'cobblestone' : y === 67 && Math.max(Math.abs(x), Math.abs(z)) <= 1 ? 'cobblestone' : 'air');
  assert.equal(perchOf(sealed, new Vec3(0, 65, 0)), null);
  // A hillside stepping down a block at a time.
  assert.equal(perchOf(viewOf((x, y) => y <= 64 + Math.max(0, 6 - Math.abs(x)) ? 'stone' : 'air'), new Vec3(0, 71, 0)), null);
});

test('dig_down on its own column never drops into a fall that hurts, and says where it stops and why', () => {
  const perch = perchOf(tower(), new Vec3(0, 90, 0));
  const ways = waysDown(tower(), perch, { health: 20, carried: {}, pickaxe: 'iron_pickaxe', pickaxeUses: 1 });
  assert(ways.dig_down, 'the column is offered');
  const plan = ways.dig_down.plan;
  assert.deepEqual({ ...plan.endsAt }, { x: 0, y: 84, z: 0 }, 'on the cobblestone at 83, over the six-block gap');
  assert.equal(plan.off, false);
  const says = ways.dig_down.description;
  assert.match(says, /3 blocks to dig \(1 cobblestone, 2 dirt\)/);
  assert.match(says, /no drop on the way is more than 3 blocks/);
  assert.match(says, /a fall of 7 under it \(about 4 health\), so it is not dug, and the way down is asked again from there/);
  assert.match(says, /1 pickaxe use/);
  // From 84, the next block opens the fall: not dug by this way.
  const lower = perchOf(tower({ below: { 89: 'air', 87: 'air', 86: 'air' } }), new Vec3(0, 84, 0));
  assert(lower);
  assert.equal(waysDown(tower({ below: { 89: 'air', 87: 'air', 86: 'air' } }), lower, { health: 20 }).dig_down, undefined);
  // A solid column all the way comes off the top, and says a walk goes on.
  const solid = tower({ below: Object.fromEntries(Array.from({ length: 25 }, (_, i) => [65 + i, 'dirt'])) });
  const whole = waysDown(solid, perchOf(solid, new Vec3(0, 90, 0)), { health: 20 }).dig_down;
  assert.equal(whole.plan.off, true);
  assert.match(whole.description, /It ends \d+ blocks lower, at \(0, \d+, 0\), where a walk goes on/);
  // Nothing over lava is dug.
  const lava = tower({ below: { 88: 'lava' } });
  assert.equal(waysDown(lava, perchOf(lava, new Vec3(0, 90, 0)), { health: 20 }).dig_down, undefined);
});

test('the water bucket is a waterfall off an open side to the ground, not in the Nether; a fall is offered only when it leaves health', () => {
  const view = tower(), perch = perchOf(view, new Vec3(0, 90, 0));
  const ways = waysDown(view, perch, { health: 20, carried: { water_bucket: 1 } });
  assert(ways.ride_water);
  assert.equal(ways.ride_water.plan.dir, 'west');
  assert.equal(ways.ride_water.plan.fall, 25);
  assert.equal(ways.ride_water.plan.off, true);
  assert.match(ways.ride_water.description, /25 blocks down to the grass block at \(-1, 64, 0\), with no fall damage in the water; a walk goes on from there/);
  assert.match(ways.ride_water.description, /the bucket comes back empty/);
  assert.match(ways.ride_water.description, /Rides so far: 11 of 11 from 4 to 17 blocks came down; the 2 of 53 and 55 blocks each ended in a fall to death.*the ride keeps the turn/, 'the record of the rides (note 662)');
  assert.equal(waysDown(view, perch, { health: 20, carried: { water_bucket: 1 }, nether: true }).ride_water, undefined, 'water boils away in the Nether');
  assert.equal(ways.step_off, undefined, 'twenty-five down costs twenty-two health');
  // Sealed in for the night on the top, walls on every side: the water
  // goes off a side whose wall is dug out first.
  const sealed = viewOf((x, y, z) => (y === 90 || y === 91) && Math.abs(x) + Math.abs(z) === 1 ? 'dirt' : y === 92 && x === 0 && z === 0 ? 'dirt' : tower().name(new Vec3(x, y, z)));
  const shut = perchOf(sealed, new Vec3(0, 90, 0));
  assert(shut, 'still a top');
  const out = waysDown(sealed, shut, { health: 20, carried: { water_bucket: 1 } }).ride_water;
  assert.match(out.description, /^Dig out the dirt and dirt of the wall on the \w+ side, then pour the water bucket at the feet/);
  assert.equal(out.plan.wall.length, 2);
  // A short tower: its fall is said with its cost.
  const short = viewOf((x, y, z) => y <= 64 ? 'stone' : x === 0 && z === 0 && y <= 69 ? 'dirt' : 'air');
  const step = waysDown(short, perchOf(short, new Vec3(0, 70, 0)), { health: 20 }).step_off;
  assert(step);
  assert.match(step.description, /a fall of 5 blocks onto the stone costs about 2 health, leaving about 18; armour does not soften a fall/);
});

test('without Jev, the way that comes off the top safely is taken first', () => {
  const view = tower(), perch = perchOf(view, new Vec3(0, 90, 0));
  assert.equal(oldOrderWay(waysDown(view, perch, { health: 20, carried: { water_bucket: 1 } })), 'ride_water', 'the dig stops still up the tower; the water reaches the ground');
  assert.equal(oldOrderWay(waysDown(view, perch, { health: 20 })), 'dig_down');
});

// A live bot on a tower of dirt over the ground: the walk asks the way
// down, digs the column and walks on from the ground.
function liveTower({ top = 72, column = y => y >= 65 && y < 72 ? 'dirt' : 'air', carried = [] } = {}) {
  const dug = new Set();
  const name = p => dug.has(`${p}`) ? 'air' : p.y <= 64 ? 'stone' : p.x === 0 && p.z === 0 ? column(p.y) : 'air';
  const bot = { entity: { position: new Vec3(.5, top, .5), onGround: true, velocity: new Vec3(0, 0, 0) }, health: 20, food: 20, entities: {},
    game: { dimension: 'overworld', gameMode: 'survival' }, registry: { itemsByName: {} },
    inventory: { items: () => carried }, clearControlStates() {}, chat() {}, emit() {}, setControlState() {}, getControlState() { return false; },
    blockAt: p => {
      const n = name(p.floored ? p.floored() : p), full = !['air', 'water', 'lava'].includes(n);
      return { position: p, name: n, diggable: true, boundingBox: full ? 'block' : 'empty', shapes: full ? [[0, 0, 0, 1, 1, 1]] : [], digTime: () => 1 };
    },
    dig: async b => {
      dug.add(`${b.position}`);
      // Down to the next solid block.
      let y = b.position.y;
      while (name(new Vec3(0, y - 1, 0)) === 'air' && y > 65) y--;
      bot.entity.position.y = y;
    },
  };
  return { bot, dug };
}

test('a walk off a top asks the way down first, digs down its own column, and walks on from the ground', async () => {
  const { navigate, Task } = require('../src/skills');
  const { goals } = require('mineflayer-pathfinder');
  const { bot, dug } = liveTower();
  const movements = { allow1by1towers: true, scafoldingBlocks: [1] }, walks = [];
  bot.pathfinder = { movements, setGoal() {}, goto: async goal => { walks.push({ y: bot.entity.position.y, towers: movements.allow1by1towers }); bot.entity.position = new Vec3(goal.x + .5, goal.y, goal.z + .5); } };
  const asked = [];
  const task = new Task('test', 'test');
  task.opportunityClient = { systemOne: async ({ questions, state }) => { asked.push({ options: Object.keys(questions.branch_0.criteria), state }); return { answers: { branch_0: { choice: 'dig_down', confidence: 0.9 } } }; } };
  await navigate(bot, task, new goals.GoalBlock(40, 65, 0));
  assert.equal(asked.length, 1, 'asked once');
  assert.deepEqual(asked[0].options, ['dig_down', 'step_off']);
  assert.match(asked[0].state.top, /no way down at a walk: its sides fall 7 to 7 blocks/);
  assert.equal(dug.size, 4, 'down the column until a drop of three is left, which a walk takes');
  assert.deepEqual(walks, [{ y: 68, towers: true }], 'the walk starts from there, laying blocks as ever');
});

test('still on a top with no way down offered, the walk builds no tower, and the movements are put back', async () => {
  const { navigate, Task } = require('../src/skills');
  const { goals } = require('mineflayer-pathfinder');
  // Bedrock underfoot, nothing carried, and forty blocks of air round it.
  const { bot } = liveTower({ top: 105, column: y => y >= 65 && y < 105 ? 'bedrock' : 'air' });
  const movements = { allow1by1towers: true, scafoldingBlocks: [1] }, seen = [];
  bot.pathfinder = { movements, setGoal() {}, goto: async () => { seen.push({ towers: movements.allow1by1towers, blocks: movements.scafoldingBlocks.length, goalY: movements.walkGoalY }); } };
  const task = new Task('test', 'test');
  task.opportunityClient = { systemOne: async () => { throw new Error('nothing to ask'); } };
  await assert.rejects(navigate(bot, task, new goals.GoalNear(-60, 70, -10, 2)), err => err.name === 'NoRoute');
  assert.deepEqual(seen, [{ towers: false, blocks: 1, goalY: 70 }]);
  assert.equal(movements.allow1by1towers, true);
  assert.deepEqual(movements.scafoldingBlocks, [1]);
  assert.equal(Object.hasOwn(movements, 'walkGoalY'), false);
});

// mid-243-ae (note 594): on the mold of the portal it was casting, 4 up,
// the only water bucket carried and no other water within 48 blocks, the
// ride said "any water refills it" and was chosen over a 1-second dig; the
// cast then searched 36 minutes for water. The ride says where the water
// stays, whether other water is in view, and what the work wants it for.
test('the ride says the water stays up top, the nearest other water or none in view, and what the work in hand needs the bucket for', () => {
  const view = tower(), perch = perchOf(view, new Vec3(0, 90, 0));
  const none = waysDown(view, perch, { health: 20, carried: { water_bucket: 1 }, water: { searched: 48, nearest: null, use: 'the portal is being cast from lava and water' } }).ride_water.description;
  assert.doesNotMatch(none, /any water refills it/);
  assert.match(none, /The water stays up here on the top, 25 blocks over where the ride lands: filling the bucket from it again means climbing back up to it/);
  assert.match(none, /No other water source is in view within 48 blocks: to fill the bucket again, water has to be found first/);
  assert.match(none, /The work in hand needs this water bucket: the portal is being cast from lava and water\./);
  const near = waysDown(view, perch, { health: 20, carried: { water_bucket: 1 }, water: { searched: 48, nearest: { distance: 12, at: new Vec3(8, 64, -9) }, use: null } }).ride_water.description;
  assert.match(near, /The nearest other water source in view is 12 blocks off, at \(8, 64, -9\), where the bucket can be filled again\./);
  assert.doesNotMatch(near, /work in hand/);
});

test('the water bucket is the cast\'s while a frame being cast has blocks left to set, and a planned step\'s that uses one', () => {
  const { waterBucketUse } = require('../src/way-down');
  const blocks = Array.from({ length: 10 }, (_, i) => ({ x: 50 + (i % 4), y: 109 + Math.floor(i / 4), z: -33 }));
  const castSoFar = n => ({ blockAt: p => ({ name: blocks.findIndex(b => b.x === p.x && b.y === p.y && b.z === p.z) < n ? 'obsidian' : 'air' }) });
  const goal = { portalMethod: { kind: 'cast' }, portalFrame: { origin: { x: 50, y: 109, z: -33 }, blocks, cast: true } };
  assert.equal(waterBucketUse(castSoFar(3), goal), 'the portal is being cast from lava and water (the frame at (50, 109, -33), 3 of 10 cast), and each block is set by water poured on its lava, so the cast waits until the bucket is filled again');
  assert.equal(waterBucketUse(castSoFar(10), goal), null, 'the frame is cast');
  assert.equal(waterBucketUse(castSoFar(0), { portalMethod: { kind: 'build' }, portalFrame: { blocks } }), null, 'a frame of mined obsidian wants no water');
  assert.match(waterBucketUse(castSoFar(0), { step: { action: 'cross_lava', consumes: { water_bucket: 1 } } }), /the step in hand \(cross lava\) uses it/);
});

test('live, the way down tells the ride what the cast needs the bucket for and that no other water is in view', async () => {
  const { navigate, Task } = require('../src/skills');
  const { goals } = require('mineflayer-pathfinder');
  const { bot } = liveTower({ carried: [{ name: 'water_bucket', count: 1 }] });
  bot.registry.blocksByName = { water: { id: 26 } };
  const looked = [];
  bot.findBlocks = options => { looked.push(options.maxDistance); return []; };
  const frame = Array.from({ length: 10 }, (_, i) => ({ x: 30 + (i % 4), y: 65 + Math.floor(i / 4), z: 5 }));
  bot._goal = { portalMethod: { kind: 'cast' }, portalFrame: { origin: { x: 30, y: 65, z: 5 }, blocks: frame, cast: true } };
  bot.pathfinder = { movements: { allow1by1towers: true, scafoldingBlocks: [1] }, setGoal() {}, goto: async goal => { bot.entity.position = new Vec3(goal.x + .5, goal.y, goal.z + .5); } };
  const asked = [];
  const task = new Task('test', 'test');
  task.opportunityClient = { systemOne: async ({ questions }) => { asked.push(questions.branch_0.criteria); return { answers: { branch_0: { choice: 'dig_down', confidence: 0.9 } } }; } };
  await navigate(bot, task, new goals.GoalBlock(40, 65, 0));
  assert.equal(asked.length, 1);
  const ride = JSON.stringify(asked[0].ride_water);
  assert.match(ride, /No other water source is in view within 48 blocks/);
  assert.match(ride, /The work in hand needs this water bucket: the portal is being cast from lava and water \(the frame at \(30, 65, 5\), 0 of 10 cast\)/);
  assert.deepEqual(looked, [48]);
});
