'use strict';
// Note 762: the walk out with rods. Of six lives that set out for a portal
// carrying four or more blaze rods (2026-09-29T23:00Z on), four died on the
// way, every death off the way the bot had come in (scripts/walk-out.js):
// 25591 at 7 rods stepped down onto the lava sea's shore, lava level with
// its feet, and went in; 25588 at 5 went off a ledge 35 blocks into the sea
// at full health; 25598 at 6 and 1.7 health took two drops of three, a
// point each. The way in kept and walked back (walk-out.js), and the rods'
// own rules for the pathfinder (movement.js rodRefused).
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { groundBot } = require('./fixtures/saved-ground');
const { Task } = require('../src/skills');
const walkOut = require('../src/walk-out');

const IRON = ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'golden_boots'];
const RODS = [['blaze_rod', 7]];
// A scene built from a function of the cell (the saved-ground format: rows
// by y then z, a letter per x).
function scene(box, fn) {
  const palette = [], rows = [];
  const letter = n => { let i = palette.indexOf(n); if (i < 0) { palette.push(n); i = palette.length - 1; } return String.fromCharCode(97 + i); };
  for (let y = box.y[0]; y <= box.y[1]; y++) for (let z = box.z[0]; z <= box.z[1]; z++) {
    let r = ''; for (let x = box.x[0]; x <= box.x[1]; x++) r += letter(fn(x, y, z)); rows.push(r);
  }
  return { box, palette, rows };
}
function nether(fixture, at, opts = {}) {
  const bot = groundBot(fixture, { dimension: 'the_nether', worn: IRON, ...opts, at });
  bot.game.minY = 0;
  Object.assign(bot.pathfinder.movements, { canDig: false, allow1by1towers: false, scafoldingBlocks: [] });
  return bot;
}
// The route the pathfinder finds, as cells, or null with none.
function route(bot, to, range = 0) {
  const r = bot.pathfinder.getPathTo(bot.pathfinder.movements, new goals.GoalNear(to.x, to.y, to.z, range), 3000);
  return r.status === 'success' ? r.path.map(p => new Vec3(p.x, p.y, p.z)) : null;
}
const maxDrop = (from, path) => { let prev = from, most = 0; for (const p of path) { most = Math.max(most, prev.y - p.y); prev = p; } return most; };

// 25591's shore (04:27:52-56Z): the lava sea at y 29-31, the shore's ground
// a block under its top so the lava is level with the feet, and a wall at
// x 7 inland, so the only way past is the row beside the lava.
const SHORE = scene({ x: [0, 14], y: [28, 36], z: [0, 6] }, (x, y, z) => {
  if (y === 28) return 'netherrack';
  if (z <= 2) return y <= 31 ? 'lava' : 'air';
  if (x === 7 && z >= 4) return y <= 34 ? 'netherrack' : 'air';
  return y <= 30 ? 'netherrack' : 'air';
});
const shoreBot = opts => nether(SHORE, new Vec3(1.5, 31, 5.5), opts);
const SHORE_TO = new Vec3(13, 31, 5);

test('25591\'s shore: without rods the walk takes the cells with the lava level with the feet; with 7 rods carried none, and no route (note 762)', () => {
  const before = route(shoreBot(), SHORE_TO);
  assert(before, 'a route without rods');
  const lavaSide = p => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => /lava/.test(SHORE_FOR_READ(p.x + dx, p.y, p.z + dz)));
  assert(before.some(lavaSide), 'the route walks the shore, the lava a block to the side at the feet');
  const bot = shoreBot({ items: RODS });
  assert.equal(route(bot, SHORE_TO), null, 'with rods: none of those cells, so no way along the shore');
  assert(bot.pathfinder.movements.rodRefusals > 0, 'refused by the rods\' rule');
});
const SHORE_FOR_READ = (() => { const b = shoreBot(); return (x, y, z) => b.blockAt(new Vec3(x, y, z))?.name || ''; })();

test('the same shore with a block laid between the path and the lava: walked with rods (note 762)', () => {
  const bot = shoreBot({ items: RODS });
  for (let x = 0; x <= 14; x++) for (const y of [30, 31]) bot.changed.set(`${x},${y},2`, 'netherrack');
  const path = route(bot, SHORE_TO);
  assert(path, 'a way with the block between');
  assert(path.some(p => p.z === 3), 'along the shore row');
});

