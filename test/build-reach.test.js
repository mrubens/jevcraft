'use strict';
// Note 581: a shelter built or dug under the mobs' noses is priced with every
// biter that can be at the bot before it is closed, seen or not, at its own
// speed and with its own blow; one there first is in with the bot.
// mid-242-ad-nether-3 (25586), 04:26:56, iron helmet and chestplate, no gold:
// the pocket's 23 blocks and 13.8 seconds were priced "about 0 damage" with a
// sword piglin 15.7 blocks off round the rock (said only as "out of sight but
// about"); built nearest cell first, its walls went up and its roof last,
// with ground two up beside its column, and the piglin dropped in over the
// bot's head eleven seconds later: 20, 13.3, 6.6, dead.
// mid-244-ag (25581), 04:43:02, a cave at y 10: the bunker was priced "about
// 8.9 damage ... at the doorway, one biter at a time" with five zombies
// within ten blocks, three out of sight past the eight counted; all five were
// at it while it dug, fourteen hits from 20 to none.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('node:events');
const { Task } = require('../src/skills');
const { Survival, pocketPlan, pocketBiters, piglinGoldSays } = require('../src/survival');

const registry = require('minecraft-data')('26.1');
// Every line blocked: nothing is in sight (lineClear).
const blind = { raycast: (from, dir) => ({ position: from.plus(dir).floored(), intersect: from.plus(dir) }) };
const mob = (id, name, x, y, z, held) => ({ id, name, type: 'hostile', position: new Vec3(x, y, z), height: 1.95, isValid: true, ...(held ? { heldItem: { name: held } } : {}) });
const threat = (bot, entity, visible = false) => ({ entity, distance: entity.position.distanceTo(bot.entity.position), visible });

// Netherrack to y 40; a terrace two high from z 2 south, so the ground at
// y 43 is level with the top of the pocket's walls (as at (-24, 43, 123)).
const netherBot = ({ entities, items = [{ name: 'netherrack', count: 27 }, { name: 'iron_sword', count: 1 }], slots = {} }) => {
  const solid = p => p.y <= 40 || (p.z >= 2 && p.y <= 42);
  return Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, entities, health: 20, food: 19, registry,
    time: { timeOfDay: 18000 }, entity: { position: new Vec3(0.5, 41, 0.5), onGround: true, velocity: new Vec3(0, 0, 0) }, oxygenLevel: 20,
    inventory: { items: () => items, emptySlotCount: () => 10, slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 45: { name: 'shield' }, ...slots } },
    blockAt: p => ({ position: p, name: solid(p) ? 'netherrack' : 'air', boundingBox: solid(p) ? 'block' : 'empty' }),
    world: blind, findBlocks: () => [], pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, setControlState() {} });
};

test('a pocket is priced with the sword piglin out of sight 15.6 blocks off, at the bot long before its blocks are down (mid-242-ad-nether-3)', () => {
  const sword = mob(747, 'piglin', 0.5, 43, 16, 'golden_sword'), bow = mob(748, 'piglin', -12, 41, -9, 'crossbow');
  const bot = netherBot({ entities: { 747: sword, 748: bow } });
  const survival = new Survival(bot, { navigate: async () => {}, place: async () => {} }, { state: { shelters: [] } });
  // As the record had it: the crossbow piglin the only mob in the danger list.
  const options = survival.stanceOptions(new Task('t'), {}, () => {}, [threat(bot, bow)], false);
  const seal = options.seal;
  assert.ok(seal, Object.keys(options).join(','));
  // It was 0: the one mob priced was a shooter out of sight.
  assert.ok(seal.expects.damage >= 20, JSON.stringify(seal.expects));
  assert.match(seal.description, /About 25 blocks to place here, some 15 seconds of building; the nearest piglin, 16 blocks off and out of sight, can be at the bot in about 2\.7 seconds at its own speed\./);
  assert.match(seal.description, /The piglin can be there before they are shut: one there first stands in a gap or drops in over the head, and the pocket does not close on it\./);
  assert.match(seal.description, /Counted though out of sight, at the bot before the building is done at its own speed: the piglin 16 blocks off, in about 2\.7 seconds\./);
  // Its blow leads, through this armour: 8 bare, 6.7 through the iron.
  assert.match(seal.description, /^The piglin 16 blocks off, out of sight, hits for about 6\.7 a blow through the armour worn \(8 before it\)/);
  // A stance with a second of setting up does not count it: it is not there.
  assert.equal(options.fight.expects.damage, 0);
});

