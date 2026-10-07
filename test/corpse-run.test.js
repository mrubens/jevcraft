'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { corpseRun, corpseRunStep, worth, madeAgain } = require('../src/corpse-run');

// Died 400 blocks from the bed with the iron kit, a sword, rods and junk.
function world({ deathAgoMs = 60000, dimension = 'overworld', deathDimension = 'overworld', at = new Vec3(0, 64, 0), status = 'finished' } = {}) {
  const deathAt = new Date(Date.now() - deathAgoMs).toISOString();
  const inventory = [], equipped = {}, said = [];
  const bot = { game: { dimension }, entity: { position: at.clone() }, chat: m => said.push(m), registry: require('minecraft-data')('26.1'), time: { timeOfDay: 1000 },
    inventory: { items: () => inventory, slots: {} },
    equip: async (item, slot) => { equipped[slot] = item.name; bot.inventory.slots[{ head: 5, torso: 6, legs: 7, feet: 8 }[slot]] = item; } };
  const goal = { survival: {
    deaths: [{ at: deathAt, position: { x: 400, y: 64, z: 0 }, dimension: deathDimension }],
    recovery: { at: deathAt, status, recovered: {}, inventoryBeforeDeath: { iron_chestplate: 1, diamond_sword: 1, blaze_rod: 8, dirt: 40, stone_pickaxe: 1, cobblestone: 64 } } } };
  const give = (name, count) => { const it = inventory.find(i => i.name === name); if (it) it.count += count; else inventory.push({ name, count }); };
  return { bot, goal, said, equipped, give };
}

test('what is worth going back for: the kit and supplies, not blocks or stone tools', () => {
  assert.deepEqual(worth({ iron_chestplate: 1, diamond_sword: 1, blaze_rod: 8, dirt: 40, stone_pickaxe: 1, cobblestone: 64, ender_pearl: 2 }),
    { iron_chestplate: 1, diamond_sword: 1, blaze_rod: 8, ender_pearl: 2 });
});

test('a far death: the bot walks back, picks up its things and puts the armour back on', async () => {
  const { bot, goal, said, equipped, give } = world();
  const walks = [];
  const move = async (b, task, g) => { walks.push(g); bot.entity.position = new Vec3(398, 64, 1); };
  const collect = async (b, task, name, { origin }) => { assert.equal(origin.x, 400); give(name, { iron_chestplate: 1, diamond_sword: 1, blaze_rod: 8 }[name]); return true; };
  assert.equal(await corpseRunStep(bot, new Task('win'), goal, () => {}, { move, collect }), true);
  assert.equal(walks.length, 1);
  assert.equal(goal.corpseRun.status, 'done');
  assert.equal(equipped.torso, 'iron_chestplate');
  assert.match(said[0], /Going back.*iron chestplate.*diamond sword.*8 blaze rod/);
  assert.doesNotMatch(said[0], /dirt|stone pickaxe/);
  assert.equal(await corpseRunStep(bot, new Task('win'), goal, () => {}, { move, collect }), false, 'nothing more to do');
});

test('drops by the bed age from the death; after five minutes the run is not made', () => {
  const { bot, goal } = world({ deathAgoMs: 6 * 60000, at: new Vec3(380, 64, 0) });
  assert.equal(corpseRun(bot, goal), null);
  assert.equal(goal.corpseRun.status, 'despawned');
});

test('drops far from the respawn keep; the run is made an hour later', () => {
  const { bot, goal } = world({ deathAgoMs: 60 * 60000 });
  assert(corpseRun(bot, goal));
});

test('a Nether death waits for the next Nether trip; the End is not gone back to', () => {
  const nether = world({ deathDimension: 'the_nether' });
  assert.equal(corpseRun(nether.bot, nether.goal), null);
  assert.equal(nether.goal.corpseRun.status, 'open');
  nether.bot.game.dimension = 'the_nether';
  assert(corpseRun(nether.bot, nether.goal), 'in the Nether: there to weigh, kit or no kit (note 559)');
  const end = world({ deathDimension: 'the_end', dimension: 'the_end' });
  assert.equal(corpseRun(end.bot, end.goal), null);
  assert.equal(end.goal.corpseRun.status, 'void');
});

test('the survival layer picks up close drops first', () => {
  const { bot, goal } = world({ status: 'pending' });
  assert.equal(corpseRun(bot, goal), null);
  assert.equal(goal.corpseRun, undefined);
});

test('a walk each way that gets no nearer: whether the things are given up is asked, told of the walks; the code does not close the run (note 1179)', async () => {
  const { bot, goal } = world();
  const asked = [], legs = [];
  let answer = 'go_back';
  const client = { systemOne: async ({ questions }) => { asked.push(JSON.stringify(Object.values(questions)[0])); return { answers: Object.fromEntries(Object.keys(questions).map(k => [k, { choice: answer, confidence: 0.9 }])) }; } };
  const task = Object.assign(new Task('run'), { opportunityClient: client });
  const move = async (b, t, g) => { legs.push(g); throw new Error('No route (noPath)'); };
  for (let i = 0; i < 5; i++) assert.equal(await corpseRunStep(bot, task, goal, () => {}, { move, collect: async () => false }), true);
  assert.equal(goal.corpseRun.status, 'open');
  assert.equal(asked.length, 1);
  assert.deepEqual(goal.corpseRun.stalled, { walks: 5, at: { x: 0, z: 0 }, error: 'No route (noPath)' });
  // Far off it goes a leg at a time, and after a leg that failed, to one side of the line.
  assert.deepEqual(legs.map(g => [g.x, g.z]), [[64, 0], [41, 49], [41, -49], [0, 64], [0, -64]]);
  answer = 'leave_them';
  assert.equal(await corpseRunStep(bot, task, goal, () => {}, { move, collect: async () => false }), false);
  assert.equal(asked.length, 2);
  assert.match(asked[1], /5 walks toward them from about \(0, 0\) got no nearer, straight and to each side \(the last: No route \(noPath\)\)/);
  assert.equal(goal.corpseRun.status, 'left');
});

