'use strict';
// Note 755: sealing in without a reason, then undoing it; and trips that do
// not know what the next step needs.
// (a) 25594 (12:18:55Z) chose secure_shelter, then seal_here, at health 20
// and hunger 18 under the rock, the skeletons about all out of sight, told
// "before hostile mobs spawn at night"; eight seconds later pocket_next chose
// night_mine. 25585 (11:48Z) sealed the same way. Every way that seals now
// opens with its reason (seal-reason.js) or says none holds, with what it
// costs; the turn is routine for it under the rock with none; a way out of
// the pocket within a minute of the seal says it undoes it.
// (b) 25594 (12:39Z) chose saved_shelter in a geode and logged no_route five
// times in forty seconds: a walk that finds no route sets it aside.
// (c) 25584 (12:13Z) chose travel_river with its step's three raw iron three
// blocks off and no empty bucket, told "an empty one fills at any water":
// the stall's travel options say the job in hand and how far their ends are
// from it (job-in-hand.js), and the bucket the water needs.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const registry = require('minecraft-data')('26.1');
const seal = require('../src/seal-reason');
const job = require('../src/job-in-hand');

// --- the rule ---

test('no reason to seal is said plainly: full health, nothing in sight or near, underground where the night changes nothing, and the sleep owed not paid in a pocket (note 755, 25594)', () => {
  const why = seal.sealReason({ health: 20, food: 18, underground: true, night: true, minutesToDawn: 8, sleepDebt: true,
    hostiles: [20, 21, 22].map(d => ({ name: 'skeleton', distance: d, visible: false })) });
  assert.equal(why.none, true);
  assert.match(why.says, /^No reason to seal: health 20 of 20, nothing hostile in sight within 24 blocks \(3 heard, out of sight, none within 8 and none coming at the bot\), underground, where the night changes nothing/);
  assert.match(why.says, /The sleep owed is not paid in a pocket: only a bed pays it, and phantoms come only to a player under open sky\./);
});

test('a reason is said first: the mob in sight, one heard within eight, the surface\'s night, health to get back', () => {
  assert.match(seal.sealReason({ underground: true, night: true, hostiles: [{ name: 'zombie', distance: 12, visible: true }] }).says, /^Sealing against the zombie 12 blocks off, in sight\./);
  assert.match(seal.sealReason({ underground: true, hostiles: [{ name: 'spider', distance: 6, visible: false }] }).says, /^Sealing against the spider 6 blocks off, heard, out of sight\./);
  assert.match(seal.sealReason({ underground: false, night: true, minutesToDawn: 9 }).says, /^Sealing for the night on the surface: mobs spawn in the open until dawn, about 9 real minutes off\./);
  assert.match(seal.sealReason({ health: 14, food: 19, underground: true }).says, /^Sealing to heal out of reach: health 14 of 20 comes back at hunger 19, about 24 seconds to full\./);
  assert.match(seal.sealReason({ health: 6, food: 12, underground: true }).says, /^Sealing to keep health 6 of 20 from being lost while it does not come back \(hunger 12, under eighteen\)\./);
});

