'use strict';
// Note 752c: a question about the work asked at low health says the body
// and offers seeing to it first. 25588 (14:09:10 to 14:09:28Z) took nine
// zombie hits in eight seconds, 20 to 1.3; at 2 health night_mine_target
// was asked with nothing said of the health and no way to heal or wall in,
// and turn_priority gave the work ("craft (stick)") 0.51 over "Eat cooked
// beef now" 0.46.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const arbiter = require('../src/arbiter');
const low = require('../src/low-health');
const hitLog = require('../src/hit-log');
const { decide } = require('../src/decisions');

const T0 = Date.parse('2026-09-30T14:09:10Z');
function hurtBot({ health = 2.3, food = 17 } = {}) {
  const zombie = { id: 7, name: 'zombie', type: 'hostile', position: new Vec3(1.5, 30, 0.5), height: 1.95, width: 0.6 };
  const items = [{ name: 'cooked_beef', count: 3 }, { name: 'cobblestone', count: 60 }];
  const bot = { health, food, game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, entities: { 7: zombie },
    registry: require('minecraft-data')('26.1'), time: { timeOfDay: 18000 },
    entity: { position: new Vec3(0.5, 30, 0.5), yaw: 0 }, inventory: { items: () => items, slots: [] },
    blockAt: p => ({ position: p.floored(), name: p.y < 30 ? 'stone' : 'air', boundingBox: p.y < 30 ? 'block' : 'empty' }),
    world: { raycast: () => null }, heldItem: null,
    equip: async item => { bot.heldItem = item; }, consume: async () => { bot.food = 20; items[0].count--; } };
  return { bot, zombie };
}
// Nine hits in eight seconds, 20 down to 2.3.
function nineHits(t, bot, zombie) {
  const hp = [20, 18.9, 17.4, 15.5, 13.5, 11.4, 9.2, 7, 4.6];
  hp.forEach((h, i) => { t.mock.timers.setTime(T0 + i * 1000); bot.health = h; hitLog.note(bot, zombie); });
  t.mock.timers.setTime(T0 + 18000); bot.health = 2.3;
}

test('low is 6 health or under, or four and more lost to hits in the last 30 seconds; not 12 health untouched (note 752c)', t => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const { bot, zombie } = hurtBot({ health: 12 });
  assert.equal(low.lowNow(bot), null);
  bot.health = 5;
  assert.deepEqual(low.lowNow(bot), { health: 5, fell: null });
  bot.health = 20; hitLog.note(bot, zombie); t.mock.timers.setTime(T0 + 3000); bot.health = 14;
  assert.deepEqual(low.lowNow(bot), { health: 14, fell: { from: 20, seconds: 3, hits: 1 } });
});

test('a work question asked at 2 health says the fall, the hits and the record, offers eating and walling in with their times, and chosen, eats and comes back stale (25588, note 752c)', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const { bot, zombie } = hurtBot();
  nineHits(t, bot, zombie);
  let sent;
  const client = { model: 'x', systemOne: async req => { sent = req; return { answers: Object.fromEntries(Object.entries(req.questions).map(([id, q]) => [id, { choice: Object.keys(q.criteria).includes('eat_first') ? 'eat_first' : Object.keys(q.criteria)[0], confidence: 0.9 }])) }; } };
  const tree = { ore_32: { description: 'Dig to the coal ore 4 blocks off (128 coal carried).' }, branch: { description: 'Dig a branch down to a working depth.' } };
  const d = await decide('night_mine_target', { client, bot, goal: { kind: 'win' }, task: { check() {} }, tree, state: {} });
  const criteria = Object.values(sent.questions)[0].criteria;
  assert(criteria.eat_first, 'eating offered');
  assert.match(JSON.stringify(criteria.eat_first), /Eat the cooked beef first, 1\.6 seconds standing still, hunger to 20; this question is asked again after it\./);
  assert.match(JSON.stringify(sent.state), /Health 2\.3, down from 20 in the last 18 seconds \(9 hits\), and it does not come back at hunger 17\. Hitting the bot now: the zombie 1 blocks off \(9 hits/);
  assert.match(JSON.stringify(sent.state), /In the played record \(2026-09-29T23:00Z to 2026-09-30T14:29Z\), at 6 health or under within 20 seconds of a hit, the work given the turn was followed by a death within a minute 3 times in 11, and a meal 3 in 25\./);
  assert.equal(d.stale, true);
  assert.deepEqual(d.bodyFirst, { key: 'eat_first', ran: true });
  assert.equal(bot.food, 20, 'eaten');
});

test('a work question at full health is asked as it was: no body options, nothing said (note 752c)', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const { bot } = hurtBot({ health: 20, food: 20 });
  let sent;
  const client = { model: 'x', systemOne: async req => { sent = req; return { answers: Object.fromEntries(Object.entries(req.questions).map(([id, q]) => [id, { choice: Object.keys(q.criteria)[0], confidence: 0.9 }])) }; } };
  const d = await decide('night_mine_target', { client, bot, goal: { kind: 'win' }, task: { check() {} }, tree: { ore_32: { description: 'Dig to the coal ore.' }, branch: { description: 'Dig a branch.' } }, state: {} });
  const criteria = Object.values(sent.questions)[0].criteria;
  assert.equal(criteria.eat_first, undefined); assert.equal(criteria.wall_in_first, undefined);
  assert.doesNotMatch(JSON.stringify(sent.state), /lowHealth/);
  assert.notEqual(d.stale, true);
});

