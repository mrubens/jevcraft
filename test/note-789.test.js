'use strict';
// Note 789: the night by place, from the record. Measured with
// scripts/night-time.js over the 261 fresh trials since 2026-09-30T12:00Z:
// under the rock the night adds nothing (22.8 health an hour at night, 22.6
// by day); on the surface it is 35.9 against 8; most seals were quiet. The
// night question is priced from that record, a failed seal is a fact, a stay
// in the pocket is held until what it was sealed for ends, and a bed is said
// with the monsters about it and the record of sleeps tried so.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('node:events');
const { Task } = require('../src/skills');
const registry = require('minecraft-data')('26.1');
const NR = require('../src/night-record');
const seal = require('../src/seal-reason');

function surfaceBot({ time = 15000, items = [{ name: 'iron_sword', count: 1 }, { name: 'cobblestone', count: 64 }, { name: 'iron_pickaxe', count: 1 }], entities = {}, y = 64 } = {}) {
  return Object.assign(new EventEmitter(), {
    registry, game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal', minY: -64, height: 384 },
    entities, health: 20, food: 20, oxygenLevel: 20, time: { timeOfDay: time, age: 100000 },
    entity: { position: new Vec3(0.5, y, 0.5), onGround: true, velocity: new Vec3(0, 0, 0), height: 1.8, width: 0.6, yaw: 0 },
    inventory: { items: () => items, slots: {}, emptySlotCount: () => 10 }, heldItem: null,
    blockAt: p => { const solid = p.y < y; return { name: solid ? 'stone' : 'air', boundingBox: solid ? 'block' : 'empty', position: p, skyLight: solid ? 0 : 15 }; },
    findBlocks: () => [], world: { raycast: () => null }, pathfinder: { movements: {}, setGoal() {}, getPathTo: () => ({ status: 'noPath', path: [] }) }, clearControlStates() {}, setControlState() {}, chat() {},
  });
}

// --- the record by place ---

