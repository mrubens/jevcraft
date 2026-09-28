'use strict';
// Low health in the Nether with nothing to eat (note 626): what the way down to the floor says of the
// hoglins by it, what the trip back for food is said to cost in time, and what keep_on does to a trip Jev chose.
// mid-208-k-nether-3-fortress-6 (25587, 18:36:25Z), mid-243-ag-fortress-5 (25589, 18:09:58Z).
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');

const item = (name, count = 1) => ({ name, count, type: registry.itemsByName[name].id, durabilityUsed: 0 });
function netherBot({ at, health, food, worn = {}, items = [], entities = {}, dimension = 'the_nether', floorY = at.y - 1 }) {
  const slots = [];
  for (const [slot, name] of Object.entries({ 5: worn.head, 6: worn.torso, 7: worn.legs, 8: worn.feet, 45: worn.offhand })) if (name) slots[slot] = item(name);
  const ground = p => Math.floor(p.y) <= Math.floor(floorY) ? { name: 'netherrack', boundingBox: 'block', position: p } : { name: 'air', boundingBox: 'empty', position: p };
  return Object.assign(new EventEmitter(), {
    registry, health, food, foodSaturation: 0, entity: { id: 1, position: at, height: 1.8, width: 0.6, onGround: true, velocity: new Vec3(0, 0, 0) },
    game: { dimension, gameMode: 'survival', difficulty: 'normal' }, time: { timeOfDay: 6000 },
    inventory: { items: () => items, slots }, entities, world: { raycast: () => null }, blockAt: p => ground(p.floored ? p.floored() : p),
  });
}
const hoglin = (id, x, y, z) => ({ id, name: 'hoglin', type: 'hostile', position: new Vec3(x, y, z), isValid: true, height: 1.4, width: 1.4 });
const worn = { head: 'iron_helmet', torso: 'iron_chestplate', legs: 'iron_leggings', feet: 'golden_boots', offhand: 'shield' };

test('the way along the floor says what the hoglins by it cost if they all came, at the health the bot has, and that none of it comes back (25587 at 10 health, note 626)', () => {
  const { walkFloor, lineColumns, floorWalkSays } = require('../src/nether-travel');
  const entities = { 1: hoglin(1, 5.5, 41, 3.5), 2: hoglin(2, 8.5, 41, -2.5) };
  const bot = netherBot({ at: new Vec3(0.5, 41, 0.5), health: 10, food: 14, worn, items: [item('iron_sword'), item('netherrack', 28)], entities });
  const floor = walkFloor(bot, new Vec3(0, 41, 0), lineColumns({ x: 0, z: 0 }, { x: 24, z: 0 }, 24));
  assert.deepEqual(floor.mobs, { hoglin: 2 });
  assert.match(floor.mobsPrice, /^ If they all came at the bot on that way, fighting them is about \d+(\.\d)? damage from 10 health \(more than the bot has\); nothing carried is food and hunger 14 is under eighteen, so none of that health comes back\.$/);
  const said = floorWalkSays(floor, { along: 'on the straight line' });
  assert.match(said, /By the floor that way: 2 hoglins\. If they all came at the bot on that way/);
  // One hoglin at full health: a price, and no talk of health that does not come back.
  const one = netherBot({ at: new Vec3(0.5, 41, 0.5), health: 20, food: 20, worn, items: [item('iron_sword'), item('cooked_beef', 8)], entities: { 1: hoglin(1, 5.5, 41, 3.5) } });
  const priced = walkFloor(one, new Vec3(0, 41, 0), lineColumns({ x: 0, z: 0 }, { x: 24, z: 0 }, 24)).mobsPrice;
  assert.match(priced, /^ If it came at the bot on that way, fighting it is about \d+(\.\d)? damage from 20 health\.$/);
  // No mob by the way: nothing is priced.
  assert.equal(walkFloor(netherBot({ at: new Vec3(0.5, 41, 0.5), health: 10, food: 14, worn, items: [] }), new Vec3(0, 41, 0), lineColumns({ x: 0, z: 0 }, { x: 24, z: 0 }, 24)).mobsPrice, '');
});