test('turn_priority at 2.3 health: the work says the fall and the record beside the meal, and the meal says health comes back once eaten (25588 14:09:28Z, note 752c)', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const { bot, zombie } = hurtBot();
  nineHits(t, bot, zombie);
  let tree;
  const decide = async (id, q) => { tree = q.tree; return { path: ['vitals'] }; };
  const eat = { layer: 'vitals', action: 'eat', urgency: 'routine', facts: { health: 2.3, food: 17, healing: false, item: 'cooked_beef', foodPoints: 8 }, run: async () => true };
  const work = { layer: 'work', action: 'craft', urgency: 'routine', facts: { doing: 'craft (stick)' }, run: async () => true };
  await arbiter.take(bot, [eat, work], { decide, mobs: [], now: Date.now(), state: {} });
  assert.match(tree.work.description.does, /At low health: Health down from 20 in the last 18 seconds \(9 hits\)\. Hitting the bot now: the zombie.*In the played record.*The body can be seen to first: eating the cooked beef, 1\.6 seconds standing still, hunger to 20, and health comes back from then/);
  assert.match(tree.vitals.description.does, /Hunger 17 to 20\. It does not come back at hunger 17; eaten, it comes back from then, at hunger eighteen or more\./);
});

// 25591 (14:29:17 to 14:30:45Z): each fight chosen in place of a hide
// ended at once in no route, and the stance was asked again at once.
function skeletonBot() {
  const { EventEmitter } = require('node:events');
  const mob = { id: 7619, name: 'skeleton', type: 'hostile', position: new Vec3(6, 65, 0), height: 1.99, width: 0.6, isValid: true, heldItem: { name: 'bow' } };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, health: 20, food: 20, oxygenLevel: 20,
    entities: { 7619: mob }, time: { timeOfDay: 6000 }, registry: require('minecraft-data')('26.1'),
    entity: { position: new Vec3(0, 65, 0), onGround: true, width: 0.6, height: 1.8, velocity: new Vec3(0, 0, 0), metadata: { 0: 0 } },
    inventory: { items: () => [{ name: 'iron_sword', count: 1 }], slots: { 45: { name: 'shield' } }, emptySlotCount: () => 20 },
    blockAt: p => ({ position: p.floored(), name: 'air', boundingBox: 'empty', diggable: false, shapes: [] }),
    world: { raycast: () => null }, findBlocks: () => [], lookAt: async () => {}, look: async () => {}, equip: async () => {}, attack() {},
    pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, setControlState() {}, activateItem() {}, deactivateItem() {} });
  return { bot, threat: () => ({ entity: mob, distance: mob.position.distanceTo(bot.entity.position), visible: true }) };
}

test('a stance chosen in place of one still holding that fails at once with no route is said as tried, and the one it replaced goes on without a fresh ask (25591, note 752c)', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const { Survival } = require('../src/survival');
  const { Task } = require('../src/skills');
  const { bot, threat } = skeletonBot();
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
  survival.state.stance = { choice: 'take_cover', kinds: 'skeleton', ids: [7619], at: T0 - 16000, ranAt: T0 - 1000, health: 20, expects: { damage: 0, seconds: 15 } };
  const asked = [];
  survival.stanceOptions = () => ({
    take_cover: { description: 'Cover.', expects: { damage: 0, seconds: 15 }, run: async () => true },
    fight: { description: 'Fight here.', expects: { damage: 2, seconds: 15 }, run: async () => { survival.state.stanceWhy = 'nothing was struck, and the run at the skeleton 6 blocks off found no way to it'; return false; } },
    keep_working: { description: 'Carry on.', run: async () => true },
  });
  survival.decide = async (task, goal, save, q) => { asked.push(q.state.failedHereJustNow || null); return { path: ['fight'] }; };
  survival.scoutRetreat = async () => {};
  await survival.stanceStep(new Task('x'), {}, () => {}, [threat()], false);
  assert.equal(asked.length, 1);
  assert.equal(survival.state.stance?.choice, 'take_cover', 'the cover goes on');
  assert.equal(survival.state.stanceFailed.at(-1).choice, 'fight');
  t.mock.timers.setTime(T0 + 500);
  await survival.stanceStep(new Task('x'), {}, () => {}, [threat()], false);
  assert.equal(asked.length, 1, 'not asked again at once');
});

test('under a skeleton\'s fire, a stance that moves says the shield goes down while it moves; health falling from 20 to 12 in ten seconds leads with the ways out of the hits (25598, note 752c)', t => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const { Survival } = require('../src/survival');
  const { Task } = require('../src/skills');
  const { bot, threat } = skeletonBot();
  bot.inventory.items = () => [{ name: 'iron_sword', count: 1 }, { name: 'cooked_beef', count: 2 }, { name: 'cobblestone', count: 40 }];
  bot.food = 16;
  const mob = bot.entities[7619];
  [20, 17, 14].forEach((h, i) => { t.mock.timers.setTime(T0 + i * 4000); bot.health = h; hitLog.note(bot, mob); });
  t.mock.timers.setTime(T0 + 10000); bot.health = 12.5;
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
  const options = survival.stanceOptions(new Task('x'), {}, () => {}, [threat()], false);
  const moving = Object.keys(options).filter(k => ['retreat', 'charge_shooter', 'seal', 'bunker', 'dig_down'].includes(k));
  assert(moving.length, Object.keys(options).join(','));
  for (const k of moving) assert.match(options[k].description, /The shield is lowered while it moves/, k);
  assert(options.eat, 'eating offered');
  assert.doesNotMatch(options.eat.description, /The shield is lowered while it moves/);
  assert.match(Object.values(options)[0].description, /^At 12\.5 health, down from 20 in the last 10 seconds, and being hit, the ways out of the hits here, quickest first: /);
});
