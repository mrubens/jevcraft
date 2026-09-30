'use strict';
// Food and healing in the Nether (note 607): the crossing kit sized for the
// stay the goal needs, and the facts said at low health with nothing to eat,
// from the recorded states of mid-242-ba-fortress-1 (25590, 13:02:55Z) and
// mid-235-q-nether-2-fortress-4 (25584, 12:48:58Z).
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');

const item = (name, count = 1) => ({ name, count, type: registry.itemsByName[name].id, durabilityUsed: 0 });
function netherBot({ at, health, food, worn = {}, items = [], entities = {}, dimension = 'the_nether' }) {
  const slots = [];
  for (const [slot, name] of Object.entries({ 5: worn.head, 6: worn.torso, 7: worn.legs, 8: worn.feet, 45: worn.offhand })) if (name) slots[slot] = item(name);
  const ground = p => Math.floor(p.y) < Math.floor(at.y) ? { name: 'netherrack', boundingBox: 'block', position: p } : { name: 'air', boundingBox: 'empty', position: p };
  return Object.assign(new EventEmitter(), {
    registry, health, food, foodSaturation: 0, entity: { id: 1, position: at, height: 1.8, width: 0.6, onGround: true, velocity: new Vec3(0, 0, 0) },
    game: { dimension, gameMode: 'survival', difficulty: 'normal' }, time: { timeOfDay: 6000 },
    inventory: { items: () => items, slots }, entities, world: { raycast: () => null }, blockAt: p => ground(p.floored ? p.floored() : p),
  });
}
const hostile = (id, name, x, y, z) => ({ id, name, type: 'hostile', position: new Vec3(x, y, z), isValid: true, height: name === 'ghast' ? 4 : 1.95, width: 0.6 });

