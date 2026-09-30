'use strict';
// Note 701: low health in a blaze fight.
// (1) 25597 (mid-242-jg) at 23:26:15.393Z chose eat at 12.1 health; a
// shield_up answer came 34 ms later with the shot hold on since 23:26:07,
// and hunger stayed 17: the hold's raise, and its lowering by a release,
// ended the meal. A chosen meal now keeps the hand: no warning raises the
// shield while it is eaten, nothing lowers it by a release, a shot on its way
// that lands inside the meal cuts it, and it is begun again after.
// (2) 25581 chose corner_ambush twice at 2.2 health with four blazes in
// sight and died (Fable's check-in, 22:50Z): at a health where one shot that
// lands ends the bot, it steps out of every line before the stance is asked.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const reflex = require('../src/shot-reflex');
const combat = require('../src/combat');
const meal = require('../src/meal');
const lethalLine = require('../src/lethal-line');

const registry = require('minecraft-data')('26.1');
const SMALL_FIREBALL = registry.entitiesByName.small_fireball.id;

// A floor of nether bricks under y 65, and `walls` (cells as 'x,y,z') above
// it; a raycast that steps through the cells.
function world(walls = new Set()) {
  const solidAt = f => f.y < 65 || walls.has(`${f.x},${f.y},${f.z}`);
  const blockAt = p => { const f = p.floored(); const s = solidAt(f); return { position: f, name: s ? 'nether_bricks' : 'air', boundingBox: s ? 'block' : 'empty', diggable: s, shapes: s ? [[0, 0, 0, 1, 1, 1]] : [] }; };
  const raycast = (from, dir, length) => {
    for (let t = 0; t <= length; t += 0.05) { const p = from.plus(dir.scaled(t)); const f = p.floored(); if (solidAt(f)) return { position: f, intersect: p }; }
    return null;
  };
  return { blockAt, raycast };
}
function fightBot({ health = 12.1, walls, armour = [], food = 17 } = {}) {
  const w = world(walls);
  const calls = { raised: 0, lowered: 0 };
  const client = new EventEmitter();
  const blaze = { id: 50, name: 'blaze', type: 'hostile', position: new Vec3(8.5, 66, 0.5), height: 1.8, width: 0.6, isValid: true, metadata: {} };
  const slots = { 45: { name: 'shield' } };
  armour.forEach((n, i) => { slots[5 + i] = { name: n }; });
  const bot = Object.assign(new EventEmitter(), {
    registry, _client: client, game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health, food, foodSaturation: 0, oxygenLevel: 20, time: { timeOfDay: 6000 },
    entity: { id: 1, position: new Vec3(0.5, 65, 0.5), yaw: 0, pitch: 0, onGround: true, height: 1.8, width: 0.6, velocity: new Vec3(0, 0, 0), metadata: {} },
    entities: { 50: blaze }, inventory: { slots, items: () => [{ name: 'beef', count: 9 }, { name: 'iron_sword', count: 1 }, { name: 'netherrack', count: 40 }], emptySlotCount: () => 10 },
    heldItem: { name: 'iron_sword' }, blockAt: w.blockAt, world: { raycast: w.raycast }, findBlocks: () => [],
    controlState: {}, pathfinder: { isBuilding: () => false, setGoal() {}, movements: {} },
    activateItem(off) { calls.raised++; calls.offHand = off; },
    deactivateItem() { calls.lowered++; },
    setControlState(k, on) { this.controlState[k] = on; }, clearControlStates() { this.controlState = {}; },
    look() { return Promise.resolve(); }, lookAt() { return Promise.resolve(); }, attack() {}, equip: async () => {},
  });
  return { bot, calls, client, blaze };
}
// The blaze's glow answered shield_up, its shots due now.
function answeredShieldUp(bot, blaze, now) {
  blaze._shotWarn = { key: `${blaze.id}:${now - 2500}`, at: now - 2500, kind: 'blaze' };
  bot._shotAnswers = new Map([[blaze.id, { key: blaze._shotWarn.key, choice: 'shield_up', at: now - 2400, until: now + 3000 }]]);
  bot._shotLookAt = now; bot._shotShooters = [blaze.id]; bot._shotWarned = new Set([blaze.id]);
  blaze.metadata[16] = 1;
}
const fireballAt = (client, bot, blaze, id = 900) => {
  const mid = bot.entity.position.offset(0, 0.9, 0), d = mid.minus(blaze.position).normalize().scaled(0.8);
  client.emit('spawn_entity', { entityId: id, type: SMALL_FIREBALL, x: blaze.position.x, y: blaze.position.y, z: blaze.position.z, velocity: { x: d.x, y: d.y, z: d.z }, objectData: blaze.id });
};