// 25598's descent (05:51:44-55Z): two drops of three at 1.7 health, a point
// each. A plateau three over the ground ahead, and a ramp down a block at a
// time along one side.
const STEP = scene({ x: [0, 12], y: [0, 12], z: [0, 4] }, (x, y, z) => {
  const top = x <= 3 ? 8 : z === 4 && x === 4 ? 7 : z === 4 && x === 5 ? 6 : 5;
  return y <= top ? 'netherrack' : 'air';
});
test('25598\'s drops: at 1.7 health the walk drops three at once; with rods carried it takes the ramp, no drop over two (note 762)', () => {
  const from = new Vec3(1, 9, 1), to = new Vec3(10, 6, 1);
  const before = route(nether(STEP, new Vec3(1.5, 9, 1.5), { health: 1.7 }), to);
  assert.equal(maxDrop(from, before), 3);
  const after = route(nether(STEP, new Vec3(1.5, 9, 1.5), { health: 1.7, items: RODS }), to);
  assert(after, 'a way down with rods');
  assert(maxDrop(from, after) <= walkOut.ROD_DROP_MAX, `drops of at most ${walkOut.ROD_DROP_MAX}: ${maxDrop(from, after)}`);
  assert(after.some(p => p.z === 4), 'by the ramp');
});

// 25588's ledge (11:50:41-43Z): a one-wide ridge fifteen over the lava sea,
// wide ground at each end.
const RIDGE = scene({ x: [0, 12], y: [40, 62], z: [0, 6] }, (x, y, z) => {
  if (y <= 44) return 'lava';
  if ((x <= 1 || x >= 11) && y <= 59) return 'netherrack';
  if (z === 3 && y <= 59) return 'netherrack';
  return 'air';
});
const ridgeBot = opts => nether(RIDGE, new Vec3(0.5, 60, 3.5), opts);
const RIDGE_TO = new Vec3(12, 60, 3);

test('25588\'s ridge over the lava sea: walked at full health without rods; with rods refused off the way in, walked where it is the way in or its own laid span (note 762)', () => {
  assert(route(ridgeBot(), RIDGE_TO), 'without rods the ridge is walked at its cost');
  const bot = ridgeBot({ items: RODS });
  assert.equal(route(bot, RIDGE_TO), null, 'with rods and the ridge fresh ground: refused');
  // Its way in: the cells it stood on crossing it.
  const known = ridgeBot({ items: RODS });
  known._wayIn = { cells: [] };
  for (let x = 12; x >= 0; x--) walkOut.noteCell(known._wayIn, { x, y: 60, z: 3 });
  const back = route(known, RIDGE_TO);
  assert(back && back.every(p => p.z === 3 || p.x <= 1 || p.x >= 11), 'along the way in');
  // Or its own span: the ridge's top laid by the bot.
  const own = ridgeBot({ items: RODS });
  own._laid = new Map();
  for (let x = 1; x <= 11; x++) own._laid.set(`${x},59,3`, { name: 'netherrack', at: Date.now() });
  assert(route(own, RIDGE_TO), 'along its own span');
});

test('with rods, a cell beside lava or an edge off the way in costs more by the rods carried (note 762)', () => {
  const plain = ridgeBot(), rods = ridgeBot({ items: [['blaze_rod', 5]] });
  rods._wayIn = { cells: [] };
  // Neither refuses the first ridge cell once it is the way in; the rods' price is off the way in only.
  walkOut.noteCell(rods._wayIn, { x: 2, y: 60, z: 3 });
  const cost = (bot, x) => bot.pathfinder.movements.getNeighbors({ x: 1, y: 60, z: 3, remainingBlocks: 0 }).find(n => n.x === x && n.z === 3)?.cost;
  assert.equal(cost(rods, 2), cost(plain, 2), 'on the way in: no rod price');
  const offWay = ridgeBot({ items: [['blaze_rod', 5]] });
  offWay._wayIn = { cells: [] };
  // The wide ground's own edge cell (1, 60, 0): beside the drop into the lava, off the way in.
  const n = offWay.pathfinder.movements.getNeighbors({ x: 1, y: 60, z: 1, remainingBlocks: 0 }).find(m => m.x === 1 && m.z === 0);
  const m = plain.pathfinder.movements.getNeighbors({ x: 1, y: 60, z: 1, remainingBlocks: 0 }).find(q => q.x === 1 && q.z === 0);
  assert(!n, 'the edge over lava is refused off the way in with rods');
  assert(m, 'and walked without');
});