test('the pocket goes up as a player closes one: the side toward the biter first, and the cell over the head before the corners where ground is level with the walls\' top', async () => {
  const sword = mob(747, 'piglin', 0.5, 43, 16, 'golden_sword');
  const bot = netherBot({ entities: { 747: sword } });
  const plan = pocketPlan(bot, bot.entity.position.floored(), pocketBiters(bot));
  const key = c => `${c.x},${c.y},${c.z}`;
  const at = k => plan.cells.map(key).indexOf(k);
  // The terrace's own rock stands in the south wall already: the nearest
  // missing cells toward the piglin are the south corners at the feet.
  assert.deepEqual(plan.cells.slice(0, 2).map(c => c.z), [1, 1], plan.cells.map(key).join(' '));
  assert.ok(plan.over, 'ground level with the walls\' top');
  assert.ok(at('0,43,0') < at('1,43,1') && at('0,43,0') < at('-1,43,-1'), 'the roof over the head before its corners');
  assert.ok(at('0,43,0') < plan.ways, 'the cell over the head is a way in');
  assert.ok(plan.shutAt < plan.seconds);
  // And sealHere lays them in that order.
  const placed = [];
  const survival = new Survival(bot, { navigate: async () => {}, place: async (b, task, p) => { placed.push(key(p)); } }, { state: { shelters: [] } });
  await survival.sealHere(new Task('t'), {}, () => {}, []);
  assert.deepEqual(placed, plan.cells.map(key));
});

test('with no biter able to come before the ways in are shut, the pocket keeps them out, and says so', () => {
  const sword = mob(747, 'piglin', 0.5, 43, 16, 'golden_sword');
  const bot = netherBot({ entities: { 747: sword } });
  // Almost built: only the roof's cells are left.
  const solid = p => p.y <= 40 || (p.z >= 2 && p.y <= 42) || (Math.abs(p.x) <= 1 && Math.abs(p.z) <= 1 && p.y <= 42 && !(p.x === 0 && p.z === 0));
  bot.blockAt = p => ({ position: p, name: solid(p) ? 'netherrack' : 'air', boundingBox: solid(p) ? 'block' : 'empty' });
  const survival = new Survival(bot, { navigate: async () => {}, place: async () => {} }, { state: { shelters: [] } });
  const seal = survival.stanceOptions(new Task('t'), {}, () => {}, [], false).seal;
  assert.match(seal.description, /shut to walkers after 1 block, about 0\.6 seconds/);
  assert.match(seal.description, /They are shut before the piglin can be there\./);
  assert.match(seal.description, /Shut in, none of them reaches it\./);
});

test('a bunker is priced with every zombie at the bot before it is dug in, seen or not, fought there together (mid-244-ag)', () => {
  // A cave corridor two high along x at z 0, stone round it.
  const open = p => p.z === 0 && (p.y === 10 || p.y === 11) && Math.abs(p.x) <= 30;
  const zombies = [[6.4, true], [7.2, true], [9.5, false], [10.4, false], [11.6, false]].map(([x, seen], i) => ({ e: mob(100 + i, 'zombie', x, 10, 0.5), seen }));
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, entities: Object.fromEntries(zombies.map(z => [z.e.id, z.e])), health: 20, food: 20, registry,
    time: { timeOfDay: 6000 }, entity: { position: new Vec3(0.5, 10, 0.5), onGround: true, velocity: new Vec3(0, 0, 0) }, oxygenLevel: 20,
    inventory: { items: () => [{ name: 'iron_sword', count: 1 }, { name: 'iron_pickaxe', count: 1 }, { name: 'cobblestone', count: 2 }], emptySlotCount: () => 10, slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 7: { name: 'iron_leggings' }, 8: { name: 'iron_boots' } } },
    blockAt: p => ({ position: p, name: open(p) ? 'air' : 'stone', boundingBox: open(p) ? 'empty' : 'block', diggable: !open(p) }),
    // In sight only the two nearest: the rest round a bend.
    world: { raycast: (from, dir, len) => (len > 7 ? blind.raycast(from, dir) : null) }, findBlocks: () => [], pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, setControlState() {} });
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
  const danger = zombies.filter(z => z.seen).map(z => threat(bot, z.e, true));
  const options = survival.stanceOptions(new Task('t'), {}, () => {}, danger, false);
  const bunker = options.bunker;
  assert.ok(bunker, Object.keys(options).join(','));
  const damage = Number(bunker.description.match(/About ([\d.]+) damage from the mobs here/)[1]);
  const fight = options.fight.expects.damage;
  // Was one at a time at the doorway, the three round the bend uncounted:
  // less than the fight here. Now all five follow it in.
  assert.match(bunker.description, /In it, with the 5 there before it is dug in fought together in the tunnel \(the doorway holds back only those after\), 5 zombies still reach it\./);
  assert.match(bunker.description, /Counted though out of sight, at the bot before the digging in is done at its own speed: the zombie 9 blocks off, in about 3\.3 seconds, the zombie 10 blocks off, in about 3\.7 seconds, the zombie 11 blocks off, in about 4\.2 seconds\./);
  assert.ok(damage > fight, `the bunker ${damage}, the fight here ${fight}`);
});

