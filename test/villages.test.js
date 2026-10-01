'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const villages = require('../src/villages');
const home = require('../src/home-base');
const { preparationStage, gameStep } = require('../src/game-progress');
const { forageChoices } = require('../src/foraging');
const { narrate } = require('../src/narration');
require('../src/narration').setRandom(() => 0);
const { LEVEL, world, pond, goalWith } = require('./fixtures/home-world');

// A village on the flat world: a bell, hay stacked beside it, beds in
// the houses, and a farm of ripe wheat on farmland.
function village(w, { x = 30, z = 0, bell = true, hay = 3, beds = 2, wheat = 0, age = 7 } = {}) {
  if (bell) w.set(new Vec3(x, LEVEL + 1, z), 'bell');
  for (let i = 0; i < hay; i++) w.set(new Vec3(x + 2 + i, LEVEL + 1, z + 2), 'hay_block');
  for (let i = 0; i < beds; i++) { w.set(new Vec3(x - 3, LEVEL + 1, z + 3 + i * 2), 'white_bed', { part: 'foot' }); w.set(new Vec3(x - 2, LEVEL + 1, z + 3 + i * 2), 'white_bed', { part: 'head' }); }
  for (let i = 0; i < wheat; i++) { w.set(new Vec3(x + 4, LEVEL, z - 4 + i), 'farmland', { moisture: 7 }); w.set(new Vec3(x + 4, LEVEL + 1, z - 4 + i), 'wheat', { age }); }
  return { x, y: LEVEL + 1, z };
}

test('a bell, several hay bales or villagers make a village; beds are counted once, not per half', () => {
  const w = world({});
  assert.equal(villages.observeVillage(w.bot), null, 'a plain field is no village');
  village(w, { hay: 3, beds: 2 });
  const seen = villages.observeVillage(w.bot);
  assert.deepEqual({ x: seen.x, y: seen.y, z: seen.z }, { x: 30, y: LEVEL + 1, z: 0 }, 'the bell is the centre');
  assert.deepEqual(seen.bell, { x: 30, y: LEVEL + 1, z: 0 }); assert.equal(seen.beds, 2); assert.equal(seen.hay, 3);
  // Two hay bales alone are a farm, not a village; three are.
  const bare = world({}); village(bare, { bell: false, hay: 2, beds: 0 });
  assert.equal(villages.observeVillage(bare.bot), null);
  const hay = world({}); village(hay, { bell: false, hay: 3, beds: 1 });
  assert.equal(villages.observeVillage(hay.bot).bell, undefined); assert.equal(villages.observeVillage(hay.bot).beds, 1);
  // Villagers alone are a village too, centred on them.
  const folk = world({});
  folk.bot.entities[1] = { id: 1, name: 'villager', position: new Vec3(20, LEVEL + 1, 10), isValid: true };
  folk.bot.entities[2] = { id: 2, name: 'villager', position: new Vec3(24, LEVEL + 1, 10), isValid: true };
  assert.deepEqual(villages.observeVillage(folk.bot), { x: 22, y: LEVEL + 1, z: 10, bell: undefined, beds: 0, hay: 0, villagers: 2 });
  // Nothing beyond the radius counts.
  const far = world({}); village(far, { x: 80 });
  assert.equal(villages.observeVillage(far.bot), null);
});

