'use strict';
// Note 578: mid-242-ac-nether-3, laying a span at y 54 in the Nether
// crouched, looked at eye height over the next cell, about fourteen degrees
// up, with an enderman standing on the span's line four blocks ahead: its
// eyes were in that look. It came on in half a second. The fight was told
// 5.4 seconds and 7.4 damage from 11.9 (a third of its hits for the one
// struck), and the rail was told only "anything at reach hitting freely
// meanwhile"; it landed six hits in seven seconds, 20 to none.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('node:events');
const { Task } = require('../src/skills');
const { Survival } = require('../src/survival');
const { gazePlugin, staredAt } = require('../src/gaze');
const { fightEstimate, blocksPerSecond } = require('../src/combat-estimate');

const ARMOUR = ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'golden_boots'];

test('a crouched step\'s look at the next cell, on an enderman\'s eyes four blocks along the span, is turned below them', () => {
  const enderman = { id: 772, name: 'enderman', position: new Vec3(41.5, 54, 114.5), isValid: true };
  const bot = Object.assign(new EventEmitter(), { controlState: { forward: true, sneak: true },
    entity: { position: new Vec3(45.4, 54, 114.5), yaw: 1.5688, pitch: 0.2487 }, entities: { 772: enderman } });
  assert.equal(staredAt(bot, undefined, undefined, 1).length, 1, 'the recorded look is on its eyes by the game\'s own test');
  gazePlugin(bot); bot.emit('spawn'); bot.emit('physicsTick');
  assert.equal(staredAt(bot).length, 0, `pitch ${bot.entity.pitch}`);
  assert.ok(bot.entity.pitch < 0.2487 && bot.entity.pitch > -0.3, `just below its eyes, not the ground: ${bot.entity.pitch}`);
  assert.equal(bot.entity.yaw, 1.5688, 'the heading the step walks along is kept');
});

test('a look that is on no enderman\'s eyes is left as it is, a deliberate look up included', () => {
  const bot = Object.assign(new EventEmitter(), { controlState: { forward: false, sneak: false },
    entity: { position: new Vec3(0, 64, 0), yaw: 0, pitch: 0.6 }, entities: { 7: { name: 'enderman', position: new Vec3(0, 64, -10), isValid: true } } });
  gazePlugin(bot); bot.emit('spawn'); bot.emit('physicsTick');
  assert.equal(bot.entity.pitch, 0.6);
  // A strike's look at its middle, at reach: not its eyes.
  const strike = Object.assign(new EventEmitter(), { controlState: {}, entity: { position: new Vec3(0, 64, 0), yaw: 0, pitch: Math.atan2(64 + 1.45 - 65.62, 2) }, entities: { 7: { name: 'enderman', position: new Vec3(0, 64, -2), isValid: true } } });
  const before = strike.entity.pitch;
  gazePlugin(strike); strike.emit('spawn'); strike.emit('physicsTick');
  assert.equal(strike.entity.pitch, before);
});

test('an enderman fought lands about 0.7 of its hits a second while it is struck, and comes on at its angry speed', () => {
  const e = fightEstimate({ threats: [{ name: 'enderman', distance: 2.1, visible: true }], armour: ARMOUR, weapon: 'iron_sword', health: 11.9, shield: true });
  assert.equal(e.mobs[0].hitsBot, 4.1, 'the recorded 4.06 a hit through iron and gold boots');
  assert.equal(e.mobs[0].swingsToKill, 7);
  // Recorded: six hits in 6.7 seconds; told 7.4 before.
  assert.ok(e.fightHere.damageTaken >= 15 && e.fightHere.healthAfter < 0, JSON.stringify(e.fightHere));
  assert.match(e.mobs[0].note, /cannot come into a space under three blocks high/);
  assert.equal(Math.round(blocksPerSecond('enderman') * 10) / 10, 8.7, 'it came 2.2 blocks in a quarter second');
});

// The span of the trial: one wide along x at y 54 over a 22-block drop.
const block = (p, name) => ({ position: p, name, boundingBox: name === 'air' ? 'empty' : 'block' });
const spanBot = ({ enderman, items, health }) => {
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health, food: 18, oxygenLevel: 20,
    entity: { position: new Vec3(47.4, 54, 114.5), onGround: true, height: 1.8, velocity: new Vec3(0, 0, 0), yaw: 0, pitch: 0 }, entities: { [enderman.id]: enderman }, time: { timeOfDay: 0 },
    inventory: { items: () => items, slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 7: { name: 'iron_leggings' }, 8: { name: 'golden_boots' }, 45: { name: 'shield' } } },
    world: { raycast: () => null },
    blockAt: p => { const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z); return block(p, (y === 53 && z === 114 && x >= 20 && x <= 90) || y === 31 ? 'netherrack' : 'air'); },
    registry: require('minecraft-data')('26.1'),
    pathfinder: { movements: {}, setGoal() {}, getPathTo: () => ({ status: 'noPath', path: [] }) }, clearControlStates() {}, setControlState() {}, getControlState: () => false,
    activateItem() {}, deactivateItem() {}, lookAt: async () => {}, look: async () => {}, equip: async () => {}, attack: () => {}, findBlocks: () => [] });
  return bot;
};

test('the rail on a span with an enderman at arm\'s length is priced with the planks and the walling under its blows, then the fight', () => {
  const enderman = { id: 772, name: 'enderman', type: 'hostile', position: new Vec3(45.4, 54, 114.5), height: 2.9, width: 0.6, isValid: true };
  const items = [{ name: 'iron_sword', count: 1 }, { name: 'oak_planks', count: 3 }, { name: 'oak_log', count: 5 }, { name: 'gravel', count: 16 }];
  const bot = spanBot({ enderman, items, health: 11.9 });
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {}, acquireStep: async () => {} }, { state: { shelters: [] } });
  const danger = [{ entity: enderman, distance: enderman.position.distanceTo(bot.entity.position), visible: true }];
  const options = survival.stanceOptions(new Task('x'), { step: { action: 'cross_toward' } }, () => {}, danger, false);
  assert.ok(options.rail_and_fight, Object.keys(options).join(','));
  assert.ok(options.rail_and_fight.expects, 'priced');
  assert.ok(options.rail_and_fight.expects.damage >= 11.9, JSON.stringify(options.rail_and_fight.expects));
  assert.match(options.rail_and_fight.description, /then fight here: .*About [\d.]+ damage from the mobs here in the next fifteen seconds this way, the [\d.]+ seconds of making the planks and walling included, from 11\.9 health \(more than the bot has\)/);
  // The span's hold walls first too, and is priced the same way.
  assert.ok(options.hold_on_span.expects.damage >= 11.9, JSON.stringify(options.hold_on_span.expects));
  assert.match(options.hold_on_span.description, /About [\d.]+ damage from the mobs here in the next fifteen seconds this way, the 3\.4 seconds of walling included, from 11\.9 health \(more than the bot has\)/);
  assert.match(options.fight.description, /about [\d.]+ seconds and (1[5-9]|2\d)(\.\d)? damage to kill them all, from 11\.9 health \(more than the bot has\)/);
  assert.match(options.retreat.description, /runs at about 8\.7 blocks a second, faster than the bot sprints \(5\.6\)/);
});
