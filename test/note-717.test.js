'use strict';
// Two ways a fight at a cage's own fortress kept asking or repeating itself
// past what note 700 and 708 already held off, and one meal that starved
// unguarded (item 1 and 2 of the critic's report of 2026-09-30 03:09Z).
//
// (1) 25589 (mid-242-pc-fortress-2, 02:59-03:09Z) stood three blocks from
// the cage at (-106/-107, 75, 158/159) and every short walk failed ("No
// path", six navigation stalls twice, "No measurable progress... distance
// 3.1"): dig_in_at_spawner, box_here and the rest kept recomputing the same
// unreachable stand cell (blaze-stand.js's own walkability model, not the
// real pathfinder's) and offering it again, since nothing remembered the
// failure. Checked here on a copy of that spawner's own ground
// (test/fixtures/spawner-box-25591.json, the same cage at (-108, 77, 155),
// read-only): the real pathfinder finds no route out of the pocket the bot
// stood in, and once a stand cell has just failed to reach, the site search
// picks a different one instead of the same cell again.
//
// (2) 25594 (mid-242-qe) rose into its own box by the cage (nine off by
// note 700's flat eight-block rule), answered stand_by_spawner, and a
// second later was asked fortress_approach and took cross_level toward "the
// fortress, 6 blocks off" while at its own spawner; 25589 said "I'm looking
// for a fortress (leg 6, heading east)" three blocks from the cage. Held
// instead by the fortress's own extent (fortressAnchor's reach), and ending
// the tick once a spawner wait ends rather than falling through into the
// fortress-search code in the same tick.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');

test('site search: a stand or hole cell the real walk just failed at is not offered again (25589, note 717)', () => {
  const { groundBot } = require('./fixtures/saved-ground');
  const fixture = require('./fixtures/spawner-box-25591.json');
  const stand = require('../src/blaze-stand');
  const cage = new Vec3(-108, 77, 155);
  const bot = groundBot(fixture, { at: new Vec3(-107.5, 77, 156.5), items: [['iron_pickaxe', 1], ['iron_sword', 1]], indexed: true });
  const before = stand.spawnerSite(bot, cage);
  assert(before, 'a stand cell is found here');
  stand.noteSiteFailed(bot, before.cell, 'no path');
  const after = stand.spawnerSite(bot, cage);
  assert(!after || !after.cell.equals(before.cell), 'the same cell the walk just failed at is not picked again');
});

test('the real pathfinder finds no way out of the pocket 25589 stood stuck in, three blocks from the cage', () => {
  const { groundBot } = require('./fixtures/saved-ground');
  const fixture = require('./fixtures/spawner-box-25591.json');
  const { goals } = require('mineflayer-pathfinder');
  // The critic's own position, (-106/-107, 75, 158/159): a slot cut into
  // the fortress's south wall at a height below the cage room's own floor,
  // walled by solid rock or brick on every side but the way it came.
  const bot = groundBot(fixture, { at: new Vec3(-106.5, 75, 158.5), items: [['iron_pickaxe', 1], ['iron_sword', 1]] });
  const result = bot.pathfinder.getPathTo(bot.pathfinder.movements, new goals.GoalNear(-107, 77, 156, 0), 3000);
  assert.equal(result.status, 'noPath', 'a real short walk from there finds no route: it is a dead end, not a stall to retry unchanged');
});

// The mob-hunt fortress-extent gate: reused minimal ground from cage-hold-
// 700.test.js's cageWorld, one blaze spawner cage in a hollowed-out room.
const CAGE = new Vec3(-204, 57, -150);
function cageWorld() {
  const cells = new Map();
  for (let x = -220; x <= -188; x++) for (let z = -166; z <= -134; z++) {
    for (let y = 40; y <= 52; y++) cells.set(`${x},${y},${z}`, 'nether_bricks');
    for (let y = 53; y <= 62; y++) cells.set(`${x},${y},${z}`, 'air');
  }
  cells.set(`${CAGE.x},${CAGE.y},${CAGE.z}`, 'spawner');
  const blockAt = p => {
    const f = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
    const name = cells.get(`${f.x},${f.y},${f.z}`) ?? 'netherrack', b = registry.blocksByName[name];
    return { name, position: f, boundingBox: name === 'air' ? 'empty' : 'block', hardness: b?.hardness, harvestTools: b?.harvestTools, type: b?.id };
  };
  return { blockAt };
}
const stack = (name, count = 1) => ({ name, count, type: registry.itemsByName[name]?.id ?? 0 });
function cageBot(position) {
  const w = cageWorld();
  const bot = Object.assign(new EventEmitter(), { registry, version: '26.1', health: 20, food: 19, game: { dimension: 'the_nether', gameMode: 'survival' },
    entity: { position, onGround: true, height: 1.8, velocity: new Vec3(0, 0, 0) }, entities: {}, inventory: { items: () => [stack('iron_sword'), stack('iron_pickaxe')], slots: [] },
    world: { raycast: () => null }, blockAt: w.blockAt, findBlocks: () => [], chat() {} });
  return bot;
}
const rodsGoal = (extra = {}) => ({ kind: 'win', mobHunt: { entity: 'blaze', item: 'blaze_rod', targetCount: 7 }, fortressSearch: { map: { spawners: [{ x: CAGE.x, y: CAGE.y, z: CAGE.z }] } }, ...extra });

test('nine blocks from the cage but within the known fortress\'s own extent, still no visit, approach or leg asked (25594, note 717)', async () => {
  const { findFortressStep } = require('../src/mob-hunt');
  // Risen into a box nine blocks from the cage, as 25594 was.
  const bot = cageBot(new Vec3(CAGE.x + 9, CAGE.y + 1, CAGE.z));
  let asked = 0;
  const task = { check() {}, opportunityClient: { systemOne: async () => { asked++; return { answers: {} }; } } };
  const goal = rodsGoal({ step: { action: 'find_fortress' }, fortressSearch: { map: { spawners: [{ x: CAGE.x, y: CAGE.y, z: CAGE.z }] }, fortressAt: { x: CAGE.x, y: CAGE.y, z: CAGE.z, extent: 24, seenAt: Date.now() } } });
  await findFortressStep(bot, task, goal, () => {}, { navigate: async () => { throw new Error('no walk here'); } });
  assert.equal(asked, 0, 'nothing asked: the fortress-extent gate held, not the flat eight-block one');
  assert.equal(goal.step.action, 'at_spawner');
});

test('a spawner wait that just ended does not fall through into a fortress question the same tick', async () => {
  const { findFortressStep } = require('../src/mob-hunt');
  const bot = cageBot(new Vec3(CAGE.x, CAGE.y, CAGE.z + 3));
  let asked = 0;
  const task = { check() {}, opportunityClient: { systemOne: async () => { asked++; return { answers: {} }; } } };
  const goal = rodsGoal({ step: { action: 'wait_at_spawner' }, fortressSearch: { map: { spawners: [{ x: CAGE.x, y: CAGE.y, z: CAGE.z }] },
    spawnerWait: { x: CAGE.x, y: CAGE.y, z: CAGE.z, until: Date.now() - 1, chosen: 'empty_spawner', startedAt: Date.now() - 60000 } } });
  await findFortressStep(bot, task, goal, () => {}, { navigate: async () => { throw new Error('no walk here'); } });
  assert.equal(asked, 0, 'the wait ending ends the tick; nothing about a fortress is asked in the same breath');
  assert.equal(goal.step.action, 'find_fortress');
  assert.equal(goal.fortressSearch.spawnerWait, undefined);
});
