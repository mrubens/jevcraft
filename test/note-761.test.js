'use strict';
// Note 761: food work well above need, and a crafting table refused in the
// same cell again and again (critic, 2026-09-30 17:20Z).
//   (a) 25588 (mid-241-ce, 17:08 to 17:16Z) gave the turn to food 14 times at
//       hunger 12 to 13, told "Hunger 13 of 20: no hunger to meet", climbed
//       from y -9 to 103 over its own nether-food step, and at 17:16:26, back
//       at hunger 18 with a beef carried, was still sent after a cow. 25592
//       flipped between the cook and the walk home at hunger 19.
//   (b) 25595 (mid-243-ke, 17:09Z) stood 0.008 of a block into the cell
//       beside it and was refused its crafting table there, the same cell
//       picked each pass; later (17:39 to 17:53Z) a firefly bush's cell.
//   (c) 25581 (12:32Z) chose return_for_food at hunger 18 in the Nether with
//       nothing carried: the stay's own question, not a food errand met.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { Task } = require('../src/skills');

const stack = (name, count = 1) => ({ name, count, type: registry.itemsByName[name]?.id ?? 0 });
// The ground at y 64 open to the sky, or (underground) rock all round a
// two-high cell at y 14.
function foodBot({ items = [], food = 20, health = 20, underground = false, position } = {}) {
  const inv = items.map(i => Array.isArray(i) ? stack(...i) : stack(i));
  const at = position || (underground ? new Vec3(-203.5, 14, -511.5) : new Vec3(-259.5, 96, -500.5));
  const floorY = Math.floor(at.y);
  const blockAt = p => {
    const f = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
    const solid = underground ? !(f.x === Math.floor(at.x) && f.z === Math.floor(at.z) && (f.y === floorY || f.y === floorY + 1)) : f.y < floorY;
    const name = solid ? (underground ? 'stone' : 'grass_block') : 'air';
    return { name, position: f, boundingBox: solid ? 'block' : 'empty', hardness: registry.blocksByName[name]?.hardness };
  };
  return Object.assign(new EventEmitter(), { registry, version: '26.1', health, food, oxygenLevel: 20,
    game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, time: { timeOfDay: 4746, age: 200000 },
    entity: { position: at, onGround: true, height: 1.8, width: 0.6, velocity: new Vec3(0, 0, 0) }, entities: {},
    inventory: { items: () => inv, slots: {} }, heldItem: null, pathfinder: { movements: {}, setGoal() {}, getPathTo: () => ({ status: 'noPath', path: [] }) },
    world: { raycast: () => null }, blockAt, findBlocks: () => [], chat() {} });
}
const netherGoal = () => ({ kind: 'win', request: 'beat the game', preparingNether: true, stockFood: true, gameProgress: { phase: 'nether_food' } });

test('met: hunger eighteen or more with food carried; not met with nothing carried or under eighteen', () => {
  const fe = require('../src/food-errand');
  assert.equal(fe.met({ food: 18 }, 3), true, '25588 at 17:16:26: hunger 18, a beef');
  assert.equal(fe.met({ food: 19 }, 10), true, '25592: hunger 19, 10 points');
  assert.equal(fe.met({ food: 18 }, 0), false, '25581 in the Nether: nothing carried (c)');
  assert.equal(fe.met({ food: 13 }, 40), false);
});

test('the hunger is said against what health needs and what the food carried covers, never "no hunger to meet" under eighteen', () => {
  const fe = require('../src/food-errand');
  const bot = foodBot({ food: 13, health: 18.08, underground: true });
  const says = fe.says(bot, netherGoal(), { supply: 0, desired: 80, hungry: false });
  assert.doesNotMatch(says, /no hunger to meet/i);
  assert.match(says, /^Get food\. Hunger 13, under eighteen: health does not come back until it is eaten back to eighteen, 5 points short; nothing carried covers any of it\. This is for the hunger and the reserve\. 0 food points carried of the 80 kept for the Nether stay/);
  assert.match(fe.hungerSays({ food: 12 }, 3), /^Hunger 12, under eighteen: .*6 points short; the 3 food points carried cover 3 of them\.$/);
  assert.match(fe.hungerSays({ food: 18 }, 3), /^Hunger 18: health comes back; the 3 points carried are eaten as it falls\.$/);
});

