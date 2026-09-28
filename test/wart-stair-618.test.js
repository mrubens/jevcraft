'use strict';
// Note 618: mid-242-af-nether-3-fortress-5 (25584), fireballed by a blaze at
// 17:12:39Z on 2026-09-28. From 17:10:57 the blaze rested on the fortress's
// stair run at (-170, 57, 148.7), four up and 4.9 to 5.3 blocks from the bot
// in the nether wart bed below on soul sand at y 52.875; it was never struck,
// and the stances turned every second or two with the bot hardly moving.
// The ground is the saved region, read from a copy (test/fixtures), stairs
// and fences with their block state, and the ray stops at a block's own
// shapes as mineflayer's does.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { Survival } = require('../src/survival');
const { threats, lineClear, blocksRay } = require('../src/danger');
const { feetCell } = require('../src/terrain');
const bunker = require('../src/bunker');
const stand = require('../src/blaze-stand');
const { groundBot, registry } = require('./fixtures/saved-ground');

const GROUND = require('./fixtures/wart-stair-mid-242-af.json');
const IRON = ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'];
// Carried at 17:11:30 (the flight's frame), what bears on the stances.
const CARRIED = [['iron_sword', 1], ['iron_pickaxe', 1], ['stone_pickaxe', 3], ['stone_sword', 1], ['netherrack', 171], ['nether_bricks', 26], ['granite', 111], ['diorite', 87], ['blaze_rod', 1]];
const IN_BED = new Vec3(-168.5, 52.875, 146.5);           // 17:11:07 to 17:11:28
const ON_STAIR = new Vec3(-170, 57, 148.7);               // blaze 1117 from 17:10:57
function wartBot({ at = IN_BED, health = 16.5, far = false } = {}) {
  const mobs = [{ id: 1117, name: 'blaze', at: ON_STAIR, height: 1.8 }];
  // Those heard 34 to 39 off, beyond the box of saved ground (out of sight).
  if (far) mobs.push({ id: 1224, name: 'blaze', at: new Vec3(-170.3, 58, 184.9), height: 1.8 });
  const bot = groundBot(GROUND, { at, health, food: 17, dimension: 'the_nether', shapes: true, held: 'iron_sword', worn: IRON, items: CARRIED, mobs });
  bot.inventory.slots[45] = { name: 'shield' };
  bot.players = {};
  return bot;
}

test('on soul sand the feet are in the cell over it, not in the soul sand: the floored position is the block stood on (note 618)', () => {
  const bot = wartBot();
  assert.equal(`${IN_BED.floored()}`, '(-169, 52, 146)', 'floored, the soul sand itself');
  assert.equal(bot.blockAt(IN_BED.floored()).name, 'soul_sand');
  assert.equal(`${feetCell(bot)}`, '(-169, 53, 146)');
  assert(bunker.standable(bot, feetCell(bot)), 'the cell the bot stands in is one a stance can stand in');
  // On a full block, and in the air over one, the floored position is the cell.
  bot.entity.position = new Vec3(-160.5, 53, 146.5);
  assert.equal(`${feetCell(bot)}`, '(-161, 53, 146)');
  bot.entity.position = new Vec3(-160.5, 53.4, 146.5);
  assert.equal(`${feetCell(bot)}`, '(-161, 53, 146)');
  // On the low half of a stair at y 55: the cell over it.
  bot.entity.position = new Vec3(-171.5, 55.5, 147.2);
  assert.equal(bot.blockAt(bot.entity.position.floored()).name, 'nether_brick_stairs');
  assert.equal(`${feetCell(bot)}`, '(-172, 56, 147)');
});

test('a ray over a stair\'s low half passes, and one through its high half is stopped, as the game\'s raycast has it (note 618)', () => {
  const Block = require('prismarine-block')(registry);
  const stair = Block.fromProperties('nether_brick_stairs', { facing: 'south', half: 'bottom', shape: 'straight' }, 0);
  const cell = new Vec3(0, 0, 0), along = (from, to) => { const d = to.minus(from); return [from, d.scaled(1 / d.norm()), d.norm()]; };
  assert.equal(blocksRay(stair, cell, ...along(new Vec3(-1, 0.75, 0.25), new Vec3(2, 0.75, 0.25))), false, 'over the low half, the north side');
  assert.equal(blocksRay(stair, cell, ...along(new Vec3(-1, 0.75, 0.75), new Vec3(2, 0.75, 0.75))), true, 'through the high half, the south side');
  assert.equal(blocksRay(stair, cell, ...along(new Vec3(-1, 0.25, 0.25), new Vec3(2, 0.25, 0.25))), true, 'through the low half');
  const bricks = Block.fromStateId(registry.blocksByName.nether_bricks.defaultState, 0);
  assert.equal(blocksRay(bricks, cell, ...along(new Vec3(-1, 0.9, 0.9), new Vec3(2, 0.9, 0.9))), true);
});

