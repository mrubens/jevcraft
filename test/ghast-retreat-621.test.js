'use strict';
// Note 621: mid-242-ah-nether-2-fortress-5 (25589), 17:32:55Z on 2026-09-28.
// The bot stood on its own gravel at (-394, 65, -66) on a netherrack slope,
// 7.4 health, food 16, a ghast floating 40 blocks off at (-362.3, 84.3,
// -47.7) in sight and firing every three seconds, piglins 13 and 29 off out
// of sight. Its last four walks had stood where they began (the
// pathfinder's return, test/pathfinder-return-wedge.test.js), each retreat
// taken as done, and the stance said "A way is found: 16 blocks to footing
// 9 blocks further from every mob about ... About 4.5 damage" again, to
// footing the ghast had a line to; Jev took the retreat (0.60) and the next
// fireball took it to 4.3. The region is as saved after the death
// (test/fixtures/ghast-slope-mid-242-ah2.json).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { Survival } = require('../src/survival');
const { threats } = require('../src/danger');
const { seenFrom } = require('../src/bunker');
const { groundBot } = require('./fixtures/saved-ground');

const noop = async () => {};
const F = require('./fixtures/ghast-slope-mid-242-ah2.json');
const CARRIED = [['iron_sword', 1], ['stone_axe', 1], ['wooden_pickaxe', 1], ['netherrack', 29], ['gravel', 12], ['oak_fence', 15], ['white_wool', 2], ['light_gray_wool', 2], ['gray_wool', 1], ['black_wool', 7], ['warped_wart_block', 4],
  ['mutton', 9], ['water_bucket', 1], ['bucket', 1], ['flint_and_steel', 1], ['bow', 1], ['oak_log', 5]];
const GHAST = { id: 2997, name: 'ghast', at: new Vec3(-362.3, 84.3, -47.7), height: 4, width: 4 };
function slopeBot({ health = 7.42 } = {}) {
  const bot = groundBot(F, { at: new Vec3(-393.46, 66, -65.52), health, food: 16, dimension: 'the_nether', worn: ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'], held: 'iron_sword',
    items: CARRIED, mobs: [GHAST, { id: 2925, name: 'piglin', at: new Vec3(-391.2, 63, -77.5), height: 1.95 }, { id: 3016, name: 'piglin', at: new Vec3(-388.6, 55, -39.2), height: 1.95 }] });
  bot.inventory.slots[45] = { name: 'shield' };
  return bot;
}
const survivalOf = (bot, navigate = noop) => new Survival(bot, { place: noop, dig: noop, navigate }, { state: { shelters: [] } });

test('the ghast is in sight from the gravel where the bot stood (mid-242-ah-nether-2-fortress-5, 17:32:55)', () => {
  const bot = slopeBot();
  const ghast = threats(bot, 64).find(t => t.entity.name === 'ghast');
  assert.ok(ghast?.visible, 'the ghast has a line on the bot');
});


test('the retreat says its footing is in the ghast\'s line, and prices the fifteen seconds with the fire there (mid-242-ah-nether-2-fortress-5, 17:32:55; note 621)', async () => {
  const bot = slopeBot();
  const s = survivalOf(bot), task = new Task('x'), danger = threats(bot, 64);
  const scout = await s.scoutRetreat(task, danger, { budgetMs: 2000 });
  assert.ok(scout?.destination, `a way is found: ${JSON.stringify(scout)}`);
  const d = scout.destination;
  const ghast = Object.values(bot.entities).find(e => e.name === 'ghast');
  // Every footing the run may take here, four or more further from every
  // mob, is in the ghast's line: the one found is too.
  assert.equal(seenFrom(bot, [ghast], new Vec3(d.x, d.y, d.z)).length, 1);
  const options = s.stanceOptions(task, { step: { action: 'find_fortress' } }, () => {}, danger, false);
  const r = options.retreat.description;
  assert.match(r, /A way is found: \d+ blocks to footing/);
  assert.match(r, /The footing is not out of their sight: the ghast has a line to it from where it is now, and its shots go on there as here: about (\d+(\.\d)?) damage from the shooters in the next fifteen seconds this way, the run included, from 7\.4 health\./);
  const all = Number(/about (\d+(?:\.\d)?) damage from the shooters in the next fifteen seconds/.exec(r)[1]);
  const run = Number(/About (\d+(?:\.\d)?) damage from the shooters in range over those seconds/.exec(r)[1]);
  assert.ok(all > run * 3, `the fire after the run counted: ${run} over the run, ${all} in fifteen seconds`);
  // The spot out of its line two blocks off is on offer beside it.
  assert.match(options.out_of_sight?.description || '', /Walk 2 blocks to a spot .* that no line from the ghast reaches/);
});