test('what sealing costs, and this bot\'s own last seals with no reason, what followed them', () => {
  const state = {};
  const none = seal.sealReason({ underground: true, night: true });
  const t0 = 1_000_000;
  for (const [next, after] of [['night_mine', 8], ['night_mine', 12], ['leave', 30], ['stay', 90]]) {
    seal.noteSeal(state, none, { now: t0 });
    if (next === 'stay') { seal.noteAfter(state, 'stay', t0 + 20000); assert.equal(state.lastSeal.next, undefined, 'a stay inside the minute is not its end yet'); }
    seal.noteAfter(state, next, t0 + after * 1000);
  }
  assert.equal(state.sealLog.length, 4);
  const says = seal.sealCostSays({ blocks: 14, minutesToDawn: 8, waiting: 'the reach nether step', log: state.sealLog, none: true });
  assert.match(says, /^ Sealing costs about 8 seconds of building \(14 blocks\), then up to 8 real minutes sealed to dawn with the reach nether step waiting\./);
  assert.match(says, /Of this bot's last 4 seals with no reason named, 3 were opened again within a minute \(night mine 2, leave 1\)\./);
});

test('a way out chosen within a minute of the seal is said as undoing it; after the minute, or once answered, it is not', () => {
  const state = {};
  seal.noteSeal(state, seal.sealReason({ underground: true }), { now: 1000 });
  assert.equal(seal.reversalSays(state, 9000), 'Undoes the seal chosen 8 seconds ago (with no reason named for it): the pocket is opened again and its building spent for nothing. ');
  assert.equal(seal.reversalSays(state, 1000 + 61000), '');
  seal.noteSeal(state, seal.sealReason({ hostiles: [{ name: 'zombie', distance: 5, visible: true }], underground: true }), { now: 1000 });
  assert.match(seal.reversalSays(state, 5000), /^Undoes the seal chosen 4 seconds ago \(against the zombie 5 blocks off, in sight\)/);
  seal.noteAfter(state, 'leave', 6000);
  assert.equal(seal.reversalSays(state, 7000), '');
});

// --- survival_priority and the claim, on a bot under the rock ---

function belowBot({ mobs = [], health = 20, food = 18, time = 13000, sight = false } = {}) {
  const entities = Object.fromEntries(mobs.map((m, i) => [i + 10, { id: i + 10, name: m.name, position: m.at, height: 1.95, width: 0.6, isValid: true, metadata: {} }]));
  const open = new Set(['0,8,0', '0,9,0']);
  return {
    registry, game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal', minY: -64, height: 384 },
    entities, health, food, oxygenLevel: 20, time: { timeOfDay: time, age: 200000 },
    entity: { position: new Vec3(0.5, 8, 0.5), onGround: true, velocity: new Vec3(0, 0, 0), height: 1.8, width: 0.6 },
    inventory: { items: () => [{ name: 'iron_sword', count: 1 }, { name: 'cobblestone', count: 64 }], slots: [], emptySlotCount: () => 10 },
    heldItem: { name: 'iron_sword' },
    blockAt: p => { const q = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) }; const air = open.has(`${q.x},${q.y},${q.z}`) || q.y > 90; return { name: air ? 'air' : 'stone', boundingBox: air ? 'empty' : 'block', position: p, skyLight: 0 }; },
    world: { raycast: () => sight ? null : ({ intersect: new Vec3(0, 0, 0) }) }, on() {}, once() {}, removeListener() {}, emit() {},
  };
}

async function askPriority(bot, state = {}) {
  const { Survival } = require('../src/survival');
  const survival = new Survival(bot, {}, { state: { sleptAtAge: 0, ...state } });
  let tree;
  survival.decide = async (task, goal, save, { id, tree: t }) => {
    if (id !== 'survival_priority') return { path: ['work'], stale: false };
    tree = t;
    return { path: ['continue_request'], stale: false, action: t.continue_request };
  };
  const goal = { kind: 'win', request: 'beat the game', rungTime: { phase: 'reach_nether' } };
  await survival.step(new Task('wait'), goal, () => {});
  return { tree, survival };
}

