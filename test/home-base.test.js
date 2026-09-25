'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const home = require('../src/home-base');
const { nextGameStage, gameStep } = require('../src/game-progress');
const { idleOptions, idleWork } = require('../src/work');
const { forageChoices } = require('../src/foraging');
const { surplus } = require('../src/inventory-tidy');
const { stepLine } = require('../src/narration');
const { LEVEL, registry, world, pond, goalWith, establishedHome } = require('./fixtures/home-world');

test('the layout puts every plot cell within reach of the water, the bed beside it and a gated pen behind', () => {
  const site = { origin: { x: 10, y: LEVEL, z: 0 }, direction: { x: 1, z: 0 }, water: { x: 9, y: LEVEL, z: 0 } };
  const l = home.layout(site);
  assert.equal(l.plot.length, 9);
  assert(l.plot.every(p => Math.abs(p.x - site.water.x) <= 4 && Math.abs(p.z - site.water.z) <= 4 && p.y === LEVEL), 'farmland hydrates within four blocks of water');
  assert.equal(l.pen.fences.length, 15, 'a five-by-five ring less the gate'); assert.deepEqual(l.pen.gate, { x: 14, y: LEVEL + 1, z: 0 });
  assert.equal(Math.abs(l.bed.foot.x - l.bed.head.x) + Math.abs(l.bed.foot.z - l.bed.head.z), 1, 'a bed is two adjacent cells');
  assert.equal(l.bed.facing, 'west', 'placed looking back toward the water');
  assert(l.pen.fences.every(f => !home.inside(l.pen.interior, f)), 'the ring is outside the interior');
  assert(home.inside(l.pen.interior, new Vec3(16.5, LEVEL + 1, 0.5)) && !home.inside(l.pen.interior, new Vec3(12.5, LEVEL + 1, 0.5)));
  assert.equal(l.footprint.length, 63);
});

test('the site is the level shore nearest the first remembered portal, never on the portal, and none without water', () => {
  const near = pond(20, 0), far = pond(-40, 0);
  const { bot } = world({ ponds: [near, far] });
  const goal = goalWith(bot, { portals: [{ x: 0, y: LEVEL + 1, z: 0, dimension: 'overworld' }, { x: 100, y: 40, z: 100, dimension: 'nether' }] });
  const site = home.chooseBaseSite(bot, goal);
  assert(site, 'a site was found');
  assert.equal(site.anchor.kind, 'portal');
  assert(Math.hypot(site.water.x, site.water.z) < 25, `the pond nearest the portal was chosen: ${JSON.stringify(site.water)}`);
  assert.equal(bot.blockAt(new Vec3(site.origin.x, site.origin.y, site.origin.z)).name, 'grass_block');
  assert.equal(Math.abs(site.origin.x - site.water.x) + Math.abs(site.origin.z - site.water.z), 1, 'the origin is the land block beside the water');
  assert(home.layout(site).footprint.every(p => Math.hypot(p.x, p.z) > 3), 'the footprint keeps clear of the portal');
  // A house is the anchor when no portal is remembered; the bot's own spot when neither is.
  const houseGoal = goalWith(bot, { survival: { shelters: [{ kind: 'house', dimension: 'overworld', origin: { x: -40, y: LEVEL + 1, z: -5 } }] } });
  assert.equal(home.chooseBaseSite(bot, houseGoal).anchor.kind, 'house');
  assert(Math.abs(home.chooseBaseSite(bot, houseGoal).water.x + 40) < 6, 'the far pond is the near one from the house');
  assert.equal(home.chooseBaseSite(bot, goalWith(bot)).anchor.kind, 'here');
  assert.equal(home.chooseBaseSite(world({}).bot, goalWith(bot)), null, 'no water, no site');
  const dry = world({ items: [['water_bucket', 1]] });
  const poured = home.chooseBaseSite(dry.bot, goalWith(dry.bot));
  assert(poured && poured.pourWater, 'a bucket of water is a pond anywhere');
  assert.equal(dry.bot.blockAt(new Vec3(poured.water.x, poured.water.y, poured.water.z)).name, 'grass_block', 'the water cell is ground to open');
  // A cliff through the footprint disqualifies that shore; the search moves on.
  const cliff = world({ ponds: [near] });
  for (let z = -6; z <= 6; z++) cliff.set(new Vec3(26, LEVEL + 1, z), 'stone');
  const other = home.chooseBaseSite(cliff.bot, goalWith(cliff.bot, { portals: [{ x: 0, y: LEVEL + 1, z: 0, dimension: 'overworld' }] }));
  assert(other && (other.direction.x !== 1), `the shore facing the cliff was passed over: ${JSON.stringify(other?.direction)}`);
});

