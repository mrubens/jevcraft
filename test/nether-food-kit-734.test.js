'use strict';
// Note 734 (critic-20260930T0817Z item 2, 25592; critic-20260930T0755Z item
// 2, 25588): nether_food_kit's restock_food was chosen at full hunger and
// health ("Stocking up on food here first") with the option's own words
// never saying so: the stay's own count (94 minutes wanted, 46 points
// carried) was in the state but not repeated on restock_food itself, so it
// read as if nothing was known of the bot's current vitals. The option now
// states the food points already carried, and hunger and health, and says
// plainly when both are already full.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { Task } = require('../src/skills');

const item = (name, count = 1) => ({ name, count, type: registry.itemsByName[name].id, durabilityUsed: 0 });
function netherBot({ at = new Vec3(0.5, 41, 0.5), health = 20, food = 20, items = [], entities = {} } = {}) {
  return Object.assign(new EventEmitter(), {
    registry, health, food, foodSaturation: 0, entity: { id: 1, position: at, height: 1.8, width: 0.6, onGround: true, velocity: new Vec3(0, 0, 0) },
    game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, time: { timeOfDay: 6000 },
    inventory: { items: () => items, slots: [] }, entities, world: { raycast: () => null }, blockAt: () => ({ name: 'netherrack', boundingBox: 'block' }),
    findBlocks: () => [], chat() {},
  });
}
const save = () => {};
const stubClient = picks => { const asked = []; return { asked, systemOne: async ({ questions }) => {
  const keys = Object.keys(questions.branch_0.criteria);
  asked.push({ options: questions.branch_0.criteria });
  const choice = picks.find(p => keys.includes(p)) || keys[0];
  return { answers: { branch_0: { choice, confidence: 0.8 } } };
} }; };

test('restock_food states the food points already carried and that hunger and health are already full (note 734)', async () => {
  const { askStayKit } = require('../src/nether-food');
  // A hoglin known so restock_food has a way to offer, and no raw meat
  // carried (nothing to cook): full hunger and health, but the stay wants
  // more than the few points carried.
  const goal = { kind: 'win', portals: [{ x: 20, y: 44, z: 7, dimension: 'nether' }], sightings: {},
    survival: {}, netherStayWanted: undefined };
  const entities = { 1: { id: 1, name: 'hoglin', type: 'hostile', position: new Vec3(20.5, 41, 0.5), isValid: true, height: 1.4, width: 1.4 } };
  const bot = netherBot({ items: [item('mutton', 1)], entities, health: 20, food: 20 });
  const actions = { returnOverworld: async () => {}, navigate: async () => {} };
  const client = stubClient(['restock_food', 'hoglin_walk']);
  await require('../src/nether-food').askStayKit(bot, new Task('t'), goal, save, { actions, client });
  assert.equal(client.asked.length, 2, 'the food kit, then restock_food\'s own ways');
  const { options } = client.asked[0];
  assert.ok(options.restock_food, 'restock_food is offered');
  assert.match(options.restock_food, /\bhunger 20 and health 20\b/);
  assert.match(options.restock_food, /both full now/);
  assert.match(options.restock_food, /\d+ food points already carried/);
});
