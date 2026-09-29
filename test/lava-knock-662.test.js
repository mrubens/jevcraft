'use strict';
// Note 662: the lava deaths of the overnight run of 2026-09-29 (04:49Z to
// 11:37Z; 20 "tried to swim in lava", 22 counting the falls a fireball
// threw the bot into), every one a knock: a ghast's fireball, a magma cube's
// hit, a hoglin's or a piglin's arrow, on a cell within a throw of the lava
// sea.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { Survival } = require('../src/survival');
const terrain = require('../src/terrain');

// A one-wide span at y 52 (its floor) over the lava sea, whose top is at y 31; the bot on it, at 20 health in iron.
function spanBot({ health = 18.9, items = [{ name: 'iron_sword', count: 1 }, { name: 'netherrack', count: 30 }] } = {}) {
  const registry = require('minecraft-data')('26.1');
  const solid = p => p.y === 52 && p.x === 0 && p.z >= -20 && p.z <= 20;
  const nameAt = p => solid(p) ? 'netherrack' : p.y <= 31 && p.y >= 20 ? 'lava' : p.y < 20 ? 'netherrack' : 'air';
  const iron = ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'].map(name => ({ name }));
  return Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health, food: 17, foodSaturation: 0, entities: {}, registry,
    time: { timeOfDay: 6000 }, entity: { position: new Vec3(0.5, 53, 0.5), onGround: true, velocity: new Vec3(0, 0, 0), width: 0.6, height: 1.8 }, oxygenLevel: 20,
    inventory: { items: () => items, emptySlotCount: () => 10, slots: { 5: iron[0], 6: iron[1], 7: iron[2], 8: iron[3], 45: { name: 'shield' } } },
    blockAt: p => { const f = p.floored(), name = nameAt(f); return { position: f, name, boundingBox: name === 'air' || name === 'lava' ? 'empty' : 'block', diggable: true }; },
    world: { raycast: () => null }, findBlocks: () => [], pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, setControlState() {} });
}
const cube = (id, z, name = 'magma_cube') => ({ entity: { id, name, position: new Vec3(0.5, 53, 0.5 + z), height: 2, width: 2.04 }, distance: Math.abs(z), visible: true });
const damageOf = text => Number((/About ([\d.]+) damage from the mobs here/.exec(text) || [])[1]);

test('a pillar over the lava sea is not priced at nothing against magma cubes: they jump higher than two blocks and their hit throws (the pillar was taken 0.71 to 0.77 against 13 cubes, four deaths)', () => {
  const bot = spanBot();
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  const crowd = [cube(1, 8), cube(2, 8.4), cube(3, 8.4), cube(4, 8.4), cube(5, 9), cube(6, 9.5)];
  const options = survival.stanceOptions(new Task('cross'), { step: { action: 'cross_toward' } }, () => {}, crowd, false);
  assert(options.pillar, Object.keys(options).join(','));
  assert.match(options.pillar.description, /Two up does not stop a magma cube \(jumps higher than two blocks, and its hit throws\)/);
  assert(damageOf(options.pillar.description) > 5, `the pillar's price: ${damageOf(options.pillar.description)} in ${options.pillar.description.slice(0, 400)}`);
  assert(options.pillar.expects.damage > 5, `expects ${options.pillar.expects.damage}`);
  assert.match(options.pillar.description, /Two up, \d+ magma cubes still reach/);
});

test('a slime is a jumper too', () => {
  const bot = spanBot();
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  const options = survival.stanceOptions(new Task('cross'), { step: { action: 'cross_toward' } }, () => {}, [cube(1, 6, 'slime')], false);
  assert(options.pillar.expects.damage > 0);
});

