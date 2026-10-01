'use strict';
// Note 771c: hurt in the Nether where health cannot come back, with nothing
// to eat, food is the survival layer's question and claim, priced with the
// walk back through the portal. 25583 (mid-230-ad, 2026-10-01) at 1.3 health,
// hunger 15 to 16, nothing edible carried, walked fortress legs, pillared and
// crafted a spare pickaxe from 03:45 to 03:56Z, no food asked after its four
// food answers ended at once (03:44:03 to 03:44:26Z), and died to blaze fire.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { Task } = require('../src/skills');

const stack = (name, count = 1) => ({ name, count, type: registry.itemsByName[name]?.id ?? 0 });
function netherBot({ health = 1.3, food = 16, items = [['diamond_sword', 1], ['netherrack', 63], ['gold_nugget', 14]] } = {}) {
  const inv = items.map(i => stack(...i));
  return Object.assign(new EventEmitter(), { registry, version: '26.1', health, food, oxygenLevel: 20,
    game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, time: { timeOfDay: 6000, age: 200000 },
    entity: { position: new Vec3(245.5, 60, -35.5), onGround: true, height: 1.8, width: 0.6, velocity: new Vec3(0, 0, 0) }, entities: {},
    inventory: { items: () => inv, slots: {}, emptySlotCount: () => 20 }, heldItem: null,
    pathfinder: { movements: {}, setGoal() {}, getPathTo: () => ({ status: 'noPath', path: [] }) },
    world: { raycast: () => null }, findBlocks: () => [], chat() {},
    blockAt: p => { const y = Math.floor(p.y); const name = y < 60 ? 'nether_bricks' : 'air'; return { name, position: new Vec3(Math.floor(p.x), y, Math.floor(p.z)), boundingBox: name === 'air' ? 'empty' : 'block' }; } });
}
const goal = () => ({ kind: 'win', request: 'beat the game', portals: [{ dimension: 'the_nether', x: 160, y: 64, z: -20 }, { dimension: 'overworld', x: 1280, y: 70, z: -160 }] });

test('25583 at 03:45Z: the claim on the turn is food, pressing at six health or under, with the walk back through the portal', () => {
  const { claim } = require('../src/survival');
  const { claimSays } = require('../src/arbiter');
  const c = claim(netherBot(), goal(), { state: {} });
  assert.equal(c?.action, 'obtain_food');
  assert.equal(c.urgency, 'pressing');
  const said = claimSays(c);
  assert.match(said, /^Find food for hunger: /);
  assert.match(said, /portal/i);
  // Routine at 12 health; nothing at full hunger or with food carried.
  assert.equal(claim(netherBot({ health: 12 }), goal(), { state: {} })?.urgency, 'routine');
  assert.equal(claim(netherBot({ food: 18 }), goal(), { state: {} }), null);
  // Jev's own keep_on holds, while one hit does not end the bot.
  const g = goal();
  require('../src/progress').setAside(g, 'nether_return', 'food', 'Jev chose to go on', 20 * 60000);
  assert.equal(claim(netherBot({ health: 12 }), g, { state: {} }), null);
});

test('25583 at 03:45Z: the survival layer asks the food question with the trip back through the portal among its ways', async () => {
  const { Survival } = require('../src/survival');
  const bot = netherBot({ health: 3 });
  const survival = new Survival(bot, { navigate: async () => {}, dig: async () => {}, place: async () => {}, explore: async () => {}, returnOverworld: async () => {} }, { client: { systemOne: async () => ({}) } });
  let tree = null;
  survival.decide = async (task, g, save, q) => { tree = q.tree; return { path: ['continue_request'], action: { run: async () => {} }, stale: false }; };
  await survival.step(new Task('t', 'food'), goal(), () => {});
  assert(tree?.obtain_food, 'food asked');
  assert(tree.obtain_food.children.return_for_food, 'the trip back offered');
  assert.match(tree.obtain_food.children.return_for_food.description, /portal/);
});
