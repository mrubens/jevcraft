'use strict';
// Food as a resource of the Nether stay (note 639): when the step is on offer, the ways it holds and what each
// says, the hoglin hunt from a pillar and the hunt that finds no hoglin at the sighting, the stay's food kit
// asked inside the Nether, and the fact that health does not come back said on the options of a hurt bot.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { Task } = require('../src/skills');

const item = (name, count = 1) => ({ name, count, type: registry.itemsByName[name].id, durabilityUsed: 0 });
function netherBot({ at = new Vec3(0.5, 41, 0.5), health = 20, food = 20, items = [], entities = {}, dimension = 'the_nether', mushrooms = [], worn = {} } = {}) {
  const slots = [];
  for (const [slot, name] of Object.entries({ 5: worn.head, 6: worn.torso, 7: worn.legs, 8: worn.feet, 45: worn.offhand })) if (name) slots[slot] = item(name);
  const cells = new Map(mushrooms.map(m => [`${m.x},${m.y},${m.z}`, m.name]));
  const ground = p => {
    const q = p.floored ? p.floored() : p, m = cells.get(`${q.x},${q.y},${q.z}`);
    if (m) return { name: m, boundingBox: 'empty', position: q, drops: [] };
    return Math.floor(q.y) < Math.floor(at.y) ? { name: 'netherrack', boundingBox: 'block', position: q } : { name: 'air', boundingBox: 'empty', position: q };
  };
  return Object.assign(new EventEmitter(), {
    registry, health, food, foodSaturation: 0, entity: { id: 1, position: at, height: 1.8, width: 0.6, onGround: true, velocity: new Vec3(0, 0, 0) },
    game: { dimension, gameMode: 'survival', difficulty: 'normal' }, time: { timeOfDay: 6000 },
    inventory: { items: () => items, slots }, entities, world: { raycast: () => null }, blockAt: ground,
    findBlocks: ({ matching, maxDistance }) => mushrooms.filter(m => matching.includes(registry.blocksByName[m.name].id) && new Vec3(m.x, m.y, m.z).distanceTo(at) <= maxDistance).map(m => new Vec3(m.x, m.y, m.z)),
    chat() {},
  });
}
const hoglin = (id, x, y, z) => ({ id, name: 'hoglin', type: 'hostile', position: new Vec3(x, y, z), isValid: true, height: 1.4, width: 1.4 });
const worn = { head: 'iron_helmet', torso: 'iron_chestplate', legs: 'iron_leggings', feet: 'golden_boots', offhand: 'shield' };
const save = () => {};
const stubClient = picks => { const asked = []; return { asked, systemOne: async ({ kind, state, questions }) => { asked.push({ kind, state, options: questions.branch_0.criteria }); return { answers: { branch_0: { choice: picks.shift(), confidence: 0.8 } } }; } }; };

test('food is a thing to manage in the Nether under eight food points carried, or hungry and hurt, and not in the Overworld or with the stay fed (note 639)', () => {
  const { foodNeed } = require('../src/nether-food');
  const goal = {};
  // Two raw mutton, a stage save's own: four points, full hunger and health.
  const n = foodNeed(netherBot({ items: [item('mutton', 2)] }), goal);
  assert.equal(n.points, 4); assert.equal(n.low, true); assert.equal(n.hurt, false);
  assert.match(n.why, /^4 food points carried, under 8$/);
  // Forty points carried, hunger 15 and health 12: hurt at a hunger where health does not come back.
  const h = foodNeed(netherBot({ items: [item('cooked_beef', 5)], food: 15, health: 12 }), goal);
  assert.equal(h.low, false); assert.equal(h.hurt, true);
  assert.match(h.why, /^hunger 15 with health 12 \(health comes back at eighteen or more\)$/);
  // Fed and healthy with food to spare: nothing to say. In the Overworld, or in Peaceful: none.
  assert.equal(foodNeed(netherBot({ items: [item('cooked_beef', 5)] }), goal), null);
  assert.equal(foodNeed(netherBot({ items: [], dimension: 'overworld' }), goal), null);
  const peaceful = netherBot({ items: [] }); peaceful.game.difficulty = 'peaceful';
  assert.equal(foodNeed(peaceful, goal), null);
});

