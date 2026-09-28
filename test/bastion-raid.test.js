'use strict';
// A bastion's chests are Jev's to open or leave (note 636): the question is
// offered only in the Nether with a bastion remembered and not resting, says
// what the chests hold and what a lifted lid does, and a bastion chest is
// opened only while a raid Jev chose is on. A desert temple's TNT chest is
// still shunned (physical safety).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const raid = require('../src/bastion-raid');
const { lootableChests, lootNearby, angerFromLid, structureOf } = require('../src/looting');
const { setAside } = require('../src/progress');

const task = { check() {} };
const bastion = { kind: 'bastion', x: 100, y: 64, z: 0, dimension: 'nether', gold: 6 };
const world = (blocks = {}, { dimension = 'the_nether', position = new Vec3(0, 64, 0), pockets = [], slots = {}, health = 20 } = {}) => {
  const items = pockets.map(([name, count]) => ({ name, count, type: registry.itemsByName[name].id }));
  return { items, bot: { registry, game: { dimension, gameMode: 'survival' }, entity: { position }, entities: {}, health, food: 20, chat() {},
    inventory: { items: () => items, emptySlotCount: () => 30 - items.length, slots },
    blockAt: p => { const name = blocks[`${p.x},${p.y},${p.z}`] || (p.y < 64 ? 'netherrack' : 'air'); return { name, boundingBox: name === 'air' ? 'empty' : 'block', position: p }; },
    findBlocks: ({ matching, count = 64 }) => Object.entries(blocks).filter(([, name]) => [].concat(matching).includes(registry.blocksByName[name]?.id)).map(([k]) => new Vec3(...k.split(',').map(Number))).slice(0, count) } };
};
const goalWith = (extra = {}) => ({ kind: 'win', landmarks: [bastion], ...extra });
const gold = { golden_boots: { name: 'golden_boots' } };

test('offered only in the Nether with a bastion remembered within reach and its walk not resting', () => {
  const { bot } = world();
  assert.equal(raid.offer(bot, goalWith()).distance, 100);
  assert.equal(raid.offer(world({}, { dimension: 'overworld' }).bot, goalWith()), null, 'not in the Overworld');
  assert.equal(raid.offer(bot, { kind: 'win', landmarks: [] }), null, 'no bastion remembered');
  assert.equal(raid.offer(bot, goalWith({ landmarks: [{ ...bastion, x: 900 }] })), null, 'past 384 blocks');
  assert.equal(raid.offer(bot, goalWith({ landmarks: [{ ...bastion, dimension: 'overworld' }] })), null, 'one in another dimension');
  const g = goalWith();
  setAside(g, 'landmark_trip', 'bastion:100,0', 'the walk there came no nearer', 1800000);
  assert.equal(raid.offer(bot, g), null, 'a walk resting is not offered');
});

test('the question says the trip, what the chests hold, what a lid does, the fights, and that it is not yet tried', () => {
  const { bot } = world({}, { slots: { 5: null, 8: { name: 'golden_boots' } }, pockets: [['bread', 4], ['gold_ingot', 3]] });
  bot.health = 14;
  const g = goalWith(), o = raid.offer(bot, g), f = raid.facts(bot, g, o);
  const text = JSON.stringify(f.state);
  assert.match(f.state.bastion.route, /1 leg: a trip walks one leg of at most 120 seconds/);
  assert.match(text, /lifting a lid turns every piglin within 16 blocks that can see the bot hostile, gold armor or not/i);
  assert.match(text, /A piglin brute is not touched by the lid and is not calmed by gold/);
  assert.match(text, /treasure room.*netherite upgrade template in every treasure chest/);
  assert.match(text, /enchanted golden apple 5%/);
  assert.match(text, /hoglin stable.*golden apple 10%/);
  assert.match(text, /not known: how many piglins, brutes and hoglins live in this bastion/);
  assert.match(f.state.mobsThere.inView, /None in view now/);
  assert.match(f.state.record.bastionChestsOpenedByTheBotEver, /not yet tried/);
  assert.equal(f.state.health, 14);
  assert.match(f.state.goldArmorWorn, /^yes/);
  assert.match(f.state.fights.oneBrute, /piglin brute.*seconds.*damage.*leaving about|more than the/);
  assert.match(f.state.fights.note, /not measured on a bastion/);
  assert.match(f.state.whatItHelps, /3 ingots of gold carried.*about 9 ingots a pearl/);
  const tree = raid.options(bot, g, o, f);
  assert.deepEqual(Object.keys(tree), ['raid_chests', 'gold_only', 'leave_it']);
  assert.match(tree.raid_chests.description, /never been tried: no bastion chest has ever been opened by the bot/);
  assert.match(tree.raid_chests.description, /angers every piglin within 16 blocks that sees it, gold armor or not/);
  assert.deepEqual(tree.raid_chests.target, { x: 100, y: 64, z: 0 });
});