test('in the wart bed the blaze on the stair has a line to the bot, and no stance says it has none (17:11:07, note 618)', () => {
  const bot = wartBot();
  const blaze = bot.entities[1117], eye = blaze.position.offset(0, 1.53, 0);
  // Its eye to the bot's own: the head is open to it over the stairs.
  assert(lineClear(bot, eye, IN_BED.offset(0, 1.62, 0)), 'a line to the bot\'s eyes');
  assert.equal(bunker.seenFrom(bot, [blaze], feetCell(bot)).length, 1, 'seen where the bot stands');
  assert.equal(bunker.seenFrom(bot, [blaze], IN_BED.floored()).length, 0, 'the soul sand\'s cell, a block lower, is out of its line: what the stances were told');
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
  const danger = threats(bot, 24);
  assert.deepEqual(danger.map(t => [t.entity.id, t.visible]), [[1117, true]]);
  const options = survival.stanceOptions(new Task('x'), { mobHunt: { item: 'blaze_rod', want: 8 } }, () => {}, danger, false);
  // Recorded: "Stay here behind what stands in the line already: nothing
  // for the blaze (5 blocks off): the nether brick stairs at (-170, 55,
  // 147) is in its line already"; held twenty seconds, then fireballed.
  assert.doesNotMatch(options.take_cover?.description || '', /Stay here behind what stands in the line already/);
  // Recorded: "round the corner at (-169, 53, 146), where none of the 4
  // blazes about has a line to the bot", the cell the bot stood in.
  if (options.corner_ambush) assert.doesNotMatch(options.corner_ambush.description, /at \(-169, 53, 146\)/);
  if (options.out_of_sight) assert.doesNotMatch(options.out_of_sight.description, /^Stay/);
});

test('the blaze resting on the stair four up is struck from the stair run beside it: close_in is offered, and the ground it walks to is within the sword\'s reach (note 618)', () => {
  const bot = wartBot();
  const blaze = bot.entities[1117];
  const cells = stand.strikeCells(bot, blaze);
  assert(cells.length, 'ground the sword reaches it from');
  for (const c of cells) {
    assert(bunker.standable(bot, c), `${c} is ground`);
    assert(/stairs/.test(bot.blockAt(c.offset(0, -1, 0)).name), `${c} is on the stair run`);
    assert(c.offset(0.5, 1.62, 0.5).distanceTo(blaze.position.offset(0, 0.9, 0)) <= 3.2);
  }
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
  const options = survival.stanceOptions(new Task('x'), { mobHunt: { item: 'blaze_rod', want: 8 } }, () => {}, threats(bot, 24), false);
  assert.match(options.close_in?.description || '', /walk in on the nearest blaze ground reaches \(4\.9 blocks off/);
  // At 1 health, where it stood from 17:11:42 to the end.
  const low = wartBot({ at: new Vec3(-168.08, 52.875, 145.83), health: 1 });
  const lowOptions = new Survival(low, { navigate: async () => {} }, { state: { shelters: [] } }).stanceOptions(new Task('x'), { mobHunt: { item: 'blaze_rod', want: 8 } }, () => {}, threats(low, 24), false);
  assert(lowOptions.close_in, 'the blaze that shot it is offered to the sword at 1 health too, at its price');
});

test('the charge at the nearest blaze stays on it: that one set aside, it ends and says why, not walking at a blaze 38 blocks off out of sight (17:10:57, note 618)', async () => {
  const bot = wartBot({ far: true });
  Object.assign(bot, { lookAt: async () => {}, dig: async () => {} });
  const walked = [];
  const noRoute = async (b, task, goal) => { walked.push(new Vec3(goal.x, goal.y, goal.z)); throw Object.assign(new Error('No path to the goal!'), { name: 'NoRoute' }); };
  const result = await stand.closeIn(bot, new Task('t'), {}, () => {}, { navigate: noRoute, seconds: 8, upTo: 1, stallMs: 20000 });
  assert(walked.length >= 1, 'it walked at the stair run');
  for (const w of walked) assert(w.distanceTo(ON_STAIR) < 4, `every walk toward the blaze it charged, not ${w}`);
  assert.match(result.stalled || '', /the walk to one failed \d+ times \(No path to the goal!\); the blaze it charged is set aside$/);
  assert.equal(walked.length, 3, 'three of its cells tried before it is set aside');
});