test('a fall into lava is priced at the pace measured in it: 0.4 blocks a second, not one', () => {
  assert.equal(terrain.LAVA_SWIM_BLOCKS_A_SECOND, 0.4);
  const bot = spanBot();
  // Lava at the feet's level beside a shore two blocks off: 5 seconds in it, not 2.
  const fate = terrain.lavaFate(bot, { into: 'lava', cell: new Vec3(1, 52, 0), fallBlocks: 20 }, 20);
  assert(fate, 'a fate');
  if (fate.shoreBlocks != null) assert.equal(fate.seconds, Math.round(fate.shoreBlocks / 0.4 * 10) / 10);
  assert.match(terrain.lavaFateSays({ ...fate, shoreBlocks: 2, seconds: 5, inIt: 21, takes: 36, burn: 15, fireSeconds: 15, nether: true, deadly: true }, 20, 20), /about 5 seconds swimming \(0\.4 blocks a second, measured: of 88 stretches in lava 62 ended in death/);
});

// A floor of 7 by 7 at y 52 over the lava sea (top at 31), the bot in its middle: the drop is four blocks off on
// every side. 25593 mid-243-fc (04:31:19Z) stood so with a ghast 37 blocks off in sight for seven seconds, the work
// going on because no drop was within three; its fireball threw the bot 4.5 blocks, over.
function plainBot(mob) {
  const bot = spanBot();
  const solid = p => p.y === 52 && Math.abs(p.x) <= 3 && Math.abs(p.z) <= 3;
  bot.blockAt = p => { const f = p.floored(), name = solid(f) ? 'netherrack' : f.y <= 31 && f.y >= 20 ? 'lava' : f.y < 20 ? 'netherrack' : 'air'; return { position: f, name, boundingBox: name === 'air' || name === 'lava' ? 'empty' : 'block', diggable: true }; };
  bot.entity.position = new Vec3(0.5, 53, 0.5);
  bot.entities = { [mob.id]: mob };
  return bot;
}
test('with a ghast in sight the drop looked for is as far as its fireball throws (five blocks), so four blocks off is "a push over a deadly drop"; a zombie about still looks three', () => {
  const { pushOverDrop, deadlyDropBeside } = require('../src/danger');
  const ghast = plainBot({ id: 9, name: 'ghast', type: 'hostile', position: new Vec3(30.5, 60, 0.5), height: 4, width: 4, isValid: true });
  assert.equal(deadlyDropBeside(ghast, 3), null, 'three blocks: none');
  assert(deadlyDropBeside(ghast, 5), 'five blocks: the lava');
  const over = pushOverDrop(ghast);
  assert(over, 'a ghast in sight and lava four blocks off is a push over a deadly drop');
  assert.equal(over.drop.blocksAway, 4);
  const zombie = plainBot({ id: 8, name: 'zombie', type: 'hostile', position: new Vec3(4.5, 53, 0.5), height: 1.95, width: 0.6, isValid: true });
  assert.equal(pushOverDrop(zombie), null, 'a zombie throws nothing four blocks');
});

test('the stance question with a ghast about says what a landed fireball threw the bot and what followed each stance, over a drop that kills', () => {
  const ghast = plainBot({ id: 9, name: 'ghast', type: 'hostile', position: new Vec3(30.5, 60, 0.5), height: 4, width: 4, isValid: true });
  const survival = new Survival(ghast, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  const danger = [{ entity: ghast.entities[9], distance: 30, visible: true }];
  const options = survival.stanceOptions(new Task('cross'), { step: { action: 'cross_toward' } }, () => {}, danger, false);
  const said = options.take_cover?.description || options.out_of_sight?.description || Object.values(options)[0].description;
  assert.match(said, /Measured: a ghast's fireball that lands: of 106 that landed on this bot in the Nether, the body went 1\.7 blocks \(half of them\), up to 4\.2 \(nine in ten\), 6\.1 the most, and 30 ended in lava/);
  const stance = Object.entries(options).find(([k]) => k === 'take_cover' || k === 'out_of_sight');
  assert(stance, Object.keys(options).join(','));
  assert.match(stance[1].description, /Measured on this bot: (take cover|out of sight) chosen with a drop that kills within three blocks and a ghast about, \d+ times \(each stretch counted once\): \d+ of them had the bot in lava within 30 seconds/);
});