test('the home rung runs stash, bed, plot then pen, each step read off the world, and ends when all four stand', async () => {
  const w = world({ ponds: [pond(20, 0)], items: [['oak_log', 8]] });
  const { bot, give, actions } = w, goal = goalWith(bot, { portals: [{ x: 0, y: LEVEL + 1, z: 0, dimension: 'overworld' }] }), task = new Task('home'), save = () => {};
  const stage = () => home.homeStage(bot, goal);
  const step = () => home.homeStep(bot, task, goal, save, stage(), actions);
  assert.deepEqual(stage(), { phase: 'home_site', action: 'choose_site' });
  await step();
  assert(goal.survival.home, 'the site is persisted in the shared survival state');
  assert.equal(goal.step.action, 'home_site'); assert.equal(goal.step.anchor, 'portal');
  // Stash: a chest where the bed goes, before the bed, placed once and remembered.
  assert.deepEqual(stage(), { phase: 'home_stash', action: 'acquire', item: 'chest', count: 1 });
  give('chest', 1); assert.deepEqual(stage(), { phase: 'home_stash', action: 'place_chest' });
  await step();
  assert.equal(bot.blockAt(new Vec3(home.layout(goal.survival.home).chest.x, LEVEL + 1, home.layout(goal.survival.home).chest.z)).name, 'chest');
  assert.deepEqual(goal.survival.home.stash.position, home.layout(goal.survival.home).chest); assert.deepEqual(goal.survival.home.stash.contents, {});
  // Bed: wool, then the bed item, then placing it, then using it.
  assert.deepEqual(stage(), { phase: 'home_bed', action: 'gather_wool', count: 3 });
  give('white_wool', 2); assert.equal(stage().count, 1);
  give('white_wool', 1); assert.deepEqual(stage(), { phase: 'home_bed', action: 'acquire', item: 'white_bed', count: 1 });
  await step(); assert.deepEqual(actions.calls.at(-1), ['acquire', 'white_bed', 1]);
  give('white_bed', 1); assert.equal(stage().action, 'place_bed');
  await step();
  assert.equal(home.bedStatus(bot, goal.survival.home).placed, true, 'both halves of the bed stand where the layout put them');
  assert.equal(stage().action, 'claim_bed');
  await step();
  assert.match(goal.survival.home.bed.evidence, /set_spawn/); assert(goal.survival.home.bed.claimedAt);
  // Plot: a hoe, tilling, seeds, planting.
  assert.deepEqual(stage(), { phase: 'home_plot', action: 'acquire', item: 'wooden_hoe', count: 1 });
  give('wooden_hoe', 1); assert.deepEqual(stage(), { phase: 'home_plot', action: 'till', cells: 9 });
  await step();
  assert.equal(home.plotStatus(bot, goal.survival.home).untilled.length, 0);
  assert.deepEqual(stage(), { phase: 'home_plot', action: 'acquire', item: 'wheat_seeds', count: 9 });
  give('wheat_seeds', 9); assert.deepEqual(stage(), { phase: 'home_plot', action: 'plant', cells: 9 });
  await step();
  const plot = home.plotStatus(bot, goal.survival.home);
  assert.equal(plot.growing.length, 9); assert.equal(plot.bare.length, 0); assert.equal(bot.inventory.items().find(i => i.name === 'wheat_seeds'), undefined);
  // Pen: fences and a gate, then placed.
  assert.deepEqual(stage(), { phase: 'home_pen', action: 'acquire', item: 'oak_fence', count: 15 });
  give('oak_fence', 15); assert.deepEqual(stage(), { phase: 'home_pen', action: 'acquire', item: 'oak_fence_gate', count: 1 });
  give('oak_fence_gate', 1); assert.equal(stage().action, 'build_pen');
  await step();
  assert.equal(home.penStatus(bot, goal.survival.home).fenced, true);
  assert.equal(stage(), null, 'the rung is done');
  assert.equal(home.homeComplete(bot, goal), true);
  assert.equal(actions.calls.filter(c => c[0] === 'place').length, 16, 'fifteen fences and a chest were placed; the gate was set facing the plot');
  w.home = goal.survival.home;
  return w;
});

test('a plot is harvested when grown, replanted from the seeds it drops, and the wheat baked into bread', async () => {
  const w = await establishedHome(), { bot, goal, task, save, actions, layout } = w;
  assert.deepEqual(home.homeChores(bot, goal), {}, 'growing wheat is nothing to do yet');
  assert.equal(home.homeStage(bot, goal), null, 'the rung does not reopen while the wheat grows');
  for (const p of layout.plot.slice(0, 4)) w.set(new Vec3(p.x, p.y + 1, p.z), 'wheat', { age: 7 });
  const chores = home.homeChores(bot, goal);
  assert.deepEqual(Object.keys(chores), ['harvest_and_bake']);
  assert.match(chores.harvest_and_bake.description, /4 ripe wheat/);
  await chores.harvest_and_bake.run(bot, task, goal, save, actions);
  assert.equal(actions.calls.filter(c => c[0] === 'dig' && c[1] === 'wheat').length, 4);
  const status = home.plotStatus(bot, goal.survival.home);
  assert.equal(status.grown.length, 0); assert.equal(status.bare.length, 0, 'every harvested cell was replanted');
  assert.deepEqual(actions.calls.at(-1), ['acquire', 'bread', 1], 'four wheat is one loaf, through the ordinary crafting path');
  assert(goal.survival.home.plot.lastHarvestAt);
  // Two ripe cells and no wheat carried is tending, not baking.
  for (const p of layout.plot.slice(0, 2)) w.set(new Vec3(p.x, p.y + 1, p.z), 'wheat', { age: 7 });
  w.take('wheat', 64);
  assert.deepEqual(Object.keys(home.homeChores(bot, goal)), ['tend_farm']);
  // Far from a plot it cannot see, and not checked for a while, the chore is to walk back and look.
  const far = { ...w, bot: Object.assign(Object.create(Object.getPrototypeOf(bot)), bot, { entity: { id: 1, position: new Vec3(100.5, LEVEL + 1, 0.5) }, blockAt: p => Math.abs(p.x - 100) < 20 ? bot.blockAt(p) : null }) };
  goal.survival.home.plot.checkedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const walkBack = home.homeChores(far.bot, goal);
  assert.match(walkBack.tend_farm.description, /Walk back to the home plot \(\d+ blocks away\)/);
  goal.survival.home.plot.checkedAt = new Date().toISOString();
  assert.deepEqual(home.homeChores(far.bot, goal), {}, 'a plot checked recently is left to grow');
  assert.deepEqual(home.homeChores(Object.assign(Object.create(Object.getPrototypeOf(bot)), bot, { entity: { id: 1, position: new Vec3(400.5, LEVEL + 1, 0.5) } }), goal), {}, 'beyond reach there are no home chores');
});

