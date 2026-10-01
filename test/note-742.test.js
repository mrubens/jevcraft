'use strict';
// Note 742: items from the live critic's report (artifacts/critic/critic-
// 20260930T0923Z.md, items 3 and 4) and trial note 738 (a cast resumed
// says its progress).
// (a) 25589 (mid-242-xh): cast_at_lava, cast_frame twice, then new_site
// ("Leaving this frame for another spot") on a single navigation failure,
// discarding four of ten already cast and lava already found seven
// blocks off. new_site now says that cost against retrying (src/work.js).
// (b) 25597 (mid-242-xg): a portal cast interrupted twice by one zombie at
// full health led to secure_shelter and seal_here with the zombie never
// named or priced. secure_shelter and continue_request now say the
// weapon carried and armour worn apart (not a false "not armed"), and the
// nearest threat's own fight cost (src/survival.js).
// (c) pocket_next named night_mine and a hunt ahead of leave both times,
// though both already said the same interrupted cast waiting on them:
// leave is now named first among the ways that are not forced by an
// active threat (src/survival.js).
// (d) night_mine_target flipped ore_0/ore_1 after navigation stalls that
// were not counted as a reason to let the ore go (only NoRoute, NoSafeWay
// or a third failure were): a stalled walk now abandons at once too
// (src/survival.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const registry = require('minecraft-data')('26.1');

// --- (a) new_site: what leaving costs against retrying ---

function fakeBot(carried, { at = new Vec3(-13, 76, 136), dimension = 'overworld' } = {}) {
  const items = Object.entries(carried).map(([name, count]) => ({ name, count }));
  return { registry, entities: {}, oxygenLevel: 20, health: 20, food: 20, game: { gameMode: 'survival', dimension }, time: { timeOfDay: 6000 },
    entity: { position: at, height: 1.8, width: 0.6 }, inventory: { items: () => items, slots: [], emptySlotCount: () => 4 },
    findBlocks: () => [], blockAt: p => ({ name: 'stone', position: p.floored?.() || p, boundingBox: 'block', getProperties: () => ({ level: 0 }) }),
    world: { raycast: () => null }, pathfinder: { movements: {}, setGoal() {} }, chat() {}, emit() {}, on() {}, removeListener() {} };
}

test('new_site says the blocks already cast and the lava already found here, against a new site starting with neither, and names a single navigation failure as not the site itself (note 742, 25589)', async () => {
  const { portalMethod } = require('../src/work');
  const { frameCells } = require('../src/ruined-portal');
  const origin = new Vec3(-13, 76, 130);
  const blocks = frameCells(origin, 'x').blocks.map(p => ({ x: p.x, y: p.y, z: p.z }));
  const obsidianAt = new Set(blocks.slice(0, 4).map(p => `${p.x},${p.y},${p.z}`));
  const bot = fakeBot({ lava_bucket: 1, water_bucket: 1, cobblestone: 64 });
  bot.blockAt = p => ({ name: obsidianAt.has(`${p.x},${p.y},${p.z}`) ? 'obsidian' : 'air', position: p.floored?.() || p, boundingBox: 'empty', getProperties: () => ({ level: 0 }) });
  const frame = { origin, axis: 'x', cast: true, castTemp: [], blocks,
    siteFailed: { cast: 4, n: 1, whys: { 'navigation timed out without reaching new ground': 1 } } };
  const goal = { portalFrame: frame, portalMethod: { kind: 'cast', key: 'here_pool_0', lava: { way: 'pool', at: { x: origin.x + 7, y: origin.y, z: origin.z } }, activeMs: 0, reasked: 0, siteFailed: true },
    landmarks: [{ kind: 'lava_pool', dimension: 'overworld', x: origin.x + 7, y: origin.y, z: origin.z }] };
  const task = new Task('nether');
  let offered;
  task.opportunityClient = { systemOne: async ({ questions }) => { offered = questions.branch_0.criteria; return { answers: { branch_0: { choice: 'here_pool_0', confidence: 0.7 } } }; } };
  await portalMethod(bot, task, goal, () => {}).catch(() => {});
  // As a portal plan (note 782), the new site is a route of its own, said with what leaving costs.
  const key = Object.keys(offered || {}).find(k => k.startsWith('new_site_'));
  assert(key, `no new site was offered; options were ${Object.keys(offered || {}).join(', ')}`);
  assert.match(offered[key], /Against retrying: 4 of ten already cast here, its lava already found \d+ blocks off\./);
  assert.match(offered[key], /What failed here once was "navigation timed out without reaching new ground": not the site itself, and a new site meets the same kind of failure no less often\./);
});