test('the way in: cells stood on, loops cut, and the way back from the nearest cell to where it began (note 762)', () => {
  const trail = { cells: [] };
  const walk = [[0, 60, 0], [1, 60, 0], [2, 60, 0], [2, 60, 1], [2, 60, 2], [3, 60, 2], [2, 60, 2], [2, 60, 3], [2, 60, 4]];
  for (const [x, y, z] of walk) walkOut.noteCell(trail, { x, y, z });
  // Back at (2, 60, 2): the step out to (3, 60, 2) and back is cut.
  assert.deepEqual(trail.cells, [[0, 60, 0], [1, 60, 0], [2, 60, 0], [2, 60, 1], [2, 60, 2], [2, 60, 3], [2, 60, 4]]);
  assert.equal(JSON.stringify(trail), JSON.stringify({ cells: trail.cells, at: trail.at }), 'the index is not saved');
  const way = walkOut.backTrail(trail, new Vec3(2.5, 60, 4.5), { x: 0, y: 60, z: 0 });
  assert.deepEqual(way.cells.map(c => [c.x, c.y, c.z]), [...trail.cells].reverse());
  assert.equal(way.reaches, true);
  assert.deepEqual(walkOut.backTrail(trail, new Vec3(40, 60, 40), null).cells, [], 'none within eight blocks: not known from here');
  // Kept in the Nether only.
  const bot = { game: { dimension: 'the_nether' }, entity: { position: new Vec3(5.5, 60, 5.5), onGround: true } }, goal = {};
  walkOut.noteWayIn(bot, goal);
  assert.deepEqual(goal.wayIn.cells, [[5, 60, 5]]);
  bot.game.dimension = 'overworld'; walkOut.noteWayIn(bot, goal);
  assert.equal(goal.wayIn, undefined, 'dropped out of the Nether');
});

// The walk back to a remembered portal, 60 blocks off across open air, the
// way in kept along a ledge: a bot in a stub world whose pathfinder moves
// it to each leg's goal.
function walkBackBot({ rods = 7, fail = false } = {}) {
  const registry = require('minecraft-data')('26.1');
  const items = [{ name: 'iron_pickaxe', count: 1, type: registry.itemsByName.iron_pickaxe.id }, { name: 'netherrack', count: 64, type: registry.itemsByName.netherrack.id }];
  if (rods) items.push({ name: 'blaze_rod', count: rods, type: registry.itemsByName.blaze_rod.id });
  const legs = [];
  const bot = Object.assign(new EventEmitter(), { registry, entity: { position: new Vec3(60.5, 70, 0.5), isInWater: false, onGround: true }, game: { dimension: 'the_nether', gameMode: 'survival' }, oxygenLevel: 20,
    health: 20, food: 20, entities: {}, world: { raycast: () => null },
    inventory: { items: () => items },
    // The portal's sheet, seen once the walk is within sixteen of it (a portal with no sheet is lit again: note 896).
    findBlocks: () => (bot.entity.position.x <= 16 ? [new Vec3(0, 70, 0)] : []),
    blockAt: p => { const name = p.y <= 31 ? 'lava' : p.y === 69 && p.z === 0 && p.x >= 0 && p.x <= 60 ? 'netherrack' : 'air'; return { name, boundingBox: name === 'netherrack' ? 'block' : 'empty', diggable: true, position: p }; },
    clearControlStates() {}, getControlState() { return false; }, setControlState() {}, stopDigging() {} });
  bot.pathfinder = { movements: {}, setGoal() {}, isMoving: () => false,
    goto: async g => { legs.push({ x: g.x, y: g.y, z: g.z }); if (fail) throw Object.assign(new Error('No path'), { name: 'NoPath' }); bot.entity.position = new Vec3(g.x + 0.5, g.y, g.z + 0.5); } };
  const goal = { survival: {}, portals: [{ x: 0, y: 70, z: 0, dimension: 'nether' }], wayIn: { cells: [] } };
  for (let x = 0; x <= 60; x++) walkOut.noteCell(goal.wayIn, { x, y: 70, z: 0 });
  return { bot, goal, legs };
}

test('with rods the walk to the portal goes back along the way in, in legs of twelve cells, and no crossing is begun (note 762)', async () => {
  const { returnFromNether } = require('../src/work');
  const { bot, goal, legs } = walkBackBot();
  const task = new Task('back');
  task.opportunityClient = { systemOne: async () => { throw new Error('nothing is asked'); } };
  await returnFromNether(bot, task, goal, () => {});
  assert(legs.length >= 5, `legs: ${legs.length}`);
  assert.deepEqual(legs.slice(0, 5).map(l => l.x), [48, 36, 24, 12, 0], 'along the way in, twelve cells a leg, toward where it came in');
  assert(legs.every(l => l.y === 70 && l.z === 0), 'every leg to a cell of the way');
  assert.notEqual(goal.step?.action, 'cross_toward', 'no crossing');
});