test('a village is remembered once, announced once, and a second look from the far side updates it rather than doubling it', () => {
  const w = world({}), { bot } = w, goal = goalWith(bot);
  let saves = 0; const save = () => saves++;
  village(w, { beds: 2, hay: 3 });
  const found = villages.noticeVillage(bot, goal, save, { now: 1000 });
  assert.equal(goal.villages.length, 1);
  assert.deepEqual(goal.villages[0], { x: 30, y: LEVEL + 1, z: 0, dimension: 'overworld', seenAt: 1000, bell: { x: 30, y: LEVEL + 1, z: 0 }, beds: 2, hay: 3 });
  assert.equal(found, goal.villages[0]); assert(saves > 0);
  assert.equal(goal.survivalAction.action, 'village_found');
  assert.equal(narrate(bot, goal, { now: 5000 }), "Ooh, a village! I'll remember this spot.");
  assert.equal(narrate(bot, goal, { now: 10000 }), null, 'said once');
  // The next twenty-nine steps standing still do not look again.
  bot.findBlocks = () => assert.fail('scanned again without moving');
  for (let n = 0; n < 29; n++) assert.equal(villages.noticeVillage(bot, goal, save), null);
  // Moved on: a look from the far side of the same village, with more hay
  // in view, is the same entry with the larger count and no new line.
  const looked = world({}); village(looked, { hay: 5, beds: 2 });
  bot.findBlocks = looked.bot.findBlocks; bot.blockAt = looked.bot.blockAt;
  bot.entity.position = new Vec3(50.5, LEVEL + 1, 0.5);
  const again = villages.noticeVillage(bot, goal, save, { now: 2000 });
  assert.equal(goal.villages.length, 1); assert.equal(again.hay, 5); assert.equal(again.seenAt, 2000);
  assert.equal(goal.survivalAction.at, new Date(1000).toISOString(), 'no second announcement');
  // A village a hundred blocks off is another village.
  const other = world({}); village(other, { x: 130, z: 40, hay: 4, beds: 1 });
  bot.findBlocks = other.bot.findBlocks; bot.blockAt = other.bot.blockAt;
  bot.entity.position = new Vec3(120.5, LEVEL + 1, 30.5);
  villages.noticeVillage(bot, goal, save, { now: 3000 });
  assert.equal(goal.villages.length, 2); assert.equal(goal.villages[1].x, 130);
  // Off the Overworld nothing is looked for, and a look that throws is no village.
  bot.game.dimension = 'the_nether';
  assert.equal(villages.noticeVillage(bot, goal, save, { force: true }), null);
  bot.game.dimension = 'overworld'; bot.findBlocks = () => { throw new Error('chunk on its way out'); };
  assert.equal(villages.noticeVillage(bot, goal, save, { force: true }), null);
});

// The bed is optional before the Nether (note 776): chosen, it is the
// ladder's rung, as these tests read it.
const bedGoal = (bot, extra = {}) => ({ ...goalWith(bot, extra), rungOptIn: { bed: Date.now() } });

test('the bed rung prefers a remembered village with beds within two hundred blocks over the sheep hunt', () => {
  const { bot } = world({ items: [['stone_pickaxe', 1], ['stone_sword', 1]] });
  const near = { x: 100, y: LEVEL + 1, z: 0, dimension: 'overworld', seenAt: 1, bell: { x: 100, y: LEVEL + 1, z: 0 }, beds: 2, hay: 3 };
  assert.deepEqual(preparationStage(bot, bedGoal(bot)), { phase: 'bed', action: 'gather_wool', count: 3 }, 'no village: wool');
  const rung = preparationStage(bot, bedGoal(bot, { villages: [near] }));
  assert.equal(rung.phase, 'bed'); assert.equal(rung.action, 'village_bed'); assert.equal(rung.village, near); assert.equal(rung.distance, 100);
  assert.equal(preparationStage(bot, bedGoal(bot, { villages: [{ ...near, beds: 0 }] })).action, 'gather_wool', 'a village with no beds left is no rung');
  assert.equal(preparationStage(bot, bedGoal(bot, { villages: [{ ...near, x: 300 }] })).action, 'gather_wool', 'three hundred blocks is a sheep, not a walk');
  assert.equal(preparationStage(bot, bedGoal(bot, { villages: [{ ...near, dimension: 'nether' }] })).action, 'gather_wool');
  const cooling = bedGoal(bot, { villages: [near] }); require('../src/progress').setAside(cooling, 'village_bed', 'any', 'not reached', 60000);
  assert.equal(preparationStage(bot, cooling).action, 'gather_wool', 'an unreachable village waits out its cool-down');
  const woolly = world({ items: [['stone_pickaxe', 1], ['stone_sword', 1], ['white_wool', 3]] }).bot;
  assert.equal(preparationStage(woolly, bedGoal(woolly, { villages: [near] })).item, 'white_bed', 'three wool in the pockets is a bed to craft, not a walk');
  const bedded = world({ items: [['stone_pickaxe', 1], ['stone_sword', 1], ['white_bed', 1]] }).bot;
  assert.equal(preparationStage(bedded, bedGoal(bedded, { villages: [near] })).item, 'iron_pickaxe', 'a bed carried is the rung done');
});

