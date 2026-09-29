'use strict';
// Note 656: fire resistance, the potion that makes a blaze's fire nothing.
// Recognized in the pockets and on the ground (potion_contents 11 and 12),
// kept from a barter, offered before a fortress and in a fight, and counted
// in the prices of a blaze fight while it lasts.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const fr = require('../src/fire-resistance');
const ce = require('../src/combat-estimate');

// An item as prismarine-item makes it from the network: its components, and
// the map of them by type.
const potion = (name, potionId, count = 1) => {
  const components = [{ type: 'potion_contents', data: { potionId, customEffects: [] } }];
  return { name, count, type: registry.itemsByName[name].id, components, componentMap: new Map(components.map(c => [c.type, c])) };
};
const FIRE_ID = registry.effectsByName.FireResistance.id;
const effectOn = (bot, seconds, now = Date.now()) => { bot.entity.effects = { [FIRE_ID]: { id: FIRE_ID, amplifier: 0, duration: seconds * 20, at: now } }; };

// A fortress floor (y 63 and under), no spawner, iron on, a shield.
function floorWorld({ items = [], health = 20, food = 20, at = new Vec3(0.5, 64, 0.5), dimension = 'the_nether' } = {}) {
  const Block = require('prismarine-block')(registry);
  const blockAt = p => { const f = p.floored(); const b = Block.fromStateId(registry.blocksByName[f.y <= 63 ? 'nether_bricks' : 'air'].defaultState); b.position = f; return b; };
  const stock = [{ name: 'iron_sword', count: 1, type: registry.itemsByName.iron_sword.id }, ...items];
  return Object.assign(new EventEmitter(), { game: { dimension, gameMode: 'survival', difficulty: 'normal' }, health, food, entities: {}, registry,
    entity: { position: at.clone(), onGround: true, metadata: [], yaw: 0, pitch: 0, height: 1.8, width: 0.6, effects: {} }, time: { timeOfDay: 6000 },
    inventory: { items: () => stock, slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 45: { name: 'shield' } } },
    blockAt, world: { raycast: () => null }, pathfinder: { movements: {}, setGoal() {} }, findBlocks: () => [] });
}
const blazeAt = (bot, id, x, y, z) => { const e = { id, name: 'blaze', type: 'hostile', position: new Vec3(x, y, z), height: 1.8, width: 0.6, isValid: true, metadata: { 16: 0 } }; bot.entities[id] = e; return e; };

test('a fire resistance potion is told by its potion_contents (11 three minutes, 12 eight), plain or splash; a water bottle is not one', () => {
  assert.deepEqual(fr.potionOf(potion('potion', 11)), { kind: 'drink', potion: 'fire_resistance', seconds: 180 });
  assert.deepEqual(fr.potionOf(potion('splash_potion', 12)), { kind: 'splash', potion: 'long_fire_resistance', seconds: 480 });
  assert.equal(fr.potionOf(potion('potion', 0)), null, 'water');
  assert.equal(fr.potionOf(potion('potion', 13)), null, 'swiftness');
  assert.equal(fr.potionOf({ name: 'potion', count: 1 }), null, 'nothing in it');
  // The old Potion tag, where an item carries one.
  assert.equal(fr.potionOf({ name: 'potion', count: 1, nbt: { value: { Potion: { value: 'minecraft:fire_resistance' } } } }).seconds, 180);
  const bot = floorWorld({ items: [potion('splash_potion', 11), potion('potion', 0, 2), potion('potion', 11, 2)] });
  const have = fr.carried(bot);
  assert.deepEqual(have.map(p => [p.kind, p.item.count]), [['drink', 2], ['splash', 1]], 'drinkable first, the water left out');
  assert.equal(fr.quickest(bot).kind, 'splash', 'in lava the splash acts sooner');
});