test('the step says why it is on offer, the stay against what is carried, and each way\'s yield; the hoglin from a pillar only with two blocks to lay (note 639)', () => {
  const { restockFoodOption, foodRoutes } = require('../src/nether-food');
  const goal = { portals: [{ x: 20, y: 44, z: 7, dimension: 'nether' }], sightings: {} };
  const entities = { 1: hoglin(1, 9.5, 41, 0.5) };
  const bot = netherBot({ health: 6, food: 12, items: [item('iron_sword'), item('cobblestone', 20)], entities, worn });
  const actions = { returnOverworld: async () => {}, navigate: async () => {} };
  const found = foodRoutes(bot, new Task('t'), goal, save, { actions });
  assert.deepEqual(Object.keys(found.routes).sort(), ['hoglin_pillar', 'hoglin_walk', 'return_for_food']);
  const option = restockFoodOption(bot, new Task('t'), goal, save, { actions });
  assert.match(option.description, /^Get food here before going on, the way asked next with each priced: a hoglin hunted on foot \(2 to 4 raw porkchops, 6 to 12 points raw, 16 to 32 cooked\); the same hoglin hunted from a pillar two blocks up/);
  assert.match(option.description, /On offer because 0 food points carried, under 8; hunger 12 with health 6 \(health comes back at eighteen or more\)\./);
  assert.match(option.description, /The goal still wants about 120 minutes in the Nether, and a stay spends about 40 hunger an hour .*no food points are carried to last, and 80 points \(10 cooked steaks or porkchops\) cover the stay, 80 more than are carried\./);
  const pillar = found.routes.hoglin_pillar.description;
  assert.match(pillar, /put 2 of the 20 blocks carried that can be laid under the feet, and strike from the top what comes within the sword's reach/);
  assert.match(pillar, /A hoglin's blow reaches sideways 1\.4 blocks and not up \(the jar\).*168 pillar stances against hoglins over 2026-09-28's trials lost 0\.1 health on average, 2 ended in a death/);
  assert.match(pillar, /What it does not stop: a ghast's fireball or a blaze's, a piglin's crossbow/);
  assert.match(pillar, /forty-five seconds|45 seconds/);
  assert.match(pillar, /No hunt of a hoglin has been made from a pillar yet by this bot/);
  assert.match(found.routes.hoglin_walk.description, /each drops two to four raw porkchops, safe to eat raw at three hunger each, eight cooked/);
  // No block to lay: the pillar is not offered and the option says why.
  const bare = netherBot({ health: 6, food: 12, items: [item('iron_sword')], entities, worn });
  const without = foodRoutes(bare, new Task('t'), goal, save, { actions });
  assert(!without.routes.hoglin_pillar);
  assert(without.notOffered.some(s => /the hunt from a pillar: 0 blocks carried that can be laid, 2 are needed/.test(s)), without.notOffered.join('; '));
  // Fed with food to spare: no step at all.
  assert.equal(restockFoodOption(netherBot({ items: [item('cooked_beef', 12)], entities }), new Task('t'), goal, save, { actions }), null);
});

test('mushroom stew is offered where a red and a brown mushroom are in view and the bowl can be made, and said with the biomes the game grows them in (note 639)', () => {
  const { foodRoutes } = require('../src/nether-food');
  const goal = { sightings: {} };
  const mush = [{ name: 'red_mushroom', x: 10, y: 41, z: 3 }, { name: 'brown_mushroom', x: 12, y: 41, z: 5 }, { name: 'red_mushroom', x: 14, y: 41, z: 1 }];
  const actions = { navigate: async () => {}, mineOne: async () => {}, acquire: async () => {} };
  const bot = netherBot({ health: 8, food: 10, items: [item('crimson_planks', 3), item('crafting_table')], mushrooms: mush });
  const found = foodRoutes(bot, new Task('t'), goal, save, { actions });
  const stew = found.routes.mushroom_stew;
  assert(stew, `stew on offer: ${Object.keys(found.routes)}`);
  assert.match(stew.description, /^Make mushroom stew from the mushrooms in view: 2 red and 1 brown within 48 blocks \(the nearest 10 off; up to 1 stew counted\)/);
  assert.match(stew.description, /Each stew is 6 hunger, 6 for 1/);
  assert.match(stew.description, /three planks make four/);
  assert.match(stew.description, /The game generates them in the nether wastes and basalt deltas only/);
  assert.match(stew.description, /None gathered yet by this bot in the game/);
  // No wood and no bowl: not offered, said.
  const none = foodRoutes(netherBot({ items: [], mushrooms: mush }), new Task('t'), goal, save, { actions });
  assert(!none.routes.mushroom_stew);
  assert(none.notOffered.some(s => /mushroom stew: 2 red and 1 brown in view, but no bowl carried and 0 planks' worth of wood: bowls \(three planks, crimson or warped serve\) are short/.test(s)), none.notOffered.join('; '));
  // Only one kind in view: not a stew, said with where the game grows them.
  const one = foodRoutes(netherBot({ items: [item('bowl', 2)], mushrooms: [mush[0]] }), new Task('t'), goal, save, { actions });
  assert(!one.routes.mushroom_stew);
  assert(one.notOffered.some(s => /mushroom stew: 1 red and 0 brown mushrooms within 48 blocks .*the game generates them in the nether wastes and basalt deltas only, and how many stand there is not counted/.test(s)), one.notOffered.join('; '));
});

test('a furnace is fuelled by coal, charcoal or a blaze rod, not by the Nether\'s wood, and cooking the raw meat carried is a way when it is (note 639)', () => {
  const { FUELS, cookable } = require('../src/work');
  assert.equal(FUELS.test('crimson_planks'), false); assert.equal(FUELS.test('warped_stem'), false); assert.equal(FUELS.test('crimson_stem'), false);
  assert.equal(FUELS.test('oak_planks'), true); assert.equal(FUELS.test('coal'), true); assert.equal(FUELS.test('blaze_rod'), true);
  const wood = netherBot({ items: [item('porkchop', 4), item('furnace'), item('crimson_planks', 8)] });
  assert.equal(cookable(wood).fuel, null); assert.equal(cookable(wood).ready, false);
  const { foodRoutes } = require('../src/nether-food');
  const actions = { acquire: async () => {} };
  const stuck = foodRoutes(wood, new Task('t'), {}, save, { actions });
  assert(!stuck.routes.cook_meat);
  assert(stuck.notOffered.some(s => /cooking the raw meat carried \(4 porkchop, \+20 points\).*the Nether's stems and planks do not burn/.test(s)), stuck.notOffered.join('; '));
  const coal = netherBot({ items: [item('porkchop', 4), item('furnace'), item('coal', 5)] });
  const ready = foodRoutes(coal, new Task('t'), {}, save, { actions });
  assert.match(ready.routes.cook_meat.description, /^Cook the raw meat carried: 4 porkchop, 12 food points as carried and 32 once cooked \(\+20\)\. The furnace carried is put down here, fuelled with the coal carried \(coal and charcoal burn 8 items, a blaze rod 12; the Nether's own wood does not burn\): about ten seconds an item/);
});

test('a hunt walked to a sighting where no hoglin is begins nothing and says so; one in view is begun with its method (61 of the day\'s 66 hunts, note 626)', async () => {
  const { huntHoglin, recordSays } = require('../src/nether-food');
  const now = Date.now();
  const goal = { survival: {}, sightings: { hoglin: [{ x: 90, y: 41, z: 0, count: 2, at: now - 60000, dimension: 'the_nether' }] } };
  const bot = netherBot({ items: [item('iron_sword')] });
  const known = require('../src/nether-travel').hoglinsKnown(bot, goal);
  assert.equal(known.inView.length, 0); assert.equal(known.seen.length, 1);
  let walked = 0;
  const started = await huntHoglin(bot, new Task('t'), goal, save, known, { navigate: async () => { walked++; }, method: 'walk' });
  assert.equal(started, false); assert.equal(walked, 1);
  assert.equal(goal.survival.nightPlan, undefined, 'no hunt begun at a place none stands');
  assert.equal(goal.sightings.hoglin.length, 0, 'the sighting is forgotten');
  assert.match(recordSays(goal, 'hoglin_walk'), /Made in this trial: 1, 0 brought meat \(0 porkchops in all\); the last, 1 minute ago, ended: walked to where 2 hoglin seen 1 minute ago, 90 blocks/);
  // One in view within thirty-two blocks: the hunt is set as the night hunt is, with the method.
  const near = netherBot({ items: [item('iron_sword'), item('porkchop', 1)], entities: { 1: hoglin(1, 9.5, 41, 0.5) } });
  const g2 = { survival: {}, sightings: {} };
  const k2 = require('../src/nether-travel').hoglinsKnown(near, g2);
  assert.equal(await huntHoglin(near, new Task('t'), g2, save, k2, { navigate: async () => { throw new Error('no walk to a hoglin in view'); }, method: 'pillar' }), true);
  assert.deepEqual({ plan: g2.survival.nightPlan.plan, kind: g2.survival.nightPlan.kind, food: g2.survival.nightPlan.food, method: g2.survival.nightPlan.method, meatAtStart: g2.survival.nightPlan.meatAtStart },
    { plan: 'hunt', kind: 'hoglin', food: true, method: 'pillar', meatAtStart: 1 });
});

test('a hunt that ends is noted with the meat it brought, and said on the next offer of the way (note 639)', () => {
  const { noteHunt, recordSays } = require('../src/nether-food');
  const goal = {};
  const bot = netherBot({ items: [item('porkchop', 3)] });
  noteHunt(bot, goal, { food: true, method: 'pillar', kills: 1, meatAtStart: 0, struck: 5 }, 'the last one is down');
  noteHunt(bot, goal, { food: true, method: 'walk', kills: 0, meatAtStart: 3 }, 'no hoglin within thirty-two blocks');
  noteHunt(bot, goal, { plan: 'hunt', method: 'walk', kills: 1 }, 'a night\'s hunt is not food');
  assert.equal(goal.netherFood.hunts.length, 2);
  assert.match(recordSays(goal, 'hoglin_pillar'), /Made in this trial: 1, 1 brought meat \(3 porkchops in all\); the last, 1 minute ago, ended: the last one is down\./);
  assert.match(recordSays(goal, 'hoglin_walk'), /Made in this trial: 1, 0 brought meat \(0 porkchops in all\); the last, 1 minute ago, ended: no hoglin within thirty-two blocks\./);
});

test('the pillar hunt walks to twelve blocks, stands two up, strikes what comes within reach, gives up after forty-five seconds, and falls back to the ground when no block goes down (note 639)', async () => {
  const { pillarHuntStep, PILLAR_FROM, PILLAR_WAIT_MS } = require('../src/nether-food');
  const bot = netherBot({});
  bot.lookAt = async () => {};
  const target = hoglin(1, 20.5, 41, 0.5);
  const calls = [];
  let up = false, strikeable = false, pillarWorks = true;
  const deps = { bot, sleep: async () => calls.push('wait'), onPillar: () => up, canStrike: () => strikeable, why: () => 'no block went down',
    pillarFrom: async danger => { calls.push(`pillar:${danger[0].entity.name}`); if (pillarWorks) up = true; return pillarWorks; },
    defend: async () => calls.push('defend'), approach: async (mob, within) => calls.push(`approach:${within}`) };
  const plan = { food: true, method: 'pillar', kind: 'hoglin' };
  // Twenty blocks off: closed on to twelve first.
  assert.deepEqual(await pillarHuntStep(deps, plan, target), { handled: true });
  assert.deepEqual(calls, [`approach:${PILLAR_FROM}`]);
  // Within twelve: the pillar.
  target.position = new Vec3(8.5, 41, 0.5); calls.length = 0;
  await pillarHuntStep(deps, plan, target);
  assert.deepEqual(calls, ['pillar:hoglin']); assert(plan.pillarAt);
  // Up, and it has not come: waits. Within reach: strikes.
  calls.length = 0; await pillarHuntStep(deps, plan, target);
  strikeable = true; await pillarHuntStep(deps, plan, target);
  assert.deepEqual(calls, ['wait', 'defend']); assert.equal(plan.struck, 1);
  // Forty-five seconds up and none within reach: the hunt ends, said.
  strikeable = false; plan.pillarAt = Date.now() - PILLAR_WAIT_MS - 1000;
  const ended = await pillarHuntStep(deps, plan, target);
  assert.match(ended.end, /^no hoglin came within the sword's reach of the pillar in 45 seconds$/);
  // No block goes down: the hunt goes on the ground, the pillar's failure kept for the record.
  up = false; pillarWorks = false; delete plan.pillarAt; calls.length = 0;
  await pillarHuntStep(deps, plan, target);
  assert.equal(plan.method, 'walk'); assert.equal(plan.pillarFailed, 'no block went down');
});

test('the food kit is asked inside the Nether when the stay wants more than is carried: go on, get food here or go back, once an hour, never with a mob in sight (note 639)', async () => {
  const { askStayKit, stayKitDue } = require('../src/nether-food');
  const goal = { kind: 'win', portals: [{ x: 20, y: 44, z: 7, dimension: 'nether' }], sightings: {}, survival: {} };
  const entities = { 1: hoglin(1, 25.5, 41, 0.5) };
  const bot = netherBot({ items: [item('mutton', 2), item('iron_sword'), item('cobblestone', 10)], entities, worn });
  const actions = { returnOverworld: async () => { back++; }, navigate: async () => {} };
  let back = 0;
  const client = stubClient(['go_on', 'return_for_food']);
  assert.equal(await askStayKit(bot, new Task('t'), goal, save, { actions, client }), 'go_on');
  assert.equal(client.asked.length, 1);
  const { options, state } = client.asked[0];
  assert.deepEqual(Object.keys(options).sort(), ['go_on', 'restock_food', 'return_for_food']);
  assert.match(options.go_on, /^Go on with the stay on what is carried: 4 food points, about 6 minutes of it at 40 an hour, against the 120 minutes the goal still wants; 76 points short\./);
  assert.match(options.restock_food, /^Get food here first \(the ways asked next, each priced\): a hoglin hunted on foot, a hoglin hunted from a pillar\./);
  assert.match(options.return_for_food, /^Go back through the portal to the Overworld for food, hunted and cooked there, and come back fed\./);
  assert.deepEqual(state.stay, { minutesWanted: 120, pointsWanted: 80, pointsCarried: 4, carriedLastMinutes: 6, short: 76 });
  assert.match(state.note, /the food line of the crossing kit, asked inside the Nether because this stay began here/);
  // Once an hour whatever the answer: not again now.
  assert.equal(stayKitDue(bot, goal), null);
  assert.equal(await askStayKit(bot, new Task('t'), goal, save, { actions, client }), 'go_on');
  assert.equal(client.asked.length, 1);
  // An hour on: asked again, and the trip back chosen is taken.
  goal.netherFoodKit.at -= 61 * 60000;
  assert.equal(await askStayKit(bot, new Task('t'), goal, save, { actions, client }), 'return_for_food');
  assert.equal(back, 1);
  assert.equal(goal.leaveNether.pick, 'go_back'); assert.equal(goal.leaveNether.reason, 'food');
  assert.equal(goal.netherFoodKit, undefined, 'the stay it was asked in is left');
  // Enough for the stay: not asked. A mob in sight: not asked. The Overworld: not asked.
  const fed = netherBot({ items: [item('cooked_beef', 12)] });
  assert.equal(stayKitDue(fed, { kind: 'win' }), null);
  const watched = netherBot({ items: [item('mutton', 2)], entities: { 9: { id: 9, name: 'blaze', type: 'hostile', position: new Vec3(6.5, 41, 0.5), isValid: true, height: 1.8, width: 0.6 } } });
  const quiet = stubClient(['go_on']);
  assert.equal(await askStayKit(watched, new Task('t'), { kind: 'win', survival: {} }, save, { actions, client: quiet }), 'go_on');
  assert.equal(quiet.asked.length, 0, 'not asked with a blaze in sight');
  assert.equal(stayKitDue(netherBot({ items: [], dimension: 'overworld' }), {}), null);
});

test('restock_food is asked with its ways, the pick carried out, and the stay and what the Nether has said in the state (note 639)', async () => {
  const { askRestockFood } = require('../src/nether-food');
  const goal = { kind: 'win', portals: [{ x: 20, y: 44, z: 7, dimension: 'nether' }], sightings: {}, survival: {} };
  const bot = netherBot({ health: 6, food: 12, items: [item('iron_sword'), item('cobblestone', 10)], entities: { 1: hoglin(1, 9.5, 41, 0.5) }, worn });
  const actions = { returnOverworld: async () => {}, navigate: async () => {} };
  const client = stubClient(['hoglin_pillar']);
  assert.equal(await askRestockFood(bot, new Task('t'), goal, save, { actions, client }), true);
  const { options, state } = client.asked[0];
  assert.deepEqual(Object.keys(options).sort(), ['hoglin_pillar', 'hoglin_walk', 'keep_on', 'return_for_food']);
  assert.equal(goal.survival.nightPlan.method, 'pillar'); assert.equal(goal.survival.nightPlan.food, true);
  assert.match(state.whatTheNetherHas, /A bastion's hoglin stable chest holds about 17 food points/);
  assert.match(state.whatTheNetherHas, /piglin barter's items \(19 in the jar\) hold none, a strider drops string, chorus fruit grows only in the End/);
  assert.match(state.carried, /^0 food points$/);
  assert(state.waysNotOffered.some(s => /mushroom stew: 0 red and 0 brown mushrooms within 48 blocks/.test(s)));
  assert.match(state.theNetherPace, /17 to 30 blocks a minute/);
  assert.deepEqual(state.stay, { minutesWanted: 120, pointsWanted: 80, carriedLastMinutes: 0 });
  // The keep_on it offers is the same twenty minutes' rest of the trip back the stalls offer.
  const { question } = require('../src/decisions');
  assert.equal(question('restock_food').fallback({ cook_meat: {}, keep_on: {}, hoglin_pillar: {} }), 'cook_meat');
  assert.equal(question('restock_food').fallback({ hoglin_walk: {}, hoglin_pillar: {}, return_for_food: {} }), 'return_for_food');
  assert.equal(question('nether_food_kit').fallback({ go_on: {}, return_for_food: {} }), 'go_on');
});

test('a hurt bot\'s options say health does not come back where it does not, once, and not where it does or where they say it already (note 639)', () => {
  const { noHealSays, withNoHealSays } = require('../src/healing');
  const hurt = netherBot({ health: 3.5, food: 13, items: [item('iron_sword')] });
  assert.equal(noHealSays(hurt), 'Health 3.5 does not come back at hunger 13: nothing carried is food, and in the Nether only a hoglin, a mushroom stew or what the bastions hold is, so whatever this costs in health stays lost.');
  // Enough carried to reach eighteen: eating brings it back, so nothing to warn of. Health ten or more, hunger eighteen or more, Creative, Overworld wording.
  assert.equal(noHealSays(netherBot({ health: 3.5, food: 13, items: [item('cooked_beef', 1)] })), '');
  assert.match(noHealSays(netherBot({ health: 3.5, food: 13, items: [item('mutton', 1)] })), /^Health 3\.5 does not come back at hunger 13: all the food carried brings hunger only to 15,/);
  assert.equal(noHealSays(netherBot({ health: 10, food: 13 })), '');
  assert.equal(noHealSays(netherBot({ health: 3.5, food: 18 })), '');
  const creative = netherBot({ health: 3.5, food: 13 }); creative.game.gameMode = 'creative';
  assert.equal(noHealSays(creative), '');
  assert.doesNotMatch(noHealSays(netherBot({ health: 3.5, food: 13, dimension: 'overworld' })), /Nether/);
  // Added to the options that leave it out, not to those that say it.
  const answers = { work_free: { description: 'Work free of the terrain one move at a time.' }, keep_on: { description: 'Stay and go on. Hunger 13: health comes back only at eighteen or more.' }, cross_toward: { description: 'Go straight at the leg.' } };
  withNoHealSays(hurt, {}, answers);
  assert.match(answers.work_free.description, /one move at a time\. Health 3\.5 does not come back at hunger 13/);
  assert.match(answers.cross_toward.description, /Go straight at the leg\. Health 3\.5 does not come back at hunger 13/);
  assert.equal(answers.keep_on.description, 'Stay and go on. Hunger 13: health comes back only at eighteen or more.');
  // Health enough: the answers are as they were.
  const fine = { a: { description: 'x' } };
  withNoHealSays(netherBot({ health: 15, food: 13 }), {}, fine);
  assert.equal(fine.a.description, 'x');
});

test('the survival layer runs the hunt from a pillar (walk near, pillar, wait) and notes how any food hunt ended, with no hoglin left (note 639)', async () => {
  const { Survival } = require('../src/survival');
  const now = Date.now();
  const mk = (entities) => {
    const bot = netherBot({ items: [item('iron_sword'), item('cobblestone', 8)], entities, worn });
    Object.assign(bot, { oxygenLevel: 20, pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, setControlState() {}, getControlState: () => false, lookAt: async () => {}, look: async () => {}, equip: async () => {}, attack: () => {} });
    const calls = [];
    const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => { calls.push('navigate'); } }, { state: { shelters: [] } });
    return { bot, survival, calls };
  };
  const goal = { survival: {} };
  // A hoglin twenty blocks off: the walk to within twelve, no pillar yet.
  const far = mk({ 1: hoglin(1, 20.5, 41, 0.5) });
  far.survival.foodHunt(goal, save, 'hoglin', { method: 'pillar' });
  assert.equal(far.survival.state.nightPlan.method, 'pillar');
  await far.survival.huntStep(new Task('t'), goal, save);
  assert.deepEqual(far.calls, ['navigate']);
  // Within twelve: the pillar is the stance's own (pillarFrom), and the next step waits on it.
  const near = mk({ 1: hoglin(1, 8.5, 41, 0.5) });
  near.survival.foodHunt(goal, save, 'hoglin', { method: 'pillar' });
  const pillars = [];
  near.survival.pillarFrom = async (task, g, s, danger) => { pillars.push(danger.map(t => t.entity.name)); near.bot.entity.position = new Vec3(0.5, 43, 0.5); near.survival.state.pillar = { x: 0, y: 41, z: 0, at: Date.now() }; return true; };
  await near.survival.huntStep(new Task('t'), goal, save);
  assert.deepEqual(pillars, [['hoglin']]);
  assert(near.survival.state.nightPlan.pillarAt, 'up');
  // A pillar that puts no block down: the hunt goes on the ground, and says why when it ends.
  const bad = mk({ 1: hoglin(1, 8.5, 41, 0.5) });
  bad.survival.foodHunt(goal, save, 'hoglin', { method: 'pillar' });
  bad.survival.pillarFrom = async () => { bad.survival.state.stanceWhy = 'no block went down: a zombie stands in the cell'; return false; };
  await bad.survival.huntStep(new Task('t'), goal, save);
  assert.equal(bad.survival.state.nightPlan.method, 'walk'); assert.equal(bad.survival.state.nightPlan.pillarFailed, 'no block went down: a zombie stands in the cell');
  // No hoglin within thirty-two blocks: the hunt is over, and noted with the meat it brought (none).
  const gone = mk({});
  gone.survival.foodHunt(goal, save, 'hoglin', { method: 'pillar' });
  await gone.survival.huntStep(new Task('t'), goal, save);
  assert.equal(gone.survival.state.nightPlan, undefined);
  const noted = goal.netherFood.hunts.at(-1);
  assert.deepEqual({ route: noted.route, kills: noted.kills, meat: noted.meat, why: noted.why }, { route: 'hoglin_pillar', kills: 0, meat: 0, why: 'no hoglin within thirty-two blocks' });
  assert(noted.at >= now);
});