test('the pen counts only cows inside the ring, offers luring while it is short and breeding once it holds a pair', async () => {
  const w = await establishedHome(), { bot, goal, task, save, actions, layout } = w;
  const cow = (id, position, extra = {}) => { bot.entities[id] = { id, name: 'cow', position, isValid: true, metadata: [], ...extra }; return bot.entities[id]; };
  const centre = layout.pen.centre;
  cow(1, new Vec3(centre.x + 0.5, centre.y, centre.z + 0.5));
  cow(2, new Vec3(centre.x - 3.5, centre.y, centre.z + 0.5), { outside: true });
  cow(3, new Vec3(centre.x + 6.5, centre.y, centre.z + 0.5));
  const pen = home.penStatus(bot, goal.survival.home);
  assert.equal(pen.cows, 1); assert.equal(pen.adults, 1); assert.equal(pen.fenced, true);
  assert.deepEqual(Object.keys(home.homeChores(bot, goal)), [], 'no wheat, no luring');
  w.give('wheat', 3);
  assert.deepEqual(Object.keys(home.homeChores(bot, goal)), ['harvest_and_bake', 'lure_cows']);
  assert.match(home.homeChores(bot, goal).lure_cows.description, /Lead 1 of the 2 cows in view/);
  // Lead one in: the cow follows the wheat to the centre of the pen; the gate is shut behind.
  actions.navigate = async (b, t, g) => { if (g.entity) b.entity.position = g.entity.position.clone(); else { b.entity.position = new Vec3(g.x + 0.5, g.y, g.z + 0.5); if (b.heldItem?.name === 'wheat') for (const e of Object.values(bot.entities)) if (e.outside && e.name === 'cow') e.position = b.entity.position.clone(); } };
  await home.lureCows(bot, task, goal, save, goal.survival.home, actions);
  assert.equal(home.penStatus(bot, goal.survival.home).cows, 2);
  assert.equal(bot.heldItem, null, 'the wheat is put away so the cows stop following');
  assert.equal(goal.survival.home.pen.cows, 2);
  // Breeding: two adults, two wheat, no recent litter.
  const chores = home.homeChores(bot, goal);
  assert(chores.breed_cows && !chores.lure_cows);
  await chores.breed_cows.run(bot, task, goal, save, actions);
  assert.equal(bot.inventory.items().find(i => i.name === 'wheat')?.count, 1, 'two wheat were fed');
  assert.equal(bot.entities[1].fed, 1);
  assert(goal.survival.home.pen.lastBredAt);
  assert.equal(home.homeChores(bot, goal).breed_cows, undefined, 'inside the cooldown there is no second litter');
  bot.time.age += 7000; w.give('wheat', 2);
  assert(home.homeChores(bot, goal).breed_cows, 'after the cooldown the pair can breed again');
  // A calf is not an adult; a third adult is a steak.
  cow(4, new Vec3(centre.x + 0.5, centre.y, centre.z - 0.5), { metadata: Object.assign([], { [registry.entitiesByName.cow.metadataKeys.indexOf('baby')]: true }) });
  assert.equal(home.penStatus(bot, goal.survival.home).adults, 2);
  assert.equal(home.homeFood(bot, goal).steaks, 0);
  cow(5, new Vec3(centre.x + 1.5, centre.y, centre.z + 0.5));
  assert.equal(home.homeFood(bot, goal).steaks, 1);
});

test('the bed is claimed on the server saying so, or sleeping, and reopens if it is gone', async () => {
  const w = await establishedHome(), { bot, goal, task, save, actions, layout } = w;
  delete goal.survival.home.bed.claimedAt;
  assert.equal(home.homeStage(bot, goal).action, 'claim_bed');
  bot.activateBlock = async () => { bot.isSleeping = true; };
  await home.claimBed(bot, task, goal, save, goal.survival.home, actions);
  assert.equal(goal.survival.home.bed.evidence, 'slept'); assert.equal(bot.isSleeping, false, 'woken again after the point is set');
  assert.equal(home.homeStage(bot, goal), null, 'claimed');
  w.set(layout.bed.foot, 'air'); w.set(layout.bed.head, 'air');
  assert.equal(home.homeStage(bot, goal).action, 'gather_wool', 'a missing bed means wool and a new bed, not a claimed one');
  // Silence three times is taken as done rather than looping forever.
  w.set(layout.bed.foot, 'red_bed'); w.set(layout.bed.head, 'red_bed'); delete goal.survival.home.bed.claimedAt;
  bot.activateBlock = async () => {};
  for (let n = 0; n < 2; n++) await assert.rejects(home.claimBed(bot, task, goal, save, goal.survival.home, actions), /did not confirm/);
  await home.claimBed(bot, task, goal, save, goal.survival.home, actions);
  assert.match(goal.survival.home.bed.evidence, /assumed/);
});

