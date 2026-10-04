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
  assert.match(asked[0], /400 blocks off, about 2 minutes' walk/);
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