// --- (b) secure_shelter and continue_request: the threat said honestly ---

function pocketBotOneZombie({ armour = [] } = {}) {
  // 12 blocks off: near enough to be the pocket's/priority tree's nearest
  // threat, far enough not to trip the body's own immediate-danger reflex
  // (survival.js flee, danger.js immediateThreat, melee cutoff 8 blocks),
  // so the step reaches survival_priority as it did in the real trial once
  // the zombie's own stance had already been answered.
  const zombie = { id: 99, name: 'zombie', position: new Vec3(12, 64, 0), height: 1.95, width: 0.6, isValid: true, metadata: {} };
  const armourSlots = { 5: null, 6: null, 7: null, 8: null };
  ['helmet', 'chestplate', 'leggings', 'boots'].forEach((piece, i) => { if (armour[i]) armourSlots[5 + i] = { name: armour[i] }; });
  return {
    registry, game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' },
    entities: { 99: zombie }, health: 20, food: 20, oxygenLevel: 20, time: { timeOfDay: 13500 },
    entity: { position: new Vec3(0, 64, 0), onGround: true, velocity: new Vec3(0, 0, 0) },
    inventory: { items: () => [{ name: 'iron_sword', count: 1 }], slots: armourSlots, emptySlotCount: () => 10 },
    heldItem: { name: 'iron_sword' },
    // Open sky at and above the bot's own feet (y 64): on the surface, not
    // underground (surfaceObserver looks for the top solid block strictly
    // below where the bot stands), so night forces the shelter question as
    // it did in the real trial.
    blockAt: p => p.y >= 64 ? { name: 'air', boundingBox: 'empty', position: p } : { name: 'stone', boundingBox: 'block', position: p },
    world: { raycast: () => null }, on() {}, once() {}, removeListener() {}, emit() {},
  };
}

async function askPriority(bot) {
  const { Survival } = require('../src/survival');
  const survival = new Survival(bot, {}, { state: {} });
  let tree;
  survival.decide = async (task, goal, save, { id, tree: t }) => {
    if (id !== 'survival_priority') return { path: ['work'], stale: false };
    tree = t;
    return { path: ['continue_request'], stale: false, action: t.continue_request };
  };
  const goal = { kind: 'win', request: 'beat the game', rungTime: { phase: 'reach_nether' } };
  await survival.step(new Task('wait'), goal, () => {});
  return tree;
}

test('continue_request says the weapon carried and armour worn apart, not a false "not armed" for a sword with no armour (note 742, 25597)', async () => {
  const tree = await askPriority(pocketBotOneZombie());
  assert(tree?.continue_request, 'continue_request was offered');
  const d = tree.continue_request.description;
  assert.doesNotMatch(d, /not armed and armoured/, 'a sword carried is not folded into a blanket "not armed"');
  assert.match(d, /it has the iron sword carried, no armour worn/);
});

test('secure_shelter names the nearest threat and what fighting it would cost, not silence on the zombie it is sealing against (note 742, 25597)', async () => {
  const tree = await askPriority(pocketBotOneZombie());
  assert(tree?.secure_shelter, 'secure_shelter was offered');
  const d = tree.secure_shelter.description;
  assert.match(d, /Nearest: a zombie 12 blocks off; fighting it with the iron sword carried, no armour worn is about [\d.]+ seconds and \d+ damage, from 20 health\./);
});

// --- (c) pocket_next: leave named first among the ways not forced by a threat ---