test('the ladder opens the home rung after the bucket and before the armour, and the idle loop offers the chores', async () => {
  const gear = [['white_bed', 1], ['stone_pickaxe', 1], ['iron_pickaxe', 1], ['iron_sword', 1], ['shield', 1], ['bucket', 1], ['oak_log', 16]];
  const { bot } = world({ ponds: [pond(20, 0)], items: gear });
  const goal = goalWith(bot);
  assert.equal(nextGameStage(bot, goal).phase, 'home_site');
  assert.equal(nextGameStage(bot, goal).action, 'home');
  const ran = [];
  await gameStep(bot, new Task('win'), goal, () => {}, { home: async (b, t, g, s, stage) => { ran.push(stage.action); } });
  assert.deepEqual(ran, ['choose_site']); assert.equal(goal.gameProgress.phase, 'home_site');
  assert.equal(nextGameStage(bot, { kind: 'win' }).phase, 'iron_armour', 'no survival layer, no base');
  goal.survival.homeSearch = { attempts: 3 }; require('../src/progress').setAside(goal, 'home_site', 'search', 'three places looked at', 60000);
  assert.equal(nextGameStage(bot, goal).phase, 'iron_armour', 'a world with nowhere to build waits out a deferral');
  // With the base standing, the ladder moves on and idle time has farm work in it.
  const w = await establishedHome();
  w.give('white_bed', 1); w.give('stone_pickaxe', 1); w.give('iron_pickaxe', 1); w.give('iron_sword', 1); w.give('shield', 1); w.give('bucket', 1);
  assert.equal(nextGameStage(w.bot, w.goal).phase, 'iron_armour');
  for (const p of w.layout.plot) w.set(new Vec3(p.x, p.y + 1, p.z), 'wheat', { age: 7 });
  const idle = { ...w.goal, kind: 'survive' };
  const options = idleOptions(w.bot, idle);
  assert(options.harvest_and_bake, 'the chore sits beside the ordinary ones');
  assert.match(options.harvest_and_bake.description, /9 ripe wheat/);
  const client = { model: 'jev-test', systemOne: async ({ questions, state }) => {
    assert.match(state.home, /home base with a plot, a pen, a bed and a stash chest/);
    assert(Object.values(questions)[0].criteria.harvest_and_bake);
    return { answers: { branch_0: { choice: 'harvest_and_bake', confidence: 0.9, probabilities: { harvest_and_bake: 0.9, rest: 0.1 } } } };
  } };
  assert.equal(await idleWork(w.bot, new Task('idle'), idle, () => {}, client, () => {}, { actions: w.actions }), true);
  assert.equal(idle.decisions.at(-1).path[0], 'harvest_and_bake');
  assert.match(w.bot.said[0], /harvest the wheat and bake/);
  assert.equal(home.plotStatus(w.bot, w.home).grown.length, 0, 'the chore ran through the real executor');
});

test('when the base can feed the bot and is within reach, walking home replaces the search and stands beside any hunt in view', async () => {
  const w = await establishedHome(), { bot, goal, task, save, actions, layout } = w;
  for (const p of layout.plot) w.set(new Vec3(p.x, p.y + 1, p.z), 'wheat', { age: 7 });
  bot.entity.position = new Vec3(60.5, LEVEL + 1, 0.5);
  const choices = await forageChoices(bot, task, goal, save, actions, {});
  assert.deepEqual(Object.keys(choices), ['go_home_for_food', 'search_food']);
  assert.equal(choices.go_home_for_food.description.loavesAvailable, 3);
  assert.equal(choices.go_home_for_food.description.distance, Math.round(60.5 - (goal.survival.home.origin.x + 0.5)));
  await choices.go_home_for_food.run();
  assert.equal(goal.survivalAction.action, 'go_home_for_food');
  assert(actions.calls.some(c => c[0] === 'navigate'), 'walked home first');
  assert.deepEqual(actions.calls.at(-1), ['acquire', 'bread', 3]);
  // A cow in view is still a choice; beyond reach the base is not one.
  bot.entities[9] = { id: 9, name: 'cow', position: bot.entity.position.offset(3, 0, 0), isValid: true, metadata: [] };
  for (const p of layout.plot) w.set(new Vec3(p.x, p.y + 1, p.z), 'wheat', { age: 7 });
  assert.deepEqual(Object.keys(await forageChoices(bot, task, goal, save, actions, {})).sort(), ['go_home_for_food', 'hunt_9', 'search_food']);
  bot.entity.position = new Vec3(300.5, LEVEL + 1, 0.5); delete bot.entities[9];
  assert.deepEqual(Object.keys(await forageChoices(bot, task, goal, save, actions, {})), ['search_food']);
});