test('keeping on at night is priced from the record by place: four and a half times the day on the surface, nothing added under the rock, deep the costliest at any hour', () => {
  const surface = NR.keepOnSays('surface', { minutesToDawn: 9 });
  assert.match(surface, /keeping on with the work on the surface at night, the fights it ran into counted, cost about 35\.9 health and 0\.23 deaths an hour \(25\.6 bot-hours\), against 8 and 0\.12 by day \(48\.7\)/);
  assert.match(surface, /to dawn, about 9 real minutes, that is about 5\.4 health and about 1 in 29 of a death at the night's rate, 4\.2 health more than by day\.$/);
  const below = NR.keepOnSays('underground', { minutesToDawn: 9 });
  assert.match(below, /under the rock \(y 0 to 56\) at night.*cost about 22\.8 health .* against 22\.6 .*: the night adds about nothing here/);
  assert.doesNotMatch(below, /more than by day/);
  assert.match(NR.keepOnSays('deep'), /deep, under y 0 .*44\.8 health and 1\.31 deaths an hour .* against 55\.2 and 0\.93 by day .*: the costliest place at any hour, and the night no worse there\.$/);
  assert.match(NR.sealedSays('surface', { minutesToDawn: 7, waiting: 'the reach nether step' }), /seals on the surface at night: 623, 414 of them with nothing hostile within 16 blocks or in sight while sealed; about 31\.5 health an hour taken in them\. Sealed to dawn is about 7 real minutes with the reach nether step waiting\./);
  assert.equal(NR.placeOf({ y: 70, underground: false }), 'surface');
  assert.equal(NR.placeOf({ y: 70, underground: true }), 'underground');
  assert.equal(NR.placeOf({ y: -12, underground: true }), 'deep');
  assert.equal(NR.facts('underground').keepOnAtNight.damagePerHour, 22.8);
});

test('survival_priority on the surface at night says the record on staying up and on the seal, with what the stay is held until (note 789)', async () => {
  const { Survival } = require('../src/survival');
  const bot = surfaceBot({ time: 15000 });
  const survival = new Survival(bot, { navigate: async () => {}, dig: async () => {}, place: async () => {} }, { state: { shelters: [], sleptAtAge: 100000 } });
  let asked = null;
  survival.decide = async (task, goal, save, { id, tree, state }) => { if (id === 'survival_priority') asked = { tree, state }; return { path: ['continue_request'], stale: false, action: tree?.continue_request || { run: async () => {} } }; };
  await survival.step(new Task('t'), { kind: 'win', request: 'beat the game', rungTime: { phase: 'reach_nether' } }, () => {}).catch(() => {});
  assert(asked, 'survival_priority asked');
  assert.equal(asked.state.nightRecord.place, 'surface');
  assert.match(asked.tree.continue_request.description, /keeping on with the work on the surface at night.*35\.9 health/);
  assert(asked.tree.secure_shelter, 'secure_shelter offered');
  assert.match(asked.tree.secure_shelter.description, /The record of seals on the surface at night: 623, 414 of them/);
  assert.match(asked.tree.secure_shelter.description, /A stay in the pocket is held until dawn, about \d+ real minutes off, not asked again meanwhile unless the bot is hurt, a mob comes within 5 blocks, hunger wants food with none carried or the bed can be slept in; when it comes, the pocket's question is asked at once\./);
});

// --- the hold ---

test('the seal\'s hold: its reasons and their ends, said on the seal and read each pass', () => {
  const state = {};
  const t0 = 1_000_000;
  seal.noteSeal(state, seal.sealReason({ underground: true, night: true, hostiles: [{ name: 'zombie', distance: 10, visible: true }] }), { now: t0 });
  assert.deepEqual(state.sealHold.kinds, ['threat']);
  // The zombie still about: holds.
  assert.deepEqual(NR.holdNow(state.sealHold, { threatNear: true, now: t0 + 5000 }), { holds: true, ended: [], waiting: ['the threat gone'] });
  // Gone: the clock starts, and 30 seconds clear ends it.
  assert.equal(NR.holdNow(state.sealHold, { threatNear: false, now: t0 + 10000 }).holds, true);
  assert.deepEqual(NR.holdNow(state.sealHold, { threatNear: false, now: t0 + 40000 }), { holds: false, ended: ['the threat gone'], waiting: [] });
  // The surface's night and healing: the hold lasts while either holds.
  const both = NR.holdOf(seal.sealReason({ underground: false, night: true, health: 14, food: 19 }), { now: t0 });
  assert.equal(NR.holdNow(both, { night: true, health: 20 }).holds, true);
  assert.deepEqual(NR.holdNow(both, { night: false, health: 20 }).ended, ['dawn', 'health back']);
  // No reason, or health that does not come back alone: no hold.
  seal.noteSeal(state, seal.sealReason({ underground: true, night: true }), { now: t0 });
  assert.equal(state.sealHold, undefined);
  assert.equal(NR.holdOf(seal.sealReason({ underground: true, health: 6, food: 12 })), null);
  assert.equal(NR.holdSays(seal.sealReason({ underground: true })), '');
  assert.match(NR.holdSays(seal.sealReason({ underground: true, hostiles: [{ name: 'spider', distance: 6, visible: false }] })), /held until nothing hostile within 16 blocks or in sight for 30 seconds,/);
});

function pocketBot({ mobs = [], health = 20, food = 20, time = 13500 } = {}) {
  const origin = new Vec3(0, 100, 0);
  const open = new Set([`${origin}`, `${origin.offset(0, 1, 0)}`]);
  const entities = Object.fromEntries(mobs.map((m, i) => [i + 10, { id: i + 10, name: m.name, position: m.at, height: 1.95, width: 0.6, isValid: true, metadata: {} }]));
  return { origin, bot: {
    registry, game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' },
    entities, health, food, oxygenLevel: 20, time: { timeOfDay: time },
    entity: { position: origin.offset(0.5, 0, 0.5), onGround: true, velocity: new Vec3(0, 0, 0) },
    inventory: { items: () => [{ name: 'iron_sword', count: 1 }, { name: 'iron_pickaxe', count: 1 }, { name: 'bread', count: 5 }], slots: [], emptySlotCount: () => 10 },
    heldItem: { name: 'iron_sword' },
    blockAt: q => { const air = open.has(`${new Vec3(Math.floor(q.x), Math.floor(q.y), Math.floor(q.z))}`); return { name: air ? 'air' : 'stone', boundingBox: air ? 'empty' : 'block', position: q }; },
    world: { raycast: from => ({ intersect: from.offset(0.6, 0, 0) }) }, on() {}, once() {}, removeListener() {}, emit() {},
  } };
}

async function pocketPass(bot, origin, state) {
  const { Survival } = require('../src/survival');
  const survival = new Survival(bot, {}, { state: { shelters: [{ origin: { ...origin }, dimension: 'overworld', verifiedAt: new Date().toISOString() }], ...state }, client: { systemOne: async () => ({}) } });
  const asked = [], reports = [];
  let waited = 0;
  survival.decide = async (task, g, save, { id, tree, state: st }) => { asked.push({ id, tree, state: st }); return { path: ['stay'], stale: false }; };
  survival.wait = async () => { waited++; };
  const report = survival.report.bind(survival);
  survival.report = (goal, save, action) => { reports.push(action); return report(goal, save, action); };
  await survival.step(new Task('wait'), { kind: 'win', request: 'beat the game', rungTime: { phase: 'reach_nether' } }, () => {}).catch(() => {});
  return { survival, asked: asked.filter(a => a.id === 'pocket_next'), reports, waited };
}

test('a stay sealed against a threat is held while the threat is about, whatever else changes, and asked at once when it has been gone 30 seconds (note 789)', async () => {
  const { origin, bot } = pocketBot({ mobs: [{ name: 'zombie', at: new Vec3(12, 100, 0) }] });
  const hold = { at: Date.now() - 60000, kinds: ['threat'], dawn: false, threat: true, heal: false, health: 20, stayHealth: 20, clearSince: null, origin: { ...origin } };
  const plan = { choice: 'stay', key: 'another set of ways', at: Date.now() - 20000, until: Date.now() + 70000 };
  const held = await pocketPass(bot, origin, { sealHold: { ...hold }, pocketPlan: { ...plan } });
  assert.equal(held.asked.length, 0, 'not asked while the zombie it was sealed against is about');
  assert.equal(held.waited, 1, 'the stay runs');
  // The turn's claim says the stay goes on as held, not that it is asked next.
  const { claim } = require('../src/survival');
  const { claimSays, promiseOf } = require('../src/arbiter');
  const c = claim(bot, { kind: 'win', request: 'beat the game' }, held.survival);
  assert.equal(c.action, 'pocket_next');
  assert.match(claimSays(c), /stay goes on, as chosen \(the stay held until the threat gone, what the pocket was sealed for\)/);
  assert.equal(promiseOf(c), null);
  // The zombie gone 31 seconds: the hold ends, said, and the pocket is asked at once.
  const { bot: clear } = pocketBot();
  const ended = await pocketPass(clear, origin, { sealHold: { ...hold, clearSince: Date.now() - 31000 }, pocketPlan: { ...plan, key: undefined } });
  assert.equal(ended.asked.length, 1, 'asked at once at the hold\'s end');
  assert(ended.reports.some(r => r.action === 'seal_hold_ended' && r.ended.includes('the threat gone')));
  assert.equal(ended.survival.state.sealHold, undefined);
});

test('the hold is asked through when the bot is hurt since the stay, and says on the stay what it is held until (note 789)', async () => {
  const { origin, bot } = pocketBot({ mobs: [{ name: 'zombie', at: new Vec3(12, 100, 0) }], health: 15 });
  const hold = { at: Date.now() - 60000, kinds: ['threat'], dawn: false, threat: true, heal: false, health: 20, stayHealth: 20, clearSince: null, origin: { ...origin } };
  const hurt = await pocketPass(bot, origin, { sealHold: hold, pocketPlan: { choice: 'stay', key: 'other', at: Date.now() - 20000, until: Date.now() + 70000 } });
  assert.equal(hurt.asked.length, 1, 'hurt since the stay: asked');
  assert.deepEqual(hurt.asked[0].state.sealHold, { sealedFor: ['threat'], waitingFor: ['the threat gone'], askedAgainFor: 'hurt since the stay' });
  assert.match(hurt.asked[0].tree.stay.description, /Chosen, the stay is held until nothing hostile within 16 blocks or in sight for 30 seconds \(what the pocket was sealed for\)/);
  // The stay answered: its health kept for the next pass.
  assert.equal(hurt.survival.state.sealHold.stayHealth, 15);
});

test('a mob within 5 blocks, or hunger with nothing to eat, asks the held stay once when it comes, not at every pass it stays so (note 1088)', async () => {
  const { origin, bot } = pocketBot({ mobs: [{ name: 'zombie', at: new Vec3(4, 100, 0) }], health: 3.2, food: 14 });
  bot.inventory.items = () => [];
  const hold = { at: Date.now() - 60000, kinds: ['threat'], dawn: false, threat: true, heal: false, health: 3.2, stayHealth: 3.2, clearSince: null, origin: { ...origin } };
  const plan = { choice: 'stay', key: 'other', at: Date.now() - 20000, until: Date.now() + 70000 };
  // New to the stay: asked, and the stay answered knows both.
  const first = await pocketPass(bot, origin, { sealHold: { ...hold }, pocketPlan: { ...plan } });
  assert.equal(first.asked.length, 1);
  assert.deepEqual([...first.survival.state.sealHold.knownAtStay].sort(), ['a mob within 5 blocks', 'hunger under 18 with no food carried']);
  // The next passes, both still so: held, not asked.
  const again = await pocketPass(bot, origin, { sealHold: { ...first.survival.state.sealHold }, pocketPlan: { ...plan, at: Date.now() - 5000 } });
  assert.equal(again.asked.length, 0, 'known to the stay: not asked again');
  assert.equal(again.waited, 1);
  // Hurt since the stay still asks.
  bot.health = 1.2;
  const hurt = await pocketPass(bot, origin, { sealHold: { ...first.survival.state.sealHold }, pocketPlan: { ...plan, at: Date.now() - 5000 } });
  assert.equal(hurt.asked.length, 1);
  assert.equal(hurt.asked[0].state.sealHold.askedAgainFor, 'hurt since the stay');
});

// --- a failed seal is a fact ---

test('a pocket whose blocks the server refuses is a failed seal, kept and said; the stay-up chat says it (note 789, the critic\'s 25581)', async () => {
  const { Survival } = require('../src/survival');
  const bot = surfaceBot({ time: 15000, items: [{ name: 'dirt', count: 64 }, { name: 'iron_sword', count: 1 }] });
  const survival = new Survival(bot, { navigate: async () => {}, dig: async () => {}, place: async () => { throw new Error('Server refused the dirt at (1, 64, 0)'); } }, { state: { shelters: [], sleptAtAge: 100000 } });
  const reports = [];
  survival.report = (goal, save, action) => { reports.push(action); };
  await survival.sealHere(new Task('t'), { kind: 'win' }, () => {}, []);
  assert.match(survival.state.shelterFailed.why, /^three blocks in a row would not go in \(Server refused the dirt at \(1, 64, 0\)\)$/);
  assert(reports.some(r => r.action === 'seal_failed'));
  // The next question and the stay-up chat say it.
  let asked = null;
  survival.decide = async (task, goal, save, { id, tree }) => { if (id === 'survival_priority') asked = tree; return { path: ['continue_request'], stale: false, action: tree?.continue_request || { run: async () => {} } }; };
  survival.report = (goal, save, action) => { reports.push(action); };
  await survival.step(new Task('t'), { kind: 'win', request: 'beat the game' }, () => {}).catch(() => {});
  assert(asked, 'survival_priority asked');
  assert.match(asked.continue_request.description, /The shelter tried \d+ seconds ago failed: three blocks in a row would not go in/);
  await asked.continue_request.run();
  const stayUp = reports.find(r => r.action === 'stay_up');
  assert.match(stayUp.shelterFailed, /three blocks in a row would not go in/);
});

// --- the bed ---

test('the bed\'s safety: the monsters within 8 of it, those within 16 and how soon they close, the creeper\'s race, and the record of sleeps tried so (note 789, 25594\'s creeper at 14)', () => {
  const s = NR.bedSafety([{ name: 'creeper', distance: 14, visible: false, coming: false }, { name: 'zombie', distance: 30, visible: false }]);
  assert.equal(s.band, '8 to 16 with a creeper');
  assert.match(s.says, /^ Monsters within 8 blocks of the bed now: none\. Within 16: a creeper 14 blocks off \(out of sight\), at the 8-block line in about 2 seconds at a walk\. The creeper 14 blocks off could reach the bed and go off in about 5\.2 seconds if it comes on\. The record of sleeps tried with the nearest monster 8 to 16 blocks off with a creeper: 11, 1 refused, 5 hurt within the minute after \(19\.8 health in all\)\.$/);
  assert.deepEqual(s.facts.sleepRecord, { band: '8 to 16 with a creeper', tries: 11, refused: 1, hurt: 5, health: 19.8 });
  const near = NR.bedSafety([{ name: 'skeleton', distance: 4, visible: true }]);
  assert.match(near.says, /Monsters within 8 blocks of the bed now: 1 \(a skeleton 4 blocks off\); the game refuses the sleep while any is\./);
  assert.match(NR.bedSafety([]).says, /none\. The record of sleeps tried with the nearest monster more than 16 blocks off: 182, 17 refused, 16 hurt/);
  // From the bot's own view.
  const { bedSafetyAt } = require('../src/survival');
  const bot = surfaceBot({ entities: { 7: { id: 7, name: 'creeper', position: new Vec3(14.5, 64, 0.5), height: 1.7, width: 0.6, isValid: true, metadata: {} } } });
  const at = bedSafetyAt(bot, bot.entity.position);
  assert.equal(at.facts.monstersWithin8OfBed, 0);
  assert.equal(at.facts.creeperWithin16OfBed, 14);
});

test('a night mine with no pickaxe carried says it makes one first (note 789)', () => {
  const { nightMinePickSays } = require('../src/survival');
  assert.equal(nightMinePickSays(surfaceBot()), '');
  assert.match(nightMinePickSays(surfaceBot({ items: [{ name: 'cobblestone', count: 10 }, { name: 'stick', count: 4 }, { name: 'crafting_table', count: 1 }] })), /^ No pickaxe is carried: the mine first makes a stone pickaxe from what is carried, at the table carried/);
  assert.equal(nightMinePickSays(surfaceBot({ items: [{ name: 'dirt', count: 10 }] })), ' No pickaxe is carried, and none can be made from what is carried.');
});

// --- the measure and the replay ---

test('night-time.js puts each bot-second to its place, hour and doing, and replays a spell under the hold', () => {
  const { measure, replaySpell } = require('../scripts/night-time');
  const t0 = Date.parse('2026-09-30T20:00:00Z');
  const f = (s, o) => ({ t: t0 + s * 1000, dim: 'overworld', p: { x: 0, y: 30, z: 0 }, hp: 20, ...o });
  const frames = [
    f(0, { tod: 14000, ask: { id: 'shelter_method', path: ['seal_here'], underground: true } }),
    f(1, { sa: { a: 'dig_in', at: t0 + 1000 }, mobs: { near16: 1, seen24: 1, nearest: 10, list: [{ name: 'zombie', distance: 10, visible: true }] } }),
    f(5, { ask: { id: 'pocket_next', path: ['stay'] } }),
    f(10, { mobs: { near16: 0, seen24: 0, nearest: null, list: [] } }),
    f(20, { ask: { id: 'pocket_next', path: ['stay'] } }),
    f(30, { ask: { id: 'pocket_next', path: ['stay'] } }),
    f(41, {}),
    f(100, { ask: { id: 'pocket_next', path: ['stay'] } }),
    f(160, { sa: { a: 'leave_shelter', at: t0 + 160000 } }),
    f(200, {}),
  ];
  const m = measure(frames);
  assert.equal(m.spells.length, 1);
  const s = m.spells[0];
  assert.equal(s.band, 'underground'); assert.equal(s.hour, 'night');
  assert.deepEqual(s.why.kinds, ['threat']);
  assert.equal(s.pocket.length, 4);
  assert.equal(m.cells['underground|night|sealed'].ms, 40000, 'gaps over 30 s between frames are not counted');
  const r = replaySpell(s);
  // The zombie clear from 10 s, the hold ends 40 s after the seal: the stays
  // asked at 20 and 30 s are not asked, one is asked at the hold's end, the
  // one at 100 s as before; sealed to 45 s had the way out been taken then.
  assert.equal(r.asks, 3);
  assert.equal(r.ms, 45000);
  assert.equal(r.pastMs, 159000 - 40000);
});
