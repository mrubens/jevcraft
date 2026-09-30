'use strict';
// Note 751: the fortress search's ground and its pickaxes as a budget.
const test = require('node:test'), assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { Task } = require('../src/skills');
const coverage = require('../src/nether-coverage');

const stack = (name, count = 1, extra = {}) => ({ name, count, type: registry.itemsByName[name].id, ...extra });
// A Nether with a netherrack floor at y 56, open air above it, and lava
// where `lava` says (at the body's height); `items` carried.
function world(position, { lava = () => false, items = [stack('netherrack', 64)] } = {}) {
  const at = p => {
    const q = p.floored ? p.floored() : p;
    const name = q.y <= 56 ? 'netherrack' : q.y <= 60 && lava(q) ? 'lava' : q.y <= 70 ? 'air' : 'netherrack';
    return { name, boundingBox: name === 'netherrack' ? 'block' : 'empty', diggable: name === 'netherrack', position: q, digTime: () => 400 };
  };
  return { registry, game: { dimension: 'the_nether', gameMode: 'survival' }, health: 20, food: 20, entity: { position }, entities: {},
    world: { raycast: () => null }, inventory: { items: () => items }, findBlocks: () => [], chat() {}, blockAt: at };
}

test('raw iron with a furnace and fuel carried is an iron pickaxe, not a wooden one: 25593 made nineteen wooden ones carrying 15 raw iron, two furnaces and 150 coal', () => {
  const { bestMakeable } = require('../src/mob-hunt');
  const { makeable, smeltableIron } = require('../src/pickaxe-budget');
  const { woodWanted } = require('../src/nether-wood');
  const items = [stack('raw_iron', 15), stack('furnace', 2), stack('coal', 150), stack('stick', 2), stack('crafting_table'), stack('crimson_planks', 5)];
  const bot = world(new Vec3(0.5, 57, 0.5), { items });
  assert.equal(smeltableIron(bot).ingots, 15);
  const pick = bestMakeable(bot);
  assert.equal(pick.item, 'iron_pickaxe');
  assert(pick.smelted);
  assert.match(pick.from, /^3 of the 15 raw iron, smelted in the furnace carried with the coal carried/);
  assert.equal(makeable(bot).kinds[0], 'iron_pickaxe');
  // The stems fetched are for an iron one too.
  assert.match(woodWanted(bot).says, /iron, from the raw iron carried, smelted in the furnace carried/);
  // No furnace, or no fuel: the planks make a wooden one, as before.
  const noFurnace = world(new Vec3(0.5, 57, 0.5), { items: items.filter(i => i.name !== 'furnace') });
  assert.equal(bestMakeable(noFurnace).item, 'wooden_pickaxe');
  const noFuel = world(new Vec3(0.5, 57, 0.5), { items: items.filter(i => i.name !== 'coal') });
  assert.equal(bestMakeable(noFuel).item, 'wooden_pickaxe');
  // One plank short of the sticks: short of wood, then an iron one.
  const short = world(new Vec3(0.5, 57, 0.5), { items: [stack('raw_iron', 15), stack('furnace', 2), stack('coal', 150), stack('crafting_table'), stack('crimson_planks', 1)] });
  const none = bestMakeable(short);
  assert(none.none);
  assert.match(none.short.then, /iron pickaxe from the 15 raw iron/);
});