test('wheat seeds are kept for the plot, and the new phases each have one line', () => {
  const bot = { inventory: { items: () => [{ name: 'wheat_seeds', count: 20 }, { name: 'wheat', count: 10 }, { name: 'bread', count: 4 }] } };
  assert.deepEqual(surplus(bot), []);
  const goal = {};
  for (const [step, pattern] of [[{ action: 'home_site', origin: { x: 21, y: 63, z: 0 } }, /home base beside the water at 21, 0/], [{ action: 'till' }, /Tilling/], [{ action: 'plant' }, /Planting wheat/],
    [{ action: 'harvest' }, /Harvesting/], [{ action: 'claim_bed' }, /respawn at home/], [{ action: 'build_pen' }, /Fencing/], [{ action: 'lure_cows' }, /Leading cows/],
    [{ action: 'idle', choice: 'tend_farm' }, /tend the farm/], [{ action: 'idle', choice: 'breed_cows' }, /breed the cows/], [{ action: 'game_progression', phase: 'home_bed' }, /home bed/]]) {
    assert.match(stepLine(goal, step), pattern);
  }
});

test('a bucket pond is opened and filled before the plot is tilled', async () => {
  const w = world({ items: [['water_bucket', 1], ['white_bed', 1], ['chest', 1], ['oak_log', 8]] });
  const { bot, actions } = w, goal = goalWith(bot), task = new Task('home'), save = () => {};
  const site = home.chooseBaseSite(bot, goal); assert(site.pourWater);
  const base = home.establishHome(goal, site); assert.equal(base.pourWater, true);
  const water = new Vec3(base.water.x, base.water.y, base.water.z);
  let stage;
  for (let i = 0; i < 12; i++) {
    stage = home.homeStage(bot, goal);
    if (!stage || stage.phase === 'home_water') break;
    await home.homeStep(bot, task, goal, save, stage, actions);
  }
  assert.equal(stage.phase, 'home_water'); assert.equal(stage.action, 'pour_water');
  bot.activateItem = () => { w.set(water, 'water'); bot.inventory.items().find(i => i.name === 'water_bucket').name = 'bucket'; };
  bot.deactivateItem = () => {}; bot.lookAt = async () => {}; bot.equip = async () => {};
  await home.homeStep(bot, task, goal, save, stage, actions);
  assert.equal(bot.blockAt(water).name, 'water'); assert(goal.survival.home.pouredAt);
  assert.equal(home.homeStage(bot, goal).phase, 'home_plot', 'with the pond in, the plot is next');
});

test('with no pond and only an empty bucket, the site step fills the bucket instead of giving up', async () => {
  const w = world({ items: [['bucket', 1]] });
  const { bot, actions } = w, goal = goalWith(bot);
  const asked = [];
  await home.homeStep(bot, new Task('home'), goal, () => {}, { phase: 'home_site', action: 'choose_site' }, { ...actions, acquireStep: async (b, t, item, count) => { asked.push([item, count]); } });
  assert.deepEqual(asked, [['water_bucket', 1]]);
  assert.equal(goal.survival.homeSearch, undefined, 'not a failed attempt');
});

test('the base anchors on the surface above a near portal, and on the bot when the portal is far or deep', () => {
  const { bot } = world({ ponds: [pond(20, 0)] });
  const deepNear = goalWith(bot, { portals: [{ x: 10, y: -41, z: 5, dimension: 'overworld' }] });
  assert.deepEqual(home.baseAnchor(bot, deepNear), { kind: 'portal', x: 10, y: LEVEL, z: 5 }, 'the column above the portal, at ground level');
  const far = goalWith(bot, { portals: [{ x: 300, y: -41, z: 5, dimension: 'overworld' }] });
  assert.equal(home.baseAnchor(bot, far).kind, 'here', 'a portal two hundred blocks off is not loaded and not an anchor');
  assert(home.chooseBaseSite(bot, deepNear), 'a site is found around the surface anchor');
});

test('a bumpy site is levelled: a tree and a bump come out, a dip is filled with dirt, then the chest goes down', async () => {
  const w = world({ items: [['water_bucket', 1], ['white_bed', 1], ['chest', 1], ['oak_log', 8], ['dirt', 8]] });
  const { bot, actions } = w, goal = goalWith(bot), task = new Task('home'), save = () => {};
  // No pond: a bucket site on flat ground has no work. Put a bump, a tree and a dip on the flat.
  const flat = home.chooseBaseSite(bot, goal); assert.deepEqual(flat.work, { digs: [], fills: [] });
  const cells = home.layout(flat).footprint;
  const bump = cells[10], tree = cells[20], dip = cells[30];
  w.set(new Vec3(bump.x, bump.y + 1, bump.z), 'dirt');
  w.set(new Vec3(tree.x, tree.y + 1, tree.z), 'oak_log'); w.set(new Vec3(tree.x, tree.y + 2, tree.z), 'oak_log');
  w.set(new Vec3(dip.x, dip.y, dip.z), 'air');
  const work = home.siteWork(bot, goal, flat);
  assert(work && work.digs.length >= 1 && work.fills.length >= 1, `a site with a little work is still a site: ${JSON.stringify(work)}`);
  home.establishHome(goal, { ...flat, work });
  assert.equal(goal.survival.home.levelling, work.digs.length + work.fills.length);
  bot.entity.position = new Vec3(flat.origin.x + 0.5, flat.origin.y + 1, flat.origin.z + 0.5);
  let stage = home.homeStage(bot, goal);
  assert.equal(stage.phase, 'home_level'); assert.equal(stage.action, 'level_site');
  await home.homeStep(bot, task, goal, save, stage, actions);
  assert.deepEqual(home.siteWork(bot, goal, goal.survival.home), { digs: [], fills: [] }, 'level after the step');
  stage = home.homeStage(bot, goal);
  assert(goal.survival.home.levelledAt); assert.equal(stage.phase, 'home_stash');
});