test('pocket_next names leave (the interrupted work) ahead of night_mine, a hunt and the valuables, once an active threat\'s own options are placed (note 742, 25597)', async () => {
  const { Survival } = require('../src/survival');
  const { Vec3: V } = require('vec3');
  const origin = new V(0, 100, 0);
  const zombie = { id: 5, name: 'zombie', position: origin.offset(3, 0, 11), height: 1.95, width: 0.6, isValid: true, metadata: {} };
  const open = new Set([`${origin}`, `${origin.offset(0, 1, 0)}`]);
  const bot = {
    registry, game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' },
    entities: { 5: zombie }, health: 20, food: 20, oxygenLevel: 20, time: { timeOfDay: 13500 },
    entity: { position: origin.offset(0.5, 0, 0.5), onGround: true, velocity: new V(0, 0, 0) },
    inventory: { items: () => [{ name: 'iron_sword', count: 1 }, { name: 'iron_pickaxe', count: 1 }, { name: 'coal', count: 10 }], slots: [], emptySlotCount: () => 10 },
    heldItem: { name: 'iron_sword' },
    blockAt: q => ({ name: open.has(`${q}`) ? 'air' : 'stone', boundingBox: open.has(`${q}`) ? 'empty' : 'block', position: q }),
    world: { raycast: from => ({ intersect: from.offset(0.6, 0, 0) }) }, on() {}, once() {}, removeListener() {}, emit() {},
  };
  const goal = { kind: 'win', request: 'beat the game', rungTime: { phase: 'reach_nether' },
    portalFrame: { origin: { x: 5, y: 100, z: 0 }, blocks: [{ x: 5, y: 100, z: 0 }, { x: 5, y: 101, z: 0 }, { x: 5, y: 102, z: 0 }], axis: 'x' },
    portalMethod: { kind: 'cast' } };
  const survival = new Survival(bot, {}, { state: { shelters: [{ origin: { ...origin }, dimension: 'overworld', emergency: true }],
    stance: { choice: 'seal', ids: [5], mobs: [{ id: 5, name: 'zombie' }], at: Date.now() - 1000 },
    sealing: { origin: { ...origin }, at: Date.now() }, pocketOutAt: Date.now() - 30000 }, client: { systemOne: async () => ({}) } });
  let tree;
  survival.decide = async (task, g, save, { id, tree: t }) => { if (id === 'pocket_next') tree = t; return { path: ['stay'], stale: false }; };
  survival.wait = async () => {};
  await survival.step(new Task('wait'), goal, () => {});
  assert(tree, 'pocket_next was asked');
  const keys = Object.keys(tree);
  assert(keys.includes('leave'), `leave was not offered; options were ${keys.join(', ')}`);
  assert(keys.includes('night_mine'), `night_mine was not offered; options were ${keys.join(', ')}`);
  assert(keys.indexOf('leave') < keys.indexOf('night_mine'), `leave (${keys.indexOf('leave')}) should come before night_mine (${keys.indexOf('night_mine')}): order was ${keys.join(', ')}`);
});

// --- (d) night_mine_target: a stalled walk lets the ore go, not just NoRoute ---

test('an ore whose walk stalls (skills.js NavigationStall) abandons and rests at once, the same as a NoRoute, not only after three failures (note 742, 25597)', async () => {
  const { Survival } = require('../src/survival');
  const { attemptsFor } = require('../src/progress');
  const target = new Vec3(16, 49, 228);
  const bot = {
    game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' },
    entity: { position: target.offset(0, 0, 1) }, health: 20, food: 20, oxygenLevel: 20,
    time: { timeOfDay: 6000 }, entities: {}, world: { raycast: () => null },
    inventory: { items: () => [{ name: 'iron_pickaxe', count: 1 }] },
    blockAt: p => ({ position: p, name: (p.x === target.x && p.y === target.y && p.z === target.z) ? 'iron_ore' : 'stone', boundingBox: 'block' }),
    on() {}, once() {}, removeListener() {}, emit() {},
  };
  const controller = new Survival(bot, {}, { state: {} });
  controller.canNightMine = () => true;
  controller.actions.dig = async () => { throw new Error('navigation timed out without reaching new ground'); };
  const mine = controller.state.nightMine = { startedAt: Date.now(), origin: { x: 0, y: 49, z: 0 }, heading: 0, failures: 0, mined: 0,
    target: { x: target.x, y: target.y, z: target.z }, targetOre: 'iron_ore' };
  await controller.nightMine({ check() {} }, {}, () => {});
  assert.equal(mine.target, undefined, 'the target is abandoned after the first stall, not after three failures');
  assert.equal(mine.failures, 0, 'abandoning clears the failure count, as the other give-up reasons do');
  assert(attemptsFor(controller).resting('night_mine', target), 'the ore now rests: it is not re-offered as ore_0 while it does');
});