test('the crossing kit wants food for the Nether stay the goal still needs, and says the stay and its hunger (note 607)', () => {
  const { kitItems, netherStay } = require('../src/crossing-kit');
  const bot = netherBot({ at: new Vec3(0.5, 64, 0.5), health: 20, food: 20, dimension: 'overworld', items: [item('cooked_beef', 5)] });
  const food = () => kitItems(bot).find(i => i.key === 'food');
  // Nothing of the rods or pearls yet: the practiced player's two hours, at forty hunger an hour.
  assert.deepEqual(netherStay(bot), { minutes: 120, points: 80, rodsLeft: 7, pearlsLeft: 13, rodsWanted: 7, pearlsWanted: 13, eyes: 13 });
  assert.equal(food().wants, 80); assert.equal(food().short, true, 'five steaks are forty points, half the stay');
  assert.match(food().says, /^Food: 40 food points carried \(5 cooked beef\); the code would take 80, food for the whole stay\. The goal still needs 7 blaze rods and 13 ender pearls \(it wants 7 rods and 13 pearls in all, for 13 eyes: .*the stronghold search throws with a thirteenth\): a practiced player takes about 2 hours in the Nether for them/);
  assert.match(food().says, /A stay spends about 40 hunger an hour .* so about 2 hours is about 80 food points, 10 cooked steaks or porkchops; raw meat counts at its raw points/);
  assert.match(food().says, /a hurt bot with nothing to eat is left to go back through the portal for food or fight one at the health it has/);
  // The rods carried: the pearls' hour is left.
  bot.inventory.items = () => [item('cooked_beef', 5), item('blaze_rod', 7)];
  assert.equal(food().wants, 40); assert.equal(food().short, false);
  assert.match(food().says, /The goal still needs 13 ender pearls \(it wants 7 rods and 13 pearls in all.*\): a practiced player takes about 60 minutes/);
  // Everything in hand: half an hour is still a stay.
  bot.inventory.items = () => [item('ender_eye', 13)];
  assert.equal(food().wants, 24);
  assert.match(food().says, /The goal needs nothing more from the Nether's fortress or barter: about 30 minutes is the stay counted/);
});

// mid-242-ba-fortress-1 sealed in at (-210.5, 53, -180.5), 2.2 health, hunger 17, nothing to eat, iron helmet and
// chestplate, 48 seconds after Jev kept on in the Nether at 10.1 health; a hoglin seen eight minutes before 123
// blocks north-east; the Overworld portal at (64, 104, -13) the only one remembered. Its pocket chose the hoglin.
function pocket25590() {
  const now = Date.now();
  const bot = netherBot({ at: new Vec3(-210.5, 53, -180.5), health: 2.2333335876464844, food: 17,
    worn: { head: 'iron_helmet', torso: 'iron_chestplate', offhand: 'shield' }, items: [item('iron_sword'), item('netherrack', 64), item('coal', 64)] });
  const goal = { kind: 'win', portals: [{ x: 64, y: 104, z: -13, dimension: 'overworld' }],
    sightings: { hoglin: [{ x: -100, y: 60, z: -234, count: 1, at: now - 8 * 60000, dimension: 'the_nether' }], cow: [{ x: 99, y: 74, z: 109, count: 4, at: now - 20 * 60000, dimension: 'overworld' }] },
    survival: { shelters: [] } };
  const { setAside } = require('../src/progress');
  const was = { health: bot.health, food: bot.food };
  Object.assign(bot, { health: 10.1 });
  setAside(goal, 'nether_return', 'food', require('../src/nether-travel').keepOnWhy(bot), 20 * 60000);
  Object.assign(bot, was);
  return { bot, goal };
}

test('at 2.2 health in the Nether with nothing to eat, every question is told health does not come back, the trip back with its walk and the food over there, and that a hoglin is lost at this health (mid-242-ba-fortress-1, note 607)', () => {
  const { bot, goal } = pocket25590();
  const h = require('../src/healing').healingSays(bot, goal);
  assert.match(h.withoutFood, /^health 2\.2 does not come back here: nothing carried is food, and in the Nether only a hoglin, a mushroom stew or what a bastion's chests hold is food; every point lost from here on stays lost until the bot has eaten to eighteen$/);
  assert.match(h.tripBackForFood, /^back through the portal to the Overworld for food: No portal here has been seen since the crossing, but the one the bot came through from the Overworld portal at \(64, -13\) comes out near \(8, -2\) here, 2\d\d blocks off, about \d+ seconds at a walk once the way is found/);
  assert.match(h.tripBackForFood, /Health does not come back on the way: hunger 17, under eighteen, and nothing to eat; 2\.2 health is what it walks with\./);
  assert.match(h.tripBackForFood, /Known on the Overworld side: 4 cow seen 20 minutes ago \d+ blocks from that portal\./);
  assert.match(h.hoglinHunt, /^1 hoglin seen 8 minutes ago, 123 blocks north-east \(-100, -234\), about 29 seconds' walk; it drops two to four raw porkchops, three hunger each\. One hoglin with the iron sword: about [\d.]+ seconds and [\d.]+ damage, more than the 2\.2 health left: at this health the bot is dead before the hoglin is; /);
  // The guidance names the new facts only where they are sent.
  const { withRealTime } = require('../src/decisions');
  if (withRealTime) assert.match(withRealTime({ area: 'survival', instructions: { task: 't', guidance: 'g' } }, { healing: h }).guidance, /tripBackForFood is the way back through the portal for food/);
  // Fed, or in the Overworld, none of it is said.
  assert.equal(require('../src/healing').healingSays({ ...bot, food: 18 }, goal).withoutFood, undefined);
  assert.equal(require('../src/healing').healingSays({ ...bot, game: { ...bot.game, dimension: 'overworld' } }, goal).tripBackForFood, undefined);
});

test('the pocket\'s way to food keeps the trip back while Jev\'s keep-on holds, said with when and at what health it was chosen, and the hoglin says it is lost at 2.2 (mid-242-ba-fortress-1, note 607)', () => {
  const { bot, goal } = pocket25590();
  const { Survival } = require('../src/survival');
  const { Task } = require('../src/skills');
  const survival = new Survival(bot, { navigate: async () => {}, returnOverworld: async () => {} }, { state: goal.survival });
  const ways = survival.offWorldFood(new Task('food'), goal, () => {});
  assert.deepEqual(Object.keys(ways).sort(), ['hoglin_food', 'return_for_food']);
  assert.match(ways.return_for_food.description, /^Go back through the portal to the Overworld, where food can be hunted and cooked\. In the Nether hoglins are the only meat\. No portal here has been seen since the crossing, but the one the bot came through/);
  assert.match(ways.return_for_food.description, /Known on the Overworld side: 4 cow seen/);
  assert.match(ways.return_for_food.description, /Jev chose under a minute ago, at 10\.1 health, to go on in the Nether without this trip for twenty minutes; health is 2\.2 now\.$/);
  assert.match(ways.hoglin_food.description, /hits for three to eight before armour/);
  assert.match(ways.hoglin_food.description, /more than the 2\.2 health left: at this health the bot is dead before the hoglin is/);
  // The walk to a hoglin seen 123 blocks off is said at the Nether's pace as well (note 625), and the
  // day's hunts said: 66 begun, none brought meat.
  assert.match(ways.hoglin_food.description, /The walk there is about 29 seconds at a walk and if nothing stops it \(the Nether's walks made 17 to 30 blocks a minute over 2026-09-28, stops counted: about 4 to 7 minutes\), at 2\.2 health, and the hoglin may have moved on\. Two minutes, or six health lost, ends the hunt; at 2\.2 health that six is more than the bot has\./);
  assert.match(ways.hoglin_food.description, /How the hunts of a hoglin for its meat went over 2026-09-28's trials in the Nether: 66 begun, 0 brought meat; 61 ended at the place a hoglin was seen with none within thirty-two blocks \(they move on\), 5 in a fight that took six health\./);
});

// mid-235-q-nether-2-fortress-4 at (92, 37, 43), 4 health, hunger 10, nothing to eat, iron helmet, chestplate and
// boots, no gold worn; a piglin in sight 9.8 blocks off; the hunt of hoglins Jev chose a minute before, the nearest
// seen 47 blocks north-east; the Nether portal at (37, 56, 3). turn_priority gave the work the turn (0.81).
function turn25584({ ghast = false } = {}) {
  const now = Date.now();
  const entities = { 1924: hostile(1924, 'piglin', 100.5, 40, 40.2) };
  if (ghast) entities[2142] = hostile(2142, 'ghast', 78.8, 40.3, 101.3);
  const bot = netherBot({ at: new Vec3(91.5, 37, 42.5), health: 4, food: 10, worn: { head: 'iron_helmet', torso: 'iron_chestplate', feet: 'iron_boots', offhand: 'shield' },
    items: [item('iron_sword'), item('stone_pickaxe', 2), item('coal', 64), item('gold_ingot', 4)], entities });
  const goal = { kind: 'win', request: 'beat the game', portals: [{ x: 37, y: 56, z: 3, dimension: 'nether' }, { x: 300, y: 67, z: 24, dimension: 'overworld' }],
    sightings: { hoglin: [{ x: 116, y: 40, z: 2, count: 1, at: now - 60000, dimension: 'the_nether' }] },
    survival: { shelters: [], nightPlan: { plan: 'hunt', kind: 'hoglin', food: true, until: now + 60000, startHealth: 4 } } };
  return { bot, goal };
}

test('turn_priority at 4 health in the Nether: the hunt says the hoglin is lost at this health, and the work says health does not come back and what each mob about would do (mid-235-q-nether-2-fortress-4, note 607)', async () => {
  const arbiter = require('../src/arbiter');
  const { claim } = require('../src/survival');
  const { bot, goal } = turn25584();
  const survivalClaim = claim(bot, goal, null);
  assert.equal(survivalClaim.action, 'night_hunt');
  const work = { layer: 'work', action: 'step', urgency: 'routine', facts: { request: 'beat the game', doing: 'find fortress' }, run: async () => true };
  let asked;
  const decide = async (id, { tree, state }) => { asked = { tree, state }; return { path: ['work'] }; };
  const mobs = require('../src/danger').threats(bot, 16);
  await arbiter.arbitrate(bot, [{ ...survivalClaim, run: async () => true }, work], { state: {}, mobs, decide, run: false, goal });
  assert.match(asked.tree.survival.description.does, /^Go on with the hunt for food of hoglins, as chosen: close on those met and fight them\. Health 4\. It does not come back at hunger 10\. None in view; 1 hoglin seen 1 minute ago, 4\d blocks north-east \(116, 2\)\. One hoglin with the iron sword: about [\d.]+ seconds and [\d.]+ damage, more than the 4 health left: at this health the bot is dead before the hoglin is; a blow is [\d.]+ to [\d.]+ through the armour worn: one of its harder blows ends the bot\.$/);
  assert.match(asked.tree.work.description.does, /Health 4: it does not come back at hunger 10, and nothing carried is food, so it does not come back while the work goes on\. Mobs within sixteen blocks now: A piglin 9\.\d blocks off, about [\d.]+ a hit through the armour worn \(as much as the health left\); it sees the bot \(no gold is worn\) and comes at it: at the bot in about \d+ seconds at its walk\. At low health: In the played record .* Nothing carried is food and no pocket can be walled here with the blocks carried\.$/);
  // Sixteen seconds on, a ghast sixty blocks off in sight: its fire reaches, and it is said.
  const later = turn25584({ ghast: true });
  await arbiter.arbitrate(later.bot, [{ ...claim(later.bot, later.goal, null), run: async () => true }, work], { state: {}, mobs: require('../src/danger').threats(later.bot, 16), decide, run: false, goal: later.goal });
  assert.match(asked.tree.work.description.does, /Mobs about now, within sixteen blocks and the shooters farther off whose fire reaches the bot: A piglin 9\.\d blocks off.*\. A ghast \d+\.\d blocks off, about [\d.]+ a hit through the armour worn \(as much as the health left\); it has the bot in sight and fires at it from as far as 64 blocks\. At low health: In the played record .*\.$/);
});

test('the stalled Nether work offers the trip back for food itself, with its walk, while keep-on holds too, and chosen it is held as the way back (mid-235-q-nether-2-fortress-4 at 12:47:45, note 607)', async () => {
  // Offered a hoglin 47 blocks off and an ore, Jev answered none good (0.82) and the hoglin was taken.
  const { netherAnswers, keepOnWhy } = require('../src/nether-travel');
  const { setAside, isSetAside } = require('../src/progress');
  const { Task } = require('../src/skills');
  const { bot, goal } = turn25584();
  delete goal.survival.nightPlan;
  // keep_on was chosen at 12:43:48, at 4 health and hunger 10.
  setAside(goal, 'nether_return', 'food', keepOnWhy({ health: 4, food: 10 }), 20 * 60000);
  Object.values(goal.survival.attempts)[0].at -= 237000;
  let back = 0;
  const answers = netherAnswers(bot, new Task('stall'), goal, () => {}, { survival: { foodHunt() {} }, actions: { navigate: async () => {}, returnOverworld: async () => { back++; } } });
  assert(answers.hoglin_food, 'the hoglin is still offered');
  assert.equal(answers.keep_on, undefined, 'keep-on already holds');
  assert.match(answers.return_for_food.description, /^Go back through the portal to the Overworld for food, hunted and cooked there, and come back fed\. The nearest portal remembered is 6\d blocks off, about 1\d seconds at a walk if nothing stops it, and back through one after\./);
  // Sixty-odd blocks is where the measured pace begins to be said (note 625): 2 to 4 minutes, not seconds.
  assert.match(answers.return_for_food.description, /In the Nether the bot's walks back to a portal made 17 to 30 blocks a minute over 2026-09-28's trials, the stops for mobs, edges and drops counted: about 2 to 4 minutes, not seconds\. Of 181 such walks of over 60 blocks 22 came out in the Overworld, 18 ended in a death and the rest were given up, set aside or stalled; of the 33 begun under eight health 4 came out and 6 died\./);
  assert.match(answers.return_for_food.description, /Health does not come back on the way: hunger 10, under eighteen, and nothing to eat; 4 health is what it walks with\./);
  assert.match(answers.return_for_food.description, /Jev chose 4 minutes ago, at 4 health, to go on in the Nether without this trip for twenty minutes; health is 4 now\.$/);
  await answers.return_for_food.run();
  assert.equal(back, 1);
  assert.equal(goal.step.action, 'return_for_food');
  assert.equal(isSetAside(goal, 'nether_return', 'food'), false, 'the keep-on it replaces is ended');
  assert.equal(require('../src/game-progress').netherLeaveHeld(goal, 'food'), true, 'held as the way back across passes');
});

test('with no Nether portal remembered, the walk back goes to where the game put the one the bot came through (mid-242-ba-fortress-1, note 607)', async () => {
  const { walkToKnownPortal } = require('../src/work');
  const { Task } = require('../src/skills');
  const { bot, goal } = pocket25590();
  const { cameThrough } = require('../src/game-progress');
  assert.deepEqual({ ...cameThrough(goal, bot.entity.position), from: undefined }, { x: 8, y: 53, z: -2, from: undefined, estimated: true });
  bot.entity.position = new Vec3(7.5, 53, -1.5);
  assert.equal(await walkToKnownPortal(bot, new Task('back'), goal, () => {}, 'nether'), false, 'at the place worked out with none in view, it is not there');
});