test('a failed site search counts once per place, waits a minute between looks, and after two places with no bucket takes a dry site', async () => {
  const w = world({});
  const { bot, actions } = w, goal = goalWith(bot);
  for (let z = -40; z <= 40; z++) for (let x = -40; x <= 40; x++) w.set(new Vec3(x, LEVEL, z), 'stone');
  const step = () => home.homeStep(bot, new Task('home'), goal, () => {}, { phase: 'home_site', action: 'choose_site' }, actions);
  await assert.rejects(step(), /No level ground/); await assert.rejects(step(), /No level ground/);
  assert.equal(goal.survival.homeSearch.attempts, 1, 'the same spot twice is one attempt');
  assert.equal(home.homeStage(bot, goal), null, 'a minute off before the next look');
  require('../src/progress').attemptsFor(goal).clear('home_site', 'search');
  bot.entity.position = new Vec3(30.5, LEVEL + 1, 0.5); await assert.rejects(step(), /No level ground/);
  assert.equal(goal.survival.homeSearch.attempts, 2);
  // Two places, no water and no bucket to carry any: the bed and the chest
  // do not need a pond, so the site is taken dry and the pond waits.
  require('../src/progress').attemptsFor(goal).clear('home_site', 'search');
  bot.entity.position = new Vec3(30.5, LEVEL + 1, 30.5); await step();
  assert(goal.survival.home?.origin, 'a home site, dry');
});

test('tilling clears leaf litter off a plot cell first', async () => {
  const w = await establishedHome({ items: [['wooden_hoe', 1]] });
  const { bot, goal, actions } = w;
  const plot = home.layout(goal.survival.home).plot;
  for (const p of plot) { w.set(new Vec3(p.x, p.y, p.z), 'grass_block'); w.set(new Vec3(p.x, p.y + 1, p.z), 'air'); }
  w.set(new Vec3(plot[0].x, plot[0].y + 1, plot[0].z), 'leaf_litter');
  const dug = [];
  await home.tillPlot(bot, new Task('till'), goal, () => {}, goal.survival.home, { ...actions, dig: async (b, t, p, o) => { dug.push(`${p}`); w.set(p, 'air'); } });
  assert.deepEqual(dug, [`${new Vec3(plot[0].x, plot[0].y + 1, plot[0].z)}`]);
  assert.equal(bot.blockAt(new Vec3(plot[0].x, plot[0].y, plot[0].z)).name, 'farmland');
});

test('a shell left on the site is cleared off the bed cells before the bed goes down', async () => {
  const w = await establishedHome({ items: [['white_bed', 1]] });
  const { bot, goal, actions } = w, home_ = goal.survival.home, { bed } = home.layout(home_);
  for (const p of [bed.foot, bed.head]) w.set(new Vec3(p.x, p.y, p.z), 'air');
  w.set(new Vec3(bed.stand.x, bed.stand.y + 1, bed.stand.z), 'cobblestone'); w.set(new Vec3(bed.head.x, bed.head.y + 1, bed.head.z), 'cobblestone');
  const dug = [];
  await home.placeBed(bot, new Task('bed'), goal, () => {}, home_, { ...actions, dig: async (b, t, p) => { dug.push(`${p}`); w.set(p, 'air'); } }, 'white_bed');
  assert.equal(dug.length, 2, 'the two stray cobblestone came off');
  assert(home.isBed(bot.blockAt(new Vec3(bed.foot.x, bed.foot.y, bed.foot.z))));
});

test('a finished base reopens when its plot is trampled or built on, and the blocked cells are repaired', async () => {
  const w = await establishedHome({ items: [['dirt', 4], ['wooden_hoe', 1], ['wheat_seeds', 9]] });
  const { bot, goal, actions } = w, home_ = goal.survival.home, { plot } = home.layout(home_);
  home_.completedAt = 'earlier';
  assert.equal(home.homeStage(bot, goal), null, 'a finished base is finished');
  w.set(new Vec3(plot[0].x, plot[0].y, plot[0].z), 'cobblestone'); w.set(new Vec3(plot[0].x, plot[0].y + 1, plot[0].z), 'air');
  w.set(new Vec3(plot[1].x, plot[1].y + 1, plot[1].z), 'cobblestone');
  let stage = home.homeStage(bot, goal);
  assert.equal(home_.completedAt, undefined, 'reopened for the repair');
  assert.equal(stage.action, 'repair_plot'); assert.equal(stage.cells, 2);
  await home.homeStep(bot, new Task('home'), goal, () => {}, stage, actions);
  assert.equal(bot.blockAt(new Vec3(plot[0].x, plot[0].y, plot[0].z)).name, 'dirt', 'cobblestone swapped for dirt');
  assert.equal(bot.blockAt(new Vec3(plot[1].x, plot[1].y + 1, plot[1].z)).name, 'air', 'the block on the cell came off');
  stage = home.homeStage(bot, goal);
  assert.equal(stage.action, 'till', 'then the cells are tilled');
});