test('with rods and the way in stopped, portal_way is asked with what a death costs, the ways off it said as fresh ground, and the crossing offered not taken (note 762)', async () => {
  const { returnFromNether } = require('../src/work');
  const { bot, goal } = walkBackBot({ fail: true });
  const task = new Task('back'), asked = [];
  task.opportunityClient = { systemOne: async ({ state, questions }) => { asked.push({ state, options: questions.branch_0.criteria }); return { answers: { branch_0: { choice: 'around_left', confidence: 0.9 } } }; } };
  await returnFromNether(bot, task, goal, () => {});
  assert.equal(asked.length, 1, 'portal_way asked');
  const { state, options } = asked[0];
  assert.equal(state.walk, 'back the way it came in: 0 cells walked, then No path', 'asked on the way\'s stop, no crossing begun first');
  assert.match(state.rodsOnTheWalk, /^On the walk out with 7 blaze rods: a fall or a step into lava loses every one \(a death drops them where the bot falls, and in lava they burn\)\. While rods are carried the walk takes no drop of more than 2, no cell with lava beside the feet or the head, and off the way in no cell beside a drop into lava or at the lava's edge\.$/);
  assert(!options.the_way_in, 'the way in rests after its stop');
  for (const k of ['around_left', 'around_right']) assert.match(options[k], /Fresh ground, not the way the bot came in: with 7 blaze rods carried, a fall or lava on it loses every one\.$/);
});

test('with rods and the walks failed, the way is asked at once, the tunnel home among its answers, before any staircase (note 902)', async () => {
  const { returnFromNether } = require('../src/work');
  const { bot, goal } = walkBackBot({ fail: true });
  // The way in rests from a stop before: the legs on foot are what fail now.
  require('../src/progress').setAside(goal, 'way_in', { x: 0, y: 70, z: 0 }, 'the way back along it stopped', 120000);
  const task = new Task('back'), asked = [];
  task.opportunityClient = { systemOne: async ({ questions }) => { asked.push(questions.branch_0.criteria); return { answers: { branch_0: { choice: 'around_left', confidence: 0.9 } } }; } };
  await returnFromNether(bot, task, goal, () => {}).catch(() => {});
  assert.equal(asked.length, 1, 'portal_way asked');
  assert.ok(asked[0].tunnel_home, Object.keys(asked[0]).join(','));
  assert.notEqual(goal.step?.action, 'tunnel', 'no staircase round first');
});

test('without rods the walk to the portal is as before: no way in walked (note 762)', async () => {
  const { returnFromNether } = require('../src/work');
  const { bot, goal, legs } = walkBackBot({ rods: 0 });
  const task = new Task('back');
  task.opportunityClient = { systemOne: async () => ({ answers: { branch_0: { choice: 'around_left', confidence: 0.9 } } }) };
  await returnFromNether(bot, task, goal, () => {}).catch(() => {});
  assert(!legs.some(l => l.x === 48 && l.y === 70), 'no leg along the way in');
});

test('portal_way offers the_way_in with its cells, spans and edges said, where rods are carried and a way is kept near (note 762)', () => {
  const { bot, goal } = walkBackBot();
  const way = walkOut.backTrail(goal.wayIn, bot.entity.position, { x: 0, y: 70, z: 0 });
  const says = walkOut.wayBackSays(bot, way, walkOut.wayFacts(bot, way));
  assert.match(says, /^Back the way it came in: 61 cells it stood on before, from the nearest, 0 blocks off, to the portal it came in by, about 60 blocks, walked by the pathfinder in legs of 12 cells along them\. 0 of them have lava round them and 61 are beside a drop into lava or of four or more; walked before, crouched on the edges\.$/);
});

test('with rods the portal made for is the one the way in began at, where remembered: 25588 made for one 114 blocks off with its way in from another (note 762)', async () => {
  const { returnFromNether } = require('../src/work');
  const { bot, goal, legs } = walkBackBot();
  // A nearer portal remembered too, off the way in.
  goal.portals.unshift({ x: 70, y: 70, z: 30, dimension: 'nether' });
  const task = new Task('back');
  task.opportunityClient = { systemOne: async () => { throw new Error('nothing is asked'); } };
  await returnFromNether(bot, task, goal, () => {});
  assert.deepEqual(goal.step.portal, { x: 0, y: 70, z: 0 });
  assert.equal(legs[0].x, 48);
});