test('the retreat\'s footing is sought out of the shooters\' line first (note 621)', () => {
  // The same ground with the ghast low in the west: some of the footings
  // the run may take are in its line and some are not.
  const bot = slopeBot();
  bot.entities[GHAST.id].position = new Vec3(-424, 70, -64);
  const ghast = bot.entities[GHAST.id];
  const s = survivalOf(bot), danger = threats(bot, 64);
  assert.ok(danger.find(t => t.entity.id === GHAST.id)?.visible, 'in sight');
  const { near } = s.escapeFootings(danger);
  const seen = near.slice(0, 24).map(p => seenFrom(bot, [ghast], p).length > 0);
  assert.ok(seen.includes(true) && seen.includes(false), `a mix: ${seen.join(' ')}`);
  assert.equal(seen.indexOf(true), seen.filter(x => !x).length, 'those out of its line first');
});

test('a retreat whose walk never leaves where it began is a stance that failed, said to the next question (note 621)', async () => {
  const bot = slopeBot();
  const stall = async () => { throw Object.assign(new Error('navigation timed out without reaching new ground'), { name: 'NavigationStall' }); };
  const s = survivalOf(bot, stall), task = new Task('x'), danger = threats(bot, 64);
  await s.scoutRetreat(task, danger, { budgetMs: 2000 });
  const done = await s.runAway(task, {}, () => {}, danger);
  assert.equal(done, false);
  assert.match(s.state.failWhy, /^the run to the footing at \(-?\d+, \d+, -?\d+\) ended [\d.]+ blocks short of it, where it began: navigation timed out without reaching new ground$/);
  // One that got a block or more is a partial escape, the mobs looked at again.
  const moved = slopeBot();
  const step = async () => { moved.entity.position = moved.entity.position.offset(1.2, 0, 0); throw new Error('navigation timed out without reaching new ground'); };
  const s2 = survivalOf(moved, step);
  await s2.scoutRetreat(task, threats(moved, 64), { budgetMs: 2000 });
  assert.equal(await s2.runAway(task, {}, () => {}, threats(moved, 64)), true);
});

test('in fire at 3.9 health with the ghast in sight, the ways out say its fire and whether each ends in its line (17:32:59; note 621)', () => {
  const { fireWays } = require('../src/vitals');
  const bot = slopeBot({ health: 3.88 });
  bot.entity.position = new Vec3(-395.5, 65, -65.5); // in the flame the save still has at (-396, 65, -66)
  bot.entities[GHAST.id].position = new Vec3(-355.8, 84.2, -35.4);
  const ways = fireWays(bot, new Task('x'));
  assert.ok(ways.out_of_fire, `a run out: ${Object.keys(ways).join(', ')}`);
  for (const k of Object.keys(ways)) assert.match(ways[k].description, /Its end is (in|out of) the line of the ghast/, k);
  const { shootersAtBody } = require('../src/vitals');
  const shot = shootersAtBody(bot);
  assert.match(shot.says, /^The ghast \d+ blocks off has the bot in sight and fires a fireball about every 3 seconds while it keeps a line, about 3\.1 health a fireball through the armour worn: at 3\.9 health, 2 that land end it, the burning besides\./);
});