test('the pickaxe as a budget: the uses carried against what this search\'s legs spent, or the record\'s, and what the pockets make next', () => {
  const b = require('../src/pickaxe-budget');
  const max = registry.itemsByName.wooden_pickaxe.maxDurability;
  const items = [stack('wooden_pickaxe', 1, { durabilityUsed: max - 40 }), stack('raw_iron', 6), stack('furnace'), stack('coal', 10), stack('stick', 4), stack('crafting_table')];
  const bot = world(new Vec3(0.5, 57, 0.5), { items });
  const state = {};
  assert.match(b.legBudgetSays(bot, state), /^40 pickaxe uses carried \(wooden pickaxe 40\); the fortress search's legs have spent about 26 uses a leg in the record .*: at that the uses carried last about 1\.5 legs\. The pockets make an iron pickaxe next .*about 250 uses\. Iron for 2 iron pickaxes is carried/);
  // Its own legs, once kept.
  b.noteLegWear(bot, state);
  items[0].durabilityUsed = max - 30; b.noteLegWear(bot, state);
  items[0].durabilityUsed = max - 10; b.noteLegWear(bot, state);
  assert.deepEqual(state.legWear, [10, 20]);
  assert.match(b.legBudgetSays(bot, state), /this search's last 2 legs spent 10, 20 uses \(about 15 a leg\): at that the uses carried last about 0\.7 legs/);
  // A pickaxe made meanwhile makes the leg's spend unknown: not kept.
  items[0].durabilityUsed = 0; b.noteLegWear(bot, state);
  assert.deepEqual(state.legWear, [10, 20]);
});

test('open air already stood on opens nothing: the leg back over the one just walked is said to open none of the unseen ground beside it (25593 at 11:12:33Z)', () => {
  const bot = world(new Vec3(0.5, 57, 0.5));
  const state = {};
  const c = coverage.coverageOf(state, 'nether');
  // The line south stood on for all its length, nothing seen.
  const mark = (x, z) => { const cx = Math.floor(x / 4), cz = Math.floor(z / 4), k = `${cx >> 2},${cz >> 2}`; c.stood[k] = (c.stood[k] || 0) | (1 << ((cx & 3) + 4 * (cz & 3))); };
  for (let z = 0; z <= 96; z++) mark(0.5, z);
  const back = coverage.headingCoverage(state, 'nether', bot.entity.position, [0, 1], { bot });
  assert.equal(back.openCells, 0);
  assert(back.openAll > 80);
  assert.equal(back.unseenInView, 0);
  assert.match(coverage.headingSays(back, 'south'), /it opens none of it: its \d+ blocks in open air have all been stood on/);
  const fresh = coverage.headingCoverage(state, 'nether', bot.entity.position, [1, 0], { bot });
  assert(fresh.unseenInView > 0);
  assert.match(coverage.headingSays(fresh, 'east'), /it opens about \d+ new columns of 4 by 4/);
  // What it opens in a region holding a bastion is said apart.
  const regions = require('../src/nether-regions');
  const barren = regions.barrenAt([{ kind: 'bastion', dimension: 'the_nether', x: 100, y: 60, z: 100 }]);
  const east = coverage.headingCoverage(state, 'nether', bot.entity.position, [1, 0], { bot, barren });
  assert(east.barrenInView > 0);
  assert.match(coverage.headingSays(east, 'east'), /lie in a region holding a bastion, where no fortress begins/);
});

test('a heading stopped by lava is offered a way round from a step to the side, and the leg back over the last one comes after the others (25593 at 11:12:33Z)', async () => {
  const { chooseLeg, fortressLegTarget } = require('../src/mob-hunt');
  // Lava at the body's height north of z -10, from x -40 to 5.
  const lava = p => p.z <= -10 && p.z >= -40 && p.x >= -40 && p.x <= 5;
  const bot = world(new Vec3(0.5, 57, 0.5), { lava });
  // The last leg came north from z 67: south is back over it.
  const state = { legs: 3, heading: 3, lastHeading: 3, legFrom: { x: 0, z: 67 }, since: Date.now() - 60000, origin: { x: 0, z: 200 } };
  const goal = { fortressSearch: state };
  const asked = [];
  const client = { systemOne: async ({ questions }) => { asked.push(questions.branch_0.criteria); return { answers: { branch_0: { choice: 'round_north', confidence: 0.9 } } }; } };
  const chosen = await chooseLeg(bot, new Task('hunt'), goal, () => {}, { client, navigate: async () => {}, tunnel: async () => {} }, state);
  assert.equal(chosen, true);
  const options = asked[0];
  assert.match(options.round_north, /Go round what stops the line north \(lava in the way at cell 9\): 8 blocks east first \(8 open, about \d+ seconds\), then north 96 blocks from there, a line 8 blocks east of this heading's: Go north 96 blocks at y 57: of the 96 cells ahead, 96 of open air/);
  assert.match(options.round_north, /Its line goes 96 cells before anything stops it, against 9 for the straight one/);
  assert(!options.round_south && !options.round_east, 'only a heading stopped short');
  // The way back is last among the legs, said as such.
  const keys = Object.keys(options).filter(k => /^(leg|round)_/.test(k));
  assert.equal(keys.at(-1), 'leg_south');
  assert.match(options.leg_south, /Back over the last leg's own line/);
  // Taken: the leg's end is 8 blocks east of the straight one's, and the step is walked first.
  assert.equal(state.legMode, 'round');
  assert.deepEqual(state.sidestep, { x: 8, y: 57, z: 0, key: 'round_north' });
  const end = fortressLegTarget(state, bot.entity.position);
  assert.deepEqual([end.x, end.z], [9, -95]);
});

test('a fetch digs what is already in reach, and a gathering leg says it was walked for nothing (25591 on its islet, 25595 between two walls)', async () => {
  const { netherGather, noteEnd } = require('../src/nether-gather');
  const items = [stack('wooden_pickaxe'), stack('netherrack', 0)].filter(i => i.count);
  const bot = world(new Vec3(0.5, 57, 0.5), { items });
  // Netherrack blocks round the bot to dig: findBlocks finds the floor about.
  bot.findBlocks = ({ maxDistance }) => { const out = []; for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) out.push(new Vec3(x, 56, z)); return out.filter(p => p.distanceTo(bot.entity.position) <= maxDistance); };
  const goal = { fortressSearch: {} };
  // The last leg east ended 17 blocks ahead a few seconds ago.
  noteEnd(goal, 'leg_east', { x: 17, y: 57, z: 0 }, 'netherrack with lava or water behind it (not dug)');
  let asked = null, mined = 0;
  const client = { systemOne: async ({ questions, state }) => { asked = { options: questions.branch_0.criteria, state }; return { answers: { branch_0: { choice: 'dig_in_reach', confidence: 0.9 } } }; } };
  const task = new Task('gather'); task.opportunityClient = client;
  await netherGather(bot, task, goal, () => {}, 'netherrack', { navigate: async () => {}, mineAt: async () => { mined++; items.push(stack('netherrack', 1)); } }).catch(() => {});
  assert(asked, 'asked');
  assert.match(asked.options.dig_in_reach, /^Dig the netherrack within reach here: \d+ netherrack, the nearest \d+ blocks off at .*, with the wooden pickaxe\. 0 netherracks carried now\./);
  assert(mined > 0, 'dug where it lies');
  assert.match(asked.options.leg_east, /The last leg east ended \d+ seconds? ago at \(17, 57, 0\), 17 blocks ahead \(netherrack with lava or water behind it \(not dug\)\): walked again from here it meets the same/);
  // No pickaxe: nothing dug by hand drops, so none is offered.
  const bare = world(new Vec3(0.5, 57, 0.5), { items: [] });
  bare.findBlocks = bot.findBlocks;
  let bareAsked = null;
  const client2 = { systemOne: async ({ questions, state }) => { bareAsked = { options: questions.branch_0.criteria, state }; return { answers: { branch_0: { choice: Object.keys(questions.branch_0.criteria)[0], confidence: 0.9 } } }; } };
  const task2 = new Task('gather'); task2.opportunityClient = client2;
  await netherGather(bare, task2, { fortressSearch: {} }, () => {}, 'netherrack', { navigate: async () => {}, mineAt: async () => {} }).catch(() => {});
  assert(bareAsked && !bareAsked.options.dig_in_reach);
  assert.match(bareAsked.state.withNeither, /^No pickaxe and no block carried/);
});