test('25597 23:26:15: a shield_up answer due while the chosen meal is eaten neither raises the shield nor ends the meal by lowering it (note 701)', () => {
  const { bot, calls, blaze } = fightBot();
  reflex.watchShots(bot);
  const now = Date.now();
  answeredShieldUp(bot, blaze, now);
  // Before the meal, as at 23:26:07 to 15: the hold raises the shield.
  reflex.tick(bot, null, now);
  assert.equal(calls.raised, 1);
  assert.ok(bot._shotHold);
  // The meal begun: the server says the main hand is in use (living flags 1).
  bot._meal = { item: 'beef', at: now + 100, endsAt: now + 2100, cut: null };
  bot.entity.metadata[8] = 1;
  reflex.tick(bot, null, now + 150);
  reflex.tick(bot, null, now + 500);
  assert.equal(bot._shotHold, null, 'the hold lets go: no warning holds the shield while the meal is eaten');
  assert.equal(calls.lowered, 0, 'no release: it would end the meal');
  assert.equal(calls.raised, 1, 'not raised again');
  // Nothing else raises it while the meal is on.
  assert.equal(combat.raiseShield(bot), false);
  assert.equal(calls.raised, 1);
});

test('a fireball on its way that lands inside the meal cuts it for the shield; one landing after the meal does not (note 701)', () => {
  const { bot, calls, client, blaze } = fightBot();
  reflex.watchShots(bot);
  const now = Date.now();
  bot._meal = { item: 'beef', at: now, endsAt: now + 1900, cut: null };
  bot.entity.metadata[8] = 1;
  fireballAt(client, bot, blaze);
  reflex.tick(bot, null, now);
  assert.ok(bot._meal.cut, 'cut');
  assert.match(bot._meal.cut.why, /small fireball on its way/);
  assert.equal(calls.raised, 1, 'the shield raised for it');
  assert.equal(reflex.shotComing(bot, now), true);
  // The same shot with the meal nearly eaten: the meal goes on.
  const b = fightBot();
  reflex.watchShots(b.bot);
  b.bot._meal = { item: 'beef', at: now - 1800, endsAt: now + 100, cut: null };
  b.bot.entity.metadata[8] = 1;
  fireballAt(b.client, b.bot, b.blaze);
  reflex.tick(b.bot, null, now);
  assert.equal(b.bot._meal.cut, null);
  assert.equal(b.calls.raised, 0);
});

test('a meal cut by a shot is begun again once no shot is on its way, and eaten (note 701)', async () => {
  const { bot } = fightBot();
  let tries = 0;
  bot.consume = () => { tries++; return tries === 1 ? new Promise((_, reject) => setTimeout(() => reject(new Error('Consuming cancelled')), 3000)) : new Promise(resolve => setTimeout(() => { bot.food = 20; resolve(); }, 30)); };
  bot.equip = async item => { bot.heldItem = { name: item.name }; };
  setTimeout(() => meal.cutMeal(bot, 'a small fireball on its way'), 250);
  const task = { check() {} };
  const r = await meal.eatThrough(bot, task, { name: 'beef' }, { eaten: () => bot.food > 17 });
  assert.equal(r.eaten, true);
  assert.equal(r.tries, 2);
  assert.deepEqual(r.cuts, ['a small fireball on its way']);
  assert.equal(bot._meal, null);
});