test('secure_shelter under the rock with no reason says so first, with the cost and the bot\'s own record, not "before hostile mobs spawn at night" (note 755, 25594)', async () => {
  const log = [{ at: 1, none: true, next: 'night_mine', afterS: 8 }, { at: 2, none: true, next: 'stay', afterS: 70 }];
  const { tree } = await askPriority(belowBot(), { sealLog: log });
  assert(tree?.secure_shelter, `secure_shelter was offered; options were ${Object.keys(tree || {}).join(', ')}`);
  const d = tree.secure_shelter.description;
  assert.match(d, /^No reason to seal: health 20 of 20, nothing hostile within 24 blocks, underground, where the night changes nothing/);
  assert.match(d, /Sealing costs the building, then up to \d+ real minutes sealed to dawn/);
  assert.match(d, /Of this bot's last 2 seals with no reason named, 1 was opened again within a minute \(night mine 1\)\./);
  assert.match(d, /Prepare and enter a sealed shelter here under the rock\./);
  assert.doesNotMatch(d, /before hostile mobs spawn at night/);
  assert.match(tree.continue_request.description, /phantoms come for a player on the third, and only to one under open sky, not down here; only a bed pays the sleep owed\./);
});

test('with a mob in sight, secure_shelter opens with it (note 755)', async () => {
  const { tree } = await askPriority(belowBot({ mobs: [{ name: 'zombie', at: new Vec3(12, 8, 0) }], sight: true }));
  assert(tree?.secure_shelter);
  assert.match(tree.secure_shelter.description, /^Sealing against the zombie 12 blocks off/);
});

test('the turn: a shelter under the rock with no reason is routine and said as a pocket under the rock, not "Shelter for the night"; a mob in sight keeps it pressing (note 755)', () => {
  const { claim } = require('../src/survival');
  const { claimSays } = require('../src/arbiter');
  const state = { sleptAtAge: 0 };
  const quiet = claim(belowBot(), { kind: 'win' }, { state, currentShelter: () => null });
  assert.equal(quiet.action, 'secure_shelter');
  assert.equal(quiet.urgency, 'routine');
  assert.match(claimSays(quiet), /^A sealed pocket under the rock \(no reason to seal: health 20, nothing hostile in sight within 24 blocks or within 8\):/);
  assert.match(claimSays(quiet), /a pocket does not pay that: only a bed does/);
  const seen = claim(belowBot({ mobs: [{ name: 'zombie', at: new Vec3(14, 8, 0) }], sight: true }), { kind: 'win' }, { state, currentShelter: () => null });
  assert.equal(seen.action, 'secure_shelter');
  assert.equal(seen.urgency, 'pressing');
  assert.match(claimSays(seen), /^A sealed pocket under the rock \(against the zombie 14 blocks off, in sight\):/);
});

// --- pocket_next: a way out right after the seal ---

test('pocket_next says leave and night_mine undo the seal chosen seconds ago with no reason, and logs what followed (note 755, 25594)', async () => {
  const { Survival } = require('../src/survival');
  const origin = new Vec3(0, 100, 0);
  const open = new Set([`${origin}`, `${origin.offset(0, 1, 0)}`]);
  const bot = {
    registry, game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' },
    entities: {}, health: 20, food: 20, oxygenLevel: 20, time: { timeOfDay: 13500 },
    entity: { position: origin.offset(0.5, 0, 0.5), onGround: true, velocity: new Vec3(0, 0, 0) },
    inventory: { items: () => [{ name: 'iron_sword', count: 1 }, { name: 'iron_pickaxe', count: 1 }, { name: 'coal', count: 10 }], slots: [], emptySlotCount: () => 10 },
    heldItem: { name: 'iron_sword' },
    blockAt: q => ({ name: open.has(`${q}`) ? 'air' : 'stone', boundingBox: open.has(`${q}`) ? 'empty' : 'block', position: q }),
    world: { raycast: from => ({ intersect: from.offset(0.6, 0, 0) }) }, on() {}, once() {}, removeListener() {}, emit() {},
  };
  const goal = { kind: 'win', request: 'beat the game', rungTime: { phase: 'reach_nether' } };
  const survival = new Survival(bot, {}, { state: { shelters: [{ origin: { ...origin }, dimension: 'overworld', verifiedAt: new Date().toISOString() }],
    lastSeal: { at: Date.now() - 8000, none: true, short: 'no reason named', how: 'seal_here' } }, client: { systemOne: async () => ({}) } });
  let tree;
  survival.decide = async (task, g, save, { id, tree: t }) => { if (id === 'pocket_next') tree = t; return { path: ['night_mine'], stale: false }; };
  survival.nightMine = async () => false;
  survival.wait = async () => {};
  await survival.step(new Task('wait'), goal, () => {}).catch(() => {});
  assert(tree, 'pocket_next was asked');
  for (const k of ['leave', 'night_mine'].filter(k => tree[k])) assert.match(tree[k].description, /^Undoes the seal chosen \d+ seconds ago \(with no reason named for it\): the pocket is opened again/, k);
  assert(tree.leave, 'leave was offered');
  if (tree.stay) assert.doesNotMatch(tree.stay.description, /^Undoes/);
  assert.equal(survival.state.sealLog?.at(-1)?.next, 'night_mine');
  assert.equal(survival.state.sealLog.at(-1).none, true);
});

// --- the job in hand, on the stall's travel options ---

test('the job in hand names the step\'s need and its nearest source, and a travel says how far its end is from it (note 755, 25584)', () => {
  const here = { x: -10.5, y: 65, z: 69.5 };
  const step = { action: 'mine', block: 'iron_ore', sources: ['iron_ore', 'deepslate_iron_ore'], drops: 'raw_iron', count: 3, target: { x: -12, y: 63, z: 69 } };
  const j = job.jobInHand({ step, here, find: () => ({ x: -12, y: 63, z: 69 }) });
  assert.equal(j.says, 'The job in hand: the step waiting mines 3 raw iron (iron ore): the nearest known 3 blocks from here.');
  assert.equal(job.awaySays(j, { x: -76, z: 69 }, here), ' Away from the job in hand: iron ore is 3 blocks from here and about 64 from there, walked back for after.');
  // A walk that ends no farther from it says nothing.
  assert.equal(job.awaySays(j, { x: -14, z: 70 }, here), '');
});

test('a portal frame begun is the job in hand: how many of ten, how many from done, and what is carried toward the next (note 755, 25588)', () => {
  const j = job.jobInHand({ here: { x: 0, y: 64, z: 0 }, frame: { at: { x: 10, y: 64, z: 0 }, placed: 8, cast: true }, carried: { lava: 1, water: 1 } });
  assert.equal(j.says, 'The job in hand: the portal frame at (10, 64, 0), 8 of ten cast, 2 blocks from done, 10 blocks from here, 1 lava bucket and 1 water bucket carried toward the next.');
  assert.match(job.awaySays(j, { x: -80, z: 0 }, { x: 0, y: 64, z: 0 }), /the frame is 10 blocks from here and about 90 from there/);
});

test('a tunnel step names where it goes', () => {
  const j = job.jobInHand({ step: { action: 'tunnel', target: { x: -25, y: 59, z: 75 } }, here: { x: -15, y: 64, z: 70 } });
  assert.match(j.says, /the step waiting tunnels to \(-25, 59, 75\), 12 blocks from here/);
});

// --- the saved shelter with no route ---

test('a walk to the saved shelter that finds no route sets it aside ten minutes and rests the way, not walked for again each pass (note 755, 25594 in the geode)', async () => {
  const { Survival } = require('../src/survival');
  const { isSetAside } = require('../src/progress');
  const bot = belowBot({ time: 13000 });
  const refuge = { origin: { x: 9, y: 8, z: 0 }, dimension: 'overworld', verifiedAt: new Date().toISOString() };
  const survival = new Survival(bot, {}, { state: { shelters: [refuge], nightPlan: { plan: 'shelter', until: Date.now() + 60000, method: 'saved_shelter' } } });
  survival.reachableRefuge = async () => refuge;
  survival.approachRefuge = async () => { throw Object.assign(new Error('No route to the goal'), { name: 'NoRoute' }); };
  const reports = [];
  survival.report = (goal, save, r) => reports.push(r);
  const out = await survival.refugeStep(new Task('wait'), { kind: 'win' }, () => {});
  assert.equal(out, true, 'the question is asked again next pass');
  assert(refuge.avoidUntil > Date.now() + 500000, 'the shelter is avoided about ten minutes');
  assert(isSetAside(survival, 'shelter_method', 'saved_shelter'), 'the way rests');
  assert(reports.some(r => r.action === 'shelter_unreachable' && r.reason === 'noRoute'));
});