test('the village bed is walked to, dug up, picked up and remembered as taken; a village with none left hands the rung back', async () => {
  const w = world({ items: [['stone_pickaxe', 1], ['stone_sword', 1]] }), { bot, actions } = w, task = new Task('bed'), save = () => {};
  const centre = village(w, { x: 40, beds: 1 });
  const goal = bedGoal(bot, { villages: [{ ...centre, dimension: 'overworld', seenAt: 1, bell: centre, beds: 1, hay: 3 }] });
  // Digging a bed takes both halves, as the server does, and drops it where
  // it stood; walking over the drop picks it up.
  const dig = actions.dig;
  actions.dig = async (b, t, p, options) => {
    assert.equal(options.requireDrops, false, 'a bed needs no harvest tool');
    assert.match(w.nameAt(p), /_bed$/);
    await dig(b, t, p, options);
    for (const dx of [-1, 1]) if (/_bed$/.test(w.nameAt(p.offset(dx, 0, 0)))) w.set(p.offset(dx, 0, 0), 'air');
    bot.entities[7] = { id: 7, position: new Vec3(p.x + 0.5, p.y, p.z + 0.5), isValid: true, getDroppedItem: () => ({ name: 'white_bed' }) };
  };
  const navigate = actions.navigate;
  actions.navigate = async (b, t, g, o) => { await navigate(b, t, g, o); if (bot.entities[7] && Math.hypot(g.x + 0.5 - bot.entities[7].position.x, g.z + 0.5 - bot.entities[7].position.z) < 1) { w.give('white_bed', 1); delete bot.entities[7]; } };
  const handlers = { village_bed: (b, t, g, s, stage) => villages.takeVillageBed(b, t, g, s, stage.village, actions) };
  await gameStep(bot, task, goal, save, handlers);
  assert.equal(home.bedCarried(bot), 'white_bed');
  assert.equal(goal.villages[0].beds, 0, 'one bed fewer in the village');
  assert.equal(goal.villageBed, undefined);
  assert.equal(goal.step.action, 'village_bed'); assert.deepEqual(goal.step.village, { x: 40, z: 0 });
  assert(actions.calls.some(c => c[0] === 'navigate' && c[1] === 40), 'walked to the bell first');
  assert.equal(preparationStage(bot, goal).item, 'iron_pickaxe', 'the bed rung is done');
  // The same village again, its beds gone from the world: the rung falls back to wool.
  w.take('white_bed'); goal.villages[0].beds = 1;
  await assert.rejects(gameStep(bot, task, goal, save, handlers), /No bed left in the village/);
  assert.equal(goal.villages[0].beds, 0);
  assert.equal(preparationStage(bot, goal).action, 'gather_wool');
  // Three failed walks defer the village for twenty minutes.
  goal.villages[0].beds = 1;
  actions.navigate = async () => { throw new Error('no route'); };
  bot.entity.position = new Vec3(0.5, LEVEL + 1, 0.5);
  for (let n = 0; n < 3; n++) await assert.rejects(gameStep(bot, task, goal, save, handlers), /no route/);
  await assert.rejects(gameStep(bot, task, goal, save, handlers), /three tries/);
  assert(require('../src/progress').isSetAside(goal, 'village_bed', 'any'));
  assert.equal(preparationStage(bot, goal).action, 'gather_wool');
});

test('a remembered village within reach is the home base anchor, so the bed and the stash end up among the houses', () => {
  const w = world({ ponds: [pond(46, 6), pond(-40, 0)] }), { bot } = w;
  const centre = village(w, { x: 40, z: 0, hay: 3, beds: 2 });
  const remembered = { ...centre, dimension: 'overworld', seenAt: 1, bell: centre, beds: 2, hay: 3 };
  const goal = goalWith(bot, { portals: [{ x: -30, y: LEVEL + 1, z: 0, dimension: 'overworld' }], villages: [remembered] });
  const site = home.chooseBaseSite(bot, goal);
  assert(site, 'a site was found');
  assert.equal(site.anchor.kind, 'village'); assert.deepEqual({ x: site.anchor.x, z: site.anchor.z }, { x: 40, z: 0 });
  assert(Math.hypot(site.water.x - 40, site.water.z) < 12, `the pond beside the village was chosen, not the one by the portal: ${JSON.stringify(site.water)}`);
  // Beyond reach, the portal is the anchor as before.
  const farGoal = goalWith(bot, { portals: [{ x: -30, y: LEVEL + 1, z: 0, dimension: 'overworld' }], villages: [{ ...remembered, x: 400, bell: { ...centre, x: 400 } }] });
  assert.equal(home.chooseBaseSite(bot, farGoal).anchor.kind, 'portal');
});