test('the errand counts the blocks it climbed and says them (25588: y -9 to 103)', () => {
  const fe = require('../src/food-errand');
  const holder = {}, t0 = Date.parse('2026-09-30T17:08:50Z');
  const ys = [[-9, 0], [-3, 26], [14, 224], [32, 279], [53, 315], [77, 370], [103, 430]];
  let e;
  for (const [y, s] of ys) e = fe.track(holder, { supply: 0, desired: 80, now: t0 + s * 1000, y, dimension: 'overworld' });
  assert.equal(e.climbed, 112);
  assert.match(fe.yieldSays(e, 0, t0 + 430000), /^ This errand so far: 7 minutes, asked 7 times, 112 blocks climbed, 0 points carried at its start and 0 now\.$/);
  assert.match(fe.costSays(e, t0 + 430000), /^the food errand so far: 7 minutes, asked 7 times, 112 blocks climbed, 0 points carried at its start$/);
  // A change of dimension is not a climb.
  const h2 = {};
  fe.track(h2, { supply: 0, desired: 80, now: t0, y: 40, dimension: 'the_nether' });
  assert.equal(fe.track(h2, { supply: 0, desired: 80, now: t0 + 1000, y: 70, dimension: 'overworld' }).climbed, 0);
});

test('25588 at 17:12:33: the survival claim says the hunger against health, what is carried, the errand\'s climb and that the work is the food already', () => {
  const { claim } = require('../src/survival');
  const { claimSays } = require('../src/arbiter');
  const bot = foodBot({ food: 13, health: 18.08, underground: true });
  const t0 = Date.now();
  const survival = { state: { foodErrand: { since: t0 - 4 * 60000, start: 0, best: 0, asks: 5, desired: 80, window: { since: t0 - 60000, start: 0 }, climbed: 23, lastAt: t0 - 20000 } } };
  const c = claim(bot, netherGoal(), survival);
  assert.equal(c?.action, 'obtain_food', JSON.stringify(c));
  assert.equal(c.facts.foodFor, 'the reserve, with hunger under eighteen');
  const said = claimSays(c);
  assert.match(said, /^Find food for the reserve, with hunger under eighteen: /);
  assert.match(said, /Hunger 13, under eighteen: health does not come back until it is eaten back to eighteen, 5 points short; nothing carried covers any of it\. 0 food points carried of 80 wanted\./);
  assert.match(said, /The food errand so far: 4 minutes, asked 5 times, 23 blocks climbed, 0 points carried at its start\./);
  assert.match(said, /The work's own step now is the food for the Nether \(the food step, which asks where it comes from\): given the turn, this takes it from that step to a search of its own\./);
  assert.doesNotMatch(said, /It does not come back at hunger 13\. .*It does not come back/);
});

test('25588 at 17:16:26: back at hunger 18 with a beef carried, the errand ends and neither the claim nor the question comes back', async () => {
  const { claim, Survival } = require('../src/survival');
  const bot = foodBot({ items: ['iron_sword', ['beef', 1]], food: 18, health: 18.08 });
  const goal = netherGoal();
  assert.equal(claim(bot, goal, { state: {} }), null, 'no survival claim for the reserve at 18 with food carried');
  const survival = new Survival(bot, { navigate: async () => {}, dig: async () => {}, place: async () => {}, explore: async () => {} }, { client: { systemOne: async () => ({}) } });
  const reports = [];
  survival.report = (g, save, r) => reports.push(r);
  survival.state.foodErrand = { since: Date.now() - 8 * 60000, start: 0, best: 3, asks: 14, desired: 80, window: { since: Date.now() - 60000, start: 0 }, climbed: 112, lastAt: Date.now() - 10000 };
  let asked = null;
  survival.decide = async (task, g, save, q) => { asked = q; return { path: [Object.keys(q.tree)[0]], action: { run: async () => {} }, stale: false }; };
  await survival.step(new Task('t', 'food'), goal, () => {});
  assert(!asked?.tree?.obtain_food, `not asked for food (${asked ? Object.keys(asked.tree) : 'nothing asked'})`);
  assert.equal(survival.state.foodErrand, undefined, 'the errand ended');
  const met = reports.find(r => r.action === 'food_errand_met');
  assert(met, 'said as met');
  assert.equal(met.climbed, 112);
});

test('25592: hunger 19 with 10 points carried is not a food question (no cook or walk home to flip between)', async () => {
  const { Survival, claim } = require('../src/survival');
  const bot = foodBot({ items: [['mutton', 2], ['cooked_mutton', 1]], food: 19, health: 20 });
  const goal = { kind: 'win', request: 'beat the game', preparingNether: true, stockFood: true };
  assert.equal(claim(bot, goal, { state: {} }), null);
  const survival = new Survival(bot, { navigate: async () => {}, dig: async () => {}, place: async () => {}, explore: async () => {} }, { client: { systemOne: async () => ({}) } });
  let asked = null;
  survival.decide = async (task, g, save, q) => { asked = q; return { path: [Object.keys(q.tree)[0]], action: { run: async () => {} }, stale: false }; };
  await survival.step(new Task('t', 'food'), goal, () => {});
  assert(!asked?.tree?.obtain_food);
});

// A Nether floor of netherrack at y 42, air above: 25595 at (417.708, 43,
// 27.3), the cell east of its feet (418, 43, 27) 0.008 into its body.
function tableBot({ position = new Vec3(417.7083072910485, 43, 27.30000001192093), refuse = () => false, cover = {} } = {}) {
  const Chunk = require('prismarine-chunk')(registry), World = require('prismarine-world')(registry);
  const world = new World(() => new Chunk()).sync;
  for (let cx = 25; cx <= 26; cx++) for (let cz = 1; cz <= 2; cz++) world.setColumn(cx, cz, new Chunk());
  const set = (p, name) => world.setBlockStateId(p, registry.blocksByName[name].defaultState);
  for (let x = 410; x <= 425; x++) for (let z = 20; z <= 35; z++) set(new Vec3(x, 42, z), 'netherrack');
  for (const [k, name] of Object.entries(cover)) set(new Vec3(...k.split(',').map(Number)), name);
  const items = [stack('crafting_table')];
  const placed = [], refused = [];
  const bot = { registry, world, version: '26.1', game: { gameMode: 'survival', dimension: 'the_nether' }, blockAt: p => world.getBlock(p),
    entity: { position, onGround: true, height: 1.8, width: 0.6, eyeHeight: 1.62 },
    inventory: { items: () => items, slots: [] }, heldItem: null, entities: {}, findBlocks: () => [], canDigBlock: () => true,
    equip: async item => { bot.heldItem = item; }, lookAt: async () => {}, look: async () => {}, setControlState() {}, getControlState: () => false, clearControlStates() {}, waitForTicks: async () => {},
    dig: async block => { set(block.position, 'air'); },
    placeBlock: async (reference, face) => {
      const at = reference.position.plus(face);
      // The server's own rule: no block where a body is, by any sliver.
      const b = bot.entity.position;
      const inBody = b.x + 0.3 > at.x && b.x - 0.3 < at.x + 1 && b.z + 0.3 > at.z && b.z - 0.3 < at.z + 1 && b.y + 1.8 > at.y && b.y < at.y + 1;
      const there = world.getBlock(at).name;
      if (inBody || refuse(at) || !['air', 'cave_air', 'short_grass'].includes(there)) { refused.push(at); throw new Error(`Server refused to place crafting_table at ${at}: the block is still ${there}`); }
      set(at, 'crafting_table'); placed.push(at); items.length = 0;
    },
    pathfinder: { movements: {}, setGoal() {}, goto: async () => {}, getPathFromTo: function * () { yield { result: { status: 'success', path: [] } }; } } };
  return { bot, world, placed, refused, set };
}

test('25595: the cell the body reaches into by 0.008 is no place for the table; it goes in a cell clear of the body', async () => {
  const { workstation, stationCellOk } = require('../src/work');
  const { bot, placed, refused } = tableBot();
  const cell = new Vec3(418, 43, 27);
  assert.equal(stationCellOk(bot, {}, cell), false, 'the body is in it');
  const goal = {};
  await workstation(bot, new Task('table'), 'crafting_table', goal).catch(() => {});
  assert.equal(refused.length, 0, `nothing refused (${refused.join(' ')})`);
  assert.equal(placed.length, 1);
  assert(!placed[0].equals(cell));
});

test('a cell the game refuses rests, and the next cell is tried in the same pass, not the same one again', async () => {
  const { workstation } = require('../src/work');
  const { isSetAside } = require('../src/progress');
  // Refused at the first cell picked, for a reason the bot cannot see.
  let first = null;
  const { bot, placed, refused } = tableBot({ position: new Vec3(417.5, 43, 27.5), refuse: at => { first ||= at.clone(); return at.equals(first); } });
  const goal = {};
  await workstation(bot, new Task('table'), 'crafting_table', goal).catch(() => {});
  assert.equal(refused.length, 1);
  assert.equal(placed.length, 1, 'the next cell took it');
  assert(!placed[0].equals(refused[0]));
  assert(isSetAside(goal, 'station_cell', `${refused[0].x},${refused[0].y},${refused[0].z}`), 'the refused cell rests');
});

test('a firefly bush is not ground cover a table replaces: its cell is not picked as open, and a placement there knocks it away first', async () => {
  const { stationCellOk, place } = require('../src/work');
  const { bot, placed, set, world } = tableBot({ position: new Vec3(417.5, 43, 27.5), cover: { '419,43,27': 'firefly_bush' } });
  assert.equal(stationCellOk(bot, {}, new Vec3(419, 43, 27)), false);
  // Knocked away as a flower is: its hardness is 0 and it stops nothing.
  await place(bot, new Task('table'), new Vec3(419, 43, 27), 'crafting_table');
  assert.equal(world.getBlock(new Vec3(419, 43, 27)).name, 'crafting_table');
  assert.equal(placed.length, 1);
  void set;
});