test('the effect\'s time left is the length the server sent less the time since (the registry\'s "FireResistance" read as fire_resistance)', () => {
  const bot = floorWorld();
  const now = Date.now();
  assert.equal(fr.left(bot, now), 0);
  effectOn(bot, 180, now - 60000);
  assert(Math.abs(fr.left(bot, now) - 120) < 0.01, `${fr.left(bot, now)}`);
  assert.match(fr.says(bot, now), /Fire resistance is on the body with about 2:00 left/);
  assert.match(fr.says(bot, now), /a ghast's blast/);
});

test('the barter table from the jar: 16 in 469 a throw for a fire resistance potion or splash potion, about 29 ingots for one', () => {
  const o = fr.barterOdds(10);
  assert.equal(fr.BARTER.total, 469);
  assert(Math.abs(o.perThrow - 16 / 469) < 1e-12);
  assert.equal(o.expectedIngots, 29.3);
  assert.equal(o.chanceWithGold, Math.round(100 * (1 - (1 - 16 / 469) ** 10)));
  assert.match(fr.barterSays(10), /8 in 469, a fire resistance splash potion 8 in 469/);
  assert.match(fr.barterSays(10), /about 29\.3 ingots for one on the average; with the 10 ingots to throw, about 29 in 100 of at least one/);
});

test('a barter keeps what it brings of fire resistance, and leaves a water bottle lying', () => {
  const { keeps } = require('../src/bartering');
  assert.equal(keeps(potion('potion', 11)), true);
  assert.equal(keeps(potion('splash_potion', 11)), true);
  assert.equal(keeps(potion('potion', 0)), false);
  assert.equal(keeps({ name: 'ender_pearl' }), true);
  assert.equal(keeps({ name: 'gravel' }), false);
});

test('a blaze fight priced with fire resistance: the fireballs and their fire count only from when it ends', () => {
  const threats = [{ name: 'blaze', distance: 8, shoots: true, visible: true }];
  const args = { threats, armour: ['iron_helmet', 'iron_chestplate'], weapon: 'iron_sword', health: 20 };
  const without = ce.fightEstimate(args).fightHere, withIt = ce.fightEstimate({ ...args, fireproofFor: 180 }).fightHere;
  const partly = ce.fightEstimate({ ...args, fireproofFor: 5 }).fightHere;
  assert(without.inFifteenSeconds > 1, `${without.inFifteenSeconds}`);
  assert.equal(withIt.inFifteenSeconds, 0, 'a blaze\'s fireball is fire: nothing while the effect lasts');
  assert(partly.inFifteenSeconds > 0 && partly.inFifteenSeconds < without.inFifteenSeconds, `${partly.inFifteenSeconds} between 0 and ${without.inFifteenSeconds}`);
  assert.match(withIt.fireResistance, /about 180 seconds left/);
  // The fire already on the body does nothing either, while the effect outlasts it.
  const burning = ce.fightEstimate({ ...args, threats: [], burningFor: 4.9 }).fightHere, burningProof = ce.fightEstimate({ ...args, threats: [], burningFor: 4.9, fireproofFor: 30 }).fightHere;
  assert(burning.inFifteenSeconds >= 4);
  assert.equal(burningProof.inFifteenSeconds, 0);
  assert.equal(burningProof.fire, undefined, 'the burning is not said as hurting');
  // A stance over the same mobs (stanceCost) keeps it: the blaze's pieces begin when it ends.
  const mobs = ce.fightEstimate({ ...args, fireproofFor: 180 }).mobs;
  assert.equal(mobs[0].fireproofFor, 180);
  assert.equal(ce.stanceCost({ mobs, seconds: 15, reaches: () => true }).damage, 0);
  const bare = ce.fightEstimate(args).mobs;
  assert(ce.stanceCost({ mobs: bare, seconds: 15, reaches: () => true }).damage > 0);
  // A ghast is priced as it was: its blast is not fire, and was never measured apart from the hit.
  const ghast = [{ name: 'ghast', distance: 20, shoots: true, visible: true }];
  assert.equal(ce.fightEstimate({ ...args, threats: ghast, fireproofFor: 180 }).fightHere.inFifteenSeconds, ce.fightEstimate({ ...args, threats: ghast }).fightHere.inFifteenSeconds);
});

test('the fire of landings (burnBetween) is nothing before the effect ends and counted after it', () => {
  const seg = [{ from: 0, to: 20, perSecond: 0.3 }];
  const all = ce.burnBetween(seg, 0, 20), proof = ce.burnBetween(seg, 0, 20, 0, 10), none = ce.burnBetween(seg, 0, 20, 0, 30);
  assert(all > proof && proof > 0, `${all} > ${proof} > 0`);
  assert.equal(none, 0);
  // The fire on the body counted certain while it lasts, unless the effect outlasts it.
  assert(ce.burnBetween([], 0, 5, 5) > 3);
  assert.equal(ce.burnBetween([], 0, 5, 5, 6), 0);
});

test('the close-in at a blaze with fire resistance on: the fireballs cost nothing, and it is said (note 656)', () => {
  const stand = require('../src/blaze-stand');
  const bot = floorWorld();
  blazeAt(bot, 1, 12.5, 65, 0.5);
  const danger = require('../src/danger').threats(bot, 24);
  const bare = stand.closeInCost(bot, danger);
  effectOn(bot, 180);
  const proof = stand.closeInCost(bot, danger);
  assert(bare.damage > 1, `${bare.damage}`);
  assert(proof.damage < bare.damage / 4, `${proof.damage} against ${bare.damage}`);
  assert.equal(Math.round(proof.fireproofFor), 180);
  assert.match(stand.closeInSays(proof, 20), /Fire resistance is on the body, about 180 seconds left: until it ends a fireball that lands does nothing/);
});

test('lava is counted harmless only with half a minute or more of the effect left; burning, while the effect outlasts the fire', () => {
  const body = require('../src/body');
  const bot = floorWorld();
  effectOn(bot, 120);
  assert.equal(body.lasts(bot, 'lava').fireResistance, true);
  effectOn(bot, 20);
  assert.notEqual(body.lasts(bot, 'lava').fireResistance, true, 'twenty seconds left: the lava is counted as hurting');
  assert(body.lasts(bot, 'lava').losesPerSecond > 0);
  // Alight out of the fire with two seconds of it left: twenty seconds of the effect outlast it.
  bot.entity.metadata = [1]; bot._alightUntil = Date.now() + 2000;
  assert.equal(body.lasts(bot, 'fire', { inFire: false }).fireResistance, true);
  assert.equal(body.burningSays(bot), null);
  bot.entity.effects = {};
  assert.match(body.burningSays(bot), /alight/);
});

test('before a fortress: a potion carried is offered to drink, priced by its minutes against the walk; with none, the barter for one where gold and a piglin are at hand', () => {
  const visit = require('../src/fortress-visit');
  const ctx = { fortress: { distance: 43, height: 0 } };
  const bot = floorWorld({ items: [potion('potion', 11)] });
  let tree = visit.fireOptions(bot, null, {}, () => {}, {}, ctx);
  assert.deepEqual(Object.keys(tree), ['drink_fire_resistance']);
  assert.match(tree.drink_fire_resistance.description, /^Drink a potion of fire resistance \(3:00\), drunk in 1\.6 seconds now, then go in/);
  assert.match(tree.drink_fire_resistance.description, /about 10 seconds' walk off/);
  // On for more than a minute: nothing to offer.
  effectOn(bot, 120);
  assert.deepEqual(visit.fireOptions(bot, null, {}, () => {}, {}, ctx), {});
  // None carried, gold boots worn, ingots, and a piglin 10 blocks off.
  const trader = floorWorld({ items: [{ name: 'gold_ingot', count: 12, type: registry.itemsByName.gold_ingot.id }] });
  trader.inventory.slots[8] = { name: 'golden_boots' };
  trader.entities[5] = { id: 5, name: 'piglin', type: 'hostile', position: new Vec3(10.5, 64, 0.5), isValid: true, metadata: {} };
  tree = visit.fireOptions(trader, null, {}, () => {}, {}, ctx);
  assert.deepEqual(Object.keys(tree), ['barter_fire_resistance']);
  assert.match(tree.barter_fire_resistance.description, /with the 12 ingots to throw, about 34 in 100 of at least one/);
  // In the Overworld piglins do not barter: not offered.
  trader.game.dimension = 'overworld';
  assert.deepEqual(visit.fireOptions(trader, null, {}, () => {}, {}, ctx), {});
});

test('in lava or alight, a fire resistance potion carried is one of the body\'s ways, the splash first', () => {
  const bot = floorWorld({ items: [potion('potion', 11), potion('splash_potion', 11)] });
  const way = fr.bodyWay(bot, null, 'the lava and burning do not hurt');
  assert.equal(way.seconds, fr.SPLASH_SECONDS);
  assert.match(way.description, /^Throw at the feet a splash potion of fire resistance \(3:00\)/);
  assert.match(way.description, /2 fire resistance potions carried/);
  assert.equal(fr.bodyWay(floorWorld(), null, 'x'), null);
});

test('drinking a potion: equipped, drunk, and the effect read back; a splash thrown looking straight down', async () => {
  const bot = floorWorld();
  const calls = [];
  bot.equip = async item => { calls.push(['equip', item.name]); bot.heldItem = item; };
  bot.consume = async () => { calls.push(['consume']); effectOn(bot, 180); };
  bot.look = async (yaw, pitch) => { calls.push(['look', pitch]); };
  bot.activateItem = () => { calls.push(['throw']); effectOn(bot, 175); };
  bot.deactivateItem = () => {};
  assert.equal(await fr.drink(bot, null, { item: potion('potion', 11), kind: 'drink', seconds: 180 }), true);
  assert.deepEqual(calls, [['equip', 'potion'], ['consume']]);
  bot.entity.effects = {}; calls.length = 0;
  assert.equal(await fr.drink(bot, null, { item: potion('splash_potion', 11), kind: 'splash', seconds: 180 }), true);
  assert.deepEqual(calls, [['equip', 'splash_potion'], ['look', -Math.PI / 2], ['throw']]);
});

// Note 617's ledge over the lava sea, two blazes 13.6 and 14.8 blocks off
// (test/blaze-volley-due.test.js), with a fire resistance potion carried.
test('in a blaze fight a potion carried is a stance, priced over its drinking, with the fight after it with and without the effect; drunk, the stances are priced with it', () => {
  const { Survival } = require('../src/survival');
  const { Task } = require('../src/skills');
  const world = p => {
    const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z), position = new Vec3(x, y, z);
    if (y === 54 && x >= -218 && x <= -196 && z >= -162 && z <= -146) return { position, name: 'nether_bricks', boundingBox: 'block' };
    return y <= 31 ? { position, name: 'lava', boundingBox: 'empty' } : { position, name: 'air', boundingBox: 'empty' };
  };
  const blaze = (id, x, y, z) => ({ id, name: 'blaze', type: 'hostile', position: new Vec3(x, y, z), height: 1.8, width: 0.6, isValid: true, metadata: { 16: 0 } });
  const b342 = blaze(342, -203.41, 58.97, -153.03), b343 = blaze(343, -204.53, 57, -151.69);
  const items = [{ name: 'iron_sword', count: 1 }, { name: 'netherrack', count: 77 }, potion('potion', 11)];
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health: 12, food: 19, oxygenLevel: 20,
    entity: { position: new Vec3(-217.5, 55, -155.42), onGround: true, height: 1.8, width: 0.6, velocity: new Vec3(0, 0, 0), metadata: [0], effects: {} }, entities: { 342: b342, 343: b343 }, time: { timeOfDay: 0 },
    inventory: { items: () => items, slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 7: { name: 'iron_leggings' }, 8: { name: 'iron_boots' }, 45: { name: 'shield' } } },
    world: { raycast: () => null }, blockAt: world, registry,
    pathfinder: { movements: {}, setGoal() {}, getPathTo: () => ({ status: 'noPath', path: [] }) }, clearControlStates() {}, setControlState() {}, getControlState: () => false,
    activateItem() {}, deactivateItem() {}, lookAt: async () => {}, look: async () => {}, equip: async () => {}, attack: () => {}, findBlocks: () => [] });
  const threat = e => ({ entity: e, distance: e.position.distanceTo(bot.entity.position), visible: true });
  const ask = () => new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {}, acquireStep: async () => {} }, { state: { shelters: [] } })
    .stanceOptions(new Task('x'), { step: { action: 'stalk_mob' } }, () => {}, [threat(b343), threat(b342)], false);
  const bare = ask();
  assert(bare.drink_fire_resistance, Object.keys(bare).join(','));
  const m = bare.drink_fire_resistance.description.match(/about ([\d.]+) damage as the bot is, about ([\d.]+) with the effect on/);
  assert(m, bare.drink_fire_resistance.description);
  assert(Number(m[1]) > 0 && Number(m[2]) === 0, m[0]);
  assert.match(bare.drink_fire_resistance.description, /^Drink a potion of fire resistance \(3:00\), drunk in 1\.6 seconds now \(1 carried\)/);
  assert.equal(bare.drink_fire_resistance.expects.seconds, fr.DRINK_SECONDS);
  // Drunk: not offered again, and a stance that stands in their fire is priced lower.
  effectOn(bot, 170);
  const proof = ask();
  assert.equal(proof.drink_fire_resistance, undefined);
  const k = ["fight", "keep_working", "close_in"].find(x => bare[x]?.expects && proof[x]?.expects);
  assert(k, Object.keys(proof).join(','));
  assert(proof[k].expects.damage < bare[k].expects.damage || bare[k].expects.damage === 0, `${k}: ${proof[k].expects.damage} against ${bare[k].expects.damage}`);
});