test('no gold armor is said, and a brute in sight is counted and priced', () => {
  const { bot } = world();
  bot.entities[4] = { id: 4, name: 'piglin_brute', position: new Vec3(20, 64, 0), isValid: true };
  bot.entities[5] = { id: 5, name: 'piglin', position: new Vec3(30, 64, 4), isValid: true };
  const g = goalWith(), f = raid.facts(bot, g, raid.offer(bot, g));
  assert.match(f.state.goldArmorWorn, /^no: piglins in sight will attack/);
  assert.match(f.state.mobsThere.inView, /1 piglin brute \(nearest 20 blocks off\), 1 piglin/);
  assert.match(f.state.fights.inView, /Everything in view now \(2 mobs\)/);
  assert.equal(f.state.wearing, 'no armor');
});

test('asked once and held; Jev\'s pick is what the trip does; leave_it rests the rung; no client is gold only', async () => {
  const { bot } = world();
  const asked = [];
  const client = pick => ({ systemOne: async ({ questions }) => { asked.push(Object.keys(Object.values(questions)[0].criteria)); return { answers: { branch_0: { choice: pick, confidence: 0.8 } } }; } });
  const g = goalWith();
  assert.equal(await raid.chooseTrip(bot, task, g, () => {}, { client: client('raid_chests') }), 'raid_chests');
  assert.deepEqual(asked[0], ['raid_chests', 'gold_only', 'leave_it']);
  assert.equal(raid.raidOn(g), true);
  assert.equal(g.bastionRaids[0].outcome, 'pending');
  assert.equal(await raid.chooseTrip(bot, task, g, () => {}, { client: client('leave_it') }), 'raid_chests', 'held: not asked again at each leg');
  assert.equal(asked.length, 1);
  // Leaving it: the gold rung rests.
  const g2 = goalWith();
  assert.equal(await raid.chooseTrip(bot, task, g2, () => {}, { client: client('leave_it') }), 'leave_it');
  assert.equal(require('../src/progress').isSetAside(g2, 'rung', 'bastion_gold'), true);
  assert.equal(g2.bastionRaids[0].outcome, 'declined');
  assert.equal(raid.raidOn(g2), false);
  // Jev unreachable: the code default takes the gold only.
  assert.equal(await raid.chooseTrip(bot, task, goalWith(), () => {}, {}), 'gold_only');
  // No bastion: nothing to ask.
  assert.equal(await raid.chooseTrip(bot, task, { kind: 'win', landmarks: [] }, () => {}, { client: client('raid_chests') }), 'gold_only');
  assert.equal(asked.length, 2);
});

test('a raid ends in what it took or in nothing, and in a death when the bot died in it; either is said on the next asking', async () => {
  const { bot } = world();
  const client = { systemOne: async () => ({ answers: { branch_0: { choice: 'raid_chests', confidence: 0.7 } } }) };
  const g = goalWith();
  await raid.chooseTrip(bot, task, g, () => {}, { client });
  const at = g.bastionRaid.at;
  g.looted = { '1,1,1': { at: at + 5, structure: 'bastion', took: { gold_block: 2, golden_apple: 1 }, left: {} } };
  const entry = raid.closeRaid(g);
  assert.equal(entry.outcome, 'looted');
  assert.deepEqual(entry.took, { gold_block: 2, golden_apple: 1 });
  assert.equal(raid.raidOn(g), false, 'the chests shut to the code once the raid closes');
  assert.equal(raid.heldFor(g, bastion).pick, 'gold_only', 'the trip goes on as the gold\'s, not asked again');
  // Another trip, a death in it.
  const g2 = goalWith();
  await raid.chooseTrip(bot, task, g2, () => {}, { client });
  g2.survival = { deaths: [{ at: new Date(Date.now() + 1000).toISOString(), cause: 'slain by Piglin Brute' }] };
  assert.equal(raid.raidOn(g2, Date.now() + 2000), false, 'a death ends the raid');
  assert.equal(g2.bastionRaids[0].outcome, 'died');
  const f = raid.facts(bot, g2, raid.offer(bot, g2), Date.now() + 60000);
  assert.match(f.state.record.thisRun[0], /^died \(slain by Piglin Brute\)/);
  assert.match(raid.options(bot, g2, raid.offer(bot, g2), f).raid_chests.description, /raids on this bastion before: died/);
  assert.equal(raid.heldFor(g2, bastion), null, 'asked again after a death');
});