test('a run the code closed as out of reach, its drops never come near, is open again and asked (note 1179)', async () => {
  const { bot, goal } = world();
  corpseRun(bot, goal);
  Object.assign(goal.corpseRun, { status: 'unreachable', choice: 'go_back', stuck: 3, announced: true });
  const run = corpseRun(bot, goal);
  assert.equal(run.status, 'open');
  assert.equal(run.choice, undefined);
  assert.deepEqual(run.stalled, { walks: 3 });
  // One whose drops were within the loaded ground stays closed: they have aged.
  const near = world();
  corpseRun(near.bot, near.goal);
  Object.assign(near.goal.corpseRun, { status: 'unreachable', loadedAt: new Date().toISOString() });
  assert.equal(corpseRun(near.bot, near.goal), null);
});

test('nothing lying at the spot: gone, said once', async () => {
  const { bot, goal, said } = world({ at: new Vec3(399, 64, 0) });
  assert.equal(await corpseRunStep(bot, new Task('win'), goal, () => {}, { move: async () => assert.fail('already there'), collect: async () => false }), true);
  assert.equal(goal.corpseRun.status, 'gone');
  assert.match(said.at(-1), /Nothing left/);
});

test('a death in lava is not gone back for: the drops burned', () => {
  const { bot, goal } = world();
  goal.survival.deaths[0].lava = true;
  assert.equal(corpseRun(bot, goal), null);
  assert.equal(goal.corpseRun.status, 'burned');
});

test('going back for the drops is Jev\'s choice, told what was about when the bot died there', async () => {
  // mid-230-c walked 194 blocks back to the drowned that had just killed it; mid-231-b died four times in two and a half minutes going back.
  const { bot, goal } = world();
  goal.survival.deaths[0].about = [{ name: 'drowned', distance: 13 }, { name: 'drowned', distance: 20 }];
  goal.survival.deaths[0].worn = ['iron_chestplate'];
  let asked = null;
  const client = { systemOne: async ({ questions }) => { asked = Object.values(questions)[0].criteria; return { answers: Object.fromEntries(Object.keys(questions).map(k => [k, { choice: 'leave_them', confidence: 0.9 }])) }; } };
  let moved = false;
  const task = Object.assign(new Task('run'), { opportunityClient: client });
  assert.equal(await corpseRunStep(bot, task, goal, () => {}, { move: async () => { moved = true; } }), false);
  assert.match(asked.go_back, /about it were a drowned 13 blocks off, a drowned 20 blocks off; it wore iron chestplate then and wears no armour now/);
  assert.equal(moved, false, 'left: no walk');
  assert.equal(goal.corpseRun.status, 'left');
  assert.equal(corpseRun(bot, goal), null, 'and not asked again for this death');
});

test('what was worn at the death is gone back for with the rest, and unarmored in the Nether by the drops Jev is asked (mid-242-aa, note 559)', async () => {
  // mid-242-aa died to piglins in an iron helmet and chestplate thirteen blocks from its Nether portal; back through it unarmored half an hour later it was never asked, and its list had no armor on it.
  const { recordDeath } = require('../src/recovery');
  const { bot, goal } = world({ deathDimension: 'the_nether', dimension: 'the_nether', at: new Vec3(390, 64, 0) });
  const state = { deaths: [] };
  const dead = { ...bot, entity: { id: 1, position: new Vec3(400, 64, 0) }, blockAt: () => ({ name: 'air' }),
    inventory: { items: () => [{ name: 'iron_sword', count: 1 }, { name: 'netherrack', count: 30 }], slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 45: { name: 'shield' } } } };
  recordDeath(dead, state);
  assert.deepEqual(state.deaths[0].worn, ['iron_helmet', 'iron_chestplate', 'shield']);
  goal.survival = { deaths: state.deaths, recovery: { ...state.recovery, status: 'finished' } };
  const run = corpseRun(bot, goal);
  assert(run, 'no kit on, in the Nether: still there to weigh');
  assert.deepEqual(run.items, { iron_sword: 1, iron_helmet: 1, iron_chestplate: 1, shield: 1 });
  let asked = null;
  const client = { systemOne: async ({ questions }) => { asked = Object.values(questions)[0].criteria; return { answers: Object.fromEntries(Object.keys(questions).map(k => [k, { choice: 'go_back', confidence: 0.9 }])) }; } };
  const walks = [];
  const task = Object.assign(new Task('run'), { opportunityClient: client });
  await corpseRunStep(bot, task, goal, () => {}, { move: async (b, t, g) => { walks.push(g); }, collect: async () => false });
  assert.match(asked.go_back, /^Go back for iron sword, iron helmet, iron chestplate, shield: 10 blocks off\. About \d+ seconds before they vanish\./);
  assert.match(asked.go_back, /it wore iron helmet, iron chestplate, shield then and wears no armour now/);
  assert.equal(walks.length, 1, 'gone back for, as Jev chose');
});