test('the stance question says why the piglins attack and what a gold piece would take', () => {
  const piglin = { entity: mob(1, 'piglin', 5, 41, 0, 'golden_sword'), distance: 5 };
  const bare = netherBot({ entities: {} });
  assert.match(piglinGoldSays(bare, [piglin]), /^The piglins here go for the bot because it wears no gold: a piglin leaves a player wearing any one piece of gold armour alone, save one angry with it .*; a piglin brute goes for a player whatever is worn\. No gold armour is carried, nor gold to make any \(golden boots take four ingots at a crafting table\)\.$/);
  const boots = netherBot({ entities: {}, items: [{ name: 'golden_boots', count: 1 }] });
  assert.match(piglinGoldSays(boots, [piglin]), /Golden boots is carried: putting it on is one move in the inventory, under half a second standing still, on the feet, bare now, so nothing worn comes off\./);
  const helmet = netherBot({ entities: {}, items: [{ name: 'golden_helmet', count: 1 }] });
  assert.match(piglinGoldSays(helmet, [piglin]), /Golden helmet is carried: .* in place of the iron helmet\./);
  const worn = netherBot({ entities: {}, slots: { 8: { name: 'golden_boots' } } });
  assert.equal(piglinGoldSays(worn, [piglin]), null);
  assert.equal(piglinGoldSays(bare, []), null);
});

test('25594 (22:27Z): a creeper coming into sight while the pocket goes up ends the pass once it would go off before the cells left are laid (note 843)', async () => {
  const creeper = mob(901, 'creeper', 0.5, 43, 14);
  const bot = netherBot({ entities: { 901: creeper } });
  const placed = [];
  // Each block laid, the creeper walks two blocks nearer.
  const survival = new Survival(bot, { navigate: async () => {}, place: async (b, task, p) => { placed.push(p); creeper.position = creeper.position.offset(0, 0, -2); } }, { state: { shelters: [] } });
  const sealed = await survival.sealHere(new Task('t'), {}, () => {}, []);
  assert.equal(sealed, false);
  const all = pocketPlan(netherBot({ entities: {} }), bot.entity.position.floored(), []).cells.length;
  assert(placed.length > 0 && placed.length < all, `${placed.length} of ${all} laid`);
});

test('a biter at arm\'s length with the pocket half laid ends the pass, and so do three blocks that will not go in with mobs about: the encounter is asked (note 1187)', async () => {
  const zombie = mob(902, 'zombie', 0.5, 41, -14);
  const bot = netherBot({ entities: { 902: zombie } });
  const placed = [];
  // Each block laid, the zombie walks three blocks nearer.
  const survival = new Survival(bot, { navigate: async () => {}, place: async (b, task, p) => { placed.push(p); zombie.position = zombie.position.offset(0, 0, 3); } }, { state: { shelters: [] } });
  assert.equal(await survival.sealHere(new Task('t'), {}, () => {}, []), false);
  const all = pocketPlan(netherBot({ entities: {} }), bot.entity.position.floored(), []).cells.length;
  assert(placed.length > 0 && placed.length < all, `${placed.length} of ${all} laid`);
  // Blocks that will not go in, a zombie twelve blocks off: not called a pocket.
  const far = mob(903, 'zombie', 0.5, 41, -12);
  const stuck = netherBot({ entities: { 903: far } });
  let tries = 0;
  const failing = new Survival(stuck, { navigate: async () => {}, place: async () => { if (++tries > 2) throw new Error('the block is still air'); } }, { state: { shelters: [] } });
  assert.equal(await failing.sealHere(new Task('t'), {}, () => {}, []), false);
  assert.equal(tries, 5);
});
