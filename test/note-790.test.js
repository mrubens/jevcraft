'use strict';
// Endermen in reach and never struck (note 790). The forest hunt on 25595
// (2026-09-30 10:35Z) chose its enderman's fight only to be told it cost
// 27.8 damage from 19 health, "-8.8 after", left it, and held the turn 105
// seconds claiming one fifteen blocks up a fungus it had no way to; and a
// hunt chosen with a piece of the kit missing never swung at all, because
// the fight's own readiness asked the full kit the hunt's question had
// already said was short. The pearls wanted were sixteen in one place and
// thirteen everywhere else; and in the Overworld no enderman was ever put to
// Jev as a way to the pearls.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { Task } = require('../src/skills');
const { combatGear, armorSlots, handlers } = require('../src/mob-policy');
const { combatTarget, checkThreats } = require('../src/danger');
const hunt = require('../src/mob-hunt');
const ce = require('../src/combat-estimate');
const record = require('../src/pearl-record');
const { nextGameStage, observeProgress } = require('../src/game-progress');

// A bot with the kit worn, an enderman at `at`; `short` takes pieces off.
function fixture({ at = new Vec3(2, 64, .5), short = [], dimension = 'the_nether' } = {}) {
  const slots = Array(46).fill(null), task = new Task('hunt');
  const target = { id: 7, uuid: 'ender-7', name: 'enderman', position: at, width: .6, height: 2.9, isValid: true, metadata: {} };
  const attacks = [], movement = { canDig: true, allow1by1towers: true, allowParkour: false, scafoldingBlocks: [1] };
  const bot = Object.assign(new EventEmitter(), { registry, game: { dimension, gameMode: 'survival', difficulty: 'normal' },
    time: { timeOfDay: 6000 }, health: 20, food: 20, oxygenLevel: 20, entity: { position: new Vec3(.5, 64, .5) }, entities: { 7: target },
    inventory: { slots, items: () => slots.slice(9, 45).filter(Boolean) },
    world: { raycast: () => null }, blockAt: p => ({ name: p.y < 64 ? 'netherrack' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty' }),
    pathfinder: { movements: movement, setGoal: () => {}, getPathTo: () => ({ status: 'success', path: [] }) },
    clearControlStates: () => {}, lookAt: async () => {}, activateItem: () => {}, deactivateItem: () => {},
    equip: async () => {}, attack: entity => attacks.push(entity) });
  Object.defineProperty(bot, 'heldItem', { get: () => slots[36] });
  for (const [destination, names] of Object.entries(combatGear)) {
    if (short.includes(destination)) continue;
    const slot = destination === 'hand' ? 36 : armorSlots[destination];
    slots[slot] = { name: names[0], count: 1, type: registry.itemsByName[names[0]].id, slot, durabilityUsed: 0 };
  }
  const goal = { request: 'beat the game', mobHunt: { entity: 'enderman', item: 'ender_pearl', targetCount: 13 } };
  return { bot, task, target, goal, slots, attacks };
}

test('a hunt chosen with a piece of the kit missing swings: the kit is said on the question, not asked again by the fight (the arena: 7 hunts chosen with the trials\' kit, no blow)', async () => {
  const { bot, task, target, goal, attacks } = fixture({ short: ['legs', 'feet'] });
  target.position = new Vec3(2, 64, .5);
  // The hunt's own target is the fight's, short kit and all.
  bot._combatEncounter = { task, target, dimension: bot.game.dimension, expiresAt: Date.now() + 30000 };
  assert(combatTarget(bot, target), 'the hunt\'s own target is not a threat for the kit it lacks');
  bot.health = 11; assert(!combatTarget(bot, target), 'the body\'s floor still ends it'); bot.health = 20;
  delete bot._combatEncounter;
  bot.attack = entity => { attacks.push(entity); bot.emit('entityDead', entity); delete bot.entities[entity.id]; };
  const result = await hunt.fightForDrop(bot, task, target, goal, () => {}, { navigate: async () => {} }, { pickupWaitMs: 1 });
  assert.equal(attacks.length, 1, 'struck');
  assert(result.deathObserved);
});

test('an enderman\'s fight is priced as the hunt fights it: calm while it is closed on, the shield raised between swings at the arena\'s rate (25595 was told -8.8 after)', () => {
  const kit = { armour: ['iron_helmet', 'iron_chestplate', 'golden_boots'], weapon: 'iron_sword', health: 19, shield: true };
  const before = ce.fightEstimate({ threats: [{ name: 'enderman', distance: 8, visible: true }], ...kit });
  assert(before.fightHere.healthAfter < 0, 'the old price: more than the bot has');
  const now = ce.fightEstimate({ threats: [{ name: 'enderman', distance: 8, visible: true, calm: true }], ...kit, guarded: true });
  assert(now.fightHere.damageTaken < 10 && now.fightHere.healthAfter > 9, `priced ${now.fightHere.damageTaken}`);
  assert.match(now.fightHere.pace, /calm, it lands nothing until the first blow/);
  assert.match(now.fightHere.pace, /lands about 0\.27 of its hits a second \(measured in the arena\), where unguarded it lands about 0\.7/);
  // No shield: the unguarded rate stands; calm still lands nothing closing.
  const bare = ce.fightEstimate({ threats: [{ name: 'enderman', distance: 8, visible: true, calm: true }], ...kit, shield: false, guarded: true });
  assert(bare.fightHere.damageTaken > now.fightHere.damageTaken * 2);
  // A kind with no guarded rate measured is priced as before.
  const z = k => ce.fightEstimate({ threats: [{ name: 'zombie', distance: 2, visible: true }], ...kit, guarded: k }).fightHere.damageTaken;
  assert.equal(z(true), z(false));
  assert.match(ce.MOBS.enderman.note, /drops a pearl about half the time/);
  assert.match(ce.MOBS.enderman.note, /water hurts it, and so does the Overworld's rain, and it teleports away/);
});

test('the hunt\'s enderman option says the arena\'s record by kit and the ways a player takes them; leaving it says the pearls still needed', async () => {
  const { bot, task, goal } = fixture({ at: new Vec3(8.5, 64, .5), short: ['legs', 'feet'] });
  bot.health = 19;
  let asked = null;
  const client = { systemOne: async ({ questions }) => { asked = questions.branch_0.criteria; return { answers: { branch_0: { choice: 'defer', confidence: 0.9 } } }; } };
  assert.equal(await hunt.huntObserved(bot, task, goal, () => {}, {}, client), false);
  assert(asked?.hunt_7, 'the enderman is offered');
  const m = /About ([\d.]+) seconds and ([\d.]+) damage from 19 health, ([\d.-]+) after/.exec(asked.hunt_7);
  assert(m, asked.hunt_7);
  assert(Number(m[3]) > 5, `not "more than the bot has": ${m[0]}`);
  assert.match(asked.hunt_7, /The arena's record of the hunt's fight with one enderman/);
  assert.match(asked.hunt_7, /the trials' kit\), 13 runs, 11 kills, a median 5\.7 damage/);
  assert.match(asked.hunt_7, /keeps its eyes off the enderman's head/);
  assert.match(asked.hunt_7, /a two-high gap or a block over the head/);
  assert.match(asked.hunt_7, /drops a pearl about half the time/);
  assert.match(asked.defer, /Leaving them gains nothing toward the 13 ender pearls still needed/);
});

test('the claim does not take the turn for a target the hunt found no way to from where both stand; moved, it is claimed again', () => {
  const { bot, goal, target } = fixture({ at: new Vec3(10.5, 79, .5) });
  assert.equal(hunt.claim(bot, goal)?.facts.entity, 'enderman');
  hunt.noWayAt(goal.mobHunt, bot, target);
  assert.equal(hunt.claim(bot, goal), null, 'no way from here: not claimed');
  target.position = new Vec3(10.5, 64, 4.5);
  assert.equal(hunt.claim(bot, goal)?.facts.entity, 'enderman', 'the mob moved: claimed again');
  hunt.noWayAt(goal.mobHunt, bot, target);
  bot.entity.position = new Vec3(4.5, 64, .5);
  assert.equal(hunt.claim(bot, goal)?.facts.entity, 'enderman', 'the bot moved: claimed again');
});

test('on the way to the Nether an enderman in reach is a way to the pearls asked at pearl_order; none in reach, the walk to the Nether as before', () => {
  const ITEMS = { iron_sword: 1, iron_pickaxe: 1, cobblestone: 40, cooked_beef: 12, blaze_rod: 2, bucket: 1, flint_and_steel: 1, water_bucket: 1 };
  const make = entities => {
    const list = Object.entries(ITEMS).map(([name, count]) => ({ name, count, type: registry.itemsByName[name]?.id }));
    const slots = Array(46).fill(null);
    for (const [s, n] of [[5, 'iron_helmet'], [6, 'iron_chestplate'], [7, 'iron_leggings'], [8, 'iron_boots'], [45, 'shield']]) slots[s] = { name: n, count: 1, type: registry.itemsByName[n].id, durabilityUsed: 0 };
    const bot = { registry, game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, health: 20, food: 20, isAlive: true, chat() {}, emit() {},
      entity: { id: 1, position: new Vec3(0, 64, 0) }, time: { timeOfDay: 6000 }, entities,
      inventory: { items: () => list, slots }, findBlocks: () => [], clearControlStates() {},
      blockAt: p => ({ position: p, name: p.y < 64 ? 'stone' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty' }),
      pathfinder: { movements: { blocksCantBreak: new Set() }, setGoal() {}, getPathTo: () => ({ status: 'noPath', path: [] }) } };
    const goal = { kind: 'win', request: 'beat the game', from: 'TestPlayer', survival: {}, landmarks: [], portals: [{ x: 0, y: 70, z: 0, dimension: 'overworld' }, { x: 2, y: 64, z: 2, dimension: 'nether' }] };
    observeProgress(bot, goal);
    goal.gameProgress.milestones.nether_entered = { at: Date.now() - 1e6, dimension: 'nether' };
    // Its rods' bank was begun once this stay and set aside (notes 868, 873).
    require('../src/progress').setAside(goal, 'rod_bank', 'arrival', 'banked on coming out with rods', 30 * 60000);
    return { bot, goal };
  };
  const quiet = make({});
  assert.deepEqual(nextGameStage(quiet.bot, quiet.goal), { phase: 'reach_nether', action: 'enter_nether' });
  const { bot, goal } = make({ 9: { id: 9, name: 'enderman', position: new Vec3(12, 64, 0), isValid: true } });
  const stage = nextGameStage(bot, goal);
  assert.equal(stage.action, 'pearl_order'); assert.equal(stage.phase, 'reach_nether');
  const order = require('../src/pearl-order');
  const { tree } = order.tree(bot, goal, order.routes(bot, goal));
  assert.deepEqual(Object.keys(tree).sort(), ['hunt_enderman', 'rods_first']);
  assert.match(tree.rods_first.description, /^Go on to the Nether for the rods/);
  assert.match(tree.hunt_enderman.description, /the shield raised between swings, struck first while it is calm/);
  assert.doesNotMatch(tree.hunt_enderman.description, /more than the health there is/);
  // Chosen, the enderman is the step while one is in view.
  goal.pearlOrder = { pick: 'hunt_enderman', at: Date.now(), until: Date.now() + order.HOLD_MS, offered: ['enderman'] };
  const held = nextGameStage(bot, goal);
  assert.equal(held.phase, 'obtain_ender_pearls'); assert.equal(held.action, 'acquire'); assert.equal(held.item, 'ender_pearl');
});

test('the pearls wanted for gold in passing are eye-need\'s thirteen less the eyes made, not sixteen', () => {
  const { shortOfPearls } = require('../src/opportunistic-mining');
  const items = [{ name: 'ender_pearl', count: 12 }, { name: 'iron_pickaxe', count: 1 }];
  const bot = { game: { dimension: 'the_nether' }, inventory: { items: () => items }, entity: { position: new Vec3(0, 64, 0) } };
  const goal = { kind: 'win' };
  assert.equal(shortOfPearls(bot, goal), true, 'twelve of thirteen: short');
  items.push({ name: 'ender_eye', count: 2 });
  assert.equal(shortOfPearls(bot, goal), false, 'two eyes made: eleven pearls wanted, twelve carried (sixteen had said short)');
  items[0].count = 13; items.pop();
  assert.equal(shortOfPearls(bot, goal), false, 'thirteen carried: not short (sixteen had said short)');
  assert.equal(shortOfPearls({ ...bot, game: { dimension: 'overworld' } }, goal), false, 'gold for pearls is the Nether\'s');
});