test('the plot grows a fourth column when the base is marked wide, and stays within the water\'s reach', () => {
  const site = { origin: { x: 0, y: 63, z: 0 }, direction: { x: 1, z: 0 }, water: { x: -1, y: 63, z: 0 } };
  assert.equal(home.layout(site).plot.length, 9);
  const wide = home.layout({ ...site, plotWide: true }).plot;
  assert.equal(wide.length, 12);
  assert(wide.every(p => Math.abs(p.x - site.water.x) <= 4 && Math.abs(p.z - site.water.z) <= 4), 'every cell within four of the water');
});

test('levelling a base never digs into a building Jev put up', () => {
  const w = world({ items: [['water_bucket', 1], ['white_bed', 1], ['chest', 1], ['oak_log', 8], ['dirt', 8]] });
  const { bot } = w, goal = goalWith(bot);
  const flat = home.chooseBaseSite(bot, goal);
  const wall = home.layout(flat).footprint[10];
  w.set(new Vec3(wall.x, wall.y + 1, wall.z), 'oak_planks');
  assert(home.siteWork(bot, goal, flat).digs.length >= 1, 'an unknown block is dug out as before');
  bot.buildRegistry = { claimed: () => new Set([`${wall.x},${wall.y + 1},${wall.z}`]) };
  assert.equal(home.siteWork(bot, goal, flat), null, 'strict: the site is not taken');
  const loose = home.siteWork(bot, goal, flat, { strict: false });
  assert(!loose.digs.some(p => p.x === wall.x && p.z === wall.z), 'loose: that cell is left as it is');
});

test('a base is never sited on water under a roof: the clean run built in a cave pool at y 0 and died to its zombies', () => {
  const near = pond(20, 0), far = pond(-40, 0);
  const w = world({ ponds: [near, far] });
  // A stone ceiling eight blocks over the near pond and its shores.
  for (let x = 8; x <= 32; x++) for (let z = -12; z <= 12; z++) w.set(new Vec3(x, LEVEL + 8, z), 'stone');
  const site = home.chooseBaseSite(w.bot, goalWith(w.bot));
  assert(site, 'the open pond still makes a site');
  assert(site.water.x < -30, `the roofed pond was passed over: ${JSON.stringify(site.water)}`);
});

test('home is measured in three dimensions: forty blocks down a mine under the base is not home', () => {
  const home = { origin: { x: 0, y: 63, z: 0 } };
  assert(home.origin && require('../src/home-base').homeDistance({ entity: { position: new Vec3(0.5, 64, 0.5) } }, home) < 1);
  assert(require('../src/home-base').homeDistance({ entity: { position: new Vec3(0.5, 24, 0.5) } }, home) >= 39);
});

test('a landmark is walked to at its depth, not to the grass over it', async () => {
  const { goToLandmark } = require('../src/exploration');
  const goals = [];
  const bot = { entity: { position: new Vec3(0.5, 64, 0.5) }, game: { dimension: 'overworld' } };
  const goal = { landmarks: [{ kind: 'dungeon', x: 40, y: 30, z: 0, dimension: 'overworld' }] };
  await goToLandmark(bot, new Task('loot'), goal, () => {}, ['dungeon'], { navigate: async (b, t, g) => { goals.push(g); bot.entity.position = new Vec3(40.5, 64, 0.5); }, arrive: 10 });
  assert.equal(goals[0].y, 30, 'the goal has the dungeon\'s depth');
  assert.equal(goals[0].constructor.name, 'GoalNear');
});

test('with two ponds in reach, where home goes is Jev\'s pick of the sites found; without Jev, the nearest', async () => {
  const near = pond(20, 0), far = pond(-40, 0);
  const { bot } = world({ ponds: [near, far] });
  const goal = goalWith(bot, { portals: [{ x: 0, y: LEVEL + 1, z: 0, dimension: 'overworld' }] });
  const sites = home.chooseBaseSite(bot, goal, { several: true });
  assert(sites.length >= 2, `several sites: ${sites.length}`);
  assert(sites.every((a, i) => sites.every((b, j) => i === j || Math.hypot(a.origin.x - b.origin.x, a.origin.z - b.origin.z) >= 8)), 'eight blocks apart');
  assert.deepEqual(sites[0].origin, home.chooseBaseSite(bot, goal).origin, 'the first is the one the rule took');
  let offered;
  const client = { systemOne: async ({ questions }) => { offered = questions.branch_0.criteria; return { answers: { branch_0: { choice: 'site_1', confidence: 0.5 } } }; } };
  goal.survival.homeSearch = undefined;
  await home.homeStep(bot, Object.assign(new Task('home'), { opportunityClient: client }), goal, () => {}, { action: 'choose_site' }, {});
  assert.match(offered.site_0, /blocks away/);
  assert.deepEqual(goal.survival.home.origin, sites[1].origin, 'Jev\'s pick');
});

test('with torches carried and dark ground around home, lighting it is a chore on offer, told what light does and does not do', async () => {
  const w = await establishedHome({ items: [['wooden_hoe', 1], ['torch', 8]] }), { bot, goal } = w;
  const chores = home.homeChores(bot, goal);
  assert(chores.light_home, Object.keys(chores).join(','));
  assert.match(chores.light_home.description, /dark enough for monsters to spawn.*does not drive off/);
});