test('leaving the things says what making them again takes; a run left without that said, its drops never come near, is asked once more (note 1180)', async () => {
  assert.equal(madeAgain({ ender_eye: 12, diamond_sword: 1, iron_helmet: 1, iron_chestplate: 1, iron_leggings: 1, iron_boots: 1, iron_pickaxe: 1, raw_iron: 13, bow: 1, arrow: 51 }),
    '12 ender pearls from endermen or piglin barter, 6 blaze rods from a fortress\'s blazes, 40 iron mined and smelted, 2 diamonds found, a bow made of three strings or taken from a skeleton, 51 arrows from skeletons');
  const { bot, goal } = world();
  const asked = [];
  const client = { systemOne: async ({ questions }) => { asked.push(JSON.stringify(Object.values(questions)[0])); return { answers: Object.fromEntries(Object.keys(questions).map(k => [k, { choice: 'leave_them', confidence: 0.9 }])) }; } };
  const task = Object.assign(new Task('run'), { opportunityClient: client });
  corpseRun(bot, goal);
  Object.assign(goal.corpseRun, { status: 'left', choice: 'leave_them' });
  assert.equal(await corpseRunStep(bot, task, goal, () => {}, { move: async () => {}, collect: async () => false }), false);
  assert.equal(asked.length, 1);
  assert.match(asked[0], /400 blocks off, about 10 minutes' walk at the 38.5 blocks a minute the bot's walks have made, stalls and detours counted/);
  assert.match(asked[0], /made again, or found, later: 8 blaze rods from a fortress's blazes, 8 iron mined and smelted, 2 diamonds found\./);
  assert.equal(goal.corpseRun.status, 'left');
  // Told, and left again: that stands.
  assert.equal(await corpseRunStep(bot, task, goal, () => {}, { move: async () => {}, collect: async () => false }), false);
  assert.equal(asked.length, 1);
});

test('far off and under the rock, the way back goes up to the surface first, and that is not a walk that failed (note 1182)', async () => {
  const { bot, goal } = world({ at: new Vec3(0, 41, 0) });
  bot.blockAt = p => ({ name: p.y < 64 ? 'stone' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty', position: p });
  const levels = require('../src/levels'), depthHere = levels.depthHere;
  levels.depthHere = () => 23;
  const calls = [];
  try {
    const surface = async () => { calls.push('surface'); bot.entity.position = new Vec3(0, 64, 0); levels.depthHere = () => 0; };
    const move = async (b, t, g) => { calls.push('walk'); bot.entity.position = new Vec3(g.x, 64, g.z); };
    assert.equal(await corpseRunStep(bot, new Task('win'), goal, () => {}, { move, surface, collect: async () => false }), true);
    assert.equal(goal.step.way, 'up to the surface first');
    assert.equal(await corpseRunStep(bot, new Task('win'), goal, () => {}, { move, surface, collect: async () => false }), true);
    assert.deepEqual(calls, ['surface', 'walk']);
    assert.equal(goal.corpseRun.stuck, 0);
  } finally { levels.depthHere = depthHere; }
});

test('a second death does not take the first one\'s drops off the list: when its own run closes, the earlier one is the run in hand and asked (note 1183)', async () => {
  const { bot, goal } = world();
  const first = corpseRun(bot, goal);
  first.choice = 'go_back';
  // Dead again 200 blocks along the way back, with a pickaxe.
  const at = new Date().toISOString();
  goal.survival.deaths.push({ at, position: { x: 200, y: 40, z: 0 }, dimension: 'overworld', worn: [] });
  goal.survival.recovery = { at, status: 'finished', recovered: {}, inventoryBeforeDeath: { iron_pickaxe: 1 } };
  const second = corpseRun(bot, goal);
  assert.deepEqual(second.items, { iron_pickaxe: 1 });
  assert.deepEqual(goal.corpseRunsEarlier.map(r => r.deathAt), [first.deathAt]);
  // Asked of the second, Jev is told how it died there and what lies further on from the first.
  goal.survival.deaths.at(-1).cause = 'burned to death';
  const asked = [];
  const client = { systemOne: async ({ questions }) => { asked.push(JSON.stringify(Object.values(questions)[0])); return { answers: Object.fromEntries(Object.keys(questions).map(k => [k, { choice: 'go_back', confidence: 0.9 }])) }; } };
  await corpseRunStep(bot, Object.assign(new Task('run'), { opportunityClient: client }), goal, () => {}, { move: async () => {}, collect: async () => false });
  assert.match(asked[0], /The bot burned to death there; when it died, nothing hostile was in view/);
  assert.match(asked[0], /From a death before this one there also lie: iron chestplate, diamond sword, 8 blaze rod, 400 blocks from here and 201 from these; that is asked of after this\./);
  second.status = 'gone';
  const again = corpseRun(bot, goal);
  assert.equal(again.deathAt, first.deathAt);
  assert.deepEqual(again.items, { iron_chestplate: 1, diamond_sword: 1, blaze_rod: 8 });
  assert.equal(again.choice, undefined);
  assert.deepEqual(goal.corpseRunsEarlier, []);
  // And the last death's run is not made over again.
  again.status = 'done';
  assert.equal(corpseRun(bot, goal), null);
});

test('state from before the list was kept: an earlier death in the last three hours is on it by what it wore, and what lies at the spot is taken with the rest (note 1183)', async () => {
  const { bot, goal, give } = world();
  const last = goal.survival.deaths[0];
  goal.survival.deaths.unshift({ at: new Date(Date.now() - 40 * 60000).toISOString(), position: { x: 900, y: 69, z: 700 }, dimension: 'overworld', worn: ['iron_helmet', 'iron_chestplate'] },
    { at: new Date(Date.now() - 5 * 3600000).toISOString(), position: { x: 1, y: 1, z: 1 }, dimension: 'overworld', worn: ['iron_helmet'] });
  goal.survival.deaths.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  assert.equal(goal.survival.deaths.at(-1), last);
  const run = corpseRun(bot, goal);
  assert.equal(run.deathAt, last.at);
  assert.equal(goal.corpseRunsEarlier.length, 1);
  run.status = 'done';
  const earlier = corpseRun(bot, goal);
  assert.deepEqual(earlier.items, { iron_helmet: 1, iron_chestplate: 1 });
  assert.equal(earlier.more, true);
  // At the spot, twelve eyes of ender lie there too.
  bot.entity.position = new Vec3(900, 69, 700);
  bot.entities = { 7: { position: new Vec3(901, 69, 700), getDroppedItem: () => ({ name: 'ender_eye', count: 12 }) }, 8: { position: new Vec3(901, 69, 701), getDroppedItem: () => ({ name: 'dirt', count: 30 }) } };
  const asked = [];
  const client = { systemOne: async ({ questions }) => { asked.push(JSON.stringify(Object.values(questions)[0])); return { answers: Object.fromEntries(Object.keys(questions).map(k => [k, { choice: 'go_back', confidence: 0.9 }])) }; } };
  const task = Object.assign(new Task('run'), { opportunityClient: client });
  const collected = [];
  await corpseRunStep(bot, task, goal, () => {}, { move: async () => {}, collect: async (b, t, name) => { collected.push(name); give(name, 1); return true; } });
  assert.match(asked[0], /a death before the last/);
  assert.ok(collected.includes('ender_eye') && !collected.includes('dirt'));
});

test('a death before the last, its list not kept: the eyes the run had made before it and has nowhere now are said, and a run left without that said is asked once more (note 1186)', async () => {
  const { bot, goal } = world();
  const before = new Date(Date.now() - 40 * 60000).toISOString();
  goal.survival.deaths.unshift({ at: before, position: { x: 900, y: 69, z: 700 }, dimension: 'overworld', worn: ['iron_helmet'], cause: 'was shot by Skeleton' });
  goal.gameProgress = { milestones: { eyes_obtained: { at: Date.now() - 5 * 3600000 }, stronghold_located: { at: 1, frames: Array.from({ length: 12 }, () => ({ eye: false })) } } };
  goal.endPortal = { neededEyes: 12 };
  corpseRun(bot, goal).status = 'done';
  const earlier = corpseRun(bot, goal);
  Object.assign(earlier, { status: 'left', choice: 'leave_them', told: 7 });
  const asked = [];
  const client = { systemOne: async ({ questions }) => { asked.push(JSON.stringify(Object.values(questions)[0])); return { answers: Object.fromEntries(Object.keys(questions).map(k => [k, { choice: 'leave_them', confidence: 0.9 }])) }; } };
  const task = Object.assign(new Task('run'), { opportunityClient: client });
  await corpseRunStep(bot, task, goal, () => {}, { move: async () => {}, collect: async () => false });
  assert.equal(asked.length, 1);
  assert.match(asked[0], /The eyes of ender this run had made before that death are not carried, in a chest or in the portal's frames now: they dropped at a death since, this one or one after it, and the goal wants 12\./);
  assert.match(asked[0], /made again, or found, later: 12 ender pearls from endermen or piglin barter, 6 blaze rods from a fortress's blazes, 5 iron mined and smelted/);
  await corpseRunStep(bot, task, goal, () => {}, { move: async () => {}, collect: async () => false });
  assert.equal(asked.length, 1, 'told and left: that stands');
  // With eyes carried, nothing of the kind is said.
  const has = world();
  has.goal.survival.deaths.unshift({ at: before, position: { x: 900, y: 69, z: 700 }, dimension: 'overworld', worn: ['iron_helmet'] });
  has.goal.gameProgress = goal.gameProgress; has.give('ender_eye', 12);
  corpseRun(has.bot, has.goal).status = 'done';
  Object.assign(corpseRun(has.bot, has.goal), { status: 'left', told: 7 });
  assert.equal(corpseRun(has.bot, has.goal), null);
});

test('the hour is said by the one clock and with how long it lasts: dawn is day (note 1188)', async () => {
  const ask = async timeOfDay => {
    const { bot, goal } = world();
    bot.time = { timeOfDay };
    let text = '';
    const client = { systemOne: async ({ questions }) => { text = JSON.stringify(Object.values(questions)[0]); return { answers: Object.fromEntries(Object.keys(questions).map(k => [k, { choice: 'leave_them', confidence: 0.9 }])) }; } };
    await corpseRunStep(bot, Object.assign(new Task('run'), { opportunityClient: client }), goal, () => {}, { move: async () => {}, collect: async () => false });
    return text;
  };
  assert.match(await ask(23100), /It is day: night in about 10 real minutes\./);
  assert.match(await ask(14000), /It is night: dawn in about 8 real minutes\./);
});

test('by night, with drops that do not age, going back when it is day is a choice of its own: nothing is closed, and it is asked again at dawn (note 1188)', async () => {
  const { bot, goal } = world();
  bot.time = { timeOfDay: 14000 };
  const asked = [];
  const client = { systemOne: async ({ questions }) => { asked.push(JSON.stringify(Object.values(questions)[0])); return { answers: Object.fromEntries(Object.keys(questions).map(k => [k, { choice: 'wait_for_day', confidence: 0.9 }])) }; } };
  const task = Object.assign(new Task('run'), { opportunityClient: client });
  assert.equal(await corpseRunStep(bot, task, goal, () => {}, { move: async () => {}, collect: async () => false }), false);
  assert.match(asked[0], /wait_for_day/);
  assert.equal(goal.corpseRun.status, 'open');
  assert.equal(goal.corpseRun.choice, undefined);
  assert.equal(await corpseRunStep(bot, task, goal, () => {}, { move: async () => {}, collect: async () => false }), false);
  assert.equal(asked.length, 1, 'not asked again before dawn');
  assert.ok(corpseRun(bot, goal, Date.now() + 9 * 60000), 'open again at dawn');
  // By day the choice is not there.
  const day = world(); day.bot.time = { timeOfDay: 0 }; let text = '';
  await corpseRunStep(day.bot, Object.assign(new Task('run'), { opportunityClient: { systemOne: async ({ questions }) => { text = JSON.stringify(Object.values(questions)[0]); return { answers: Object.fromEntries(Object.keys(questions).map(k => [k, { choice: 'leave_them', confidence: 0.9 }])) }; } } }), day.goal, () => {}, { move: async () => {}, collect: async () => false });
  assert.doesNotMatch(text, /wait_for_day/);
});

test('by day with less day left than the walk, setting out at the next dawn is offered; and what the eyes took on the run\'s clock is said beside leaving them (note 1189)', async () => {
  const { bot, goal } = world();
  goal.survival.deaths[0].position = { x: 1100, y: 64, z: 0 };
  goal.survival.recovery.inventoryBeforeDeath.ender_eye = 12;
  goal.gameProgress = { milestones: {}, clock: { byDoing: { 'obtain_blaze_rods: find fortress': 57 * 60000, 'obtain_ender_pearls: stalk mob': 87 * 60000, 'eat': 29 * 60000 } } };
  bot.time = { timeOfDay: 8000 };
  let q = null;
  const client = { systemOne: async ({ questions }) => { q = Object.values(questions)[0]; return { answers: Object.fromEntries(Object.keys(questions).map(k => [k, { choice: 'wait_for_day', confidence: 0.9 }])) }; } };
  await corpseRunStep(bot, Object.assign(new Task('run'), { opportunityClient: client }), goal, () => {}, { move: async () => {}, collect: async () => false });
  const text = JSON.stringify(q);
  assert.match(text, /Set out for them at the next dawn, about 13 real minutes off, with the day ahead for the walk \(the day left now, about 3, is shorter than the walk, about 29\)/);
  assert.match(text, /On this run's clock the rods and pearls for its eyes were 144 minutes of play\./);
  assert.ok(goal.corpseRun.waitUntil > Date.now() + 12 * 60000);
});

test('at the spot the eyes and the kit are taken before the rest, room is made for each, and the run is not closed while they are seen lying there (note 1192)', async () => {
  const { bot, goal, give } = world({ at: new Vec3(398, 64, 1) });
  goal.survival.recovery.inventoryBeforeDeath = { emerald: 1, ender_eye: 12, diamond_sword: 1, iron_chestplate: 1, arrow: 51 };
  const drop = (id, name, count) => ({ id, position: new Vec3(400, 64, 0), getDroppedItem: () => ({ name, count }) });
  bot.entities = { 1: drop(1, 'emerald', 1), 2: drop(2, 'ender_eye', 12), 3: drop(3, 'diamond_sword', 1), 4: drop(4, 'iron_chestplate', 1), 5: drop(5, 'arrow', 51) };
  let free = 0;
  const order = [], roomed = [];
  const client = { systemOne: async ({ questions }) => ({ answers: Object.fromEntries(Object.keys(questions).map(k => [k, { choice: 'go_back', confidence: 0.9 }])) }) };
  const task = Object.assign(new Task('run'), { opportunityClient: client });
  // Pockets full: nothing goes in until room is made, and room is made for two stacks only.
  const room = async name => { roomed.push(name); if (roomed.length <= 2) { free++; return true; } return false; };
  const collect = async (b, t, name) => { order.push(name); if (!free) return false; free--; const e = Object.values(bot.entities).find(x => x.getDroppedItem().name === name); give(name, e.getDroppedItem().count); delete bot.entities[e.id]; return true; };
  assert.equal(await corpseRunStep(bot, task, goal, () => {}, { move: async () => {}, collect, room }), true);
  assert.deepEqual(order.slice(0, 3), ['ender_eye', 'diamond_sword', 'iron_chestplate']);
  assert.deepEqual(roomed.slice(0, 2), ['ender_eye', 'diamond_sword']);
  assert.equal(goal.corpseRun.status, 'open', 'the chestplate, the arrows and the emerald still lie there');
  assert.deepEqual(Object.keys(goal.corpseRun.items).sort(), ['arrow', 'emerald', 'iron_chestplate']);
});

test('the walk back under way is said for a question asked in the middle of it: what, how far, and the time left (note 1211)', () => {
  const { underWay } = require('../src/corpse-run');
  const { bot, goal } = world();
  assert.equal(underWay(bot, goal), null, 'no run yet');
  corpseRun(bot, goal);
  assert.equal(underWay(bot, goal), null, 'not chosen yet');
  goal.corpseRun.choice = 'go_back';
  assert.deepEqual(underWay(bot, goal), { list: 'iron chestplate, diamond sword, 8 blaze rod', far: 400, secondsLeft: null });
  goal.corpseRun.loadedAt = new Date(Date.now() - 100000).toISOString();
  assert.equal(underWay(bot, goal).secondsLeft, 200);
  goal.corpseRun.status = 'done';
  assert.equal(underWay(bot, goal), null);
});

test('things lying under the ground: the way down is in the minutes, and the place is said to be one the hour does not reach (note 1220)', async () => {
  const { bot, goal } = world({ at: new Vec3(260, 70, 0) });
  goal.survival.deaths[0].position = { x: 400, y: -23, z: 0 };
  let text = '';
  const client = { systemOne: async ({ questions }) => { text = JSON.stringify(Object.values(questions)[0]); return { answers: Object.fromEntries(Object.keys(questions).map(k => [k, { choice: 'leave_them', confidence: 0.9 }])) }; } };
  await corpseRunStep(bot, Object.assign(new Task('run'), { opportunityClient: client }), goal, () => {}, { move: async () => {}, collect: async () => false });
  assert.match(text, /about [0-9]+ minutes' walk and climb at the 38.5 blocks a minute.*?, at y -23/);
  assert.match(text, /The place is under the ground \(y -23, 93 blocks down from here\): the hour does not reach it, and what was about it at the death does not burn at dawn; the bot goes there with no sword or axe and no armour\./);
});

test('a death in the Nether, back to life in the Overworld: straight back for the kit or a kit first is asked once, and going sets the trip (note 1233)', async () => {
  const { bot, goal, said } = world({ dimension: 'overworld', deathDimension: 'the_nether' });
  goal.survival.deaths[0].about = [{ name: 'zombified_piglin', distance: 1 }];
  goal.survival.deaths[0].cause = 'was slain by Zombified Piglin';
  goal.survival.deaths[0].worn = ['iron_helmet'];
  goal.portals = [{ x: 30, y: 64, z: 40, dimension: 'overworld' }, { x: 300, y: 64, z: 0, dimension: 'nether' }];
  const asked = [];
  let answer = 'go_now';
  const client = { systemOne: async ({ questions }) => { asked.push(JSON.stringify(Object.values(questions)[0])); return { answers: Object.fromEntries(Object.keys(questions).map(k => [k, { choice: answer, confidence: 0.9 }])) }; } };
  const task = Object.assign(new Task('run'), { opportunityClient: client });
  assert.equal(await corpseRunStep(bot, task, goal, () => {}, {}), false, 'the ladder goes on, to the errand');
  assert.equal(asked.length, 1);
  assert.match(asked[0], /lie in the Nether where the bot died, 100 blocks from the portal on that side; the portal on this side is 50 blocks off/);
  assert.match(asked[0], /The bot was slain by Zombified Piglin there; when it died, a zombified piglin 1 blocks off was about/);
  assert.match(asked[0], /no sword or axe and no armour/);
  assert.match(asked[0], /a median 37/);
  assert.match(asked[0], /No pickaxe and 0 building blocks are carried/);
  assert.match(asked[0], /eleven such trips were taken as the bot stood: two came back with any of the kit/);
  assert.match(asked[0], /No food is carried, and none was in the pack that dropped: in the Nether health comes back only at hunger eighteen or more/);
  assert.deepEqual({ dimension: goal.errand.dimension, items: goal.errand.items, for: goal.errand.for }, { dimension: 'nether', items: [], for: 'the kit dropped at the death there' });
  assert.equal(goal.corpseRun.choice, 'go_back', 'not asked again on the far side');
  assert.match(said.at(-1), /^Straight back through the portal for what I dropped/);
  assert.equal(await corpseRunStep(bot, task, goal, () => {}, {}), false);
  assert.equal(asked.length, 1, 'once a death');
  const { nextGameStage } = require('../src/game-progress');
  if (typeof nextGameStage === 'function') { const stage = nextGameStage(bot, goal); assert.equal(stage.action, 'enter_nether'); assert.equal(stage.phase, 'errand'); }
});

test('the kit made again first is the other answer: no trip, the drops left for the next one; with no portal known nothing is asked', async () => {
  const { bot, goal } = world({ dimension: 'overworld', deathDimension: 'the_nether' });
  const asked = [];
  const client = { systemOne: async ({ questions }) => { asked.push(1); return { answers: Object.fromEntries(Object.keys(questions).map(k => [k, { choice: 'kit_first', confidence: 0.9 }])) }; } };
  const task = Object.assign(new Task('run'), { opportunityClient: client });
  assert.equal(await corpseRunStep(bot, task, goal, () => {}, {}), false);
  assert.equal(asked.length, 0, 'no portal known on either side');
  goal.portals = [{ x: 30, y: 64, z: 40, dimension: 'overworld' }, { x: 300, y: 64, z: 0, dimension: 'nether' }];
  assert.equal(await corpseRunStep(bot, task, goal, () => {}, {}), false);
  assert.equal(asked.length, 1);
  assert.equal(goal.errand, undefined);
  assert.equal(goal.corpseRun.trip.pick, 'kit_first');
  assert.equal(goal.corpseRun.status, 'open');
});

test('by night the kit trip says the hour and offers the dawn, and is asked again then; in a kit already it is not asked (note 1236)', async () => {
  const { bot, goal } = world({ dimension: 'overworld', deathDimension: 'the_nether' });
  bot.time.timeOfDay = 18000;
  goal.portals = [{ x: 30, y: 64, z: 40, dimension: 'overworld' }, { x: 300, y: 64, z: 0, dimension: 'nether' }];
  const asked = [];
  let answer = 'go_at_dawn';
  const client = { systemOne: async ({ questions }) => { asked.push(JSON.stringify(Object.values(questions)[0])); return { answers: Object.fromEntries(Object.keys(questions).map(k => [k, { choice: answer, confidence: 0.9 }])) }; } };
  const task = Object.assign(new Task('run'), { opportunityClient: client });
  const realNow = Date.now;
  try {
    assert.equal(await corpseRunStep(bot, task, goal, () => {}, {}), false);
    assert.match(asked[0], /It is night: dawn in about 4 real minutes, and mobs spawn in the open along the walk to the portal until then/);
    assert.match(asked[0], /go_at_dawn/);
    assert.equal(goal.errand, undefined);
    assert.equal(await corpseRunStep(bot, task, goal, () => {}, {}), false);
    assert.equal(asked.length, 1, 'not again before dawn');
    const later = realNow() + 5 * 60000;
    Date.now = () => later;
    bot.time.timeOfDay = 1000; answer = 'go_now';
    assert.equal(await corpseRunStep(bot, task, goal, () => {}, {}), false);
    assert.equal(asked.length, 2, 'asked again by day');
    assert.match(asked[1], /It is day/);
    assert.doesNotMatch(asked[1], /go_at_dawn/);
    assert.equal(goal.errand.dimension, 'nether');
  } finally { Date.now = realNow; }
  const kitted = world({ dimension: 'overworld', deathDimension: 'the_nether' });
  kitted.goal.portals = goal.portals;
  kitted.bot.inventory.slots = { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 7: { name: 'iron_leggings' } };
  const n = asked.length;
  assert.equal(await corpseRunStep(kitted.bot, task, kitted.goal, () => {}, {}), false);
  assert.equal(asked.length, n);
});

test('a trip for the kit come to nothing, the bot in the Nether in next to no armour: out again for a kit (note 1251)', () => {
  const { tripCameToNothing } = require('../src/corpse-run');
  const said = [];
  const bot = { game: { dimension: 'the_nether' }, inventory: { slots: { 6: { name: 'iron_chestplate' } } }, chat: m => said.push(m) };
  const goal = {};
  assert.equal(tripCameToNothing(bot, goal, { dimension: 'nether' }, () => {}), true);
  assert.deepEqual({ dimension: goal.errand.dimension, items: goal.errand.items }, { dimension: 'overworld', items: [] });
  assert.match(said[0], /back out to make one/);
  const kitted = { game: { dimension: 'the_nether' }, inventory: { slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 8: { name: 'golden_boots' } } } };
  const g2 = {};
  assert.equal(tripCameToNothing(kitted, g2, { dimension: 'nether' }, () => {}), false, 'in a kit it goes on');
  assert.equal(g2.errand, undefined);
  assert.equal(tripCameToNothing({ ...bot, game: { dimension: 'overworld' } }, {}, { dimension: 'overworld' }, () => {}), false);
});

test('a new death ends the trip chosen for the death before: it is asked of afresh (note 1255)', () => {
  const { bot, goal } = world({ dimension: 'overworld', deathDimension: 'the_nether' });
  goal.errand = { dimension: 'nether', items: [], for: require('../src/corpse-run').KIT_ERRAND, at: Date.now() };
  goal.corpseRunFor = '2026-10-04T18:25:31.000Z';
  goal.corpseRun = { deathAt: '2026-10-04T18:25:31.000Z', status: 'gone', dimension: 'nether', items: {}, trip: { pick: 'go_now', at: 1 } };
  goal.corpseRunsEarlier = [];
  corpseRun(bot, goal);
  assert.equal(goal.errand, undefined);
  assert.equal(goal.corpseRun.trip, undefined, 'the new run has no answer yet');
});

test('eyes lying by the End portal found: going back is said as the walk to the portal, the eyes into its empty frames (note 1292)', async () => {
  const { bot, goal } = world();
  goal.survival.deaths[0].position = { x: 1100, y: 64, z: 0 };
  goal.survival.recovery.inventoryBeforeDeath.ender_eye = 12;
  goal.endPortal = { center: { x: 1120, y: 32, z: 30 }, frames: [...Array(12)].map((_, i) => ({ position: { x: i, y: 32, z: 0 }, eye: i === 0 })) };
  let text = '';
  const client = { systemOne: async ({ questions }) => { text = JSON.stringify(Object.values(questions)[0]); return { answers: Object.fromEntries(Object.keys(questions).map(k => [k, { choice: 'go_back', confidence: 0.9 }])) }; } };
  await corpseRunStep(bot, Object.assign(new Task('run'), { opportunityClient: client }), goal, () => {}, { move: async () => {}, collect: async () => false });
  assert.match(text, /They lie 36 blocks from the End portal the bot found at \(1120, 32, 30\), 11 of its frames empty: the walk back is the walk to the portal, and the 12 eyes go into its frames there\./);
  assert.match(text, /Sprinting costs a point of hunger \(saturation first\) for about every 40 blocks, about 28 for this walk sprinted; the bot is at hunger \d+ with nothing carried to eat/);
});

test('a closed run hands over to the latest earlier one due to be asked, and left runs never come near stay on the list (note 1293)', () => {
  const { bot, goal } = world();
  const run = corpseRun(bot, goal);
  Object.assign(run, { status: 'left', told: 7 });
  const eyes = { deathAt: new Date(Date.now() - 6 * 3600000).toISOString(), position: { x: 1868, y: 61, z: -341 }, dimension: 'overworld', items: { ender_eye: 12 }, status: 'left', told: 5, passes: 0, stuck: 0 };
  const older = { deathAt: new Date(Date.now() - 11 * 3600000).toISOString(), position: { x: -211, y: 93, z: -324 }, dimension: 'nether', items: { iron_sword: 1 }, status: 'left', told: 5, passes: 0, stuck: 0 };
  goal.corpseRunsEarlier = [older, eyes];
  const next = corpseRun(bot, goal);
  assert.equal(next?.items?.ender_eye, 12, 'the eyes\' run, asked again with what it was not told');
  assert.ok(goal.corpseRunsEarlier.includes(older), 'the older left run kept');
  // Told everything already: nothing opens, and nothing is thrown away.
  const b = world();
  Object.assign(corpseRun(b.bot, b.goal), { status: 'left', told: 7 });
  const e2 = { ...eyes, told: 7 }, o2 = { ...older, told: 7 };
  b.goal.corpseRunsEarlier = [o2, e2];
  corpseRun(b.bot, b.goal);
  assert.equal(b.goal.corpseRunsEarlier.length + (b.goal.corpseRun === e2 || b.goal.corpseRun === o2 ? 1 : 0), 2, JSON.stringify({ list: b.goal.corpseRunsEarlier.map(r => [r.status, r.told]), now: [b.goal.corpseRun.status, b.goal.corpseRun.items] }));
});

test('a long walk with little food carried: getting food first is offered, and chosen, the food is gathered before the walk (note 1298)', async () => {
  const { bot, goal } = world();
  goal.survival.deaths[0].position = { x: 1100, y: 64, z: 0 };
  let text = '', gathered = 0, moved = 0;
  const client = { systemOne: async ({ questions }) => { text = JSON.stringify(Object.values(questions)[0]); return { answers: Object.fromEntries(Object.keys(questions).map(k => [k, { choice: 'food_first', confidence: 0.9 }])) }; } };
  const task = Object.assign(new Task('run'), { opportunityClient: client });
  const r = await corpseRunStep(bot, task, goal, () => {}, { move: async () => { moved++; }, collect: async () => false, gatherFood: async () => { gathered++; } });
  assert.match(text, /Get food for the walk first, here: hunted, cooked or taken from a chest, toward 28 food points carried \(0 now\)/);
  assert.equal(r, true); assert.equal(gathered, 1); assert.equal(moved, 0);
  assert.equal(goal.corpseRun.choice, 'go_back');
  goal.corpseRun.foodFirst.at = Date.now() - 21 * 60000;
  await corpseRunStep(bot, task, goal, () => {}, { move: async () => { moved++; }, collect: async () => false, gatherFood: async () => { gathered++; } });
  assert.equal(gathered, 1, 'twenty minutes spent: no more');
  assert.equal(goal.corpseRun.foodFirst, undefined);
});

test('a corpse run through the Nether ends its shortcut on arrival near the drop, and the walk takes the rest (note 1393)', () => {
  const ns = require('../src/nether-shortcut');
  const goal = { netherShortcut: { chest: { x: 598, y: 15, z: 1534 }, phase: 'out', at: 1, for: 'corpse_run' }, errand: { dimension: 'nether', items: [], for: ns.ERRAND, at: 1 },
    gameProgress: { milestones: { stronghold_located: { center: { x: 604, y: -37, z: 1540 } } } } };
  const far = { game: { dimension: 'overworld' }, entity: { position: { x: -14, y: 70, z: 104 } } };
  ns.settle(far, goal, () => {});
  assert.equal(goal.netherShortcut.phase, 'out', 'far off: still out');
  const near = { game: { dimension: 'overworld' }, entity: { position: { x: 482, y: 105, z: 1360 } } };
  ns.settle(near, goal, () => {});
  assert.equal(goal.netherShortcut, undefined);
  assert.equal(goal.errand, undefined);
});