test('the walk back to a portal in the Nether is said at the pace the day\'s walks made, from sixty blocks, and not in the Overworld or for a short walk (note 626)', () => {
  const { portalTrip, NETHER_TRIPS } = require('../src/game-progress');
  const goal = { portals: [{ x: 3, y: 44, z: 8, dimension: 'nether' }] };
  const far = netherBot({ at: new Vec3(-125.5, 39, 415.5), health: 3.5, food: 13, worn, items: [] });
  const said = portalTrip(far, goal);
  assert.match(said, /^The nearest portal remembered is 4\d\d blocks off, about 9\d seconds at a walk if nothing stops it, and back through one after\./);
  assert.match(said, /In the Nether the bot's walks back to a portal made 17 to 30 blocks a minute over 2026-09-28's trials, the stops for mobs, edges and drops counted: about 1\d to 2\d minutes, not seconds\./);
  assert.match(said, /Of 181 such walks of over 60 blocks 22 came out in the Overworld, 18 ended in a death and the rest were given up, set aside or stalled; of the 33 begun under eight health 4 came out and 6 died\./);
  // Above eight health the walks begun under it are not the bot's.
  assert.doesNotMatch(portalTrip(netherBot({ at: new Vec3(-125.5, 39, 415.5), health: 15, food: 13, worn, items: [] }), goal), /begun under eight health/);
  // Forty-one blocks: the straight walk.
  const near = portalTrip(netherBot({ at: new Vec3(43.5, 44, 8.5), health: 3.5, food: 13, worn, items: [] }), goal);
  assert.doesNotMatch(near, /blocks a minute/);
  assert.match(near, /^The nearest portal remembered is 41 blocks off, about 10 seconds at a walk, and back through one after\./);
  // The Overworld's walks are not the Nether's.
  const over = netherBot({ at: new Vec3(400.5, 70, 400.5), health: 20, food: 20, dimension: 'overworld', items: [] });
  assert.doesNotMatch(portalTrip(over, { portals: [{ x: 3, y: 64, z: 8, dimension: 'overworld' }] }), /blocks a minute/);
  assert.equal(NETHER_TRIPS.trips, 181);
});

// mid-243-ag-fortress-5, 18:09:58: the walk back for food Jev chose at 18:07:00 (go_back 0.52, 3.5 health, the portal 277
// blocks off) had stopped at a drop; the stall's answers were dirt, cobblestone and keep_on.
function stalled25589({ chosen = true } = {}) {
  const now = Date.now();
  const bot = netherBot({ at: new Vec3(-127.5, 44, 252.5), health: 3.5333, food: 13, worn, items: [item('iron_sword'), item('netherrack', 13), item('warped_wart_block', 13)] });
  const goal = { kind: 'win', request: 'beat the game', portals: [{ x: 3, y: 44, z: 8, dimension: 'nether' }, { x: 24, y: 67, z: 64, dimension: 'overworld' }], survival: { shelters: [] }, step: { action: 'cross_toward', what: 'the portal back', target: { x: 3, y: 44, z: 8 } } };
  if (chosen) goal.leaveNether = { reason: 'food', pick: 'go_back', until: 0, at: now - 178000 };
  return { bot, goal };
}

test('keep_on says it ends the walk back for food Jev chose and that stopped here; return_for_food says it tries that walk again (25589 at 18:09:58, note 626)', () => {
  const { netherAnswers } = require('../src/nether-travel');
  const { Task } = require('../src/skills');
  const { bot, goal } = stalled25589();
  const answers = netherAnswers(bot, new Task('stall'), goal, () => {}, { survival: { foodHunt() {} }, actions: { navigate: async () => {}, returnOverworld: async () => {} } });
  assert.match(answers.keep_on.description, /It ends the trip back for food that Jev chose 3 minutes ago and that has stopped here, 2\d\d blocks from the portal: the walk home is given up, not stalled\.$/);
  assert.match(answers.return_for_food.description, /The trip back for food that Jev chose 3 minutes ago is the walk that has stopped here, 2\d\d blocks from the portal; this tries the walk again from here, at 3\.5 health\.$/);
  // No trip chosen: the words are the ones they were.
  const none = stalled25589({ chosen: false });
  const plain = netherAnswers(none.bot, new Task('stall'), none.goal, () => {}, { survival: { foodHunt() {} }, actions: { navigate: async () => {}, returnOverworld: async () => {} } });
  assert.doesNotMatch(plain.keep_on.description, /has stopped here/);
  assert.doesNotMatch(plain.return_for_food.description, /has stopped here/);
  // A trip chosen long ago is not this one.
  const old = stalled25589(); old.goal.leaveNether.at -= 40 * 60000;
  const stale = netherAnswers(old.bot, new Task('stall'), old.goal, () => {}, { survival: { foodHunt() {} }, actions: { navigate: async () => {}, returnOverworld: async () => {} } });
  assert.doesNotMatch(stale.keep_on.description, /has stopped here/);
});