test('a bastion chest is passed unless Jev chose the raid, opened when chosen; a TNT chest is never opened', async () => {
  const blocks = { '104,64,0': 'chest', '30,64,0': 'chest', '31,64,0': 'tnt' };
  const { bot, items } = world(blocks, { position: new Vec3(100, 64, 0) });
  const goal = goalWith();
  assert.equal(lootableChests(bot, goal).length, 0, 'not chosen: the bastion\'s chest is left');
  goal.bastionRaid = { key: 'bastion:100,0', pick: 'gold_only', at: Date.now() };
  assert.equal(lootableChests(bot, goal).length, 0, 'gold only opens no chest');
  goal.bastionRaid = { key: 'bastion:100,0', pick: 'raid_chests', at: Date.now() };
  const opened = [];
  const actions = { approach: async (b, t, name, [p]) => ({ name, position: p }), makeRoom: false,
    open: async (b, t, block) => { opened.push(block.position); return { containerItems: () => [{ name: 'gold_block', count: 2, type: registry.itemsByName.gold_block.id }, { name: 'cracked_polished_blackstone_bricks', count: 5, type: 1 }],
      withdraw: async (type, meta, count) => { items.push({ name: registry.items[type].name, count, type }); }, close() {} }; } };
  assert.equal(await lootNearby(bot, task, goal, () => {}, actions), true);
  assert.equal(items.find(i => i.name === 'gold_block').count, 2);
  assert.equal(goal.looted['104,64,0'].structure, 'bastion');
  // The TNT chest at the temple: shunned whatever was chosen.
  const tnt = world({ '30,64,0': 'chest', '31,64,0': 'tnt' }, { position: new Vec3(30, 64, 0) }).bot;
  assert.equal(lootableChests(tnt, { landmarks: [{ kind: 'bastion', x: 30, y: 64, z: 0, dimension: 'nether' }], bastionRaid: { pick: 'raid_chests', at: Date.now() } }).length, 0, 'a trapped chest is not opened even in a chosen raid');
  const temple = world({ '30,64,0': 'chest', '31,64,0': 'tnt' }, { dimension: 'overworld', position: new Vec3(30, 64, 0) }).bot;
  assert.equal(lootableChests(temple, { landmarks: [{ kind: 'desert_temple', x: 30, y: 64, z: 0, dimension: 'overworld' }] }).length, 0, 'the desert temple chest stays shunned');
});

test('a chest among blackstone is a bastion\'s, whichever landmark was written down, and is passed unchosen', () => {
  const blocks = { '10,64,0': 'chest' };
  for (let dx = 8; dx <= 12; dx++) blocks[`${dx},63,0`] = 'polished_blackstone_bricks';
  const { bot } = world(blocks, { position: new Vec3(5, 64, 0) });
  const s = structureOf({ landmarks: [] }, new Vec3(10, 64, 0), bot);
  assert.equal(s.kind, 'bastion');
  assert.equal(lootableChests(bot, { landmarks: [] }).length, 0, 'not opened as "a chest seen" with no piglin in sight');
  assert.equal(lootableChests(bot, { landmarks: [], bastionRaid: { pick: 'raid_chests', at: Date.now() } }).length, 1);
});

test('the lid turns the piglins that saw it hostile to the survival layer, gold worn or not', () => {
  const { bot } = world({}, { position: new Vec3(0, 64, 0) });
  bot.entities[1] = { id: 1, name: 'piglin', position: new Vec3(8, 64, 0), isValid: true };
  bot.entities[2] = { id: 2, name: 'piglin', position: new Vec3(40, 64, 0), isValid: true };
  bot.entities[3] = { id: 3, name: 'piglin_brute', position: new Vec3(6, 64, 0), isValid: true };
  const angered = angerFromLid(bot);
  assert.deepEqual(angered.map(e => e.id), [1], 'only a piglin within 16 blocks (a brute is not touched by the lid)');
  assert.equal(bot._provokedMobs.get(1), bot.entities[1]);
  const { threats } = require('../src/danger');
  bot.inventory.slots = { 8: { name: 'golden_boots' } };
  bot.time = { timeOfDay: 1000 };
  assert(threats(bot, 24).some(t => t.entity.id === 1), 'the survival layer counts the angered piglin though gold is worn');
});