test('a remembered village within reach is a forage option: ripe crops are taken and replanted, hay becomes bread', async () => {
  const w = world({ items: [['stone_sword', 1]] }), { bot, actions } = w, task = new Task('food'), save = () => {};
  const centre = village(w, { x: 40, hay: 3, beds: 1, wheat: 3 });
  const goal = goalWith(bot, { villages: [{ ...centre, dimension: 'overworld', seenAt: 1, bell: centre, beds: 1, hay: 3 }] });
  assert.equal((await forageChoices(bot, task, goalWith(bot), save, actions, {})).village_food, undefined, 'no village remembered, no option');
  const choices = await forageChoices(bot, task, goal, save, actions, {});
  assert(choices.village_food, 'the village is on offer');
  assert.deepEqual({ ...choices.village_food.description, action: undefined }, { action: undefined, distance: 40, ripeCrops: 3, hayBales: 3, villageLoaded: true, walkSeconds: 9, healthNow: 20 });
  assert(choices.search_food, 'a search is on offer beside the village, for Jev to weigh');
  await choices.village_food.run();
  assert.equal(goal.survivalAction.action, 'village_food');
  assert.deepEqual(actions.calls.filter(c => c[0] === 'dig'), [['dig', 'wheat'], ['dig', 'wheat'], ['dig', 'wheat']], 'the ripe wheat was taken and no hay was touched');
  for (let i = 0; i < 3; i++) assert.deepEqual(w.bot.blockAt(new Vec3(44, LEVEL + 1, -4 + i)).getProperties(), { age: 0 }, 'the seed went back in');
  assert.deepEqual(actions.calls.at(-1), ['acquire', 'bread', 1], 'three wheat is a loaf through the planner');
  // Bare farms: a hay bale is dug for nine wheat, and the village remembers one fewer.
  const bare = world({}), { bot: b2, actions: a2 } = bare;
  const c2 = village(bare, { x: 40, hay: 3, beds: 1 });
  const g2 = goalWith(b2, { villages: [{ ...c2, dimension: 'overworld', seenAt: 1, bell: c2, beds: 1, hay: 3 }] });
  const dig = a2.dig; a2.dig = async (b, t, p, o) => { const name = bare.nameAt(p); await dig(b, t, p, o); if (name === 'hay_block') bare.give('hay_block', 1); };
  const c = await forageChoices(b2, task, g2, save, a2, {});
  assert.equal(c.village_food.description.ripeCrops, 0);
  await c.village_food.run();
  assert.deepEqual(a2.calls.filter(x => x[0] === 'dig'), [['dig', 'hay_block']], 'one bale is nine wheat, enough');
  assert.deepEqual(a2.calls.at(-1), ['acquire', 'bread', 3]);
  assert.equal(g2.villages[0].hay, 2);
  // A village whose farms and stacks are both gone is not offered.
  const empty = world({}); const c3 = village(empty, { x: 40, hay: 0, beds: 1 });
  const g3 = goalWith(empty.bot, { villages: [{ ...c3, dimension: 'overworld', seenAt: 1, bell: c3, beds: 1, hay: 3 }] });
  assert.equal((await forageChoices(empty.bot, task, g3, save, empty.actions, {})).village_food, undefined, 'read off the world when loaded, not off memory');
});

test('the bed on the home\'s own bed cells is never taken as a village bed', async () => {
  // Trial 84: the home stood in a village; its bed was taken as a village bed and placed again eight times in eight seconds.
  const w = world({ items: [['stone_pickaxe', 1], ['stone_sword', 1]] }), { bot, actions } = w, task = new Task('bed'), save = () => {};
  const centre = village(w, { x: 40, beds: 0 });
  const goal = goalWith(bot, { villages: [{ ...centre, dimension: 'overworld', seenAt: 1, bell: centre, beds: 1, hay: 3 }] });
  goal.survival ||= {};
  goal.survival.home = { origin: { x: 40, y: LEVEL, z: 6 }, direction: { x: 1, z: 0 }, water: { x: 39, y: LEVEL, z: 6 }, bed: {}, pen: {} };
  const { bed } = home.layout(goal.survival.home);
  w.set(new Vec3(bed.foot.x, bed.foot.y, bed.foot.z), 'white_bed', { part: 'foot' });
  w.set(new Vec3(bed.head.x, bed.head.y, bed.head.z), 'white_bed', { part: 'head' });
  let dug = 0; actions.dig = async () => { dug++; };
  await assert.rejects(villages.takeVillageBed(bot, task, goal, save, goal.villages[0], actions), /No bed left in the village/);
  assert.equal(dug, 0, 'the home\'s bed stays where it is');
});