test('the eat option says whether the meal is done before a shot can land here (note 701)', () => {
  const glowing = meal.finishSays([{ name: 'blaze', distance: 8, inSeconds: 0.9 }], { from: 4, to: 34, lastAgo: 6 });
  assert.equal(glowing.finishes, false);
  assert.match(glowing.says, /Not done before a shot: the blaze 8 blocks off, with a line here, shoots in about 0.9 seconds/);
  assert.match(glowing.says, /begun again once the shots are past/);
  assert.match(glowing.says, /spawner's next try is 4 to 34 seconds off/);
  const resting = meal.finishSays([{ name: 'blaze', distance: 13, inSeconds: 3 }, { name: 'blaze', distance: 9, inSeconds: 6.2 }]);
  assert.equal(resting.finishes, true);
  assert.match(resting.says, /Done before any shot lands here: the soonest of the 2 shooters with a line here, the blaze 13 blocks off, can shoot in about 3 seconds/);
  assert.equal(meal.finishSays([]).says, '');
});

test('one landing\'s end: the blaze\'s hit through the armour worn and its fire, said as the rule\'s threshold; none out of its line (note 701)', () => {
  const iron = ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'];
  const at = (health, opts = {}) => { const g = fightBot({ health, ...opts }); return { g, L: lethalLine.lethal(g.bot, [{ entity: g.blaze }], g.bot.entity.position.floored()) }; };
  // Full iron: 2.5 through it and 4 from the fire.
  assert.ok(at(6.5, { armour: iron }).L);
  assert.equal(at(6.6, { armour: iron }).L, null);
  // None worn: 5 and 4.
  const { L } = at(8.9);
  assert.ok(L);
  assert.match(L.says, /^At 8.9 health one shot that lands ends the bot: a blaze's is about 5 through the armour worn, and the fire it sets about 4 more\./);
  assert.match(L.says, /out of every shooter's line first/);
  assert.equal(at(9.1).L, null);
  // Behind a wall: no line, no rule.
  const walls = new Set(['4,65,0', '4,66,0', '4,67,0']);
  assert.equal(at(2.2, { walls }).L, null);
});

test('at 5 health with a blaze in line, the bot walks out of every line before the stance, and the stance asked after says so (25581 22:14Z, note 701)', async () => {
  const { Task } = require('../src/skills');
  const { Survival } = require('../src/survival');
  const walls = new Set(['2,65,1', '2,66,1', '2,67,1', '2,65,2', '2,66,2', '2,67,2', '2,65,3', '2,66,3', '2,67,3']);
  const { bot, blaze } = fightBot({ health: 5, walls });
  const walked = [];
  const navigate = async (b, task, goal) => { walked.push([goal.x, goal.y, goal.z]); b.entity.position = new Vec3(goal.x + 0.5, goal.y, goal.z + 0.5); };
  const survival = new Survival(bot, { navigate, place: async () => {} }, { state: { shelters: [] } });
  survival.scoutRetreat = async () => {};
  const asked = [];
  survival.decide = async (task, goal, save, q) => { asked.push(q); return { path: [Object.keys(q.tree)[0]] }; };
  const danger = () => [{ entity: blaze, distance: blaze.position.distanceTo(bot.entity.position), visible: require('../src/bunker').seenFrom(bot, [blaze], bot.entity.position.floored()).length > 0 }];
  const first = await survival.stanceStep(new Task('x'), {}, () => {}, danger(), false);
  assert.equal(first, true);
  assert.equal(asked.length, 0, 'not asked before stepping out');
  assert.equal(walked.length, 1);
  assert.equal(require('../src/bunker').seenFrom(bot, [blaze], bot.entity.position.floored()).length, 0, 'out of the blaze\'s line');
  assert.match(survival.state.lethalLine.did, /^walked 1 block/);
  // The next look asks the stance, with the rule and what it did said.
  const build = survival.stanceOptions.bind(survival);
  survival.stanceOptions = (...a) => { const o = build(...a); for (const v of Object.values(o)) v.run = async () => true; return o; };
  await survival.stanceStep(new Task('x'), {}, () => {}, danger(), false);
  assert.equal(asked.length, 1);
  assert.match(asked[0].state.oneShotEnds, /one shot that lands ends the bot/);
  assert.match(asked[0].state.oneShotEnds, /Just now: walked 1 block/);
  assert.equal(survival.state.stance.lethalKnown, true);
});

test('with a blaze in line and food a meal helps with, the eat says whether it is done before a shot here, and stepping out of every line then eating is offered (note 701)', t => {
  // The shot timing is read against the clock: held still, so a loaded
  // machine's lost time does not move the next shot past the meal.
  const held = Date.now(); t.mock.method(Date, 'now', () => held);
  const { Task } = require('../src/skills');
  const { Survival } = require('../src/survival');
  const walls = new Set(['2,65,1', '2,66,1', '2,67,1', '2,65,2', '2,66,2', '2,67,2', '2,65,3', '2,66,3', '2,67,3']);
  const { bot, blaze } = fightBot({ health: 12.1, walls, food: 17 });
  const survival = new Survival(bot, { navigate: async () => {}, place: async () => {} }, { state: { shelters: [] } });
  const now = Date.now();
  blaze.metadata[16] = 1; blaze._glowAt = now - 2000;
  const o = survival.stanceOptions(new Task('x'), {}, () => {}, [{ entity: blaze, distance: 8, visible: true }], false);
  assert.ok(o.eat, Object.keys(o).join(', '));
  assert.match(o.eat.description, /Not done before a shot: the blaze 8 blocks off, with a line here, shoots in about 1 second, inside the 1.9 seconds the meal takes/);
  assert.ok(o.step_out_and_eat, Object.keys(o).join(', '));
  assert.match(o.step_out_and_eat.description, /^Walk 1 block \(about 0.2 seconds, in their fire meanwhile\) to a spot no line from the blaze reaches, then eat the beef there \(about 1.6 seconds\)\..* over the walk and the meal, the 0.2 seconds of walking there included/);
  assert.ok(o.step_out_and_eat.description.length < 700, o.step_out_and_eat.description);
});