test('lighting home is on offer from the bed and the chest on, before the plot and the pen, and a lost chest is said with it', async () => {
  // Trial 98: a creeper blew up the chest by the bed on a dark mountainside; the torches were offered only once the whole home was done.
  const w = await establishedHome({ items: [['torch', 8]], chest: false }), { bot, goal } = w;
  const h = goal.survival.home;
  h.bed.placedAt = '2026-09-21T00:00:00Z';
  h.completedAt = null; h.pen = {}; h.plot = {};
  for (const p of w.layout.pen.fences) w.set(p, 'air'); w.set(w.layout.pen.gate, 'air');
  for (const p of w.layout.plot) { w.set(p, 'grass_block'); w.set(new Vec3(p.x, p.y + 1, p.z), 'air'); }
  assert.deepEqual(Object.keys(home.homeChores(bot, goal)), [], 'no chest yet, nothing begun');
  h.stash = { contents: {}, lostAt: new Date(Date.now() - 3 * 60000).toISOString() };
  const chores = home.homeChores(bot, goal);
  assert.deepEqual(Object.keys(chores), ['light_home']);
  assert.match(chores.light_home.description, /chest by the bed was found gone 3 minutes ago/);
});

test('a plot cell the hoe would not turn waits: it is neither tilled again nor sent for repair', async () => {
  const w = await establishedHome(), { bot, goal, layout } = w;
  const cell = layout.plot[0];
  w.set(new Vec3(cell.x, cell.y, cell.z), 'grass_block');
  goal.survival.home.plot.stubborn = { [`${cell.x},${cell.y},${cell.z}`]: Date.now() + 60000 };
  const status = home.plotStatus(bot, goal.survival.home);
  assert(status.waiting.some(p => p.x === cell.x && p.z === cell.z));
  assert(!status.untilled.some(p => p.x === cell.x && p.z === cell.z) && !status.blocked.some(p => p.x === cell.x && p.z === cell.z));
  assert.notEqual(home.homeStage(bot, goal)?.action, 'repair_plot', 'no repair for a waiting cell');
});

test('a stone that went into a plot cell after it was dug (a plug, a step out of the water) is dug out again before the dirt goes in', async () => {
  // Trial 36: "placement obstructed by cobblestone" twenty times at one
  // plot cell beside the pond.
  const w = world({ items: [['water_bucket', 1], ['white_bed', 1], ['chest', 1], ['oak_log', 8], ['dirt', 8], ['cobblestone', 8]] });
  const { bot, actions } = w, goal = goalWith(bot), task = new Task('home'), save = () => {};
  const flat = home.chooseBaseSite(bot, goal);
  const plotCell = home.layout(flat).plot[0];
  // The plot cell is stone (it will be dug and filled with dirt), and the dig
  // is answered by a plug: the next look finds cobblestone there again once.
  w.set(new Vec3(plotCell.x, plotCell.y, plotCell.z), 'stone');
  const work = home.siteWork(bot, goal, flat);
  home.establishHome(goal, { ...flat, work });
  const dig = actions.dig; let plugged = false;
  actions.dig = async (b, t, p, o) => { await dig(b, t, p, o); if (!plugged && p.x === plotCell.x && p.y === plotCell.y && p.z === plotCell.z) { plugged = true; w.set(p, 'cobblestone'); } };
  // As the real placement does: an occupied cell is refused.
  const place = actions.place;
  actions.place = async (b, t, p, m, o) => { const at = b.blockAt(p); if (at && at.boundingBox === 'block') throw new Error(`Placement obstructed by ${at.name} at ${p}`); return place(b, t, p, m, o); };
  bot.entity.position = new Vec3(flat.origin.x + 0.5, flat.origin.y + 1, flat.origin.z + 0.5);
  await home.homeStep(bot, task, goal, save, { phase: 'home_level', action: 'level_site' }, actions);
  assert.equal(bot.blockAt(new Vec3(plotCell.x, plotCell.y, plotCell.z)).name, 'dirt');
});

test('a night shell left on the pen gate\'s stand is dug away when the pen is built', async () => {
  // Trial 74: the pocket beside the plot left cobblestone on the gate's stand, and "no route" seventy-seven times.
  const { buildPen, layout } = require('../src/home-base');
  const { Vec3 } = require('vec3');
  const home = { origin: { x: 0, y: 64, z: 0 }, direction: { x: 1, z: 0 }, water: { x: -1, y: 64, z: 0 }, bed: {}, pen: {} };
  const { pen } = layout(home);
  const key = p => `${p.x},${p.y},${p.z}`;
  const blocks = new Map();
  for (const f of pen.fences) blocks.set(key(f), 'oak_fence');
  blocks.set(key(pen.gate), 'oak_fence_gate');
  blocks.set(key(pen.gateStand), 'cobblestone');
  const bot = { entity: { position: new Vec3(0.5, 65, 0.5) }, inventory: { items: () => [{ name: 'oak_planks', count: 4 }] }, registry: require('minecraft-data')('26.1'),
    blockAt: p => { const n = blocks.get(key(p)) || 'air'; return { name: n, position: p, boundingBox: n === 'air' ? 'empty' : 'block', getProperties: () => ({ open: false }) }; } };
  const dug = [];
  await buildPen(bot, { check() {} }, {}, () => {}, home, { dig: async (b, t, p) => { dug.push(key(p)); blocks.delete(key(p)); }, place: async () => {} });
  assert.deepEqual(dug, [key(pen.gateStand)], 'the stray on the stand, and nothing else');
});
